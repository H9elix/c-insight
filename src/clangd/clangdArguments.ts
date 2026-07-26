import * as path from "node:path";
import type { CInsightConfiguration } from "../configuration/configuration";

export function buildClangdArguments(
  config: CInsightConfiguration,
  discoveredCompileCommandsDir?: string,
): string[] {
  const args = [
    config.backgroundIndex ? "--background-index" : "--background-index=0",
    "--clang-tidy=0",
    "--completion-style=detailed",
    "--header-insertion=never",
    `--log=${config.clangdLogLevel}`,
  ];
  const compileCommandsDir =
    config.compileCommandsDir ?? discoveredCompileCommandsDir;
  if (compileCommandsDir) {
    args.push(
      `--compile-commands-dir=${path.resolve(compileCommandsDir)}`,
    );
  }
  return [...args, ...config.clangdArguments];
}
