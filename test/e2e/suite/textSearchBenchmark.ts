import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import * as vscode from "vscode";
import { DEFAULT_SEARCH_OPTIONS } from "../../../src/textSearch/searchModel";
import { WorkspaceTextSearch, DEFAULT_SEARCH_BUDGET, type SearchRequest } from "../../../src/textSearch/workspaceSearch";
import { searchDiagnostics } from "../../../src/textSearch/searchDiagnostics";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("H9elix.c-insight")!;
  assert(!extension.isActive, "Benchmark must not activate analysis engines against the source workspace");
  const search = new WorkspaceTextSearch(join(extension.extensionPath, "dist/textSearchWorker.js"));
  const queries = ["CI_SEARCH_ABSENT_c2a6d8e0", "avcodec_receive_frame", "return"];
  const rows: unknown[] = [];
  for (const query of queries) {
    const request: SearchRequest = {...DEFAULT_SEARCH_OPTIONS, query, caseSensitive: true, scope: "workspace", include: "**/*.{c,h,cpp,hpp}", exclude: "", useIgnores: true};
    const inventoryStart = performance.now();
    const candidates = await search.listCandidates(request, undefined, DEFAULT_SEARCH_BUDGET, new AbortController().signal);
    const inventoryMs = performance.now() - inventoryStart;
    for (let repeat = 0; repeat < 2; repeat++) {
      const diagnostics = searchDiagnostics();
      const stats = await search.run(request, undefined, DEFAULT_SEARCH_BUDGET, new AbortController().signal, () => undefined, () => undefined, diagnostics);
      // A bounded explicit argument list makes the raw backend use exactly the same filtered paths.
      const started = performance.now(); let firstResultMs: number | undefined, hits = 0, lines = "", stderr = "", limited = false;
      const child = spawn(process.env.C_INSIGHT_BENCHMARK_RG || "rg", ["--no-config", "--no-ignore", "--text", "--fixed-strings", "--case-sensitive", "--json", "--regexp", query, "--", ...candidates.map(file => file.uri.fsPath)], {stdio: ["ignore", "pipe", "pipe"]});
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (text: string) => {
        if (limited) return;
        lines += text;
        let end: number;
        while ((end = lines.indexOf("\n")) >= 0) {
          const line = lines.slice(0, end); lines = lines.slice(end + 1);
          const item = JSON.parse(line);
          if (item.type === "match") {firstResultMs ??= performance.now() - started; hits += item.data.submatches.length;}
          if (hits >= DEFAULT_SEARCH_BUDGET.maximumMatches) {limited = true; hits = DEFAULT_SEARCH_BUDGET.maximumMatches; child.kill(); break;}
        }
      });
      child.stderr.on("data", (text: string) => {stderr += text;});
      await new Promise<void>((resolve, reject) => {child.once("error", reject); child.once("close", code => code === 0 || code === 1 || limited ? resolve() : reject(new Error(stderr)));});
      assert.equal(hits, stats.matches, `Match count differs for ${query}`);
      const row = {query, repeat, candidates: candidates.length, inventoryMs, javascript: {stats, diagnostics},
        rawRipgrep: {elapsedMs: performance.now() - started, firstResultMs, matches: hits, limited}};
      rows.push(row); console.log("SEARCH_BENCHMARK", JSON.stringify(row));
    }
  }
  assert(!extension.isActive);
  if (process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT) await writeFile(process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT, JSON.stringify(rows, null, 2));
}
