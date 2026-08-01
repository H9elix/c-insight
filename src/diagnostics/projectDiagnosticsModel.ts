import { includeSearchPaths, shellSplit } from "../includeHierarchy/includeModel";

export interface CompilationDatabaseEntry {
  directory: string;
  file: string;
  command?: string;
  arguments?: string[];
}

export interface CompileCommandSummary {
  compiler?: string;
  language?: string;
  standard?: string;
  includePaths: string[];
  systemIncludePaths: string[];
  quoteIncludePaths: string[];
  defines: string[];
  forcedIncludes: string[];
  responseFiles: string[];
}

export interface ProjectDiagnosticsReport {
  schemaVersion: 1;
  generatedAt: string;
  workspaceTrusted: boolean;
  analysisEngine?: "clangd" | "microsoft";
  extension?: {
    name: string;
    version: string;
    developer: string;
    license: string;
    vscodeVersion: string;
    nodeVersion: string;
    platform: string;
    architecture: string;
    remoteName?: string;
    extensionMode: string;
  };
  clangd: {
    state: string;
    executable: string;
    version?: string;
    indexStatus: string;
    indexProgress?: string;
  };
  compilationDatabase: {
    path?: string;
    source?: string;
    entries?: number;
    error?: string;
  };
  currentFile?: {
    path: string;
    kind: "source" | "header";
    commandSource: "direct" | "inferred-candidate" | "fallback";
    workingDirectory?: string;
    compileCommand?: string;
    command?: CompileCommandSummary;
    inferredFrom?: string;
    fallbackFlags?: string[];
  };
  diagnostics: DiagnosticCounts & {
    currentFileMessages: Array<{
      line: number;
      severity: string;
      message: string;
    }>;
  };
  runtime?: {
    scheduler: {
      submitted: number;
      coalesced: number;
      started: number;
      completed: number;
      failed: number;
      cancelledBeforeStart: number;
      active: number;
      queued: number;
      peakActive: number;
    };
    requests: {
      measured: number;
      averageDurationMs: number;
      maximumDurationMs: number;
      slow: number;
      lastSlowMethod?: string;
      lastSlowDurationMs?: number;
    };
    counters: Record<string, number>;
    gauges: Record<string, number>;
    limits: Record<string, number>;
  };
}

export type DiagnosticsReportRedaction =
  | "none"
  | "paths"
  | "paths-and-defines";

export interface DiagnosticCounts {
  errors: number;
  warnings: number;
  information: number;
  hints: number;
  missingIncludes: number;
}

export function compilationCommand(
  entry: CompilationDatabaseEntry,
): string | undefined {
  return entry.command ?? entry.arguments?.join(" ");
}

export function analyzeCompileCommand(
  entry: CompilationDatabaseEntry,
): CompileCommandSummary {
  const arguments_ =
    entry.arguments ?? (entry.command ? shellSplit(entry.command) : []);
  const paths = includeSearchPaths(arguments_, entry.directory);
  const defines: string[] = [];
  const forcedIncludes: string[] = [];
  const responseFiles: string[] = [];
  let language: string | undefined;
  let standard: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "-x" && arguments_[index + 1]) {
      language = arguments_[++index];
    } else if (argument.startsWith("-x") && argument.length > 2) {
      language = argument.slice(2);
    } else if (argument.startsWith("-std=")) {
      standard = argument.slice(5);
    } else if (argument === "-D" && arguments_[index + 1]) {
      defines.push(arguments_[++index]);
    } else if (argument.startsWith("-D") && argument.length > 2) {
      defines.push(argument.slice(2));
    } else if (argument === "-include" && arguments_[index + 1]) {
      forcedIncludes.push(arguments_[++index]);
    } else if (argument.startsWith("-include") && argument.length > 8) {
      forcedIncludes.push(argument.slice(8));
    } else if (argument.startsWith("@") && argument.length > 1) {
      responseFiles.push(argument.slice(1));
    }
  }
  return {
    compiler: arguments_[0],
    language,
    standard,
    includePaths: paths.user,
    systemIncludePaths: paths.system,
    quoteIncludePaths: paths.quote,
    defines: [...new Set(defines)],
    forcedIncludes: [...new Set(forcedIncludes)],
    responseFiles: [...new Set(responseFiles)],
  };
}

