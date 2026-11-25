import { randomBytes } from "node:crypto";
import { join } from "node:path";
import * as vscode from "vscode";
import { INTERNAL_COMMANDS, VIEWS } from "../ids";
import type { ViewRegistrar } from "../views/viewDiscovery";
import { contentHash, replacementText, type TextMatch } from "./searchModel";
import { DEFAULT_SEARCH_OPTIONS } from "./searchModel";
import { applyReplacementPlan, canReplace, createReplacementPlan, ReplacementSnapshots, type ReplacementPlan } from "./replacementPlan";
import { renderTextSearch } from "./textSearchWebview";
import { textSearchLabels } from "./textSearchLabels";
import { isGitMetadata, isKnownBinaryFile } from "../projectFiles/projectFileModel";
import { searchPresentationDelta, type SearchPresentationCursor } from "./searchPresentationDelta";
import { DEFAULT_SEARCH_BUDGET, WorkspaceTextSearch, type SearchFile, type SearchRequest, type SearchStats } from "./workspaceSearch";

const emptyStats = (): SearchStats => ({files: 0, skipped: 0, timedOut: 0, matches: 0, limited: false, cancelled: false});
export class TextSearchExplorer implements vscode.WebviewViewProvider, vscode.Disposable {
  private request: SearchRequest = {...DEFAULT_SEARCH_OPTIONS, scope: "workspace", include: "", exclude: "", useIgnores: true};
  private replacement = "";
  private preserveCase = false;
  private replaceVisible = false;
  private revision = 0;
  private editOrigin = "";
  private editSequence = 0;
  private generation = 0;
  private results: SearchFile[] = [];
  private checked = new Set<string>();
  private selected?: string;
  private activation = 0;
  private stats = emptyStats();
  private loading = false;
  private stale = false;
  private searched = false;
  private searchSnapshot?: {request: SearchRequest; current?: string; open: Set<string>};
  private error?: string;
  private scan?: AbortController;
  private plan?: ReplacementPlan;
  private planning = false;
  private applying = false;
  private confirmingForTest = false;
  private current?: vscode.Uri;
  private active?: vscode.WebviewView;
  private timer?: NodeJS.Timeout;
  private readonly presentations = new Set<vscode.WebviewView>();
  private readonly deliveries = new Map<vscode.WebviewView, SearchPresentationCursor>();
  private readonly listeners: vscode.Disposable[] = [];
  private readonly snapshots = new ReplacementSnapshots();
  private readonly search: WorkspaceTextSearch;
  private readonly workerPath: string;

