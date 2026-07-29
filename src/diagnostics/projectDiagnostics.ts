import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { ClangdManager } from "../clangd/clangdManager";
import {
  CompilationDatabaseSelection,
  invalidateCompilationDatabaseResolution,
  resolveCompilationDatabase,
} from "../clangd/compilationDatabase";
import {
  isCppDocument,
  readConfiguration,
} from "../configuration/configuration";
import { TreeNode } from "../views/treeNode";
import {
  CompilationDatabaseEntry,
  ProjectDiagnosticsReport,
  analyzeCompileCommand,
  compilationCommand,
  emptyDiagnosticCounts,
  isMissingInclude,
  renderProjectDiagnosticsText,
} from "./projectDiagnosticsModel";
import {
  AnalysisReliability,
  evaluateReliability,
} from "./analysisReliability";

interface CachedDatabase {
  path: string;
  mtimeMs: number;
  entries: Map<string, CompilationDatabaseEntry>;
}

export class ProjectDiagnostics implements vscode.Disposable {
  private cachedDatabase?: CachedDatabase;
  private databaseSelection?: CompilationDatabaseSelection;
  private generation = 0;
  private readonly emitter = new vscode.EventEmitter<TreeNode[]>();
  private readonly reliabilityEmitter =
    new vscode.EventEmitter<AnalysisReliability>();
  private reliability: AnalysisReliability = {
    level: "unavailable",
    issues: [],
  };
  private report?: ProjectDiagnosticsReport;

  readonly onDidRefresh = this.emitter.event;
  readonly onDidChangeReliability = this.reliabilityEmitter.event;

  constructor(private readonly manager: ClangdManager) {}

  async refresh(
    editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor,
  ): Promise<void> {
    const generation = ++this.generation;
    const result = await this.build(editor);
    if (generation === this.generation) {
      this.reliability = result.reliability;
      this.report = result.report;
      this.emitter.fire(result.roots);
      this.reliabilityEmitter.fire(result.reliability);
    }
  }

  invalidateCompilationDatabase(): void {
    this.cachedDatabase = undefined;
    invalidateCompilationDatabaseResolution();
  }

  usesCompilationDatabase(uri: vscode.Uri): boolean {
    return (
      path.normalize(this.databaseSelection?.path ?? "") ===
      path.normalize(uri.fsPath)
    );
  }

  get currentReliability(): AnalysisReliability {
    return this.reliability;
  }

  async copyReport(format: "text" | "json"): Promise<void> {
    const report = await this.latestReport();
    await vscode.env.clipboard.writeText(
      format === "json"
        ? `${JSON.stringify(report, undefined, 2)}\n`
        : renderProjectDiagnosticsText(report),
    );
    void vscode.window.showInformationMessage(
      "C Insight: Project diagnostics report copied.",
    );
  }

