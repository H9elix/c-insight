import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { DEFAULT_SEARCH_OPTIONS } from "../../../src/textSearch/searchModel";
import { WorkspaceTextSearch, DEFAULT_SEARCH_BUDGET, type SearchRequest } from "../../../src/textSearch/workspaceSearch";
import { searchDiagnostics } from "../../../src/textSearch/searchDiagnostics";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("H9elix.c-insight")!;
  assert(!extension.isActive, "Benchmark must not activate analysis engines against the source workspace");
  const backend = "native";
  const caseSensitive = process.env.C_INSIGHT_TEXT_SEARCH_CASE_SENSITIVE !== "0";
  const search = new WorkspaceTextSearch(join(extension.extensionPath, "dist/textSearchWorker.js"));
  const queries = ["CI_SEARCH_ABSENT_c2a6d8e0", "avcodec_receive_frame", "return"];
  const rows: unknown[] = [];
  for (const query of queries) {
    const request: SearchRequest = {...DEFAULT_SEARCH_OPTIONS, query, caseSensitive, scope: "workspace", include: "**/*.{c,h,cpp,hpp}", exclude: "", useIgnores: true};
    const inventoryStart = performance.now();
    const candidates = await search.listCandidates(request, undefined, DEFAULT_SEARCH_BUDGET, new AbortController().signal);
    const inventoryMs = performance.now() - inventoryStart;
    for (let repeat = 0; repeat < 2; repeat++) {
      const diagnostics = searchDiagnostics();
      const signatures: string[] = [];
      const stats = await search.run(request, undefined, DEFAULT_SEARCH_BUDGET, new AbortController().signal, file => {
        signatures.push(...file.matches.map(match => `${file.uri}:${match.line}:${match.character}:${match.endCharacter}`));
      }, () => undefined, diagnostics);
      // A bounded explicit argument list makes the raw backend use exactly the same filtered paths.
      const started = performance.now(); let firstResultMs: number | undefined, hits = 0, lines = "", stderr = "", limited = false;
      const nativeSignatures: string[] = [];
      const child = spawn(process.env.C_INSIGHT_BENCHMARK_RG || "rg", ["--no-config", "--no-ignore", "--text", "--fixed-strings", caseSensitive ? "--case-sensitive" : "--ignore-case", "--json", "--regexp", query, "--", ...candidates.map(file => file.uri.fsPath)], {stdio: ["ignore", "pipe", "pipe"]});
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (text: string) => {
        if (limited) return;
        lines += text;
        let end: number;
        while ((end = lines.indexOf("\n")) >= 0) {
          const line = lines.slice(0, end); lines = lines.slice(end + 1);
          const item = JSON.parse(line);
          if (item.type === "match") {
            firstResultMs ??= performance.now() - started; hits += item.data.submatches.length;
            const bytes = Buffer.from(item.data.lines.text);
            for (const match of item.data.submatches) nativeSignatures.push(`${vscode.Uri.file(item.data.path.text).toString()}:${item.data.line_number - 1}:${bytes.subarray(0, match.start).toString("utf8").length}:${bytes.subarray(0, match.end).toString("utf8").length}`);
          }
          if (hits >= DEFAULT_SEARCH_BUDGET.maximumMatches) {limited = true; hits = DEFAULT_SEARCH_BUDGET.maximumMatches; child.kill(); break;}
        }
      });
      child.stderr.on("data", (text: string) => {stderr += text;});
      await new Promise<void>((resolve, reject) => {child.once("error", reject); child.once("close", code => code === 0 || code === 1 || limited ? resolve() : reject(new Error(stderr)));});
      assert.equal(hits, stats.matches, `Match count differs for ${query}`);
      if (!stats.limited && !limited) assert.deepEqual(signatures.sort(), nativeSignatures.sort(), "Exact file/UTF-16 match positions differ");
      const row = {query, repeat, backend, caseSensitive, candidates: candidates.length, inventoryMs, pipeline: {stats, diagnostics},
        matchDigest: createHash("sha256").update(signatures.sort().join("\n")).digest("hex"),
        rawRipgrep: {elapsedMs: performance.now() - started, firstResultMs, matches: hits, limited}};
      rows.push(row); console.log("SEARCH_BENCHMARK", JSON.stringify(row));
    }
  }
  assert(!extension.isActive);
  if (process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT) await writeFile(process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT, JSON.stringify(rows, null, 2));
}