  constructor(extensionUri: vscode.Uri, registrar: ViewRegistrar, private readonly testMode = false) {
    this.workerPath = join(extensionUri.fsPath, "dist", "textSearchWorker.js");
    this.search = new WorkspaceTextSearch(this.workerPath);
    this.current = vscode.window.activeTextEditor?.document.uri;
    this.listeners.push(registrar(VIEWS.TEXT_SEARCH, this, {webviewOptions: {retainContextWhenHidden: true}}),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (["files.encoding", "files.exclude", "search"].some(key => event.affectsConfiguration(key))) {
          this.cancel(); this.invalidate(true);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(editor => { if (editor && !editor.document.uri.scheme.startsWith("c-insight-")) this.current = editor.document.uri; }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!event.contentChanges.length || this.applying) return;
        this.sourceChanged(event.document.uri);
      }),
      vscode.workspace.onDidRenameFiles(event => event.files.forEach(file => { this.sourceChanged(file.oldUri); this.sourceChanged(file.newUri); })),
      vscode.workspace.onDidDeleteFiles(event => event.files.forEach(uri => this.sourceChanged(uri))));
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    this.listeners.push(watcher, watcher.onDidChange(uri => this.sourceChanged(uri)),
      watcher.onDidCreate(uri => this.sourceChanged(uri)), watcher.onDidDelete(uri => this.sourceChanged(uri)));
  }
  private sourceChanged(uri: vscode.Uri): void {
    const snapshot = this.searchSnapshot;
    if (this.applying || !snapshot || this.stale && !this.plan || isGitMetadata(uri.path) || isKnownBinaryFile(uri.path)) return;
    const {request} = snapshot;
    const relevant = request.scope === "file" ? uri.toString() === snapshot.current : request.scope === "open" ? snapshot.open.has(uri.toString()) :
      request.scope === "folder" && request.folder ? (() => {
        const folder = vscode.Uri.parse(request.folder);
        return uri.scheme === folder.scheme && uri.authority === folder.authority && (uri.path === folder.path || uri.path.startsWith(folder.path.replace(/\/$/, "") + "/"));
      })() : !!vscode.workspace.getWorkspaceFolder(uri);
    if (relevant) this.invalidate(true);
  }
  resolveWebviewView(view: vscode.WebviewView): void {
    this.presentations.add(view); this.active ??= view;
    view.webview.options = {enableScripts: true};
    view.webview.html = renderTextSearch(view.webview.cspSource, randomBytes(16).toString("hex"), textSearchLabels());
    const listeners = [view.webview.onDidReceiveMessage((message: unknown) => {
      if (message && typeof message === "object" && "type" in message && message.type === "ready") this.deliveries.delete(view);
      this.active = view; void this.receive(message).catch(error => { this.error = String(error); this.publish(); });
    }), view.onDidChangeVisibility(() => { this.deliveries.delete(view); this.checkVisibility(); if (view.visible) this.publish(); }),
    view.onDidDispose(() => { this.deliveries.delete(view); this.presentations.delete(view); if (this.active === view) this.active = undefined; this.checkVisibility(); listeners.forEach(listener => listener.dispose()); })];
    this.publish();
  }
  preferPresentation(view: vscode.WebviewView): void { if (this.presentations.has(view)) this.active = view; }
  async openSearch(): Promise<void> {
    this.active = [...this.presentations].find(view => view.visible);
    if (!this.active) await vscode.commands.executeCommand(`${VIEWS.TEXT_SEARCH}.focus`);
    this.active?.show(false); await this.active?.webview.postMessage({type: "focus"});
  }
  private checkVisibility(): void { if (![...this.presentations].some(view => view.visible)) this.cancel(); }
  cancel(): void { this.scan?.abort(); }
  private invalidate(stale: boolean): void {
    this.revision++; this.plan = undefined; this.snapshots.clear(); if (stale && this.searched) this.stale = true;
    this.publish();
  }
  private budget() {
    const limit = vscode.workspace.getConfiguration("search").get<number | null>("maxResults", 20000);
    return {...DEFAULT_SEARCH_BUDGET, maximumMatches: limit === null ? Infinity : Number.isSafeInteger(limit) && limit > 0 ? limit : 20000};
  }
  async run(): Promise<void> {
    if (this.applying) return;
    if (![...this.presentations].some(view => view.visible)) await this.openSearch();
    if (this.request.scope === "folder" && !this.request.folder) {
      await this.receive({type: "folder"}); if (!this.request.folder) return;
    }
    this.cancel(); const generation = ++this.generation;
    const scan = this.scan = new AbortController();
    this.invalidate(false); this.results = []; this.checked.clear(); this.selected = undefined;
    this.stats = emptyStats(); this.stale = false; this.loading = true; this.error = undefined; this.searched = true; this.publish();
    const request = {...this.request};
    try {
      if (request.scope === "file" && !this.current) throw new Error(vscode.l10n.t("Open a text file before searching the current file."));
      if (["folder", "workspace"].includes(request.scope) && !vscode.workspace.workspaceFolders?.length) {
        if (!this.current) throw new Error(vscode.l10n.t("Open a text file or workspace before searching."));
        request.scope = this.request.scope = "file";
      }
      this.searchSnapshot = {request, current: this.current?.toString(), open: new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab =>
        tab.input instanceof vscode.TabInputText ? [tab.input.uri.toString()] : [])))};
      const stats = await this.search.run(request, this.current, this.budget(), scan.signal, file => {
        if (generation !== this.generation) return;
        file.id = `${generation}/${file.id}`;
        file.matches.forEach((match, index) => { match.id = `${file.id}:${index}`; this.checked.add(match.id); });
        this.results.push(file); this.queuePublish();
      }, stats => { if (generation === this.generation) { this.stats = stats; this.queuePublish(); } });
      if (generation === this.generation) this.stats = stats;
    } catch (error) { if (generation === this.generation) this.error = String(error); }
    finally { if (generation === this.generation) { this.loading = false; this.scan = undefined; this.publish(); } }
  }
  async receive(value: unknown): Promise<void> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const message = value as Record<string, unknown>;
    if (message.type === "ready") { this.publish(); return; }
    if (message.type === "focus") return;
    if (this.applying) return;
    if (message.type === "input") {
      if (typeof message.client === "string" && message.client.length <= 64 && Number.isSafeInteger(message.sequence)) {
        this.editOrigin = message.client; this.editSequence = message.sequence as number;
      }
      const previous = JSON.stringify(this.request);
      for (const key of ["query", "include", "exclude"] as const) if (typeof message[key] === "string") this.request[key] = (message[key] as string).slice(0, 10000);
      for (const key of ["caseSensitive", "wholeWord", "regex", "multiline", "useIgnores"] as const) if (typeof message[key] === "boolean") this.request[key] = message[key] as boolean;
      if (["file", "open", "folder", "workspace"].includes(String(message.scope))) this.request.scope = message.scope as SearchRequest["scope"];
      const changed = previous !== JSON.stringify(this.request);
      const previousReplacement = this.replacement, previousPreserve = this.preserveCase;
      if (typeof message.replacement === "string") this.replacement = message.replacement.slice(0, 100000);
      if (typeof message.preserveCase === "boolean") this.preserveCase = message.preserveCase;
      if (typeof message.replaceVisible === "boolean") this.replaceVisible = message.replaceVisible;
      if (changed) this.cancel();
      if (changed || previousReplacement !== this.replacement || previousPreserve !== this.preserveCase) this.invalidate(changed);
      return;
    }
    if (message.type === "search") { await this.run(); return; }
    if (message.type === "cancel") { this.cancel(); return; }
    if (message.type === "toggle") { this.replaceVisible = message.show === true || !this.replaceVisible; this.publish(); return; }
    if (message.type === "folder") {
      const selected = await vscode.window.showOpenDialog({canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri});
      if (selected?.[0]) { this.request.folder = selected[0].toString(); this.request.scope = "folder"; this.cancel(); this.invalidate(true); }
      return;
    }
    if (message.revision !== this.revision) return;
    if (message.type === "check" && typeof message.id === "string" && typeof message.checked === "boolean") {
      const file = this.results.find(file => file.id === message.id || file.matches.some(match => match.id === message.id));
      if (!file) return;
      for (const match of file.matches.filter(match => message.id === file.id || match.id === message.id)) {
        if (message.checked) this.checked.add(match.id); else this.checked.delete(match.id);
      }
      this.invalidate(false); return;
    }
    if (message.type === "activate" && typeof message.id === "string") { await this.activate(message.id, message.intent === "open"); return; }
    if (message.type === "next" || message.type === "previous") {
      const matches = this.results.flatMap(file => file.matches), index = matches.findIndex(match => match.id === this.selected);
      const match = matches[(index + (message.type === "next" ? 1 : -1) + matches.length) % matches.length];
      if (match) await this.activate(match.id, false); return;
    }
    if (message.type === "plan") { await this.previewReplacement(String(message.mode), typeof message.id === "string" ? message.id : undefined); return; }
    if (message.type === "diff" && typeof message.id === "string") {
      const file = this.plan?.files.find(file => file.file.id === message.id); if (file && this.plan) await this.snapshots.show(this.plan, file); return;
    }
    if (message.type === "apply" && typeof message.plan === "string") await this.apply(message.plan);
  }
  private async activate(id: string, open: boolean): Promise<void> {
    const activation = ++this.activation;
    const file = this.results.find(file => file.matches.some(match => match.id === id)), match = file?.matches.find(match => match.id === id);
    if (!file || !match) return;
    const snapshot = await this.search.read(vscode.Uri.parse(file.uri), this.budget().maximumFileBytes);
    if (activation !== this.activation) return;
    if (contentHash(snapshot.text) !== file.hash) { this.invalidate(true); return; }
    this.selected = id;
    await vscode.commands.executeCommand(INTERNAL_COMMANDS.ACTIVATE_TREE_LOCATION, {
      id, label: this.request.query, previewTitle: file.label, previewMode: "reference",
      location: {uri: vscode.Uri.parse(file.uri), range: new vscode.Range(match.line, match.character, match.endLine, match.endCharacter)},
    }, "textSearch", open ? "open" : "preview");
    this.publish();
  }
  private replaceReady(): boolean {
    return canReplace() && this.searched && !this.loading && !this.stale && !this.error && !this.stats.limited && !this.stats.cancelled && !this.stats.skipped && !this.stats.timedOut;
  }
  private async previewReplacement(mode: string, id?: string): Promise<void> {
    if (!this.replaceReady() || this.planning) return;
    const revision = this.revision, ids = mode === "all" ? new Set(this.results.flatMap(file => file.matches.map(match => match.id))) :
      mode === "file" ? new Set(this.results.find(file => file.id === id)?.matches.map(match => match.id) ?? []) :
      mode === "current" ? new Set(this.selected ? [this.selected] : []) : new Set(this.checked);
    this.planning = true; this.error = undefined; this.publish();
    try {
      const plan = await createReplacementPlan(this.results, ids, revision, this.request, this.replacement, this.preserveCase,
        uri => this.search.read(uri, this.budget().maximumFileBytes), (text, options, replacement) => this.search.matchSnapshot(text, options, replacement));
      if (revision !== this.revision) return;
      this.snapshots.clear(); this.plan = plan; await this.snapshots.show(plan, plan.files[0]);
    } finally { this.planning = false; this.publish(); }
  }
  private async apply(id: string): Promise<void> {
    const plan = this.plan;
    if (!plan || plan.id !== id || plan.revision !== this.revision || !this.replaceReady()) return;
    const confirm = vscode.l10n.t("Apply Replacement");
    const answer = this.confirmingForTest && this.testMode ? confirm : await vscode.window.showWarningMessage(vscode.l10n.t("Replace {matches} matches in {files} files? Changes will remain unsaved.",
      {matches: plan.count, files: plan.files.length}), {modal: true}, confirm);
    if (answer !== confirm) return;
    const order = this.results.flatMap(file => file.matches.map(match => match.id)), previousIndex = order.indexOf(this.selected ?? "");
    this.applying = true; this.publish();
    try {
      await applyReplacementPlan(plan, this.request, this.replacement, this.preserveCase, () => this.plan === plan && plan.revision === this.revision);
      this.plan = undefined; this.snapshots.clear();
      // Refresh only affected files. Existing matches are mapped, not rediscovered, so inserted query text isn't replaced again.
      for (const planned of plan.files) {
        const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === planned.file.uri)!;
        const selected = new Set(planned.matches.map(match => match.start));
        const remaining = planned.file.matches.filter(match => !selected.has(match.start));
        {
          const version = document.version, text = document.getText();
          const edits = [...planned.matches].sort((a, b) => a.start - b.start).map(edit => ({end: edit.end,
            delta: replacementLength(planned.before, edit, this.replacement, this.request.regex, this.preserveCase) - (edit.end - edit.start)}));
          const mapped = new Map<number, string>(); let delta = 0, index = 0;
          for (const match of remaining) {
            while (index < edits.length && edits[index].end <= match.start) delta += edits[index++].delta;
            mapped.set(match.start + delta, match.id);
          }
          const found = mapped.size ? (await this.search.matchSnapshot(text, this.request)).filter(match => mapped.has(match.start)) : [];
          if (document.version !== version) throw new Error(vscode.l10n.t("Search results changed. Search again before replacing."));
          planned.matches.forEach(match => this.checked.delete(match.id));
          const fresh: SearchFile = {...planned.file, hash: contentHash(document.getText()), version: document.version,
            matches: found.map(match => ({...match, id: mapped.get(match.start)!}))};
          this.results = this.results.map(file => file.id === fresh.id ? fresh : file).filter(file => file.matches.length);
        }
      }
      const remaining = new Set(this.results.flatMap(file => file.matches.map(match => match.id)));
      this.selected = order.slice(previousIndex + 1).find(id => remaining.has(id)) ?? order.find(id => remaining.has(id));
      this.stats.matches = this.results.reduce((sum, file) => sum + file.matches.length, 0); this.revision++;
    } catch (error) { this.error = String(error); this.stale = true; }
    finally { this.applying = false; this.publish(); }
  }
  private queuePublish(): void { this.timer ??= setTimeout(() => { this.timer = undefined; this.publish(); }, 100); }
  private publish(): void {
    const state = {type: "state", revision: this.revision, generation: this.generation, editOrigin: this.editOrigin, editSequence: this.editSequence,
      request: this.request, replacement: this.replacement, preserveCase: this.preserveCase,
      replaceVisible: this.replaceVisible, selected: this.selected, stats: this.stats, loading: this.loading, stale: this.stale, error: this.error,
      ready: this.replaceReady(), planning: this.planning || this.applying,
      plan: this.plan ? {id: this.plan.id, count: this.plan.count, files: this.plan.files.map(file => ({id: file.file.id, label: file.file.label}))} : undefined};
    for (const view of this.presentations) if (view.visible) {
      const {cursor, ...delta} = searchPresentationDelta(this.results, this.checked, this.generation, this.deliveries.get(view));
      this.deliveries.set(view, cursor); void view.webview.postMessage({...state, ...delta});
    }
  }
  stateForTest() { return {revision: this.revision, request: {...this.request}, results: this.results, checked: [...this.checked], stats: {...this.stats},
    loading: this.loading, visible: [...this.presentations].filter(view => view.visible).length, stale: this.stale,
    ready: this.replaceReady(), generation: this.generation, plan: this.plan?.id, selected: this.selected, error: this.error}; }
  async applyForTest(id: string): Promise<void> {
    if (!this.testMode) throw new Error("Test-only entry point.");
    this.confirmingForTest = true;
    try { await this.apply(id); } finally { this.confirmingForTest = false; }
  }
  dispose(): void { this.cancel(); this.generation++; if (this.timer) clearTimeout(this.timer); this.snapshots.dispose(); this.listeners.forEach(listener => listener.dispose()); }
}

function replacementLength(text: string, match: TextMatch, replacement: string, regex: boolean, preserve: boolean): number {
  return replacementText(text, match, replacement, regex, preserve).length;
}
