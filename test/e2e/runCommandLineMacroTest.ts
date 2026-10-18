import * as path from "node:path";
import { runTests } from "@vscode/test-electron";
import { isolatedTestLaunchArgs } from "./testLaunchArgs";

async function main(): Promise<void> {
  const project = path.resolve(__dirname, "../../..");
  process.env.LD_LIBRARY_PATH = [
    path.join(project, ".vscode-test/runtime-libs/usr/lib/x86_64-linux-gnu"),
    process.env.LD_LIBRARY_PATH,
  ].filter(Boolean).join(path.delimiter);
  await runTests({
    version: process.env.C_INSIGHT_VSCODE_TEST_VERSION ?? "1.130.0",
    vscodeExecutablePath: process.env.C_INSIGHT_VSCODE_EXECUTABLE_PATH || undefined,
    extensionDevelopmentPath: project,
    extensionTestsPath: path.join(__dirname, "suite/commandLineMacros.js"),
    launchArgs: isolatedTestLaunchArgs(path.join(project, "test/fixtures/command-line-macros")),
  });
}

void main().catch((error: unknown) => {
  console.error("Command-line macro Extension Host test failed:", error);
  process.exitCode = 1;
});
