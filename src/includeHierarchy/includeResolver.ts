import { access, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { resolveCompilationDatabase } from "../clangd/compilationDatabase";
import type { CompilationDatabaseEntry } from "../diagnostics/projectDiagnosticsModel";
import {
  IncludeDirective,
  includeSearchPaths,
  shellSplit,
} from "./includeModel";

export type IncludeTargetKind =
  | "workspace-header"
  | "workspace-source"
  | "system"
  | "external"
  | "unresolved";

export interface ResolvedInclude {
  directive: IncludeDirective;
  uri?: vscode.Uri;
  kind: IncludeTargetKind;
  reason?: string;
}

interface CachedDatabase {
  path: string;
  mtimeMs: number;
  entries: Map<string, CompilationDatabaseEntry>;
  fallback?: CompilationDatabaseEntry;
}

export class IncludeResolver {
  private database?: CachedDatabase;

  async resolve(
    source: vscode.Uri,
    directive: IncludeDirective,
  ): Promise<ResolvedInclude> {
    const paths = await this.searchPaths(source);
    const candidates = directive.angled
      ? [...paths.user, ...paths.system]
      : [
          path.dirname(source.fsPath),
          ...paths.quote,
          ...paths.user,
          ...paths.system,
        ];
    for (const directory of candidates) {
      const candidate = path.resolve(directory, directive.target);
      if (await exists(candidate)) {
        const uri = vscode.Uri.file(candidate);
        return {
          directive,
          uri,
          kind: classify(uri, paths.system),
        };
      }
    }
    return {
      directive,
      kind: "unresolved",
      reason:
        candidates.length === 0
          ? "No include search paths are available"
          : `Not found in ${candidates.length} search paths`,
    };
  }

  invalidate(): void {
    this.database = undefined;
  }

  private async searchPaths(source: vscode.Uri): Promise<{
    quote: string[];
    user: string[];
    system: string[];
  }> {
    const database = await this.loadDatabase();
    const entry =
      database?.entries.get(normalize(source.fsPath)) ??
      inferEntry(database, source.fsPath);
    const arguments_ = entry?.arguments ??
      (entry?.command ? shellSplit(entry.command) : []);
    const parsed = includeSearchPaths(
      arguments_,
      entry?.directory ?? path.dirname(source.fsPath),
    );
    const roots = (vscode.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.fsPath,
    );
    return {
      quote: parsed.quote,
      user: [...new Set([...parsed.user, ...roots])],
      system: [
        ...new Set([
          ...parsed.system,
          "/usr/local/include",
          "/usr/include",
        ]),
      ],
    };
  }

  private async loadDatabase(): Promise<CachedDatabase | undefined> {
    const selection = await resolveCompilationDatabase();
    if (!selection) {
      return undefined;
    }
    const fileStat = await stat(selection.path);
    if (
      this.database?.path === selection.path &&
      this.database.mtimeMs === fileStat.mtimeMs
    ) {
      return this.database;
    }
    const parsed = JSON.parse(
      await readFile(selection.path, "utf8"),
    ) as CompilationDatabaseEntry[];
    const entries = new Map<string, CompilationDatabaseEntry>();
    for (const entry of parsed) {
      if (!entry.file || !entry.directory) {
        continue;
      }
      const file = path.isAbsolute(entry.file)
        ? entry.file
        : path.resolve(entry.directory, entry.file);
      entries.set(normalize(file), entry);
    }
    this.database = {
      path: selection.path,
      mtimeMs: fileStat.mtimeMs,
      entries,
      fallback: parsed.find((entry) => entry.directory),
    };
    return this.database;
  }
}

function inferEntry(
  database: CachedDatabase | undefined,
  file: string,
): CompilationDatabaseEntry | undefined {
  if (!database) {
    return undefined;
  }
  const directory = path.dirname(normalize(file));
  return (
    [...database.entries.entries()].find(([candidate]) =>
      candidate.startsWith(`${directory}${path.sep}`),
    )?.[1] ?? database.fallback
  );
}

function classify(
  uri: vscode.Uri,
  systemPaths: readonly string[],
): IncludeTargetKind {
  if (
    systemPaths.some((directory) =>
      isWithin(uri.fsPath, directory),
    )
  ) {
    return "system";
  }
  if (vscode.workspace.getWorkspaceFolder(uri)) {
    return /\.(?:c|cc|cpp|cxx|m|mm)$/i.test(uri.fsPath)
      ? "workspace-source"
      : "workspace-header";
  }
  return "external";
}

function isWithin(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function normalize(file: string): string {
  return path.normalize(path.resolve(file));
}
