import { mkdtemp, mkdir, writeFile, copyFile, open, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";
import { isolatedTestLaunchArgs } from "./testLaunchArgs";

async function main(): Promise<void> {
  const project = path.resolve(__dirname, "../../..");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "c-insight-project-files-"));
  process.env.LD_LIBRARY_PATH = [path.join(project, ".vscode-test/runtime-libs/usr/lib/x86_64-linux-gnu"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  try {
    for (const folder of ["alpha/src", "alpha/hidden", "alpha/.git", "alpha/third_party", "beta/src"]) await mkdir(path.join(temporary, folder), { recursive: true });
    for (const [file, text] of Object.entries({
      "alpha/src/file10.c": "int tenth(void) { return 10; }\n", "alpha/src/file2.c": "int second(void) { return 2; }\n",
      "alpha/src/main.c": "int main(void) { return 0; }\n", "beta/src/main.c": "int another(void) { return 1; }\n",
      "alpha/readme.md": "# Alpha\n", "beta/readme.md": "# Beta\n", "alpha/hidden/secret.c": "int hidden;\n",
      "alpha/.git/config": "", "alpha/.gitignore": "ignored.txt\n", "alpha/ignored.txt": "Keep Git-ignored files\n",
      "alpha/search-hidden.txt": "Not excluded by Project Files\n", "alpha/third_party/retained.c": "int retained;\n",
    })) await writeFile(path.join(temporary, file), text);
    await copyFile(path.join(project, "media/c-insight.png"), path.join(temporary, "alpha/pixel.png"));
    const oversized = await open(path.join(temporary, "alpha/large.txt"), "w");
    try { await oversized.truncate(10 * 1024 * 1024 + 1); } finally { await oversized.close(); }
    const workspace = path.join(temporary, "fixture.code-workspace");
    await writeFile(workspace, JSON.stringify({ folders: [{ path: "alpha" }, { path: "beta" }], settings: {
      "files.exclude": { "**/hidden/**": true, "**/.git": false }, "search.exclude": { "**/search-hidden.txt": true },
      "cInsight.engine": "clangd", "cInsight.clangd.path": process.env.CINSIGHT_TEST_CLANGD20 || "/usr/bin/clangd-20",
      "cInsight.followCursor": false, "cInsight.session.restore": false, "cInsight.codePreview.semanticHighlighting": false,
    } }, null, 2));
    await runTests({
      version: process.env.C_INSIGHT_VSCODE_TEST_VERSION ?? "1.130.0",
      vscodeExecutablePath: process.env.C_INSIGHT_VSCODE_EXECUTABLE_PATH || undefined,
      extensionDevelopmentPath: project,
      extensionTestsPath: path.join(__dirname, "suite/projectFiles.js"),
      launchArgs: isolatedTestLaunchArgs(workspace),
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

void main().catch((error: unknown) => { console.error("Project Files Extension Host test failed:", error); process.exitCode = 1; });
