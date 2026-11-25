import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { createServer } from "node:net";
import { runTests } from "@vscode/test-electron";
import { isolatedTestLaunchArgs } from "./testLaunchArgs";

async function main(): Promise<void> {
  const source = process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_ROOT;
  if (!source) throw new Error("Set C_INSIGHT_TEXT_SEARCH_BENCHMARK_ROOT to a read-only source folder.");
  const project = resolve(__dirname, "../../.."), temporary = await mkdtemp(join(tmpdir(), "ci-search-ui-benchmark-"));
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as {port: number}).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env.C_INSIGHT_SEARCH_CDP_PORT = String(port);
  process.env.LD_LIBRARY_PATH = [join(project, ".vscode-test/runtime-libs/usr/lib/x86_64-linux-gnu"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(delimiter);
  try {
    let root = resolve(source);
    if (source === "synthetic") {
      root = join(temporary, "source"); await mkdir(root);
      for (let batch = 0; batch < 10; batch++) await Promise.all(Array.from({length: 100}, (_, index) => {
        const number = batch * 100 + index;
        return writeFile(join(root, `${number}.c`), "return;\n".repeat(24) + (number % 100 === 0 ? "avcodec_receive_frame();\navcodec_send_packet();\n" : ""));
      }));
      await writeFile(join(root, "buffer.c"), "int buffer_file;\n");
    } else if (process.env.C_INSIGHT_SEARCH_UI_DIRTY === "1") throw new Error("Dirty-buffer UI benchmarking is limited to synthetic fixtures.");
    const workspace = join(temporary, "search.code-workspace");
    await writeFile(workspace, JSON.stringify({folders: [{path: root}], settings: {
      "workbench.startupEditor": "none", "files.exclude": {}, "search.exclude": {}, "search.searchOnType": false,
      "search.maxResults": 20000, "cInsight.followCursor": false, "cInsight.session.restore": false,
    }}));
    await runTests({version: "1.130.0", vscodeExecutablePath: process.env.C_INSIGHT_VSCODE_EXECUTABLE_PATH || undefined,
      extensionDevelopmentPath: project, extensionTestsPath: join(__dirname, "suite/textSearchUiBenchmark.js"),
      launchArgs: [...isolatedTestLaunchArgs(workspace), `--remote-debugging-port=${port}`, "--locale=en"]});
  } finally { await rm(temporary, {recursive: true, force: true}); }
}
void main().catch(error => {console.error(error); process.exitCode = 1;});
