import { IndexProgressState } from "../clangd/indexProgress";
import { AnalysisReliability } from "./analysisReliability";

export type StatusSeverity = "normal" | "warning" | "error";

export interface ReliabilityStatusPresentation {
  text: string;
  tooltip: string;
  severity: StatusSeverity;
}

export function reliabilityStatusPresentation(
  reliability: AnalysisReliability,
  indexProgress: IndexProgressState,
): ReliabilityStatusPresentation {
  const tooltipLines = ["C Insight analysis reliability"];
  if (reliability.issues.length === 0) {
    tooltipLines.push("", "Project analysis is ready.");
  } else {
    tooltipLines.push(
      "",
      ...reliability.issues.map((issue) => `• ${issue.message}`),
      "",
      "Click to open Project Diagnostics.",
    );
  }
  if (reliability.level === "unavailable") {
    return {
      text: "$(error) C Insight unavailable",
      tooltip: tooltipLines.join("\n"),
      severity: "error",
    };
  }
  if (indexProgress.status === "indexing") {
    return {
      text: `$(sync~spin) C Insight: Indexing${
        indexProgress.percentage === undefined
          ? ""
          : ` ${Math.round(indexProgress.percentage)}%`
      }`,
      tooltip: tooltipLines.join("\n"),
      severity: "warning",
    };
  }
  if (reliability.level === "limited") {
    return {
      text: `$(warning) C Insight: ${reliability.issues.length} issue${
        reliability.issues.length === 1 ? "" : "s"
      }`,
      tooltip: tooltipLines.join("\n"),
      severity: "warning",
    };
  }
  return {
    text: "$(check) C Insight",
    tooltip: tooltipLines.join("\n"),
    severity: "normal",
  };
}
