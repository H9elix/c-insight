import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { runTests } from "@vscode/test-electron";
import { isolatedTestLaunchArgs } from "./testLaunchArgs";

async function main(): Promise<void> {
  const project = resolve(__dirname, "../../.."), temporary = await mkdtemp(join(tmpdir(), "ci-search-benchmark-"));
  const source = process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_ROOT;
  if (!source) throw new Error("Set C_INSIGHT_TEXT_SEARCH_BENCHMARK_ROOT to the read-only source folder.");
  process.env.LD_LIBRARY_PATH = [join(project, ".vscode-test/runtime-libs/usr/lib/x86_64-linux-gnu"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(delimiter);
  try {
    const workspace = join(temporary, "benchmark.code-workspace");
    await writeFile(workspace, JSON.stringify({folders: [{path: resolve(source)}], settings: {
      "files.exclude": {}, "search.exclude": {}, "cInsight.followCursor": false, "cInsight.session.restore": false,
    }}));
    await runTests({version: "1.130.0", vscodeExecutablePath: process.env.C_INSIGHT_VSCODE_EXECUTABLE_PATH || undefined,
      extensionDevelopmentPath: project, extensionTestsPath: join(__dirname, "suite/textSearchBenchmark.js"),
      launchArgs: isolatedTestLaunchArgs(workspace)});
  } finally { await rm(temporary, {recursive: true, force: true}); }
}
void main().catch(error => {console.error(error); process.exitCode = 1;});
