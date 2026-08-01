export type PresentedAnalysisEngine = "clangd" | "microsoft";

export function analysisEngineDisplayName(
  engine: PresentedAnalysisEngine,
): string {
  return engine === "microsoft"
    ? "Microsoft C/C++ language service (cpptools)"
    : "clangd";
}

export interface CompilationDatabaseChangePresentation {
  message: string;
  primaryAction: "Restart clangd" | "Reload Window";
}

export function compilationDatabaseChangePresentation(
  engine: PresentedAnalysisEngine,
  change: "created" | "changed" | "deleted",
): CompilationDatabaseChangePresentation {
  if (engine === "microsoft") {
    return {
      message:
        `C Insight: The active compilation database was ${change}. ` +
        "Microsoft C/C++ manages its own configuration reload; reload the window if results remain stale.",
      primaryAction: "Reload Window",
    };
  }
  return {
    message:
      `C Insight: The active compilation database was ${change}. ` +
      "Restart clangd to reload all compile commands?",
    primaryAction: "Restart clangd",
  };
}
