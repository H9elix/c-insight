import { createHash, randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { COMMANDS, INTERNAL_COMMANDS, ViewId } from "../ids";
import { readConfiguration } from "../configuration/configuration";
import { MutableTreeProvider, TreeNode } from "./treeNode";
import { ResultTreeDescription, ResultTreeModel } from "./resultTreeModel";
import { parseResultTreeMessage, renderResultTreeWebview } from "./resultTreeWebview";

export interface ResultTreeView extends vscode.Disposable {
  readonly visible: boolean;
  readonly onDidChangeVisibility: vscode.Event<{ visible: boolean }>;
  readonly onDidExpandElement: vscode.Event<{ element: TreeNode }>;
  readonly onDidCollapseElement: vscode.Event<{ element: TreeNode }>;
  reveal(node: TreeNode, options?: {
    expand?: boolean | number; focus?: boolean; select?: boolean;
  }): Promise<void>;
  collapseAll(): Promise<void>;
}

interface ResultTreeAction { command: string; label: string }

export interface ResultTreeOptions {
  persistentFilter?: boolean;
  filterTitle?: string;
  hideCollapseAll?: boolean;
  trackInteraction?: boolean;
  onActivate?: (node: TreeNode, intent: "preview" | "open", inputRevision?: number) => Promise<void>;
}

export class WebviewResultTree implements ResultTreeView, vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private ready = false;
  private disposed = false;
  private dirty = true;
  private refreshTimer?: NodeJS.Timeout;
  private pendingReveal?: { type: "reveal"; id: string; focus: boolean; select: boolean };
  private readonly disposables: vscode.Disposable[] = [];
  private readonly viewListeners: vscode.Disposable[] = [];
  private readonly visibilityEmitter = new vscode.EventEmitter<{ visible: boolean }>();
  private readonly expandEmitter = new vscode.EventEmitter<{ element: TreeNode }>();
  private readonly collapseEmitter = new vscode.EventEmitter<{ element: TreeNode }>();
  private readonly resolutionTokens = new WeakMap<TreeNode, number>();
  private nextResolutionToken = 1;
  private status = "";
  private focused = false;
  private revision = 0;
  private automaticFollowBlocked = true;
  private readonly interactionEmitter = new vscode.EventEmitter<{ focused: boolean; inputRevision: number }>();
  readonly onDidChangeInteraction = this.interactionEmitter.event;
  get hasFocus(): boolean { return this.focused; }
  get inputRevision(): number { return this.revision; }
  readonly onDidChangeVisibility = this.visibilityEmitter.event;
  readonly onDidExpandElement = this.expandEmitter.event;
  readonly onDidCollapseElement = this.collapseEmitter.event;
  readonly model: ResultTreeModel<TreeNode>;

  constructor(
    private readonly id: ViewId,
    private readonly provider: MutableTreeProvider,
    private readonly extensionUri: vscode.Uri,
    private readonly options: ResultTreeOptions = {},
  ) {
    this.model = new ResultTreeModel({
      roots: () => provider.getRoots(),
      describe: (node) => this.describe(node),
      children: (node) => provider.getChildren(node),
      parent: (node) => provider.getParent(node),
    });
    this.disposables.push(
      this.model.onChange(() => this.publish()),
      this.model.onExpansion((node, expanded) => {
        (expanded ? this.expandEmitter : this.collapseEmitter).fire({ element: node });
      }),
      provider.onDidChangeTreeData(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("cInsight.navigation.doubleClickInterval")) this.publish();
      }),
    );
  }

  get visible(): boolean { return this.view?.visible ?? false; }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.viewListeners.splice(0).forEach((item) => item.dispose());
    this.view = view;
    this.ready = false;
    const assets = vscode.Uri.joinPath(this.extensionUri, "dist", "codicons");
    view.webview.options = { enableScripts: true, localResourceRoots: [assets] };
    view.webview.html = renderResultTreeWebview({
      nonce: randomBytes(16).toString("hex"),
      cspSource: view.webview.cspSource,
      iconsUri: view.webview.asWebviewUri(vscode.Uri.joinPath(assets, "codicon.css")).toString(),
      label: view.title ?? this.id,
      collapseTitle: vscode.l10n.t("Collapse All"),
      filterTitle: this.options.filterTitle ?? vscode.l10n.t("Filter visible results"),
      persistentFilter: this.options.persistentFilter,
      hideCollapseAll: this.options.hideCollapseAll,
      trackInteraction: this.options.trackInteraction,
      clearTitle: vscode.l10n.t("Clear file filter"),
      noMatchesTitle: vscode.l10n.t("No matching files"),
      expandTitle: vscode.l10n.t("Expand"),
      collapseNodeTitle: vscode.l10n.t("Collapse"),
    });
    this.viewListeners.push(
      view.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message).catch((error: unknown) => {
          void vscode.window.showErrorMessage(`C Insight: ${String(error)}`);
        });
      }),
      view.onDidChangeVisibility(() => {
        if (!view.visible) this.focused = false;
        this.visibilityEmitter.fire({ visible: view.visible });
        if (view.visible) this.scheduleRefresh();
      }),
      view.onDidDispose(() => {
        if (this.view === view) { this.view = undefined; this.ready = false; }
        this.visibilityEmitter.fire({ visible: false });
      }),
    );
    this.visibilityEmitter.fire({ visible: view.visible });
  }

  async reveal(node: TreeNode, options: {
    expand?: boolean | number; focus?: boolean; select?: boolean;
  } = {}): Promise<void> {
    if (options.focus || options.select !== false) {
      if (!this.view) await vscode.commands.executeCommand(`${this.id}.focus`);
      this.view?.show(!options.focus);
    }
    const existing = this.options.persistentFilter && !options.expand
      ? this.model.snapshot().find(row => row.node === node)?.id : undefined;
    const id = existing ?? await this.model.reveal(node,
      options.expand === true ? 1 : typeof options.expand === "number" ? options.expand : 0);
    if (id) {
      this.pendingReveal = {
        type: "reveal", id, focus: !!options.focus, select: options.select !== false,
      };
      this.publishReveal();
    }
  }

  async collapseAll(): Promise<void> { await this.model.collapseAll(); }

  setStatus(status: string): void {
    this.status = status;
    if (this.ready && this.visible) void this.view?.webview.postMessage({ type: "status", status });
  }

  setAutomaticFollowBlocked(blocked: boolean): void {
    this.automaticFollowBlocked = blocked;
    if (this.ready && this.visible) void this.view?.webview.postMessage({ type: "autoFollowPolicy", blocked });
  }

  async followFile(node: TreeNode, action: { clear: "always" | "ifHidden"; reveal: boolean; inputRevision: number }, current: () => boolean): Promise<boolean> {
    if (!current() || !this.ready || !this.visible || this.automaticFollowBlocked) return false;
    const id = this.model.snapshot().find(row => row.node === node)?.id ?? await this.model.reveal(node);
    if (!id || !current() || this.automaticFollowBlocked || !this.ready || !this.visible) return false;
    await this.view?.webview.postMessage({ type: "autoFollow", id, ...action });
    return true;
  }

  refreshPresentations(nodes: TreeNode[]): void {
    const rows = nodes.map(node => this.model.updateDescription(node));
    if (rows.some(row => !row)) { this.scheduleRefresh(); return; }
    if (!this.ready || !this.visible) return;
    void this.view?.webview.postMessage({ type: "patch", rows: rows.map(row => {
      const { node, ...value } = row!;
      return { ...value, actions: this.actions(node) };
    }) });
  }

  async interactionForTest(message?: unknown): Promise<unknown> {
    if (message) await this.handleMessage(message);
    else await this.model.refresh();
    return this.model.snapshot().map((row) => ({
      id: row.id, label: row.label, parent: row.parent,
      expanded: row.expanded, expandable: row.expandable,
      uri: row.node.location?.uri.toString(), line: row.node.location?.range.start.line,
    }));
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.refreshTimer);
    this.viewListeners.splice(0).forEach((item) => item.dispose());
    this.disposables.splice(0).forEach((item) => item.dispose());
    this.model.dispose();
    this.visibilityEmitter.dispose(); this.expandEmitter.dispose(); this.collapseEmitter.dispose();
    this.interactionEmitter.dispose();
  }

  private scheduleRefresh(): void {
    this.dirty = true;
    if (this.disposed || !this.visible || !this.ready || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh().catch((error: unknown) => console.error("C Insight result tree", error));
    }, 0);
  }

  private async refresh(): Promise<void> {
    if (this.disposed || !this.dirty) return;
    this.dirty = false;
    await this.model.refresh();
  }

  private describe(node: TreeNode): ResultTreeDescription {
    const label = node.label.replace(/\r?\n/g, " ");
    const state = node.collapsibleState ?? (node.children || node.loadChildren
      ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    let resolutionToken = this.resolutionTokens.get(node);
    if (node.resolveVisible && !resolutionToken) {
      resolutionToken = this.nextResolutionToken++;
      this.resolutionTokens.set(node, resolutionToken);
    }
    const rawKey = node.id ?? [node.contextValue, label, node.location?.uri.toString(),
      node.location?.range.start.line, node.location?.range.start.character,
      node.location?.range.end.line, node.location?.range.end.character].join(":");
    return {
      key: createHash("sha256").update(rawKey).digest("hex").slice(0, 24),
      label,
      description: node.description?.replace(/\r?\n/g, " "),
      filterText: node.filterText,
      tooltip: typeof node.tooltip === "string" ? node.tooltip : node.tooltip?.value,
      icon: node.icon?.id, iconColor: node.icon?.color?.id,
      highlights: node.labelHighlights,
      expandable: state !== vscode.TreeItemCollapsibleState.None,
      initiallyExpanded: state === vscode.TreeItemCollapsibleState.Expanded,
      navigable: !!node.location,
      actionable: !!node.command,
      resolutionToken: node.resolveVisible ? resolutionToken : undefined,
    };
  }

  private async handleMessage(value: unknown): Promise<void> {
    if (this.disposed) return;
    const message = parseResultTreeMessage(value);
    if (!message) return;
    if (message.type === "ready") {
      this.ready = true;
      this.revision = 0;
      this.dirty = true;
      if (this.visible) await this.refresh();
      this.setAutomaticFollowBlocked(this.automaticFollowBlocked);
      return;
    }
    if (message.type === "interaction") {
      if (this.options.trackInteraction) {
        this.focused = message.focused;
        this.revision = message.inputRevision;
        this.interactionEmitter.fire(message);
      }
      return;
    }
    if (message.type === "focus") return;
    if (message.type === "collapseAll") { await this.collapseAll(); return; }
    if (message.type === "resolve") {
      for (const id of message.ids) {
        const node = this.model.row(id)?.node;
        if (node?.resolveVisible) this.provider.getTreeItem(node);
      }
      return;
    }
    if (!("id" in message)) return;
    const row = this.model.row(message.id);
    if (!row) return;
    if (message.type === "expand") {
      await this.model.setExpanded(row.id, message.expanded);
    } else if (message.type === "activate") {
      if (this.options.onActivate && row.node.location) {
        await this.options.onActivate(row.node, message.intent, message.inputRevision ?? this.revision);
      } else if (row.node.command) {
        const command = row.node.command;
        await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
      } else if (row.node.location) {
        await vscode.commands.executeCommand(
          INTERNAL_COMMANDS.ACTIVATE_TREE_LOCATION, row.node, this.id, message.intent,
        );
      }
    } else if (message.type === "action" &&
      this.actions(row.node).some((action) => action.command === message.command)) {
      if (this.options.onActivate && message.command === COMMANDS.OPEN_LOCATION) {
        await this.options.onActivate(row.node, "open", message.inputRevision ?? this.revision);
      } else {
        await vscode.commands.executeCommand(message.command, row.node);
      }
    }
  }

  private publish(): void {
    if (!this.ready || !this.visible || this.disposed) return;
    void this.view?.webview.postMessage({
      type: "state", doubleClickInterval: readConfiguration().navigationDoubleClickInterval,
      status: this.status,
      rows: this.model.snapshot().map(({ node, ...row }) => ({
        ...row, actions: this.actions(node),
      })),
    });
    this.publishReveal();
  }

  private publishReveal(): void {
    if (this.ready && this.visible && this.pendingReveal && this.model.row(this.pendingReveal.id)) {
      void this.view?.webview.postMessage(this.pendingReveal);
      this.pendingReveal = undefined;
    }
  }

  private actions(node: TreeNode): ResultTreeAction[] {
    const actions: ResultTreeAction[] = [];
    if (node.location) {
      actions.push({ command: COMMANDS.OPEN_LOCATION, label: vscode.l10n.t("Open Location") });
      if (node.contextValue !== "bookmarkLocation" && !this.options.onActivate) {
        actions.push({ command: COMMANDS.BOOKMARKS_ADD, label: vscode.l10n.t("Add Bookmark") });
      }
    }
    if (node.contextValue === "macroCallerRoot") {
      actions.push({ command: COMMANDS.CALLERS_SHOW_EXPANDED_TARGET, label: vscode.l10n.t("Query Expanded Function Callers") });
    }
    if (node.contextValue === "referenceLocation") {
      actions.push({ command: COMMANDS.REFERENCES_COPY, label: vscode.l10n.t("Copy Reference") });
    }
    if (node.contextValue === "bookmarkLocation") {
      actions.push(
        { command: COMMANDS.BOOKMARKS_RENAME, label: vscode.l10n.t("Rename Bookmark") },
        { command: COMMANDS.BOOKMARKS_CHANGE_GROUP, label: vscode.l10n.t("Change Bookmark Group") },
        { command: COMMANDS.BOOKMARKS_DELETE, label: vscode.l10n.t("Delete Bookmark") },
      );
    }
    if (node.contextValue === "bookmarkGroup") {
      actions.push(
        { command: COMMANDS.BOOKMARKS_RENAME_GROUP, label: vscode.l10n.t("Rename Bookmark Group") },
        { command: COMMANDS.BOOKMARKS_EXPORT, label: vscode.l10n.t("Export Bookmarks") },
        { command: COMMANDS.BOOKMARKS_DELETE_GROUP, label: vscode.l10n.t("Delete Bookmark Group") },
      );
    }
    return actions;
  }
}