  async exportReport(format: "text" | "json"): Promise<void> {
    const report = await this.latestReport();
    const uri = await vscode.window.showSaveDialog({
      title: `Export C Insight Project Diagnostics (${format.toUpperCase()})`,
      defaultUri: vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ??
          vscode.Uri.file(process.cwd()),
        `c-insight-project-diagnostics.${format === "json" ? "json" : "txt"}`,
      ),
      filters:
        format === "json"
          ? { JSON: ["json"] }
          : { Text: ["txt"] },
    });
    if (!uri) {
      return;
    }
    const content =
      format === "json"
        ? `${JSON.stringify(report, undefined, 2)}\n`
        : renderProjectDiagnosticsText(report);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    void vscode.window.showInformationMessage(
      `C Insight: Project diagnostics exported to ${uri.fsPath}`,
    );
  }

  dispose(): void {
    this.emitter.dispose();
    this.reliabilityEmitter.dispose();
  }

  private async build(
    editor: vscode.TextEditor | undefined,
  ): Promise<{
    roots: TreeNode[];
    reliability: AnalysisReliability;
    report: ProjectDiagnosticsReport;
  }> {
    const installation = this.manager.clangdInstallation;
    const state = this.manager.currentState;
    const config = readConfiguration();
    const databaseSelection = await resolveCompilationDatabase();
    this.databaseSelection = databaseSelection;
    const databasePath = databaseSelection?.path;
    let database: CachedDatabase | undefined;
    let databaseError: string | undefined;
    if (databasePath) {
      try {
        database = await this.loadDatabase(databasePath);
      } catch (error) {
        databaseError = String(error);
      }
    }
    const document =
      editor && isCppDocument(editor.document) ? editor.document : undefined;
    const entry = document
      ? database?.entries.get(normalizeFile(document.uri.fsPath))
      : undefined;
    const currentIsSource = Boolean(
      document && /\.(?:c|cc|cpp|cxx|m|mm)$/i.test(document.uri.fsPath),
    );
    const inferredEntry =
      document && !currentIsSource && !entry
        ? inferHeaderEntry(database, document.uri.fsPath)
        : undefined;
    const inspectedEntry = entry ?? inferredEntry?.entry;
    const diagnostics = diagnosticNodes(document);
    const currentMissingIncludes = document
      ? vscode.languages
          .getDiagnostics(document.uri)
          .filter((item) => isMissingInclude(item.message)).length
      : 0;
    const reliability = evaluateReliability({
      clangdState: state,
      indexStatus: this.manager.currentIndexProgress.status,
      indexPercentage: this.manager.currentIndexProgress.percentage,
      hasCompilationDatabase: Boolean(database),
      currentSourceFile: currentIsSource,
      hasCompileCommand: Boolean(entry),
      missingIncludes: currentMissingIncludes,
    });

    const roots: TreeNode[] = [
      group(
        `clangd: ${state}`,
        state === "ready"
          ? "pass-filled"
          : state === "failed"
            ? "error"
            : "sync",
        [
          detail(
            "Executable",
            installation?.command || config.clangdPath || "Auto-detect",
            "terminal",
          ),
          detail(
            "Version",
            installation?.version ?? "Not located yet",
            "versions",
          ),
        ],
      ),
      indexProgressNode(this.manager.currentIndexProgress),
      group(
        databasePath
          ? "Compilation database: found"
          : "Compilation database: missing",
        databasePath ? "database" : "warning",
        [
          detail(
            "Path",
            databasePath
              ? vscode.workspace.asRelativePath(databasePath)
              : config.compileCommandsDir
                ? `Configured file not found: ${path.join(config.compileCommandsDir, "compile_commands.json")}`
                : "No compile_commands.json found in the workspace or common build directories",
            databasePath ? "file-code" : "warning",
          ),
          ...(databasePath && !database
            ? [
                detail(
                  "Read error",
                  databaseError ?? "compile_commands.json could not be parsed",
                  "error",
                ),
              ]
            : []),
          ...(database
            ? [
                detail(
                  "Entries",
                  String(database.entries.size),
                  "list-unordered",
                ),
              ]
            : []),
          ...(databaseSelection
            ? [
                detail(
                  "Source",
                  databaseSelection.source,
                  databaseSelection.source === "configured"
                    ? "settings-gear"
                    : "search",
                ),
              ]
            : []),
        ],
      ),
    ];

    if (document) {
      const command = inspectedEntry
        ? compilationCommand(inspectedEntry)
        : undefined;
      const isSource = /\.(?:c|cc|cpp|cxx|m|mm)$/i.test(document.uri.fsPath);
      const commandSummary = inspectedEntry
        ? analyzeCompileCommand(inspectedEntry)
        : undefined;
      roots.push(
        group(
          `Current file: ${path.basename(document.uri.fsPath)}`,
          entry || !isSource ? "file-code" : "warning",
          [
            detail(
              "Path",
              vscode.workspace.asRelativePath(document.uri),
              "file",
            ),
            ...(entry
              ? [
                  detail("Working directory", entry.directory, "folder"),
                  detail(
                    "Compile command",
                    command ?? "Entry has no command or arguments",
                    command ? "terminal" : "warning",
                  ),
                ]
              : [
                  detail(
                    "Compile command",
                    isSource
                      ? "No entry for this source file; clangd is using fallback flags"
                      : inferredEntry
                        ? "Header command is inferred by clangd; the candidate below is diagnostic guidance, not a confirmed clangd choice"
                        : "Header commands are inferred by clangd from a related source file",
                    isSource ? "warning" : "info",
                  ),
                  detail(
                    "Fallback flags",
                    config.fallbackFlags.join(" ") || "None",
                    "settings-gear",
                  ),
                  ...(inferredEntry
                    ? [
                        detail(
                          "Candidate source",
                          vscode.workspace.asRelativePath(
                            inferredEntry.file,
                          ),
                          "file-code",
                        ),
                        detail(
                          "Candidate command",
                          command ?? "Entry has no command or arguments",
                          command ? "terminal" : "warning",
                        ),
                      ]
                    : []),
                ]),
            ...(commandSummary
              ? [compileCommandGroup(commandSummary)]
              : []),
          ],
        ),
      );
    } else {
      roots.push(
        group("Current file: no active C/C++ editor", "info", [
          detail(
            "Status",
            "Open a C or C++ file to inspect its compile command",
            "info",
          ),
        ]),
      );
    }

    roots.push(...diagnostics.nodes);
    const progress = this.manager.currentIndexProgress;
    const report: ProjectDiagnosticsReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspaceTrusted: vscode.workspace.isTrusted,
      clangd: {
        state,
        executable:
          installation?.command || config.clangdPath || "Auto-detect",
        version: installation?.version,
        indexStatus: progress.status,
        indexProgress:
          progress.completed !== undefined && progress.total !== undefined
            ? `${progress.completed} / ${progress.total} files`
            : progress.message,
      },
      compilationDatabase: {
        path: databasePath,
        source: databaseSelection?.source,
        entries: database?.entries.size,
        error: databaseError,
      },
      currentFile: document
        ? {
            path: document.uri.fsPath,
            kind: currentIsSource ? "source" : "header",
            commandSource: entry
              ? "direct"
              : inferredEntry
                ? "inferred-candidate"
                : "fallback",
            workingDirectory: inspectedEntry?.directory,
            compileCommand: inspectedEntry
              ? compilationCommand(inspectedEntry)
              : undefined,
            command: inspectedEntry
              ? analyzeCompileCommand(inspectedEntry)
              : undefined,
            inferredFrom: inferredEntry?.file,
            fallbackFlags: entry || inferredEntry
              ? undefined
              : [...config.fallbackFlags],
          }
        : undefined,
      diagnostics: {
        ...diagnostics.counts,
        currentFileMessages: diagnostics.current.map((diagnostic) => ({
          line: diagnostic.range.start.line + 1,
          severity: diagnosticSeverityLabel(diagnostic.severity),
          message: diagnostic.message,
        })),
      },
    };
    return { roots, reliability, report };
  }

  private async latestReport(): Promise<ProjectDiagnosticsReport> {
    await this.refresh();
    if (!this.report) {
      throw new Error("Project diagnostics are not available.");
    }
    return this.report;
  }

  private async loadDatabase(
    databasePath: string,
  ): Promise<CachedDatabase> {
    const metadata = await stat(databasePath);
    if (
      this.cachedDatabase?.path === databasePath &&
      this.cachedDatabase.mtimeMs === metadata.mtimeMs
    ) {
      return this.cachedDatabase;
    }
    const parsed = JSON.parse(
      await readFile(databasePath, "utf8"),
    ) as CompilationDatabaseEntry[];
    const entries = new Map<string, CompilationDatabaseEntry>();
    for (const entry of parsed) {
      if (!entry.file || !entry.directory) {
        continue;
      }
      const file = path.isAbsolute(entry.file)
        ? entry.file
        : path.resolve(entry.directory, entry.file);
      entries.set(normalizeFile(file), entry);
    }
    this.cachedDatabase = {
      path: databasePath,
      mtimeMs: metadata.mtimeMs,
      entries,
    };
    return this.cachedDatabase;
  }
}

