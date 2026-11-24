import * as vscode from "vscode";
import { isGitMetadata, isKnownBinaryFile } from "../projectFiles/projectFileModel";
import { decodeSearchFile, excludedBySettings, ignoreLayer, isIgnored, matchesPatterns, type IgnoreLayer } from "./fileRules";
import { contentHash, searchExpression, type SearchOptions, type TextMatch } from "./searchModel";
import { MatchingWorker, MatchTimeout, SearchCancelled } from "./matchingPool";
import type { SearchDiagnostics } from "./searchDiagnostics";

export type TextSearchScope = "file" | "open" | "folder" | "workspace";
export interface SearchRequest extends SearchOptions {
  scope: TextSearchScope; include: string; exclude: string; useIgnores: boolean; folder?: string;
}
export interface SearchFile {
  id: string; uri: string; label: string; hash: string; version?: number; matches: Array<TextMatch & {id: string}>;
}
export interface SearchStats { files: number; skipped: number; timedOut: number; matches: number; limited: boolean; cancelled: boolean }
export interface SearchBudget { maximumFiles: number; maximumMatches: number; maximumFileBytes: number }
export const DEFAULT_SEARCH_BUDGET: SearchBudget = {maximumFiles: 50000, maximumMatches: 10000, maximumFileBytes: 10 * 1024 * 1024};
export interface SearchCandidate { uri: vscode.Uri; label: string }
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** No analysis engine or language-provider dependency. Content is retained only for the two in-flight files. */
export class WorkspaceTextSearch {
  constructor(private readonly workerPath: string) {}

