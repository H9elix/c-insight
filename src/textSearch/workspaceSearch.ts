import * as vscode from "vscode";
import { readFile, stat, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { compilePatterns, compileExclusions, decodeSearchFile, ignoreLayer, isIgnored, type IgnoreLayer } from "./fileRules";
import { contentHash, type SearchOptions, type TextMatch } from "./searchModel";
import { SearchCancelled } from "./matchingPool";
import { packagedRipgrep } from "./ripgrepSearch";
import { nativeArgs, nativeQuery, searchGlobs, type NativeFileFilters } from "./nativeSearchQuery";
import { runNativeSearch, matchNativeText, type NativeMatch } from "./nativeSearchProcess";
import type { SearchDiagnostics } from "./searchDiagnostics";

export type TextSearchScope = "file" | "open" | "folder" | "workspace";
export interface SearchRequest extends SearchOptions {scope: TextSearchScope; include: string; exclude: string; useIgnores: boolean; folder?: string}
export interface SearchFile {id: string; uri: string; label: string; hash: string; version?: number; matches: Array<TextMatch & {id: string}>}
export interface SearchStats {files: number; skipped: number; timedOut: number; matches: number; limited: boolean; cancelled: boolean}
export interface SearchBudget {maximumFiles: number; maximumMatches: number; maximumFileBytes: number}
export const DEFAULT_SEARCH_BUDGET: SearchBudget = {maximumFiles: Infinity, maximumMatches: 20000, maximumFileBytes: Infinity};
export interface SearchCandidate {uri: vscode.Uri; label: string}
interface RootPlan {root: vscode.Uri; base: vscode.Uri; filters: NativeFileFilters; conditional: Record<string, unknown>;
  include: (path: string) => boolean; exclude: (path: string) => boolean; except: (path: string) => boolean;
  siblingExclude: (path: string, siblings: readonly string[]) => boolean}

/** Native streams own matching; buffers override disk and the host validates source snapshots. */
export class WorkspaceTextSearch {
  constructor(private readonly workerPath: string, private readonly options: {ripgrepPath?: string} = {}) {}
  private binary(): string {
    const binary = this.options.ripgrepPath ?? packagedRipgrep(this.workerPath);
    if (!binary) throw new Error("Native text search is unavailable. Reinstall the extension for this platform.");
    return binary;
  }
  async matchSnapshot(text: string, request: SearchOptions, replacement?: string): Promise<TextMatch[]> {
    const options = {...request};
    if (!options.caseSensitive && vscode.workspace.getConfiguration("search").get<boolean>("smartCase", false)) options.caseSensitive = /[A-Z]/.test(options.regex ? options.query.replace(/\\./g, "") : options.query);
    return matchNativeText(this.binary(), text, options, new AbortController().signal, replacement);
  }
  private plans(request: SearchRequest): RootPlan[] {
    const roots = request.scope === "folder" && request.folder ? [vscode.Uri.parse(request.folder)] : (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri);
    return roots.map(root => {
      const base = vscode.workspace.getWorkspaceFolder(root)?.uri ?? root;
      const files = vscode.workspace.getConfiguration("files", base), search = vscode.workspace.getConfiguration("search", base);
      const settings = request.useIgnores ? {...files.get<Record<string, unknown>>("exclude", {}), ...search.get<Record<string, unknown>>("exclude", {})} : {};
      const excludes = searchGlobs(request.exclude), exceptions: string[] = [], conditional: Record<string, unknown> = {};
      for (const [pattern, value] of Object.entries(settings)) {
        if (value === true) {
          if (pattern.startsWith("!")) exceptions.push(pattern.slice(1), `${pattern.slice(1)}/**`);
          else excludes.push(pattern, `${pattern}/**`);
        } else if (value && typeof value === "object") conditional[pattern] = value;
      }
      for (const nested of roots) if (nested.toString() !== root.toString() && nested.scheme === root.scheme && nested.authority === root.authority && nested.path.startsWith(root.path.replace(/\/$/, "") + "/")) {
        const path = nested.path.slice(base.path.length).replace(/^\//, ""); excludes.push(path, `${path}/**`);
      }
      const includes = searchGlobs(request.include), ignoreGlobCase = process.platform !== "linux";
      return {root, base, conditional, include: includes.length ? compilePatterns(includes.join(","), ignoreGlobCase) : () => true,
        exclude: compilePatterns(excludes.join(","), ignoreGlobCase), except: compilePatterns(exceptions.join(","), ignoreGlobCase), siblingExclude: compileExclusions(conditional, ignoreGlobCase), filters: {includes, excludes, exceptions,
        useIgnores: request.useIgnores, useParentIgnores: search.get<boolean>("useParentIgnoreFiles", false),
        useGlobalIgnores: search.get<boolean>("useGlobalIgnoreFiles", false), followSymlinks: search.get<boolean>("followSymlinks", true),
        ignoreGlobCase, encoding: files.get<string>("encoding", "utf8"), threads: search.get<number>("ripgrep.maxThreads", 0)}};
    });
  }
  private inRoot(uri: vscode.Uri, root: vscode.Uri): boolean {
    return uri.scheme === root.scheme && uri.authority === root.authority && (uri.path === root.path || uri.path.startsWith(root.path.replace(/\/$/, "") + "/"));
  }
  private async accepted(uri: vscode.Uri, plan: RootPlan): Promise<boolean> {
    const path = uri.path.slice(plan.base.path.length).replace(/^\//, "");
    if (!plan.include(path) || !plan.except(path) && plan.exclude(path)) return false;
    if (!Object.keys(plan.conditional).length) return true;
    const parent = uri.with({path: uri.path.slice(0, uri.path.lastIndexOf("/"))});
    const siblings = uri.scheme === "file" ? await readdir(parent.fsPath) : (await vscode.workspace.fs.readDirectory(parent)).map(([name]) => name);
    return !plan.siblingExclude(path, siblings);
  }
  async run(request: SearchRequest, current: vscode.Uri | undefined, budget: SearchBudget, signal: AbortSignal,
    onFile: (file: SearchFile) => void, onProgress: (stats: SearchStats) => void, diagnostics?: SearchDiagnostics): Promise<SearchStats> {
    const started = performance.now(), binary = this.binary(); nativeQuery(request);
    const stats: SearchStats = {files: 0, skipped: 0, timedOut: 0, matches: 0, limited: false, cancelled: false};
    const plans = this.plans(request), seen = new Set<string>(); let serial = 0;
    if (diagnostics) diagnostics.backend = "ripgrep";
    const effective = {...request};
    if (!effective.caseSensitive && vscode.workspace.getConfiguration("search").get<boolean>("smartCase", false)) effective.caseSensitive = /[A-Z]/.test(request.regex ? request.query.replace(/\\./g, "") : request.query);
    const publish = async (uri: vscode.Uri, matches: NativeMatch[], snapshot?: {text: string; version?: number}): Promise<boolean> => {
      const key = uri.toString(); if (seen.has(key) || !matches.length) return !stats.limited;
      seen.add(key);
      if (signal.aborted) throw new SearchCancelled();
      if (stats.matches >= budget.maximumMatches) {stats.limited = true; return false;}
      try {
        snapshot ??= await this.read(uri, budget.maximumFileBytes, diagnostics, true);
        const starts = [0]; for (let i = 0; i < snapshot.text.length; i++) if (snapshot.text[i] === "\n") starts.push(i + 1);
        const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === key && !document.isClosed);
        if (snapshot.version !== undefined && snapshot.version !== document?.version) {stats.skipped++; return true;}
        const id = String(++serial), available = budget.maximumMatches - stats.matches;
        const mapped = matches.slice(0, available).map((match, index) => {
          const start = starts[match.line] + match.character, end = starts[match.endLine] + match.endCharacter;
          if (!Number.isFinite(start) || !Number.isFinite(end) || snapshot!.text.slice(start, end) !== match.value) throw new Error("Search source changed during native matching.");
          return {...match, start, end, id: `${id}:${index}`};
        });
        if (signal.aborted) throw new SearchCancelled();
        if (mapped.length) {
          const time = performance.now(); if (diagnostics) diagnostics.firstResultMs ??= time - started;
          onFile({id, uri: key, label: vscode.workspace.asRelativePath(uri, true), hash: contentHash(snapshot.text), version: snapshot.version, matches: mapped});
          stats.matches += mapped.length; if (diagnostics) diagnostics.resultsMs += performance.now() - time;
        }
        if (matches.length > available) stats.limited = true;
      } catch (error) {if (error instanceof SearchCancelled) throw error; stats.skipped++;}
      onProgress({...stats}); return !stats.limited;
    };
    // Saved buffers share the disk stream; only dirty buffers need an overriding native stdin query.
    const documents = vscode.workspace.textDocuments.filter(document => !document.isClosed && (request.scope === "file" || request.scope === "open" || document.isDirty));
    const open = new Set(documents.map(document => document.uri.toString()));
    const tabs = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab => tab.input instanceof vscode.TabInputText ? [tab.input.uri.toString()] : [])));
    const inScope = async (uri: vscode.Uri): Promise<boolean> => {
      if (request.scope === "file" && uri.toString() !== current?.toString() || request.scope === "open" && !tabs.has(uri.toString())) return false;
      if (request.scope === "file" || request.scope === "open") {
        const label = vscode.workspace.asRelativePath(uri, true);
        return (!request.include || compilePatterns(searchGlobs(request.include).join(","))(label)) && !compilePatterns(searchGlobs(request.exclude).join(","))(label);
      }
      const plan = plans.filter(plan => this.inRoot(uri, plan.root)).sort((a, b) => b.root.path.length - a.root.path.length)[0];
      return !!plan && await this.accepted(uri, plan);
    };
    const searchBuffer = async (uri: vscode.Uri): Promise<void> => {
      const snapshot = await this.read(uri, budget.maximumFileBytes);
      if (diagnostics) diagnostics.nativeProcesses++;
      const summary = await runNativeSearch(binary, effective, {paths: ["-"], input: snapshot.text, filters: {useIgnores: false, encoding: "utf8"}, maximumMatches: budget.maximumMatches - stats.matches}, signal,
        async (_path, matches) => publish(uri, matches, snapshot));
      stats.files++; stats.limited ||= summary.limited;
    };
    try {
      for (const document of documents) {
        if (signal.aborted || stats.limited) break;
        if (await inScope(document.uri)) await searchBuffer(document.uri);
      }
      if (request.scope === "file" || request.scope === "open") {
        const uris = request.scope === "file" ? current ? [current] : [] : [...tabs].map(uri => vscode.Uri.parse(uri));
        for (const uri of uris) {if (signal.aborted || stats.limited) break; if (!open.has(uri.toString()) && await inScope(uri)) await searchBuffer(uri);}
      } else for (const plan of plans) {
        if (signal.aborted || stats.limited) break;
        if (plan.root.scheme !== "file") {
          for await (const uri of this.virtualFiles(plan, signal)) {
            if (signal.aborted || stats.limited) break;
            if (!open.has(uri.toString()) && await this.accepted(uri, plan)) await searchBuffer(uri);
          }
          continue;
        }
        const relative = plan.root.path.slice(plan.base.path.length).replace(/^\//, "") || ".";
        if (diagnostics) diagnostics.nativeProcesses++;
        const pending = new Set<Promise<void>>(); let failure: unknown;
        const consume = async (path: string, matches: NativeMatch[], exceptions = false): Promise<boolean> => {
          const uri = vscode.Uri.file(isAbsolute(path) ? path : join(plan.base.fsPath, path));
          if (open.has(uri.toString()) || exceptions && !plan.except(uri.path.slice(plan.base.path.length).replace(/^\//, "")) || !await this.accepted(uri, plan)) return true;
          // Bound snapshot reads, not native matching. Avoid a serial filesystem round trip per hit file.
          const task: Promise<void> = publish(uri, matches).then(() => undefined).catch(error => {failure ??= error;}).finally(() => pending.delete(task)); pending.add(task);
          if (pending.size >= 8) await Promise.race(pending);
          if (failure) throw failure;
          return !stats.limited;
        };
        let summary;
        try {
          summary = await runNativeSearch(binary, effective, {cwd: plan.base.fsPath, paths: [relative],
            filters: {...plan.filters, exceptions: undefined, maximumFileBytes: budget.maximumFileBytes}}, signal,
            async (path, matches) => consume(path, matches));
        } finally {await Promise.all(pending);}
        if (failure) throw failure;
        if (!stats.limited && plan.filters.exceptions?.length) {
          if (diagnostics) diagnostics.nativeProcesses++;
          let extra;
          try {extra = await runNativeSearch(binary, effective, {cwd: plan.base.fsPath, paths: [relative],
            filters: {...plan.filters, excludes: [], useIgnores: false}}, signal, (path, matches) => consume(path, matches, true));}
          finally {await Promise.all(pending);}
          if (failure) throw failure;
          stats.limited ||= extra.limited;
        }
        stats.files += summary.files; stats.limited ||= summary.limited;
        if (diagnostics) {diagnostics.candidateFiles += summary.files; diagnostics.bytesRead += summary.bytes;}
        onProgress({...stats});
      }
    } catch (error) {if (!(error instanceof SearchCancelled)) throw error;}
    finally {stats.cancelled = signal.aborted; if (diagnostics) diagnostics.elapsedMs = performance.now() - started;}
    return stats;
  }
  async read(uri: vscode.Uri, maximum: number, diagnostics?: SearchDiagnostics, local = false): Promise<{text: string; version?: number}> {
    const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString() && !document.isClosed);
    if (document) {
      const text = document.getText(); if (text.includes("\0")) throw new Error("Binary file.");
      if (Buffer.byteLength(text, "utf8") > maximum) throw new Error("File size limit.");
      return {text, version: document.version};
    }
    let time = performance.now();
    if (Number.isFinite(maximum)) {
      const metadata = local && uri.scheme === "file" ? await stat(uri.fsPath) : await vscode.workspace.fs.stat(uri);
      if (diagnostics) diagnostics.statMs += performance.now() - time;
      if (metadata.size > maximum) throw new Error("File size limit.");
    }
    time = performance.now(); const bytes = local && uri.scheme === "file" ? await readFile(uri.fsPath) : await vscode.workspace.fs.readFile(uri);
    if (diagnostics) {diagnostics.readMs += performance.now() - time; diagnostics.bytesRead += bytes.byteLength;}
    if (bytes.byteLength > maximum) throw new Error("File size limit.");
    time = performance.now(); const text = decodeSearchFile(bytes, vscode.workspace.getConfiguration("files", uri).get<string>("encoding", "utf8"));
    if (diagnostics) {diagnostics.decodeMs += performance.now() - time; diagnostics.decodedFiles++;}
    return {text};
  }
  private async *virtualFiles(plan: RootPlan, signal: AbortSignal): AsyncGenerator<vscode.Uri> {
    const walk = async function* (directory: vscode.Uri, inherited: IgnoreLayer[]): AsyncGenerator<vscode.Uri> {
      const entries = await vscode.workspace.fs.readDirectory(directory), layers = [...inherited];
      if (plan.filters.useIgnores) for (const name of [".gitignore", ".ignore", ".rgignore"]) {
        if (entries.some(([entry]) => entry === name)) layers.push(ignoreLayer(directory.path.replace(/\/$/, "") + "/", Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(directory, name))).toString("utf8")));
      }
      for (const [name, kind] of entries) {
        if (signal.aborted) return;
        const uri = vscode.Uri.joinPath(directory, name);
        if (isIgnored(uri.path, !!(kind & vscode.FileType.Directory), layers)) continue;
        if (kind & vscode.FileType.SymbolicLink) {if (plan.filters.followSymlinks) throw new Error("This virtual filesystem cannot resolve symbolic links safely."); else continue;}
        if (kind & vscode.FileType.Directory) yield* walk(uri, layers); else if (kind & vscode.FileType.File) yield uri;
      }
    }; yield* walk(plan.root, []);
  }
  /** Benchmark-only inventory; production matching does not enumerate every path in JS. */
  async listCandidates(request: SearchRequest, _current: vscode.Uri | undefined, budget: SearchBudget, signal: AbortSignal): Promise<SearchCandidate[]> {
    const files: SearchCandidate[] = [];
    for (const plan of this.plans(request)) {
      if (plan.root.scheme !== "file") throw new Error("Native inventory needs file-backed roots.");
      const args = nativeArgs({...request, query: "inventory", regex: false, wholeWord: false}, plan.filters); args.splice(args.indexOf("--regexp"));
      const child = spawn(this.binary(), [...args.filter(arg => arg !== "--json" && arg !== "--fixed-strings"), "--files", "--null", "--", plan.root.fsPath], {cwd: plan.base.fsPath, stdio: ["ignore", "pipe", "pipe"], shell: false});
      const abort = (): void => {child.kill();}; signal.addEventListener("abort", abort, {once: true});
      let pending = Buffer.alloc(0), error: Error | undefined;
      child.on("error", value => {error = value;}); child.stderr.on("data", () => undefined);
      const exit = new Promise<number | null>(resolve => child.once("close", code => resolve(code)));
      try {
        for await (const chunk of child.stdout) {
          pending = Buffer.concat([pending, chunk]); let end: number;
          while ((end = pending.indexOf(0)) >= 0) {
            const path = pending.subarray(0, end).toString("utf8"); pending = pending.subarray(end + 1);
            const uri = vscode.Uri.file(path);
            if (await this.accepted(uri, plan)) files.push({uri, label: vscode.workspace.asRelativePath(uri, true)});
            if (files.length > budget.maximumFiles) {child.kill(); throw new Error("Candidate inventory is incomplete.");}
          }
        }
        const code = await exit; if (signal.aborted) throw new SearchCancelled();
        if (error || code !== 0 && code !== 1 || pending.length) throw new Error("Native inventory failed.");
      } finally {child.kill(); signal.removeEventListener("abort", abort);}
    }
    return files;
  }
}
