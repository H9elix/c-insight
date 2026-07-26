import * as vscode from "vscode";
import { IndexProgressState } from "../clangd/indexProgress";
import { AnalysisReliability } from "./analysisReliability";
import { reliabilityStatusPresentation } from "./reliabilityStatusPresentation";

export class ReliabilityStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );

  constructor() {
    this.item.name = "C Insight Analysis Reliability";
    this.item.command = "cInsight.openProjectDiagnostics";
    this.item.show();
  }

  update(
    reliability: AnalysisReliability,
    indexProgress: IndexProgressState,
  ): void {
    const presentation = reliabilityStatusPresentation(
      reliability,
      indexProgress,
    );
    this.item.text = presentation.text;
    this.item.tooltip = new vscode.MarkdownString(
      presentation.tooltip.replaceAll("\n", "  \n"),
    );
    this.item.backgroundColor =
      presentation.severity === "error"
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : presentation.severity === "warning"
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
