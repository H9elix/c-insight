import * as vscode from "vscode";
import { isGitMetadata, isKnownBinaryFile } from "../projectFiles/projectFileModel";
import { decodeSearchFile, excludedBySettings, ignoreLayer, isIgnored, matchesPatterns, type IgnoreLayer } from "./fileRules";
import { contentHash, searchExpression, type SearchOptions, type TextMatch } from "./searchModel";
import { MatchingWorker, MatchTimeout, SearchCancelled } from "./matchingPool";

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
interface Candidate { uri: vscode.Uri; label: string }
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** No analysis engine or language-provider dependency. Content is retained only for the two in-flight files. */
export class WorkspaceTextSearch {
  constructor(private readonly workerPath: string) {}

  async run(request: SearchRequest, current: vscode.Uri | undefined, budget: SearchBudget,
    signal: AbortSignal, onFile: (file: SearchFile) => void, onProgress: (stats: SearchStats) => void): Promise<SearchStats> {
    searchExpression(request);
    const stats: SearchStats = {files: 0, skipped: 0, timedOut: 0, matches: 0, limited: false, cancelled: false};
    const candidates = this.candidates(request, current, budget, signal, stats);
    let serial = 0;
    // Serialize iterator advancement, not disk reading or matching.
    let advancing: Promise<IteratorResult<Candidate>> = Promise.resolve({done: true, value: undefined});
    const next = (): Promise<IteratorResult<Candidate>> => advancing = advancing.then(() => candidates.next());
    const lane = async (): Promise<void> => {
      const worker = new MatchingWorker(this.workerPath);
      try {
        while (!signal.aborted && !stats.limited) {
          const candidate = await next();
          if (candidate.done) break;
          const {uri, label} = candidate.value;
          try {
            const snapshot = await this.read(uri, budget.maximumFileBytes);
            if (signal.aborted) break;
            const result = await worker.match(snapshot.text, request, Math.max(1, budget.maximumMatches - stats.matches), signal);
            if (signal.aborted) break;
            stats.files++;
            const available = budget.maximumMatches - stats.matches;
            if (result.matches.length > available || result.truncated) stats.limited = true;
            const matches = result.matches.slice(0, available);
            if (matches.length) {
              const id = String(++serial);
              onFile({id, uri: uri.toString(), label, hash: contentHash(snapshot.text), version: snapshot.version,
                matches: matches.map((match, index) => ({...match, id: `${id}:${index}`}))});
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
    return stats;
  }

  async read(uri: vscode.Uri, maximum: number): Promise<{text: string; version?: number}> {
    const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString() && !document.isClosed);
    if (document) {
      const text = document.getText();
      if (Buffer.byteLength(text, "utf8") > maximum) throw new Error("File size limit.");
      return {text, version: document.version};
    }
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > maximum) throw new Error("File size limit.");
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > maximum) throw new Error("File size limit.");
    const encoding = vscode.workspace.getConfiguration("files", uri).get<string>("encoding", "utf8");
    return {text: decodeSearchFile(bytes, encoding)};
  }

  private async *candidates(request: SearchRequest, current: vscode.Uri | undefined, budget: SearchBudget,
    signal: AbortSignal, stats: SearchStats): AsyncGenerator<Candidate> {
    const seen = new Set<string>();
    let visited = 0;
    const accepted = (uri: vscode.Uri): boolean => {
      if (seen.has(uri.toString()) || isGitMetadata(uri.path) || isKnownBinaryFile(uri.path)) return false;
      seen.add(uri.toString());
      if (++visited > budget.maximumFiles) { stats.limited = true; return false; }
      return true;
    };
    if (request.scope === "file" || request.scope === "open") {
      const uris = request.scope === "file" ? current ? [current] : [] : vscode.workspace.textDocuments
        .filter(document => !document.isClosed && ["file", "vscode-remote", "untitled"].includes(document.uri.scheme)).map(document => document.uri);
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
      const walk = async function* (directory: vscode.Uri, layers: IgnoreLayer[]): AsyncGenerator<Candidate> {
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
            excludedBySettings(path, filesRules, siblings) || excludedBySettings(path, searchRules, siblings))) continue;
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
