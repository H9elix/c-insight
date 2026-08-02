import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import { NavigationSource } from "../history/navigationHistoryModel";
import { COMMANDS, INTERNAL_COMMANDS } from "../ids";
import { LocationResult } from "../models/types";
import { CodePreviewProvider, PreviewMode } from "../views/codePreviewProvider";
import { RegisterCommand } from "./commandRegistrar";

export type ActivePosition = () => { uri: vscode.Uri; position: vscode.Position } | undefined;

export function registerNavigationCommands(
  register: RegisterCommand,
  analysis: AnalysisService,
  history: NavigationHistoryExplorer,
  preview: CodePreviewProvider,
  activePosition: ActivePosition,
): void {
  register(COMMANDS.OPEN_LOCATION, async (value: unknown) => {
    const candidate = value as LocationResult & {
      location?: LocationResult; previewMode?: PreviewMode; previewTitle?: string;
      label?: string; contextValue?: string; includeFileUri?: vscode.Uri;
    };
    const location = candidate.contextValue === "includeHierarchyLocation" && candidate.includeFileUri
      ? { uri: candidate.includeFileUri, range: new vscode.Range(0, 0, 0, 0) }
      : "location" in candidate && candidate.location ? candidate.location : candidate;
    if (!location?.uri || !location.range) return;
    if (candidate.contextValue !== "historyLocation") {
      history.record(location, candidate.previewMode ?? "reference",
        candidate.previewTitle ?? candidate.label ?? "Location", "selection");
    }
    const document = await vscode.workspace.openTextDocument(location.uri);
    const editor = await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
    editor.selection = new vscode.Selection(location.range.start, location.range.start);
    editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
  });
  register(INTERNAL_COMMANDS.PREVIEW_LOCATION, async (
    value: unknown, mode: unknown, title: unknown, source: unknown,
  ) => preview.showLocation(value as LocationResult, (mode as PreviewMode) ?? "reference",
    typeof title === "string" ? title : undefined, (source as NavigationSource) ?? "selection"));
  register(COMMANDS.GO_TO_DEFINITION, async () => {
    const target = activePosition();
    if (!target) return;
    const locations = await analysis.definition(target.uri, target.position);
    if (locations.length === 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t("C Insight: No definition found."));
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const range = editor?.document.getWordRangeAtPosition(editor.selection.active);
    history.record(locations[0], "definition",
      range && editor ? editor.document.getText(range) : "Definition", "selection");
    await vscode.commands.executeCommand(COMMANDS.OPEN_LOCATION, {
      location: locations[0], contextValue: "historyLocation",
    });
  });
}
