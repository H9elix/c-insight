import * as vscode from "vscode";
import { CONTEXT_KEYS, INTERNAL_COMMANDS, VIEWS } from "../ids";
import { MutableTreeProvider, TreeNode } from "../views/treeNode";
import { WebviewResultTree } from "../views/resultTreeView";
import { isGitMetadata, isKnownBinaryFile, ProjectFileEntry, projectFileLimit, projectFileSort, sortProjectFiles } from "./projectFileModel";
import { projectFileFollowAction } from "./projectFileFollowModel";

/** File-system presentation only. No AnalysisService, compilation database or document-content watcher. */
export class ProjectFilesExplorer implements vscode.Disposable {
  readonly provider = new MutableTreeProvider();
  readonly view: WebviewResultTree;
  private readonly disposables: vscode.Disposable[] = [];
  private watchers: vscode.Disposable[] = [];
  private entries: ProjectFileEntry[] = [];
  private nodes = new Map<string, TreeNode>();
  private readonly descriptions = new WeakMap<TreeNode, string>();
  private timer?: NodeJS.Timeout;
  private cancellation?: vscode.CancellationTokenSource;
  private scanning = false;
  private dirty = true;
  private disposed = false;
  private revision = 0;
  private activationRevision = 0;
  private highlighted?: TreeNode;
  private truncated = false;
  private scans = 0;
  private status = "";
  private locked = false;
  private interacting = false;
  private opening?: number;
  private followTimer?: NodeJS.Timeout;
  private followGeneration = 0;
  private pendingOpened?: { uri: string; inputRevision: number };
  private lastViewFocused = false;
  private followActions = 0;
  private lastFollowAction?: { uri: string; clear: "always" | "ifHidden"; reveal: boolean; inputRevision: number };

  constructor(extensionUri: vscode.Uri) {
    this.provider.setInteractionScope(VIEWS.PROJECT_FILES);
    this.view = new WebviewResultTree(VIEWS.PROJECT_FILES, this.provider, extensionUri, {
      persistentFilter: true, hideCollapseAll: true, trackInteraction: true,
      filterTitle: vscode.l10n.t("Filter files by name or path"),
      onActivate: (node, intent, revision) => this.activate(node, intent, revision),
    });
    this.disposables.push(
      this.provider, this.view,
      vscode.window.registerWebviewViewProvider(VIEWS.PROJECT_FILES, this.view, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      this.view.onDidChangeVisibility(({ visible }) => {
        this.cancelFollow();
        if (!visible) { this.pendingOpened = undefined; this.opening = undefined; this.activationRevision++; }
        this.synchronizeFollowPolicy();
        this.stopWatching();
        this.invalidate();
        if (visible) this.startWatching();
      }),
      this.view.onDidChangeInteraction(({ focused }) => {
        const entered = focused && !this.lastViewFocused;
        this.lastViewFocused = focused;
        this.cancelFollow();
        if (this.opening === undefined && entered) this.pendingOpened = undefined;
        this.scheduleFollow();
      }),
      vscode.window.onDidChangeWindowState(() => {
        this.cancelFollow();
        this.synchronizeFollowPolicy();
        this.scheduleFollow();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("files.exclude") || event.affectsConfiguration("cInsight.projectFiles.maximumFiles")) {
          this.invalidate();
        } else if (event.affectsConfiguration("cInsight.projectFiles.sortBy")) {
          this.publishEntries();
        } else if (event.affectsConfiguration("cInsight.projectFiles.followActiveEditor")) {
          this.updateActiveFile();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateActiveFile()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.updateActiveFile()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.updateActiveFile()),
    );
  }

  refresh(): void {
    this.cancelFollow();
    this.invalidate();
    if (this.view.visible) void vscode.commands.executeCommand(`${VIEWS.PROJECT_FILES}.focus`);
  }

  async setLocked(locked: boolean): Promise<void> {
    this.locked = locked;
    this.cancelFollow();
    if (locked) this.pendingOpened = undefined;
    this.synchronizeFollowPolicy();
    await vscode.commands.executeCommand("setContext", CONTEXT_KEYS.PROJECT_FILES_LOCKED, locked);
    if (!locked) this.scheduleFollow();
  }

  async chooseSort(): Promise<void> {
    const choices = [
      { label: vscode.l10n.t("File name"), value: "name" },
      { label: vscode.l10n.t("Relative path"), value: "path" },
      { label: vscode.l10n.t("File type"), value: "type" },
    ];
    this.interacting = true;
    this.cancelFollow(); this.synchronizeFollowPolicy();
    try {
      const selected = await vscode.window.showQuickPick(choices, { title: vscode.l10n.t("Sort Project Files") });
      if (selected) {
        await vscode.workspace.getConfiguration("cInsight.projectFiles").update(
          "sortBy", selected.value, vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
        );
      }
      if (this.view.visible) await vscode.commands.executeCommand(`${VIEWS.PROJECT_FILES}.focus`);
    } finally {
      this.interacting = false;
      this.cancelFollow(); this.synchronizeFollowPolicy();
    }
  }

  stateForTest(): unknown {
    return { visible: this.view.visible, scanning: this.scanning, dirty: this.dirty, scans: this.scans,
      truncated: this.truncated, status: this.status,
      locked: this.locked, focused: this.view.hasFocus, inputRevision: this.view.inputRevision,
      followActions: this.followActions, lastFollowAction: this.lastFollowAction,
      files: this.provider.getRoots().map(node => ({ uri: node.location?.uri.toString(), name: node.label,
        description: node.description, active: !!node.labelHighlights?.length })),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    this.activationRevision++;
    this.cancelFollow();
    clearTimeout(this.timer);
    this.cancellation?.cancel();
    this.stopWatching();
    this.disposables.forEach(item => item.dispose());
    this.nodes.clear(); this.entries = [];
  }

  private startWatching(): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, true, false);
    const changed = () => this.invalidate(500);
    this.watchers.push(watcher, watcher.onDidCreate(changed), watcher.onDidDelete(changed),
      vscode.workspace.onDidCreateFiles(changed), vscode.workspace.onDidDeleteFiles(changed), vscode.workspace.onDidRenameFiles(changed));
  }

  private stopWatching(): void { this.watchers.splice(0).forEach(item => item.dispose()); }

  private invalidate(delay = 0): void {
    this.dirty = true;
    this.revision++;
    this.cancellation?.cancel();
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.disposed && this.view.visible) this.queueScan(delay);
  }

