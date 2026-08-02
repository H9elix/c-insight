import { accessSync } from "node:fs";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";
import { isolatedTestLaunchArgs } from "./testLaunchArgs";

async function main(): Promise<void> {
  const project = path.resolve(__dirname, "../../..");
  const cpptools =
    process.env.C_INSIGHT_CPPTOOLS_EXTENSION_PATH ??
    "/home/user/.vscode-server/extensions/ms-vscode.cpptools-1.32.2-linux-x64";
  accessSync(path.join(cpptools, "package.json"));
  const runtimeLibraries = path.join(
    project,
    ".vscode-test",
    "runtime-libs",
    "usr",
    "lib",
    "x86_64-linux-gnu",
  );
  process.env.LD_LIBRARY_PATH = [runtimeLibraries, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  await runTests({
    version: process.env.C_INSIGHT_VSCODE_TEST_VERSION ?? "1.130.0",
    vscodeExecutablePath:
      process.env.C_INSIGHT_VSCODE_EXECUTABLE_PATH || undefined,
    extensionDevelopmentPath: [project, cpptools],
    extensionTestsPath: path.resolve(__dirname, "suite/microsoftEngine.js"),
    launchArgs: isolatedTestLaunchArgs(
      path.join(project, "test", "fixtures", "basic-cpp"),
    ),
  });
}

void main().catch((error: unknown) => {
  console.error("C Insight Microsoft engine E2E test failed:", error);
  process.exitCode = 1;
});
