import { access } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { readConfiguration } from "../configuration/configuration";

export type CompilationDatabaseSource =
  | "configured"
  | "workspace root"
  | "common build directory"
  | "workspace search";

export interface CompilationDatabaseSelection {
  path: string;
  directory: string;
  source: CompilationDatabaseSource;
}

const COMMON_DIRECTORIES = [
  "build",
  "Build",
  "out",
  path.join("out", "build"),
  "cmake-build-debug",
  "cmake-build-release",
  "_build",
];

let cachedResolution:
  | Promise<CompilationDatabaseSelection | undefined>
  | undefined;

export async function resolveCompilationDatabase(): Promise<
  CompilationDatabaseSelection | undefined
> {
  cachedResolution ??= discoverCompilationDatabase();
  return cachedResolution;
}

export function invalidateCompilationDatabaseResolution(): void {
  cachedResolution = undefined;
}

async function discoverCompilationDatabase(): Promise<
  CompilationDatabaseSelection | undefined
> {
  const configured = readConfiguration().compileCommandsDir;
  if (configured) {
    const candidate = path.join(configured, "compile_commands.json");
    return (await exists(candidate))
      ? selection(candidate, "configured")
      : undefined;
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const rootCandidate = path.join(
      folder.uri.fsPath,
      "compile_commands.json",
    );
    if (await exists(rootCandidate)) {
      return selection(rootCandidate, "workspace root");
    }
  }
  for (const folder of folders) {
    for (const directory of COMMON_DIRECTORIES) {
      const candidate = path.join(
        folder.uri.fsPath,
        directory,
        "compile_commands.json",
      );
      if (await exists(candidate)) {
        return selection(candidate, "common build directory");
      }
    }
  }

  const found = await vscode.workspace.findFiles(
    "**/compile_commands.json",
    "**/{.git,node_modules,.vscode-test}/**",
    20,
  );
  if (found.length === 0) {
    return undefined;
  }
  const ranked = [...found].sort((left, right) =>
    rankCompilationDatabasePath(left.fsPath).localeCompare(
      rankCompilationDatabasePath(right.fsPath),
    ),
  );
  return selection(ranked[0].fsPath, "workspace search");
}

export function rankCompilationDatabasePath(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  const depth = normalized.split("/").length;
  return `${String(depth).padStart(5, "0")}:${normalized}`;
}

function selection(
  file: string,
  source: CompilationDatabaseSource,
): CompilationDatabaseSelection {
  return {
    path: file,
    directory: path.dirname(file),
    source,
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