function indexProgressNode(
  progress: ClangdManager["currentIndexProgress"],
): TreeNode {
  const label =
    progress.status === "disabled"
      ? "Background index: disabled"
      : progress.status === "indexing"
        ? `Background index: indexing${progress.percentage === undefined ? "" : ` ${Math.round(progress.percentage)}%`}`
        : "Background index: idle";
  const count =
    progress.completed !== undefined && progress.total !== undefined
      ? `${progress.completed} / ${progress.total} files`
      : progress.message ?? "No active indexing work";
  return group(
    label,
    progress.status === "disabled"
      ? "circle-slash"
      : progress.status === "indexing"
        ? "sync~spin"
        : "pass-filled",
    [
      detail("Progress", count, "graph"),
      detail(
        "Last update",
        new Date(progress.updatedAt).toLocaleTimeString(),
        "history",
      ),
    ],
  );
}

function diagnosticNodes(document?: vscode.TextDocument): {
  nodes: TreeNode[];
  counts: ReturnType<typeof emptyDiagnosticCounts>;
  current: vscode.Diagnostic[];
} {
  const counts = emptyDiagnosticCounts();
  const current: vscode.Diagnostic[] = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    for (const diagnostic of diagnostics) {
      if (
        diagnostic.source &&
        !/clang|c\/c\+\+/i.test(diagnostic.source)
      ) {
        continue;
      }
      switch (diagnostic.severity) {
        case vscode.DiagnosticSeverity.Error:
          counts.errors += 1;
          break;
        case vscode.DiagnosticSeverity.Warning:
          counts.warnings += 1;
          break;
        case vscode.DiagnosticSeverity.Information:
          counts.information += 1;
          break;
        case vscode.DiagnosticSeverity.Hint:
          counts.hints += 1;
          break;
      }
      if (isMissingInclude(diagnostic.message)) {
        counts.missingIncludes += 1;
      }
      if (document && uri.toString() === document.uri.toString()) {
        current.push(diagnostic);
      }
    }
  }
  const problemCount =
    counts.errors + counts.warnings + counts.information + counts.hints;
  return {
    nodes: [group(
      problemCount === 0
        ? "clangd diagnostics: no problems"
        : `clangd diagnostics: ${counts.errors} errors, ${counts.warnings} warnings`,
      counts.errors > 0 ? "error" : counts.warnings > 0 ? "warning" : "pass",
      [
        detail("Errors", String(counts.errors), "error"),
        detail("Warnings", String(counts.warnings), "warning"),
        detail(
          "Missing includes",
          String(counts.missingIncludes),
          counts.missingIncludes > 0 ? "warning" : "pass",
        ),
        ...(current.length > 0
          ? current.slice(0, 20).map((diagnostic) =>
              detail(
                `Line ${diagnostic.range.start.line + 1}`,
                diagnostic.message,
                diagnostic.severity === vscode.DiagnosticSeverity.Error
                  ? "error"
                  : "warning",
              ),
            )
          : [
              detail(
                "Current file",
                "No clangd diagnostics",
                "pass",
              ),
            ]),
      ],
    )],
    counts,
    current,
  };
}

