import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { ClangdManager } from "../clangd/clangdManager";
import { AnalysisService } from "../analysis/analysisService";
import { CallHierarchyRepository } from "../callHierarchy/callHierarchyRepository";
import {
  AnalysisEngine,
  configuredAnalysisEngine,
} from "../analysis/analysisEngine";
import { microsoftProviderStatus } from "../analysis/microsoftProviderStatus";
import { runtimeDiagnostics } from "./runtimeDiagnostics";
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
  DiagnosticsReportRedaction,
  ProjectDiagnosticsReport,
  analyzeCompileCommand,
  compilationCommand,
  emptyDiagnosticCounts,
  isMissingInclude,
  redactProjectDiagnosticsReport,
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

  constructor(
    private readonly manager: ClangdManager,
    private readonly analysis: AnalysisService,
    private readonly context: vscode.ExtensionContext,
    private readonly engine: AnalysisEngine = configuredAnalysisEngine(),
    private readonly callRepository?: CallHierarchyRepository,
  ) {}

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
    const report = await this.latestExportReport();
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
    const report = await this.latestExportReport();
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
    config.engine = this.engine;
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
    const microsoftStatus =
      config.engine === "microsoft"
        ? microsoftProviderStatus(document?.uri)
        : undefined;
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
      engineLabel:
        config.engine === "microsoft" ? "Microsoft C/C++ Provider" : "clangd",
      indexStatus: this.manager.currentIndexProgress.status,
      indexPercentage: this.manager.currentIndexProgress.percentage,
      hasCompilationDatabase:
        config.engine === "microsoft" ? true : Boolean(database),
      currentSourceFile:
        config.engine === "microsoft" ? false : currentIsSource,
      hasCompileCommand: config.engine === "microsoft" ? true : Boolean(entry),
      missingIncludes: currentMissingIncludes,
    });

    const extension = extensionInformation(this.context);
    const callersMode = vscode.workspace
      .getConfiguration("cInsight.microsoft")
      .get<string>("callersMode", "references");
    const callerEvidence = this.callRepository?.microsoftCallerEvidenceStats();
    const calleeEvidence = this.callRepository?.microsoftCalleeEvidenceStats();

    const roots: TreeNode[] = [
      group("Extension information", "extensions", [
        detail("Version", extension.version, "versions"),
        detail("Developer", extension.developer, "account"),
        detail("License", extension.license, "law"),
        detail("VS Code", extension.vscodeVersion, "code"),
        detail("Node", extension.nodeVersion, "server-process"),
        detail(
          "Host",
          `${extension.platform} ${extension.architecture} · ${extension.remoteName ?? "local"} · ${extension.extensionMode}`,
          "remote",
        ),
      ], vscode.TreeItemCollapsibleState.Collapsed),
      group(
        `${config.engine === "microsoft" ? "Microsoft C/C++ Provider" : "clangd"}: ${state}`,
        state === "ready"
          ? "pass-filled"
          : state === "failed"
            ? "error"
            : "sync",
        config.engine === "microsoft"
          ? [
              detail("Extension", "ms-vscode.cpptools", "extensions"),
              detail(
                "Provider status",
                microsoftStatus?.state ?? "unavailable",
                microsoftStatus?.state === "verified"
                  ? "pass"
                  : microsoftStatus?.state === "ambiguous"
                    ? "warning"
                    : "error",
              ),
              detail(
                "C_Cpp.intelliSenseEngine",
                microsoftStatus?.intelliSenseEngine ?? "unknown",
                microsoftStatus?.intelliSenseEngine === "default"
                  ? "pass"
                  : "error",
              ),
              detail(
                "Known Provider conflicts",
                microsoftStatus?.conflicts.join(", ") || "None active",
                microsoftStatus?.conflicts.length ? "warning" : "pass",
              ),
              detail(
                "Status evidence",
                microsoftStatus?.detail ?? "Microsoft Provider status unavailable",
                "info",
              ),
              detail(
                "Index progress",
                "Managed by Microsoft C/C++; not exposed through the public Provider API",
                "info",
              ),
              detail(
                "Callers mode",
                callersMode,
                "shield",
              ),
              ...(callersMode === "references" && callerEvidence
                ? [
                    group(
                      "Callers evidence (loaded nodes)",
                      "references",
                      [
                        detail("Queried nodes", String(callerEvidence.queriedNodes), "list-tree"),
                        detail("References", String(callerEvidence.references), "references"),
                        detail("Mapped references", String(callerEvidence.mappedReferences), "pass"),
                        detail("Unmapped references", String(callerEvidence.unmappedReferences), callerEvidence.unmappedReferences > 0 ? "warning" : "pass"),
                        detail("Caller functions", String(callerEvidence.callerFunctions), "symbol-method"),
                      ],
                      vscode.TreeItemCollapsibleState.Collapsed,
                    ),
                  ]
                : []),
              ...(calleeEvidence
                ? [
                    group(
                      "Callees evidence (loaded nodes)",
                      "type-hierarchy-sub",
                      [
                        detail("Queried nodes", String(calleeEvidence.queriedNodes), "list-tree"),
                        detail("Successful", String(calleeEvidence.successful), "pass"),
                        detail("Failed", String(calleeEvidence.failed), calleeEvidence.failed > 0 ? "error" : "pass"),
                        detail("Cancelled", String(calleeEvidence.cancelled), calleeEvidence.cancelled > 0 ? "circle-slash" : "pass"),
                        detail("Empty results", String(calleeEvidence.empty), "circle-outline"),
                        detail("Callee functions", String(calleeEvidence.callees), "symbol-method"),
                        detail("Average duration", `${Math.round(calleeEvidence.averageDurationMs)} ms`, "dashboard"),
                        detail("Maximum duration", `${Math.round(calleeEvidence.maximumDurationMs)} ms`, "clock"),
                      ],
                      vscode.TreeItemCollapsibleState.Collapsed,
                    ),
                  ]
                : []),
            ]
          : [
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
      ...(config.engine === "clangd"
        ? [indexProgressNode(this.manager.currentIndexProgress)]
        : []),
      group(
        databasePath
          ? "Compilation database: found"
          : "Compilation database: missing",
        databasePath ? "database" : "warning",
        [
          ...(databasePath
            ? [
                actionDetail(
                  "Path",
                  vscode.workspace.asRelativePath(databasePath),
                  "file-code",
                  "vscode.open",
                  [vscode.Uri.file(databasePath)],
                ),
              ]
            : [
                detail(
                  "Path",
                  config.compileCommandsDir
                    ? `Configured file not found: ${path.join(config.compileCommandsDir, "compile_commands.json")}`
                    : "No compile_commands.json found in the workspace or common build directories",
                  "warning",
                ),
                actionDetail(
                  "Select compilation database…",
                  "Choose compile_commands.json",
                  "database",
                  "cInsight.diagnostics.selectCompilationDatabase",
                ),
              ]),
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
                    config.engine === "microsoft" && isSource
                      ? "No exact entry for this source file; Microsoft C/C++ uses its base C_Cpp.default.* or c_cpp_properties.json configuration"
                      : isSource
                      ? "No entry for this source file; clangd is using fallback flags"
                      : inferredEntry
                        ? "Header command is inferred by clangd; the candidate below is diagnostic guidance, not a confirmed clangd choice"
                        : "Header commands are inferred by clangd from a related source file",
                    isSource ? "warning" : "info",
                  ),
                  ...(config.engine === "microsoft"
                    ? [
                        actionDetail(
                          "Microsoft base configuration",
                          "Open C/C++ settings",
                          "settings-gear",
                          "workbench.action.openSettings",
                          ["C_Cpp.default"],
                        ),
                      ]
                    : [
                        actionDetail(
                          "Fallback flags",
                          config.fallbackFlags.join(" ") || "None",
                          "settings-gear",
                          "workbench.action.openSettings",
                          ["cInsight.fallbackFlags"],
                        ),
                      ]),
                  ...(inferredEntry
                    ? [
                        actionDetail(
                          "Candidate source",
                          vscode.workspace.asRelativePath(
                            inferredEntry.file,
                          ),
                          "file-code",
                          "vscode.open",
                          [vscode.Uri.file(inferredEntry.file)],
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
    const scheduler = this.analysis.requestSchedulerStats();
    const timing = this.analysis.requestTimingStats();
    const runtime = runtimeDiagnostics.snapshot();
    const runtimeLimits = configuredRuntimeLimits();
    roots.push(
      group("Runtime performance", "pulse", [
        detail(
          "Semantic request queue",
          `${scheduler.active} active · ${scheduler.queued} queued · peak ${scheduler.peakActive}`,
          scheduler.queued > 0 ? "clock" : "pass",
        ),
        detail(
          "Request outcomes",
          `${scheduler.completed} completed · ${scheduler.failed} failed · ${scheduler.coalesced} coalesced · ${scheduler.cancelledBeforeStart} cancelled before start`,
          scheduler.failed > 0 ? "warning" : "pass",
        ),
        detail(
          "Request latency",
          `${timing.measured === 0 ? 0 : Math.round(timing.totalDurationMs / timing.measured)} ms average · ${Math.round(timing.maximumDurationMs)} ms maximum · ${timing.slow} slow`,
          timing.slow > 0 ? "warning" : "dashboard",
        ),
        ...(timing.last
          ? [
              detail(
                "Last semantic request",
                `${timing.last.method} · ${timing.last.outcome} · ${Math.round(timing.last.durationMs)} ms${timing.last.providerActivationDurationMs === undefined ? "" : ` · Provider activation ${Math.round(timing.last.providerActivationDurationMs)} ms`}`,
                timing.last.outcome === "failed"
                  ? "error"
                  : timing.last.outcome === "cancelled"
                    ? "circle-slash"
                    : "pulse",
              ),
            ]
          : []),
        ...(timing.lastSlowMethod
          ? [
              detail(
                "Last slow request",
                `${timing.lastSlowMethod} · ${Math.round(timing.lastSlowDurationMs ?? 0)} ms`,
                "clock",
              ),
            ]
          : []),
        group(
          "Semantic requests by method",
          "list-tree",
          Object.entries(timing.byMethod).map(([method, value]) =>
            detail(
              method,
              `${value.measured} requests · ${Math.round(value.averageDurationMs)} ms average · ${Math.round(value.maximumDurationMs)} ms maximum · ${value.failed} failed · ${value.cancelled} cancelled`,
              value.failed > 0 ? "warning" : "dashboard",
            ),
          ),
          vscode.TreeItemCollapsibleState.Collapsed,
        ),
        ...Object.entries(runtime.counters).map(([name, value]) =>
          detail(runtimeLabel(name), String(value), "warning"),
        ),
        ...Object.entries(runtime.gauges).map(([name, value]) =>
          detail(runtimeLabel(name), String(value), "database"),
        ),
        group(
          "Configured resource limits",
          "settings-gear",
          Object.entries(runtimeLimits).map(([name, value]) =>
            detail(runtimeLabel(name), String(value), "symbol-number"),
          ),
          vscode.TreeItemCollapsibleState.Collapsed,
        ),
      ]),
    );
    const progress = this.manager.currentIndexProgress;
    const report: ProjectDiagnosticsReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspaceTrusted: vscode.workspace.isTrusted,
      analysisEngine: config.engine,
      microsoftProvider: microsoftStatus,
      microsoftCallers:
        config.engine === "microsoft" && callerEvidence
          ? { mode: callersMode, ...callerEvidence }
          : undefined,
      microsoftCallees:
        config.engine === "microsoft" ? calleeEvidence : undefined,
      extension,
      clangd: {
        state,
        executable:
          config.engine === "microsoft"
            ? "ms-vscode.cpptools"
            : installation?.command || config.clangdPath || "Auto-detect",
        version:
          config.engine === "microsoft"
            ? vscode.extensions.getExtension("ms-vscode.cpptools")?.packageJSON
                .version
            : installation?.version,
        indexStatus:
          config.engine === "microsoft" ? "not-exposed" : progress.status,
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
      runtime: {
        scheduler,
        requests: {
          measured: timing.measured,
          averageDurationMs:
            timing.measured === 0 ? 0 : timing.totalDurationMs / timing.measured,
          maximumDurationMs: timing.maximumDurationMs,
          slow: timing.slow,
          lastSlowMethod: timing.lastSlowMethod,
          lastSlowDurationMs: timing.lastSlowDurationMs,
          failed: timing.failed,
          cancelled: timing.cancelled,
          providerActivationDurationMs: timing.providerActivationDurationMs,
          last: timing.last,
          byMethod: timing.byMethod,
        },
        counters: runtime.counters,
        gauges: runtime.gauges,
        limits: runtimeLimits,
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

  private async latestExportReport(): Promise<ProjectDiagnosticsReport> {
    const report = await this.latestReport();
    const redaction = vscode.workspace
      .getConfiguration("cInsight.diagnostics")
      .get<DiagnosticsReportRedaction>("reportRedaction", "none");
    return redactProjectDiagnosticsReport(report, redaction);
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
      actionDetail(
        "Restart background indexing…",
        "Restart clangd and rebuild the index",
        "sync",
        "cInsight.index.refresh",
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
        ? "Language diagnostics: no problems"
        : `Language diagnostics: ${counts.errors} errors, ${counts.warnings} warnings`,
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
              diagnosticDetail(document!, diagnostic),
            )
          : [
              detail(
                "Current file",
                "No language diagnostics",
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

function actionDetail(
  label: string,
  value: string,
  icon: string,
  command: string,
  args: unknown[] = [],
): TreeNode {
  return {
    ...detail(label, value, icon),
    command: { command, title: label, arguments: args },
  };
}

function diagnosticDetail(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
): TreeNode {
  const node: TreeNode = {
    ...detail(
      `Line ${diagnostic.range.start.line + 1}`,
      diagnostic.message,
      diagnostic.severity === vscode.DiagnosticSeverity.Error
        ? "error"
        : "warning",
    ),
    location: {
      uri: document.uri,
      range: diagnostic.range,
    },
  };
  node.command = {
    command: "cInsight.openLocation",
    title: "Open Diagnostic",
    arguments: [node],
  };
  return node;
}

function normalizeFile(file: string): string {
  const normalized = path.normalize(file);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function runtimeLabel(name: string): string {
  const labels: Record<string, string> = {
    "limits.references.display": "References display-limit hits",
    "limits.references.bulkOutput": "References bulk-output limit hits",
    "limits.references.omittedRecords": "References records omitted",
    "limits.export.maximumMegabytes": "Oversized exports rejected",
    "cache.references.highlightEvictions": "Highlight cache evictions",
    "cache.references.parameterEvictions": "Parameter cache evictions",
    "cache.references.highlights": "Highlight cache entries",
    "cache.references.parameters": "Parameter cache entries",
    "analysis.maximumConcurrentRequests": "Semantic request concurrency",
    "analysis.maximumBackgroundRequests": "Background request concurrency",
    "references.maximumDisplayedResults": "References displayed results",
    "references.detailRequestCacheSize": "References detail cache entries",
    "export.maximumResults": "References bulk-output records",
    "export.maximumMegabytes": "Export encoded size (MiB)",
  };
  return labels[name] ?? name;
}

function configuredRuntimeLimits(): Record<string, number> {
  const analysis = vscode.workspace.getConfiguration("cInsight.analysis");
  const references = vscode.workspace.getConfiguration("cInsight.references");
  const exportConfig = vscode.workspace.getConfiguration("cInsight.export");
  return {
    "analysis.maximumConcurrentRequests": analysis.get<number>(
      "maximumConcurrentRequests",
      8,
    ),
    "analysis.maximumBackgroundRequests": analysis.get<number>(
      "maximumBackgroundRequests",
      2,
    ),
    "references.maximumDisplayedResults": references.get<number>(
      "maximumDisplayedResults",
      10_000,
    ),
    "references.detailRequestCacheSize": references.get<number>(
      "detailRequestCacheSize",
      2_000,
    ),
    "export.maximumResults": exportConfig.get<number>(
      "maximumResults",
      50_000,
    ),
    "export.maximumMegabytes": exportConfig.get<number>(
      "maximumMegabytes",
      64,
    ),
  };
}

function extensionInformation(
  context: vscode.ExtensionContext,
): NonNullable<ProjectDiagnosticsReport["extension"]> {
  const manifest = context.extension.packageJSON as {
    displayName?: string;
    name?: string;
    version?: string;
    author?: string | { name?: string };
    license?: string;
  };
  const developer =
    typeof manifest.author === "string"
      ? manifest.author
      : manifest.author?.name ?? "youjinchun";
  const extensionModes: Record<number, string> = {
    [vscode.ExtensionMode.Production]: "production",
    [vscode.ExtensionMode.Development]: "development",
    [vscode.ExtensionMode.Test]: "test",
  };
  return {
    name: manifest.displayName ?? manifest.name ?? "C Insight",
    version: manifest.version ?? "unknown",
    developer,
    license: manifest.license ?? "MIT",
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    remoteName: vscode.env.remoteName,
    extensionMode: extensionModes[context.extensionMode] ?? "unknown",
  };
}
