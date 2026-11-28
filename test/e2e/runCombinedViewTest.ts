import * as path from "node:path";
import { runTests } from "@vscode/test-electron";
import { isolatedTestLaunchArgs } from "./testLaunchArgs";
import { resolveCpptoolsExtensionPath } from "./cpptoolsExtensionPath";
import { mkdir, writeFile } from "node:fs/promises";

async function main(): Promise<void> {
  const project = path.resolve(__dirname, "../../..");
  process.env.LD_LIBRARY_PATH = [path.join(project, ".vscode-test/runtime-libs/usr/lib/x86_64-linux-gnu"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  const launchArgs = isolatedTestLaunchArgs(path.join(project, "test/fixtures/basic-cpp"));
  if (process.env.C_INSIGHT_COMBINED_SEEDED) {
    const userData = launchArgs.find(argument=>argument.startsWith("--user-data-dir="))!.slice("--user-data-dir=".length);
    await mkdir(path.join(userData,"User"),{recursive:true});
    await writeFile(path.join(userData,"User/settings.json"),JSON.stringify({
      "cInsight.engine":"clangd","cInsight.clangd.path":"/usr/bin/clangd-20","cInsight.session.restore":false,
      "cInsight.combinedViews.slot1":{enabled:true,title:"Restored",direction:"horizontal",views:["projectFiles","symbols"],ratios:[1,1]},
    }));
  }
  await runTests({
    version: process.env.C_INSIGHT_VSCODE_TEST_VERSION ?? "1.130.0",
    vscodeExecutablePath: process.env.C_INSIGHT_VSCODE_EXECUTABLE_PATH || undefined,
    extensionDevelopmentPath: process.env.C_INSIGHT_COMBINED_ENGINE === "microsoft" ? [project, resolveCpptoolsExtensionPath()] : project,
    extensionTestsPath: path.join(__dirname, process.env.C_INSIGHT_PREVIEW_HEADER_ONLY === "1" ? "suite/previewHeader.js" : process.env.C_INSIGHT_VIEWPORT_FOLLOW_ONLY === "1" ? "suite/viewportFollow.js" : "suite/combinedViews.js"),
    launchArgs: [...launchArgs,
      ...(process.env.C_INSIGHT_TEST_LOCALE ? [`--locale=${process.env.C_INSIGHT_TEST_LOCALE}`] : []),
      ...(process.env.C_INSIGHT_TEST_DEBUG_PORT ? [`--remote-debugging-port=${process.env.C_INSIGHT_TEST_DEBUG_PORT}`] : [])],
  });
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
