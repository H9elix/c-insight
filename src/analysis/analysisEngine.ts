import * as vscode from "vscode";

export type AnalysisEngine = "clangd" | "microsoft";

export function configuredAnalysisEngine(): AnalysisEngine {
  return vscode.workspace
    .getConfiguration("cInsight")
    .get<AnalysisEngine>("engine", "clangd");
}

export function isMicrosoftEngine(): boolean {
  return configuredAnalysisEngine() === "microsoft";
}
