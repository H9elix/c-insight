import * as path from "node:path";
import * as vscode from "vscode";

export interface CInsightConfiguration {
  engine: "clangd" | "microsoft";
  clangdPath: string;
  clangdArguments: string[];
  clangdLogLevel: "error" | "info" | "verbose";
  compileCommandsDir?: string;
  fallbackFlags: string[];
  backgroundIndex: boolean;
  followCursor: boolean;
  followCursorDelay: number;
  followCursorDetailsDelay: number;
  navigationDoubleClickInterval: number;
  includeDeclarationInReferences: boolean;
  includeSystemReferences: boolean;
  exclude: string[];
}

function resolveWorkspacePath(value: string): string {
  if (!value) {
    return "";
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return path.isAbsolute(value) || !folder
    ? value
    : path.join(folder.uri.fsPath, value);
}

export function readConfiguration(): CInsightConfiguration {
  const config = vscode.workspace.getConfiguration("cInsight");
  return {
    engine: config.get<"clangd" | "microsoft">("engine", "clangd"),
    clangdPath: resolveWorkspacePath(config.get<string>("clangd.path", "")),
    clangdArguments: config.get<string[]>("clangd.arguments", []),
    clangdLogLevel: config.get<"error" | "info" | "verbose">(
      "clangd.logLevel",
      "info",
    ),
    compileCommandsDir:
      resolveWorkspacePath(config.get<string>("compileCommandsDir", "")) ||
      undefined,
    fallbackFlags: config.get<string[]>("fallbackFlags", ["-std=c++17"]),
    backgroundIndex: config.get<boolean>("backgroundIndex", true),
    followCursor: config.get<boolean>("followCursor", true),
    followCursorDelay: config.get<number>("followCursorDelay", 200),
    followCursorDetailsDelay: config.get<number>(
      "followCursorDetailsDelay",
      600,
    ),
    navigationDoubleClickInterval: config.get<number>(
      "navigation.doubleClickInterval",
      500,
    ),
    includeDeclarationInReferences: config.get<boolean>(
      "includeDeclarationInReferences",
      true,
    ),
    includeSystemReferences: config.get<boolean>(
      "includeSystemReferences",
      false,
    ),
    exclude: config.get<string[]>("exclude", []),
  };
}

export function isCppDocument(document: vscode.TextDocument): boolean {
  return ["c", "cpp", "objective-c", "objective-cpp"].includes(
    document.languageId,
  );
}
