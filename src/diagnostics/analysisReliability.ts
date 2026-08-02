export type ReliabilityLevel = "reliable" | "limited" | "unavailable";

export type ReliabilityIssueCode =
  | "clangd-not-ready"
  | "indexing"
  | "no-compilation-database"
  | "no-compile-command"
  | "missing-includes";

export interface ReliabilityIssue {
  code: ReliabilityIssueCode;
  message: string;
}

export interface AnalysisReliability {
  level: ReliabilityLevel;
  issues: ReliabilityIssue[];
}

export function analysisReliabilityEqual(
  left: AnalysisReliability,
  right: AnalysisReliability,
): boolean {
  return left.level === right.level &&
    left.issues.length === right.issues.length &&
    left.issues.every(
      (issue, index) =>
        issue.code === right.issues[index].code &&
        issue.message === right.issues[index].message,
    );
}

export interface ReliabilityInputs {
  clangdState: string;
  engineLabel?: string;
  indexStatus: "disabled" | "idle" | "indexing";
  indexPercentage?: number;
  hasCompilationDatabase: boolean;
  currentSourceFile: boolean;
  hasCompileCommand: boolean;
  missingIncludes: number;
}

export function evaluateReliability(
  inputs: ReliabilityInputs,
): AnalysisReliability {
  const issues: ReliabilityIssue[] = [];
  const unavailable = ["stopped", "locating", "starting", "restarting", "failed"]
    .includes(inputs.clangdState);
  if (unavailable) {
    issues.push({
      code: "clangd-not-ready",
      message: `${inputs.engineLabel ?? "clangd"} is ${inputs.clangdState}; navigation results may be unavailable`,
    });
  }
  if (inputs.indexStatus === "indexing") {
    issues.push({
      code: "indexing",
      message: `Background indexing is in progress${
        inputs.indexPercentage === undefined
          ? ""
          : ` (${Math.round(inputs.indexPercentage)}%)`
      }; workspace results may be incomplete`,
    });
  }
  if (!inputs.hasCompilationDatabase) {
    issues.push({
      code: "no-compilation-database",
      message:
        "No compilation database; fallback flags may reduce result accuracy",
    });
  } else if (inputs.currentSourceFile && !inputs.hasCompileCommand) {
    issues.push({
      code: "no-compile-command",
      message:
        "The current source file has no compile command; results may ignore project flags",
    });
  }
  if (inputs.missingIncludes > 0) {
    issues.push({
      code: "missing-includes",
      message: `${inputs.missingIncludes} missing include diagnostic${
        inputs.missingIncludes === 1 ? "" : "s"
      } may affect analysis`,
    });
  }
  return {
    level: unavailable ? "unavailable" : issues.length > 0 ? "limited" : "reliable",
    issues,
  };
}
