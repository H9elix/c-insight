import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { renderTextSearch } from "./textSearchWebview";
import { textSearchLabels } from "./textSearchLabels";
import { searchPresentationDelta, type SearchPresentationCursor } from "./searchPresentationDelta";
import type { SearchFile, SearchRequest, SearchStats } from "./workspaceSearch";

/** A query owns its append-only results. Panels retain this object, not the explorer's next query. */
export interface SearchResultSession {
  generation: number; request: SearchRequest; current?: string; open: Set<string>; files: SearchFile[];
  stats: SearchStats; loading: boolean; stale: boolean; error?: string;
}
interface ResultWindow {session: SearchResultSession; panel: vscode.WebviewPanel; cursor?: SearchPresentationCursor; selected?: string; activation: number; listeners: vscode.Disposable[]}
export function sourceAffectsSearch(session: Pick<SearchResultSession, "request" | "current" | "open">, uri: vscode.Uri): boolean {
  const {request} = session;
  if (request.scope === "file") return uri.toString() === session.current;
  if (request.scope === "open") return session.open.has(uri.toString());
  if (request.scope === "folder" && request.folder) {
    const root = vscode.Uri.parse(request.folder);
    return uri.scheme === root.scheme && uri.authority === root.authority && (uri.path === root.path || uri.path.startsWith(root.path.replace(/\/$/, "") + "/"));
  }
  return !!vscode.workspace.getWorkspaceFolder(uri);
}

/** Read-only editor panels: shared host data, independent browser state, no replacement authority. */
export class SearchResultWindows implements vscode.Disposable {
  private readonly windows = new Map<number, ResultWindow>();
  constructor(private readonly activate: (file: SearchFile, id: string, query: string, open: boolean) => Promise<boolean>, private readonly visibility: () => void) {}
  visible(generation: number): boolean {return this.windows.get(generation)?.panel.visible === true;}
  open(session: SearchResultSession): void {
    const existing = this.windows.get(session.generation);
    if (existing) {existing.panel.reveal(); return;}
    const panel = vscode.window.createWebviewPanel("cInsight.textSearchResults", vscode.l10n.t("Search: {query}", {query: session.request.query.slice(0, 60)}),
      vscode.ViewColumn.Active, {enableScripts: true, retainContextWhenHidden: true, localResourceRoots: []});
    const window: ResultWindow = {session, panel, activation: 0, listeners: []}; this.windows.set(session.generation, window);
    panel.webview.html = renderTextSearch(panel.webview.cspSource, randomBytes(16).toString("hex"), textSearchLabels(), true);
    window.listeners.push(panel.webview.onDidReceiveMessage((value: unknown) => {void this.receive(window, value).catch(error => {session.error = String(error); this.publish(session);});}),
      panel.onDidChangeViewState(() => {if (panel.visible) this.publish(session); this.visibility();}),
      panel.onDidDispose(() => {this.windows.delete(session.generation); window.activation++; window.listeners.forEach(listener => listener.dispose()); this.visibility();}));
    this.publish(session);
  }
  private async receive(window: ResultWindow, value: unknown): Promise<void> {
    if (!value || typeof value !== "object" || !this.windows.has(window.session.generation)) return;
    const message = value as Record<string, unknown>;
    if (message.type === "ready") {window.cursor = undefined; this.publish(window.session); return;}
    if (message.type !== "activate" || message.revision !== window.session.generation || typeof message.id !== "string") return;
    const file = window.session.files.find(file => file.matches.some(match => match.id === message.id)); if (!file) return;
    const activation = ++window.activation;
    if (await this.activate(file, message.id, window.session.request.query, message.intent === "open") && activation === window.activation && this.windows.has(window.session.generation)) {
      window.selected = message.id; this.publish(window.session);
    }
  }
  publish(session: SearchResultSession): void {
    const window = this.windows.get(session.generation); if (!window?.panel.visible) return;
    const {cursor, ...delta} = searchPresentationDelta(session.files, new Set(), session.generation, window.cursor); window.cursor = cursor;
    void window.panel.webview.postMessage({type: "state", revision: session.generation, generation: session.generation, request: session.request,
      selected: window.selected, stats: session.stats, loading: session.loading, stale: session.stale, error: session.error, ready: false, planning: false,
      replacement: "", preserveCase: false, replaceVisible: false, snapshot: true, ...delta});
  }
  sourceChanged(uri: vscode.Uri): void {
    for (const {session} of this.windows.values()) if (!session.stale && sourceAffectsSearch(session, uri)) {session.stale = true; this.publish(session);}
  }
  stateForTest() {return [...this.windows.values()].map(({session, panel, selected}) => ({generation: session.generation, visible: panel.visible,
    query: session.request.query, matches: session.files.reduce((sum, file) => sum + file.matches.length, 0), loading: session.loading,
    stale: session.stale, cancelled: session.stats.cancelled, selected}));}
  async messageForTest(generation: number, message: unknown): Promise<void> {const window = this.windows.get(generation); if (window) await this.receive(window, message);}
  dispose(): void {for (const {panel} of [...this.windows.values()]) panel.dispose(); this.windows.clear();}
}
