import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { SearchCancelled } from "./matchingPool";
import type { SearchOptions } from "./searchModel";

export function packagedRipgrep(workerPath: string): string | undefined {
  const path = join(dirname(workerPath), "ripgrep", `${process.platform}-${process.arch}`, process.platform === "win32" ? "rg.exe" : "rg");
  return existsSync(path) ? path : undefined;
}

/** A literal, line-local ASCII superset filter; JS remains the authority for positions and whole words. */
export function canPrefilter(options: SearchOptions, encodings: readonly string[]): boolean {
  return !options.regex && !!options.query && /^[\x01-\x09\x0b\x0c\x0e-\x7f]+$/.test(options.query) &&
    encodings.every(encoding => /^(?:utf-?8|utf8bom)$/i.test(encoding));
}

/** Bounded explicit paths, no shell, user config, ignore files, preprocessors or private VS Code paths. */
export async function prefilterFiles(binary: string, files: readonly string[], options: SearchOptions, signal: AbortSignal): Promise<Set<string>> {
  if (signal.aborted) throw new SearchCancelled();
  if (!files.length) return new Set();
  return new Promise((resolve, reject) => {
    const known = new Set(files), matched = new Set<string>();
    const child = spawn(binary, ["--no-config", "--no-ignore", "--no-follow", "--hidden", "--text", "--encoding", "auto",
      "--fixed-strings", "--files-with-matches", "--null", "--color", "never", "--threads", "2",
      options.caseSensitive ? "--case-sensitive" : "--ignore-case", "--regexp", options.query, "--", ...files],
    {stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false});
    let pending = Buffer.alloc(0), failure: Error | undefined, finished = false;
    const abort = (): void => { child.kill(); };
    const timeout = setTimeout(() => {failure = new Error("Native text prefilter timed out."); child.kill();}, 10000);
    const finish = (error?: Error): void => {
      if (finished) return; finished = true; clearTimeout(timeout); signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new SearchCancelled());
      else if (error || failure) reject(error ?? failure);
      else resolve(matched);
    };
    signal.addEventListener("abort", abort, {once: true});
    child.stdout.on("data", (bytes: Buffer) => {
      pending = Buffer.concat([pending, bytes]);
      if (pending.length > 1024 * 1024) {failure = new Error("Native path output limit."); child.kill(); return;}
      let end: number;
      while ((end = pending.indexOf(0)) >= 0) {
        const path = pending.subarray(0, end).toString("utf8"); pending = pending.subarray(end + 1);
        if (!known.has(path)) {failure = new Error("Unexpected native search path."); child.kill(); return;}
        matched.add(path);
      }
    });
    // Drain stderr, but never retain paths or source from a native error. The caller safely rechecks the batch in JS.
    child.stderr.on("data", () => undefined);
    child.once("error", error => finish(error));
    child.once("close", code => finish((code === 0 || code === 1) && !pending.length ? undefined : new Error("Native text prefilter failed.")));
  });
}
