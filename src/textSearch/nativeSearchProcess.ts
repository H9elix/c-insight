import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { SearchCancelled } from "./matchingPool";
import type { TextMatch, SearchOptions } from "./searchModel";
import { nativeArgs, type NativeFileFilters } from "./nativeSearchQuery";
import { nativeReplacement } from "./nativeReplacement";

export interface NativeMatch extends Omit<TextMatch, "start" | "end"> {replacement?: string}
export interface NativeSearchRun {
  cwd?: string; paths: readonly string[]; input?: string; filters?: NativeFileFilters; maximumMatches?: number;
  replacement?: string;
}
export interface NativeSearchSummary {files: number; matches: number; bytes: number; limited: boolean}
type Data = {text?: string; bytes?: string};
const value = (data: Data): string => typeof data.text === "string" ? data.text : Buffer.from(data.bytes ?? "", "base64").toString("utf8");

export function nativeMatches(data: {line_number: number; lines: Data; submatches: Array<{start: number; end: number; match: Data; replacement?: Data}>}): NativeMatch[] {
  const text = value(data.lines), bytes = Buffer.from(text), matches: NativeMatch[] = [];
  let line = data.line_number - 1, character = 0, previous = 0, textOffset = 0, lineStart = 0, cachedStart = -1, lineEnd = text.length;
  const advance = (end: number): void => {
    const portion = bytes.subarray(previous, end).toString("utf8"), pieces = portion.split("\n");
    if (pieces.length > 1) {line += pieces.length - 1; character = pieces.at(-1)!.length; lineStart = textOffset + portion.lastIndexOf("\n") + 1;} else character += portion.length;
    textOffset += portion.length;
    previous = end;
  };
  for (const match of data.submatches) {
    advance(match.start); const startLine = line, startCharacter = character;
    const matchOffset = textOffset;
    if (cachedStart !== lineStart) {cachedStart = lineStart; const end = text.indexOf("\n", matchOffset); lineEnd = end < 0 ? text.length : end;}
    const snippetStart = Math.max(lineStart, matchOffset - 120), snippetEnd = Math.min(lineEnd, matchOffset + 300);
    advance(match.end);
    matches.push({line: startLine, character: startCharacter, endLine: line, endCharacter: character,
      value: value(match.match), captures: [], snippet: text.slice(snippetStart, snippetEnd).replace(/\r$/, ""),
      highlightStart: matchOffset - snippetStart, highlightEnd: Math.min(matchOffset + value(match.match).length, snippetEnd) - snippetStart,
      replacement: match.replacement ? value(match.replacement) : undefined});
  }
  return matches;
}

/** One native result stream, no shell or fixed query timeout. Async file consumers apply backpressure. */
export async function runNativeSearch(binary: string, options: SearchOptions, run: NativeSearchRun, signal: AbortSignal,
  onFile: (path: string, matches: NativeMatch[]) => Promise<boolean | void>): Promise<NativeSearchSummary> {
  if (signal.aborted) throw new SearchCancelled();
  const child = spawn(binary, [...nativeArgs(options, run.filters, run.replacement), "--", ...run.paths],
    {cwd: run.cwd, stdio: [run.input === undefined ? "ignore" : "pipe", "pipe", "pipe"], shell: false, windowsHide: true});
  let processError: Error | undefined, stderr = "", stopped = false;
  const exit = new Promise<number | null>(resolve => {
    child.once("error", error => {processError = error;}); child.once("close", code => resolve(code));
  });
  const abort = (): void => {child.kill();}; signal.addEventListener("abort", abort, {once: true});
  child.stderr!.on("data", (bytes: Buffer) => {if (stderr.length < 4096) stderr += bytes.toString("utf8").slice(0, 4096 - stderr.length);});
  if (run.input !== undefined) {child.stdin!.on("error", () => undefined); child.stdin!.end(run.input);}
  const summary: NativeSearchSummary = {files: 0, matches: 0, bytes: 0, limited: false};
  let path = "", matches: NativeMatch[] = [];
  const flush = async (): Promise<void> => {
    if (matches.length && !signal.aborted) {
      const keepGoing = await onFile(path, matches); summary.files++;
      if (keepGoing === false) {stopped = true; summary.limited = true; child.kill();}
    }
    matches = [];
  };
  try {
    const lines = createInterface({input: child.stdout!, crlfDelay: Infinity});
    for await (const line of lines) {
      if (signal.aborted || stopped) break;
      const record = JSON.parse(line);
      if (record.type === "begin") {await flush(); path = value(record.data.path);}
      else if (record.type === "match") {
        path = value(record.data.path);
        const found = nativeMatches(record.data), available = (run.maximumMatches ?? Infinity) - summary.matches;
        for (let i = 0; i < Math.min(available, found.length); i++) matches.push(found[i]); summary.matches += Math.min(available, found.length);
        if (found.length > available) {summary.limited = true; await flush(); stopped = true; child.kill(); break;}
      } else if (record.type === "end") await flush();
      else if (record.type === "summary") {summary.files = record.data.stats.searches; summary.bytes = record.data.stats.bytes_searched;}
    }
    if (!stopped) await flush();
    if (stopped) child.stdout!.destroy();
    const code = await exit;
    if (signal.aborted) throw new SearchCancelled();
    if (processError) throw new Error("Native text search is unavailable. Reinstall the extension for this platform.", {cause: processError});
    if (!stopped && code !== 0 && code !== 1) throw new Error(stderr.trim() || "Native text search failed.");
    return summary;
  } catch (error) {child.kill(); await exit; throw error;}
  finally {signal.removeEventListener("abort", abort);}
}

export async function matchNativeText(binary: string, text: string, options: SearchOptions, signal: AbortSignal, replacement?: string): Promise<TextMatch[]> {
  const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const expansion = replacement !== undefined && options.regex ? nativeReplacement(options.query, replacement, text) : undefined;
  const matches: TextMatch[] = [];
  await runNativeSearch(binary, options, {paths: ["-"], input: text, filters: {useIgnores: false, encoding: "utf8"}, replacement: expansion?.template}, signal,
    async (_path, found) => {
      for (const match of found) {
        const start = starts[match.line] + match.character, end = starts[match.endLine] + match.endCharacter;
        if (text.slice(start, end) !== match.value) throw new Error("Native match offsets do not match the source snapshot.");
        matches.push({...match, start, end, replacementValue: expansion ? expansion.expand(match.replacement ?? "", start, end) : undefined});
      }
    });
  return matches;
}