  async run(request: SearchRequest, current: vscode.Uri | undefined, budget: SearchBudget,
    signal: AbortSignal, onFile: (file: SearchFile) => void, onProgress: (stats: SearchStats) => void, diagnostics?: SearchDiagnostics): Promise<SearchStats> {
    const started = performance.now();
    searchExpression(request);
    const stats: SearchStats = {files: 0, skipped: 0, timedOut: 0, matches: 0, limited: false, cancelled: false};
    const candidates = this.candidates(request, current, budget, signal, stats);
    let serial = 0;
    let payloadBytes = 0;
    // Serialize iterator advancement, not disk reading or matching.
    let advancing: Promise<IteratorResult<SearchCandidate>> = Promise.resolve({done: true, value: undefined});
    const next = (): Promise<IteratorResult<SearchCandidate>> => advancing = advancing.then(async () => {
      const time = performance.now(), result = await candidates.next();
      if (diagnostics) { diagnostics.enumerationMs += performance.now() - time; if (!result.done) diagnostics.candidateFiles++; }
      return result;
    });
    const lane = async (): Promise<void> => {
      const worker = new MatchingWorker(this.workerPath);
      try {
        while (!signal.aborted && !stats.limited) {
          const candidate = await next();
          if (candidate.done) break;
          const {uri, label} = candidate.value;
          try {
            const snapshot = await this.read(uri, budget.maximumFileBytes, diagnostics);
            if (signal.aborted) break;
            const matching = performance.now();
            const result = await worker.match(snapshot.text, request, Math.max(1, budget.maximumMatches - stats.matches), signal);
            if (diagnostics) diagnostics.matchingMs += performance.now() - matching;
            if (signal.aborted) break;
            const current = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString() && !document.isClosed);
            if (snapshot.version !== undefined && current?.version !== snapshot.version) { stats.skipped++; continue; }
            stats.files++;
            const available = budget.maximumMatches - stats.matches;
            if (result.matches.length > available || result.truncated) stats.limited = true;
            const matches = result.matches.slice(0, available);
            if (matches.length) {
              payloadBytes += matches.reduce((sum, match) => sum + (match.value.length + match.captures.reduce((sum, value) => sum + (value?.length ?? 0), 0)) * 2 + 1024, 0);
              if (payloadBytes > 32 * 1024 * 1024) { stats.limited = true; break; }
              const id = String(++serial);
              const publishing = performance.now();
              if (diagnostics) diagnostics.firstResultMs ??= publishing - started;
              onFile({id, uri: uri.toString(), label, hash: contentHash(snapshot.text), version: snapshot.version,
                matches: matches.map((match, index) => ({...match, id: `${id}:${index}`}))});
              if (diagnostics) diagnostics.resultsMs += performance.now() - publishing;
              stats.matches += matches.length;
            }
          } catch (error) {
            if (error instanceof SearchCancelled) break;
            if (error instanceof MatchTimeout) stats.timedOut++;
            else stats.skipped++;
          }
          onProgress({...stats});
        }
      } finally { worker.dispose(); }
    };
    await Promise.all([lane(), lane()]);
    await candidates.return(undefined);
    stats.cancelled = signal.aborted;
    if (diagnostics) diagnostics.elapsedMs = performance.now() - started;
    return stats;
  }

  async read(uri: vscode.Uri, maximum: number, diagnostics?: SearchDiagnostics): Promise<{text: string; version?: number}> {
    const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString() && !document.isClosed);
    if (document) {
      const text = document.getText();
      if (text.includes("\0")) throw new Error("Binary file.");
      if (Buffer.byteLength(text, "utf8") > maximum) throw new Error("File size limit.");
      return {text, version: document.version};
    }
    let time = performance.now();
    const stat = await vscode.workspace.fs.stat(uri);
    if (diagnostics) diagnostics.statMs += performance.now() - time;
    if (stat.size > maximum) throw new Error("File size limit.");
    time = performance.now();
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (diagnostics) { diagnostics.readMs += performance.now() - time; diagnostics.bytesRead += bytes.byteLength; }
    if (bytes.byteLength > maximum) throw new Error("File size limit.");
    const encoding = vscode.workspace.getConfiguration("files", uri).get<string>("encoding", "utf8");
    time = performance.now();
    const text = decodeSearchFile(bytes, encoding);
    if (diagnostics) { diagnostics.decodeMs += performance.now() - time; diagnostics.decodedFiles++; }
    return {text};
  }

  /** Bounded path-only inventory for equal-candidate performance comparisons. */
  async listCandidates(request: SearchRequest, current: vscode.Uri | undefined, budget: SearchBudget, signal: AbortSignal): Promise<SearchCandidate[]> {
    const stats: SearchStats = {files: 0, skipped: 0, timedOut: 0, matches: 0, limited: false, cancelled: false};
    const files: SearchCandidate[] = [];
    for await (const file of this.candidates(request, current, budget, signal, stats)) files.push(file);
    if (stats.limited || stats.skipped || signal.aborted) throw new Error("Candidate inventory is incomplete.");
    return files;
  }

  private async *candidates(request: SearchRequest, current: vscode.Uri | undefined, budget: SearchBudget,
    signal: AbortSignal, stats: SearchStats): AsyncGenerator<SearchCandidate> {
    const seen = new Set<string>();
    let visited = 0;
    const accepted = (uri: vscode.Uri): boolean => {
      if (seen.has(uri.toString()) || isGitMetadata(uri.path) || isKnownBinaryFile(uri.path)) return false;
      seen.add(uri.toString());
      if (++visited > budget.maximumFiles) { stats.limited = true; return false; }
      return true;
    };
    if (request.scope === "file" || request.scope === "open") {
      const uris = request.scope === "file" ? current ? [current] : [] : vscode.window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab =>
        tab.input instanceof vscode.TabInputText ? [tab.input.uri] : []));
      for (const uri of uris) {
        if (signal.aborted || stats.limited) return;
        const label = vscode.workspace.asRelativePath(uri, true);
        if (accepted(uri) && (!request.include || matchesPatterns(label, request.include)) && !matchesPatterns(label, request.exclude)) yield {uri, label};
      }
      return;
    }
    const workspaceRoots = vscode.workspace.workspaceFolders ?? [];
    const selected = request.scope === "folder" && request.folder ? vscode.Uri.parse(request.folder) : undefined;
    const roots = selected ? [selected] : workspaceRoots.map(folder => folder.uri);
    for (const root of roots) {
      const workspace = vscode.workspace.getWorkspaceFolder(root);
      const base = workspace?.uri ?? root;
      const filesRules = vscode.workspace.getConfiguration("files", base).get<Record<string, unknown>>("exclude", {});
      const searchRules = vscode.workspace.getConfiguration("search", base).get<Record<string, unknown>>("exclude", {});
      const walk = async function* (directory: vscode.Uri, layers: IgnoreLayer[]): AsyncGenerator<SearchCandidate> {
        if (signal.aborted || stats.limited) return;
        let entries: [string, vscode.FileType][];
        try { entries = await vscode.workspace.fs.readDirectory(directory); } catch { stats.skipped++; return; }
        const relative = directory.path.slice(base.path.length).replace(/^\//, "");
        const prefix = relative ? `${relative}/` : "";
        if (request.useIgnores && entries.some(([name]) => name === ".gitignore")) {
          try { layers = [...layers, ignoreLayer(prefix, new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(directory, ".gitignore"))))]; }
          catch { stats.skipped++; }
        }
        const siblings = entries.map(([name]) => name);
        for (const [name, kind] of entries.sort(([a], [b]) => a.localeCompare(b))) {
          if (signal.aborted || stats.limited) return;
          const path = prefix + name, uri = vscode.Uri.joinPath(directory, name), isDirectory = !!(kind & vscode.FileType.Directory);
          if (kind & vscode.FileType.SymbolicLink || isGitMetadata(path)) continue;
          if (request.useIgnores && (isIgnored(path, isDirectory, layers) ||
            excludedBySettings(path, {...filesRules, ...searchRules}, siblings))) continue;
          if (matchesPatterns(path, request.exclude)) continue;
          if (isDirectory) yield* walk(uri, layers);
          else if (kind & vscode.FileType.File && accepted(uri) && (!request.include || matchesPatterns(path, request.include))) {
            yield {uri, label: workspaceRoots.length > 1 && workspace ? `${workspace.name}/${path}` : path};
          }
          if (visited % 100 === 0) await tick();
        }
      };
      // A chosen subdirectory inherits .gitignore files from its workspace ancestors.
      const inherited: IgnoreLayer[] = [];
      if (request.useIgnores && root.path !== base.path) {
        const pieces = root.path.slice(base.path.length).replace(/^\//, "").split("/");
        let parent = base, prefix = "";
        for (const piece of pieces) {
          try { inherited.push(ignoreLayer(prefix, new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(parent, ".gitignore"))))); }
          catch { /* No ignore file at this ancestor. */ }
          parent = vscode.Uri.joinPath(parent, piece); prefix += `${piece}/`;
        }
      }
      yield* walk(root, inherited);
    }
  }
}
