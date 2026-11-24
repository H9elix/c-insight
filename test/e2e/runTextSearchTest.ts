import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";
import { isolatedTestLaunchArgs } from "./testLaunchArgs";

async function main(): Promise<void> {
  const project = path.resolve(__dirname, "../../..");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "c-insight-text-search-"));
  process.env.LD_LIBRARY_PATH = [path.join(project, ".vscode-test/runtime-libs/usr/lib/x86_64-linux-gnu"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  try {
    for (const folder of ["alpha/src", "alpha/.git", "beta"]) await mkdir(path.join(temporary, folder), {recursive: true});
    for (const [name, text] of Object.entries({
      "alpha/src/a.txt": "needle first\r\nNEEDLE second\r\n", "beta/b.txt": "needle other\n",
      "alpha/.gitignore": "ignored.txt\n", "alpha/ignored.txt": "needle ignored\n", "alpha/search-hidden.txt": "needle excluded\n",
      "alpha/.git/private.txt": "needle never\n", "alpha/src/.gitignore": "*.log\n!keep.log\n",
      "alpha/src/drop.log": "needle hidden\n", "alpha/src/keep.log": "needle kept\n",
    })) await writeFile(path.join(temporary, name), text);
    await writeFile(path.join(temporary, "alpha/binary.dat"), Buffer.from([0, 1, 2, 3]));
    const workspace = path.join(temporary, "search.code-workspace");
    await writeFile(workspace, JSON.stringify({folders: [{path: "alpha"}, {path: "beta"}], settings: {
      "cInsight.followCursor": false, "cInsight.session.restore": false, "cInsight.codePreview.semanticHighlighting": false,
      "search.exclude": {"**/search-hidden.txt": true},
    }}));
    await runTests({version: process.env.C_INSIGHT_VSCODE_TEST_VERSION ?? "1.130.0",
      vscodeExecutablePath: process.env.C_INSIGHT_VSCODE_EXECUTABLE_PATH || undefined,
      extensionDevelopmentPath: project, extensionTestsPath: path.join(__dirname, "suite/textSearch.js"),
      launchArgs: isolatedTestLaunchArgs(workspace)});
  } finally { await rm(temporary, {recursive: true, force: true}); }
}
void main().catch(error => {console.error("Text search Extension Host test failed:", error); process.exitCode = 1;});