function compileCommandGroup(
  summary: ReturnType<typeof analyzeCompileCommand>,
): TreeNode {
  const allIncludePaths = [
    ...summary.quoteIncludePaths.map((value) => `quote: ${value}`),
    ...summary.includePaths.map((value) => `user: ${value}`),
    ...summary.systemIncludePaths.map((value) => `system: ${value}`),
  ];
  return group("Compile command breakdown", "list-tree", [
    detail("Compiler", summary.compiler ?? "Unknown", "terminal"),
    detail("Language", summary.language ?? "Compiler default", "symbol-key"),
    detail("Standard", summary.standard ?? "Compiler default", "symbol-enum"),
    group(
      `Include paths: ${allIncludePaths.length}`,
      "folder-library",
      allIncludePaths.length > 0
        ? allIncludePaths.map((value) => detail("Path", value, "folder"))
        : [detail("Paths", "None explicitly configured", "info")],
      vscode.TreeItemCollapsibleState.Collapsed,
    ),
    group(
      `Defines: ${summary.defines.length}`,
      "symbol-constant",
      summary.defines.length > 0
        ? summary.defines.map((value) => detail("Define", value, "symbol-constant"))
        : [detail("Defines", "None", "info")],
      vscode.TreeItemCollapsibleState.Collapsed,
    ),
    group(
      `Forced includes: ${summary.forcedIncludes.length}`,
      "files",
      summary.forcedIncludes.length > 0
        ? summary.forcedIncludes.map((value) =>
            detail("Include", value, "file-code"),
          )
        : [detail("Forced includes", "None", "info")],
      vscode.TreeItemCollapsibleState.Collapsed,
    ),
    group(
      `Response files: ${summary.responseFiles.length}`,
      "file",
      summary.responseFiles.length > 0
        ? summary.responseFiles.map((value) =>
            detail("Response file", value, "file"),
          )
        : [detail("Response files", "None", "info")],
      vscode.TreeItemCollapsibleState.Collapsed,
    ),
  ], vscode.TreeItemCollapsibleState.Collapsed);
}

function inferHeaderEntry(
  database: CachedDatabase | undefined,
  header: string,
): { file: string; entry: CompilationDatabaseEntry } | undefined {
  if (!database) {
    return undefined;
  }
  const directory = path.dirname(normalizeFile(header));
  const stem = path.basename(header, path.extname(header)).toLowerCase();
  const candidates = [...database.entries.entries()].filter(([file]) =>
    file.startsWith(`${directory}${path.sep}`),
  );
  const candidate =
    candidates.find(
      ([file]) =>
        path.basename(file, path.extname(file)).toLowerCase() === stem,
    ) ??
    candidates[0];
  return candidate ? { file: candidate[0], entry: candidate[1] } : undefined;
}

function diagnosticSeverityLabel(
  severity: vscode.DiagnosticSeverity,
): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "information";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
  }
}

function group(
  label: string,
  icon: string,
  children: TreeNode[],
  collapsibleState = vscode.TreeItemCollapsibleState.Expanded,
): TreeNode {
  return {
    label,
    icon: new vscode.ThemeIcon(icon),
    collapsibleState,
    children,
  };
}

function detail(label: string, value: string, icon: string): TreeNode {
  return {
    label,
    description: value,
    tooltip: value,
    icon: new vscode.ThemeIcon(icon),
  };
}

function normalizeFile(file: string): string {
  const normalized = path.normalize(file);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
