import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
  const localRuntimeLibraries = path.join(
    extensionDevelopmentPath,
    ".vscode-test",
    "runtime-libs",
    "usr",
    "lib",
    "x86_64-linux-gnu",
  );
  process.env.LD_LIBRARY_PATH = [
    localRuntimeLibraries,
    process.env.LD_LIBRARY_PATH,
  ]
    .filter(Boolean)
    .join(path.delimiter);
  const extensionTestsPath = path.resolve(__dirname, "suite/index.js");
  const fixturePath = path.join(
    extensionDevelopmentPath,
    "test",
    "fixtures",
    "basic-cpp",
  );

  await runTests({
    version: process.env.C_INSIGHT_VSCODE_TEST_VERSION ?? "1.130.0",
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      fixturePath,
      "--disable-extensions",
      "--disable-gpu",
      "--no-sandbox",
    ],
  });
}

void main().catch((error: unknown) => {
  console.error("C Insight VS Code E2E test failed:", error);
  process.exitCode = 1;
});
