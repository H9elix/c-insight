import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import { readConfiguration } from "../configuration/configuration";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import { NavigationSource } from "../history/navigationHistoryModel";
import { COMMANDS, INTERNAL_COMMANDS } from "../ids";
import { LocationResult } from "../models/types";
import { TreeLocationClickClassifier } from "../utils/treeLocationInteraction";
import {
  CodePreviewProvider,
  ExplicitPreviewSource,
  PreviewMode,
} from "../views/codePreviewProvider";
import type { TreeNode } from "../views/treeNode";
import { ContextController } from "../context/contextController";
import { RegisterCommand } from "./commandRegistrar";

export type ActivePosition = () => { uri: vscode.Uri; position: vscode.Position } | undefined;

export function registerNavigationCommands(
  register: RegisterCommand,
  analysis: AnalysisService,
  history: NavigationHistoryExplorer,
  preview: CodePreviewProvider,
  controller: ContextController,
  activePosition: ActivePosition,
): void {
  const treeClicks = new TreeLocationClickClassifier();
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
  register(INTERNAL_COMMANDS.ACTIVATE_TREE_LOCATION, async (
    value: unknown,
    scope: unknown,
  ) => {
    const node = value as TreeNode | undefined;
    if (!node?.location) return;
    const key = treeLocationKey(
      typeof scope === "string" ? scope : "unknown",
      node,
    );
    const activation = treeClicks.classify(
      key,
      readConfiguration().navigationDoubleClickInterval,
    );
    let location = node.location;
    let mode = (node.previewMode ?? "reference") as PreviewMode;
    let title = node.previewTitle ?? node.label;
    let source = explicitPreviewSource(node.navigationSource);
    if (node.historyEntryId !== undefined) {
      const selected = history.select(node.historyEntryId);
      if (!selected) return;
      location = history.entryLocation(selected);
      mode = selected.mode;
      title = selected.title;
      source = "history";
    }
    if (activation === "preview") {
      await preview.showLocation(location, mode, title, source);
      return;
    }
    preview.preserveForEditorOpen();
    const navigation = controller.beginProgrammaticNavigation(location);
    try {
      await openEditorLocation(location);
      controller.completeProgrammaticNavigation(navigation);
    } catch (error) {
      controller.cancelProgrammaticNavigation(navigation);
      throw error;
    }
  });
  register(INTERNAL_COMMANDS.PREVIEW_LOCATION, async (
    value: unknown, mode: unknown, title: unknown, source: unknown,
  ) => preview.showLocation(value as LocationResult, (mode as PreviewMode) ?? "reference",
    typeof title === "string" ? title : undefined,
    explicitPreviewSource(source as NavigationSource | undefined)));
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

function explicitPreviewSource(
  source: NavigationSource | undefined,
): ExplicitPreviewSource {
  return source && source !== "context" ? source : "selection";
}

function treeLocationKey(scope: string, node: TreeNode): string {
  const location = node.location!;
  const stableNode = node.id ?? [
    node.contextValue ?? "location",
    location.uri.toString(),
    location.range.start.line,
    location.range.start.character,
    location.range.end.line,
    location.range.end.character,
    node.label,
  ].join(":");
  return `${scope}\0${stableNode}`;
}

async function openEditorLocation(location: LocationResult): Promise<void> {
  const document = await vscode.workspace.openTextDocument(location.uri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: true,
    preserveFocus: false,
  });
  editor.selection = new vscode.Selection(location.range.start, location.range.start);
  editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
}