  private queueScan(delay: number): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.scan();
    }, delay);
  }

  private setStatus(status: string): void { this.status = status; this.view.setStatus(status); }

  private async scan(): Promise<void> {
    if (this.scanning || !this.dirty || this.disposed || !this.view.visible) return;
    this.dirty = false;
    const revision = this.revision;
    const cancellation = new vscode.CancellationTokenSource();
    this.cancellation = cancellation;
    this.scanning = true;
    try {
      if (!vscode.workspace.workspaceFolders?.length) {
        this.entries = []; this.truncated = false; this.publishEntries();
        this.setStatus(vscode.l10n.t("Open a folder or workspace to list project files."));
        return;
      }
      this.setStatus(vscode.l10n.t("Loading project files..."));
      const maximum = projectFileLimit(vscode.workspace.getConfiguration("cInsight.projectFiles").get<number>("maximumFiles", 50000));
      this.scans++;
      // undefined preserves folder-specific files.exclude, not search.exclude or .gitignore.
      const discovered = await this.discoverFiles(maximum, cancellation.token);
      if (this.disposed || cancellation.token.isCancellationRequested || revision !== this.revision || !this.view.visible) return;
      const byUri = new Map<string, ProjectFileEntry>();
      for (const uri of discovered) {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) continue;
        const relativePath = uri.path.slice(folder.uri.path.replace(/\/$/, "").length + 1);
        if (!relativePath || isGitMetadata(relativePath)) continue;
        byUri.set(uri.toString(), { uri: uri.toString(), name: relativePath.split("/").at(-1)!, relativePath, rootName: folder.name });
      }
      this.truncated = discovered.length > maximum;
      this.entries = [...byUri.values()].slice(0, maximum);
      this.publishEntries();
      this.setStatus(this.truncated
        ? vscode.l10n.t("Loaded {count} files; limit reached. List and search may be incomplete.", { count: this.entries.length })
        : vscode.l10n.t("{count} project files", { count: this.entries.length }));
    } catch (error) {
      if (!this.disposed && revision === this.revision && !cancellation.token.isCancellationRequested) {
        this.setStatus(vscode.l10n.t("Could not list project files: {error}", { error: String(error) }));
      }
    } finally {
      cancellation.dispose();
      if (this.cancellation === cancellation) this.cancellation = undefined;
      this.scanning = false;
      if (this.dirty && this.view.visible && !this.disposed) this.queueScan(0);
    }
  }

  private publishEntries(): void {
    const order = projectFileSort(vscode.workspace.getConfiguration("cInsight.projectFiles").get("sortBy"));
    const multiple = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const previous = this.nodes;
    this.nodes = new Map();
    const roots = sortProjectFiles(this.entries, order).map(entry => {
      const directory = entry.relativePath.includes("/") ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/")) : ".";
      const node: TreeNode = previous.get(entry.uri) ?? { id: entry.uri, label: entry.name,
        location: { uri: vscode.Uri.parse(entry.uri), range: new vscode.Range(0, 0, 0, 0) },
        previewMode: "reference" as const, previewTitle: entry.name, contextValue: "projectFile", icon: new vscode.ThemeIcon("file"),
      };
      node.description = multiple ? `${entry.rootName}/${directory}` : directory;
      this.descriptions.set(node, node.description);
      node.tooltip = vscode.Uri.parse(entry.uri).fsPath;
      node.filterText = `${entry.name} ${entry.rootName}/${entry.relativePath}`;
      node.labelHighlights = undefined;
      this.nodes.set(entry.uri, node);
      return node;
    });
    this.highlighted = undefined;
    this.provider.setRoots(roots);
    this.updateActiveFile();
  }

  private discoverFiles(maximum: number, token: vscode.CancellationToken): Thenable<vscode.Uri[]> {
    return vscode.workspace.findFiles("**/*", undefined, maximum + 1, token);
  }

  private updateActiveFile(): void {
    if (this.disposed || !this.view.visible) return;
    const uri = this.activeUri();
    const enabled = vscode.workspace.getConfiguration("cInsight.projectFiles").get<boolean>("followActiveEditor", true);
    const next = enabled && uri ? this.nodes.get(uri.toString()) : undefined;
    if (next === this.highlighted) { this.scheduleFollow(); return; }
    const changed: TreeNode[] = [];
    if (this.highlighted) {
      this.highlighted.labelHighlights = undefined;
      this.highlighted.description = this.descriptions.get(this.highlighted);
      changed.push(this.highlighted);
    }
    this.highlighted = next;
    if (next) {
      next.labelHighlights = [[0, next.label.length]];
      next.description = `${next.description} · ${vscode.l10n.t("Active file")}`;
      changed.push(next);
    }
    this.view.refreshPresentations(changed);
    this.scheduleFollow();
  }

  private activeUri(): vscode.Uri | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputNotebook
      ? input.uri : input instanceof vscode.TabInputTextDiff ? input.modified : undefined;
  }

  private cancelFollow(): void {
    clearTimeout(this.followTimer); this.followTimer = undefined;
    this.followGeneration++;
  }

  private synchronizeFollowPolicy(): void {
    this.view.setAutomaticFollowBlocked(this.locked || !this.view.visible || !vscode.window.state.focused || this.interacting || this.opening !== undefined);
  }

  private scheduleFollow(): void {
    this.cancelFollow();
    if (this.disposed || !this.view.visible) return;
    const generation = this.followGeneration;
    this.followTimer = setTimeout(() => {
      this.followTimer = undefined;
      void this.followActiveFile(generation).catch(() => undefined);
    }, 100);
  }

  private async followActiveFile(generation: number): Promise<void> {
    const uri = this.activeUri()?.toString();
    const node = uri ? this.nodes.get(uri) : undefined;
    const opened = !!uri && this.pendingOpened?.uri === uri;
    const decision = projectFileFollowAction({
      locked: this.locked, visible: this.view.visible, windowFocused: vscode.window.state.focused,
      viewFocused: this.view.hasFocus, interacting: this.interacting, opening: this.opening !== undefined,
      hasTarget: !!node,
      followEnabled: vscode.workspace.getConfiguration("cInsight.projectFiles").get<boolean>("followActiveEditor", true),
      opened,
    });
    if (!decision || !node || this.disposed || generation !== this.followGeneration) return;
    const action = { ...decision, inputRevision: opened ? this.pendingOpened!.inputRevision : this.view.inputRevision };
    this.synchronizeFollowPolicy();
    const sent = await this.view.followFile(node, action, () => !this.disposed && generation === this.followGeneration &&
      !this.locked && this.view.visible && !this.view.hasFocus && vscode.window.state.focused && this.activeUri()?.toString() === uri);
    if (sent) {
      this.followActions++;
      this.lastFollowAction = { uri: uri!, ...action };
      if (opened) this.pendingOpened = undefined;
    }
  }

  private async activate(node: TreeNode, intent: "preview" | "open", inputRevision = this.view.inputRevision): Promise<void> {
    const uri = node.location?.uri;
    if (!uri || this.nodes.get(uri.toString()) !== node) return;
    const generation = ++this.activationRevision;
    this.cancelFollow(); this.pendingOpened = undefined;
    this.opening = intent === "open" ? generation : undefined;
    this.synchronizeFollowPolicy();
    try {
      const stat = await this.statFile(uri);
      if (generation !== this.activationRevision || this.disposed) return;
      let external = isKnownBinaryFile(node.label) || stat.size > 10 * 1024 * 1024;
      if (!external) {
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          external = document.getText(new vscode.Range(new vscode.Position(0, 0), document.positionAt(8192))).includes("\0");
        } catch { external = true; }
      }
      if (generation !== this.activationRevision || this.disposed) return;
      if (external) {
        if (intent === "open") await vscode.commands.executeCommand("vscode.open", uri);
        else void vscode.window.showInformationMessage(vscode.l10n.t("This file cannot be previewed as text here. Double-click to open it in VS Code."));
      } else {
        await vscode.commands.executeCommand(INTERNAL_COMMANDS.ACTIVATE_TREE_LOCATION, node, VIEWS.PROJECT_FILES, intent);
      }
      if (intent === "open" && !this.locked && !this.disposed && generation === this.activationRevision) {
        this.pendingOpened = { uri: uri.toString(), inputRevision };
      }
    } catch (error) {
      if (generation === this.activationRevision && !this.disposed) {
        void vscode.window.showWarningMessage(vscode.l10n.t("Could not open project file: {error}", { error: String(error) }));
      }
    } finally {
      if (this.opening === generation) this.opening = undefined;
      this.synchronizeFollowPolicy();
      if (this.pendingOpened && generation === this.activationRevision) this.scheduleFollow();
    }
  }

  private statFile(uri: vscode.Uri): Thenable<vscode.FileStat> { return vscode.workspace.fs.stat(uri); }
}