export function renderProjectDiagnosticsText(
  report: ProjectDiagnosticsReport,
): string {
  const lines = [
    "C Insight Project Diagnostics",
    `Generated: ${report.generatedAt}`,
    `Workspace trusted: ${report.workspaceTrusted}`,
  ];
  if (report.extension) {
    lines.push(
      "",
      `Extension: ${report.extension.name} ${report.extension.version}`,
      `Developer: ${report.extension.developer}`,
      `License: ${report.extension.license}`,
      `VS Code: ${report.extension.vscodeVersion}`,
      `Node: ${report.extension.nodeVersion}`,
      `Host: ${report.extension.platform} ${report.extension.architecture} · ${report.extension.remoteName ?? "local"} · ${report.extension.extensionMode}`,
    );
  }
  lines.push(
    "",
    `${report.analysisEngine === "microsoft" ? "Microsoft C/C++ Provider" : "clangd"}: ${report.clangd.state}`,
    `Executable: ${report.clangd.executable}`,
    `Version: ${report.clangd.version ?? "unknown"}`,
    `Background index: ${report.clangd.indexStatus}${report.clangd.indexProgress ? ` (${report.clangd.indexProgress})` : ""}`,
    "",
    `Compilation database: ${report.compilationDatabase.path ?? "not found"}`,
  );
  if (report.compilationDatabase.source) {
    lines.push(`Database source: ${report.compilationDatabase.source}`);
  }
  if (report.compilationDatabase.entries !== undefined) {
    lines.push(`Database entries: ${report.compilationDatabase.entries}`);
  }
  if (report.compilationDatabase.error) {
    lines.push(`Database error: ${report.compilationDatabase.error}`);
  }
  if (report.currentFile) {
    lines.push(
      "",
      `Current file: ${report.currentFile.path}`,
      `File kind: ${report.currentFile.kind}`,
      `Command source: ${report.currentFile.commandSource}`,
    );
    if (report.currentFile.inferredFrom) {
      lines.push(`Candidate inferred from: ${report.currentFile.inferredFrom}`);
    }
    if (report.currentFile.workingDirectory) {
      lines.push(`Working directory: ${report.currentFile.workingDirectory}`);
    }
    if (report.currentFile.compileCommand) {
      lines.push(`Compile command: ${report.currentFile.compileCommand}`);
    }
    if (report.currentFile.fallbackFlags) {
      lines.push(
        `Fallback flags: ${report.currentFile.fallbackFlags.join(" ") || "none"}`,
      );
    }
    const command = report.currentFile.command;
    if (command) {
      lines.push(
        `Compiler: ${command.compiler ?? "unknown"}`,
        `Language: ${command.language ?? "compiler default"}`,
        `Standard: ${command.standard ?? "compiler default"}`,
        `User include paths (${command.includePaths.length}): ${command.includePaths.join(", ") || "none"}`,
        `System include paths (${command.systemIncludePaths.length}): ${command.systemIncludePaths.join(", ") || "none"}`,
        `Quote include paths (${command.quoteIncludePaths.length}): ${command.quoteIncludePaths.join(", ") || "none"}`,
        `Defines (${command.defines.length}): ${command.defines.join(", ") || "none"}`,
        `Forced includes (${command.forcedIncludes.length}): ${command.forcedIncludes.join(", ") || "none"}`,
        `Response files (${command.responseFiles.length}): ${command.responseFiles.join(", ") || "none"}`,
      );
    }
  }
  lines.push(
    "",
    `Diagnostics: ${report.diagnostics.errors} errors, ${report.diagnostics.warnings} warnings, ${report.diagnostics.information} information, ${report.diagnostics.hints} hints`,
    `Missing includes: ${report.diagnostics.missingIncludes}`,
  );
  for (const diagnostic of report.diagnostics.currentFileMessages) {
    lines.push(
      `Line ${diagnostic.line} [${diagnostic.severity}]: ${diagnostic.message}`,
    );
  }
  if (report.runtime) {
    const scheduler = report.runtime.scheduler;
    const requests = report.runtime.requests;
    lines.push(
      "",
      "Runtime performance:",
      `Scheduler: ${scheduler.active} active, ${scheduler.queued} queued, peak ${scheduler.peakActive}`,
      `Requests: ${scheduler.submitted} submitted, ${scheduler.completed} completed, ${scheduler.failed} failed, ${scheduler.coalesced} coalesced, ${scheduler.cancelledBeforeStart} cancelled before start`,
      `Timing: ${requests.measured} measured, ${Math.round(requests.averageDurationMs)} ms average, ${Math.round(requests.maximumDurationMs)} ms maximum, ${requests.slow} slow`,
    );
    if (requests.lastSlowMethod) {
      lines.push(
        `Last slow request: ${requests.lastSlowMethod} (${Math.round(requests.lastSlowDurationMs ?? 0)} ms)`,
      );
    }
    for (const [name, value] of Object.entries(report.runtime.counters)) {
      lines.push(`Counter ${name}: ${value}`);
    }
    for (const [name, value] of Object.entries(report.runtime.gauges)) {
      lines.push(`Gauge ${name}: ${value}`);
    }
    for (const [name, value] of Object.entries(report.runtime.limits)) {
      lines.push(`Limit ${name}: ${value}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function redactProjectDiagnosticsReport(
  report: ProjectDiagnosticsReport,
  mode: DiagnosticsReportRedaction,
): ProjectDiagnosticsReport {
  if (mode === "none") {
    return structuredClone(report);
  }
  const redacted = structuredClone(report);
  redacted.clangd.executable = redactPath(redacted.clangd.executable);
  if (redacted.compilationDatabase.path) {
    redacted.compilationDatabase.path = "<redacted-path>";
  }
  const current = redacted.currentFile;
  if (current) {
    current.path = "<redacted-path>";
    current.workingDirectory = current.workingDirectory
      ? "<redacted-path>"
      : undefined;
    current.inferredFrom = current.inferredFrom
      ? "<redacted-path>"
      : undefined;
    current.compileCommand = current.compileCommand
      ? "<redacted-command>"
      : undefined;
    if (current.command) {
      current.command.compiler = current.command.compiler
        ? redactPath(current.command.compiler)
        : undefined;
      current.command.includePaths = current.command.includePaths.map(
        () => "<redacted-path>",
      );
      current.command.systemIncludePaths =
        current.command.systemIncludePaths.map(() => "<redacted-path>");
      current.command.quoteIncludePaths =
        current.command.quoteIncludePaths.map(() => "<redacted-path>");
      current.command.forcedIncludes = current.command.forcedIncludes.map(
        () => "<redacted-path>",
      );
      current.command.responseFiles = current.command.responseFiles.map(
        () => "<redacted-path>",
      );
      if (mode === "paths-and-defines") {
        current.command.defines = current.command.defines.map(
          (_value, index) => `<redacted-define-${index + 1}>`,
        );
        current.fallbackFlags = current.fallbackFlags?.map(
          () => "<redacted-flag>",
        );
      }
    }
  }
  return redacted;
}

function redactPath(value: string): string {
  const basename = value.replaceAll("\\", "/").split("/").pop();
  return basename && basename !== value
    ? `<redacted-path>/${basename}`
    : value;
}

export function isMissingInclude(message: string): boolean {
  return [
    /file not found/i,
    /cannot open (?:source|include) file/i,
    /no such file or directory/i,
    /pp_file_not_found/i,
  ].some((pattern) => pattern.test(message));
}

export function emptyDiagnosticCounts(): DiagnosticCounts {
  return {
    errors: 0,
    warnings: 0,
    information: 0,
    hints: 0,
    missingIncludes: 0,
  };
}
