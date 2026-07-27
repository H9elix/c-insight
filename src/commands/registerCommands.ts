import * as path from "node:path";
import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import { ClangdManager } from "../clangd/clangdManager";
import { readConfiguration } from "../configuration/configuration";
import { ContextController } from "../context/contextController";
import { ProjectDiagnostics } from "../diagnostics/projectDiagnostics";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import {
  NavigationHistoryEntry,
  NavigationSource,
} from "../history/navigationHistoryModel";
import { LocationResult } from "../models/types";
import { ViewRegistry } from "../views/viewRegistry";
import type { PreviewMode } from "../views/codePreviewProvider";

export function registerCommands(
  context: vscode.ExtensionContext,
  manager: ClangdManager,
  analysis: AnalysisService,
  controller: ContextController,
  views: ViewRegistry,
  projectDiagnostics: ProjectDiagnostics,
  navigationHistory: NavigationHistoryExplorer,
): void {
  const register = (
    id: string,
    callback: (...args: unknown[]) => unknown,
  ): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, callback));
  };

  register("cInsight.openLocation", async (value: unknown) => {
    const candidate = value as LocationResult & {
      location?: LocationResult;
      previewMode?: PreviewMode;
      previewTitle?: string;
      label?: string;
      contextValue?: string;
    };
    const location =
      "location" in candidate && candidate.location
        ? candidate.location
        : (candidate as LocationResult);
    if (!location?.uri || !location.range) {
      return;
    }
    if (candidate.contextValue !== "historyLocation") {
      navigationHistory.record(
        location,
        candidate.previewMode ?? "reference",
        candidate.previewTitle ?? candidate.label ?? "Location",
        "selection",
      );
    }
    const document = await vscode.workspace.openTextDocument(location.uri);
    const editor = await vscode.window.showTextDocument(document, {
      preview: true,
      preserveFocus: false,
    });
    editor.selection = new vscode.Selection(
      location.range.start,
      location.range.start,
    );
    editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
  });

  register(
    "cInsight.previewLocation",
    async (
      value: unknown,
      mode: unknown,
      title: unknown,
      source: unknown,
    ) => {
      const location = value as LocationResult;
      await views.preview.showLocation(
        location,
        (mode as PreviewMode) ?? "reference",
        typeof title === "string" ? title : undefined,
        (source as NavigationSource) ?? "selection",
      );
    },
  );

  register("cInsight.goToDefinition", async () => {
    const target = activePosition();
    if (!target) {
      return;
    }
    const locations = await analysis.definition(target.uri, target.position);
    if (locations.length === 0) {
      void vscode.window.showInformationMessage("C Insight: No definition found.");
      return;
    }
    navigationHistory.record(
      locations[0],
      "definition",
      activeWord() ?? "Definition",
      "selection",
    );
    await vscode.commands.executeCommand(
      "cInsight.openLocation",
      {
        location: locations[0],
        contextValue: "historyLocation",
      },
    );
  });

  register("cInsight.findReferences", async () => {
    const target = activePosition();
    if (!target) {
      return;
    }
    views.referenceExplorer.loading();
    try {
      const [locations, definitions, declarations, callRoots] = await Promise.all([
        analysis.references(
          target.uri,
          target.position,
          readConfiguration().includeDeclarationInReferences,
        ),
        analysis.definition(target.uri, target.position),
        analysis.declaration(target.uri, target.position),
        analysis.prepareCallHierarchy(target.uri, target.position).catch(() => []),
      ]);
      views.updateReferences(
        locations,
        definitions,
        declarations,
        callRoots.length > 0,
        callRoots[0]?.raw.name,
        true,
      );
      await vscode.commands.executeCommand("cInsight.references.focus");
    } catch (error) {
      views.referencesFailed(error, true);
    }
  });

  register("cInsight.references.search", () =>
    views.referenceExplorer.promptSearch(),
  );
  register("cInsight.references.clearSearch", () =>
    views.referenceExplorer.clearSearch(),
  );
  register("cInsight.references.groupBy", () =>
    views.referenceExplorer.chooseGrouping(),
  );
  register("cInsight.references.scope", () =>
    views.referenceExplorer.chooseScope(),
  );
  register("cInsight.references.loadMore", () =>
    views.referenceExplorer.loadMore(),
  );
  register("cInsight.references.showAll", () =>
    views.referenceExplorer.showAll(),
  );
  register("cInsight.references.copy", (value: unknown) =>
    views.referenceExplorer.copyReference(value),
  );
  register("cInsight.references.copyAll", () =>
    views.referenceExplorer.copyAll(),
  );
  register("cInsight.references.exportText", () =>
    views.referenceExplorer.exportResults("text"),
  );
  register("cInsight.references.exportJson", () =>
    views.referenceExplorer.exportResults("json"),
  );
  register("cInsight.references.openList", () =>
    views.referenceExplorer.openResultList(),
  );
  register("cInsight.references.expandAll", () =>
    views.referenceExplorer.expandAll(),
  );
  register("cInsight.references.collapseAll", () =>
    views.referenceExplorer.collapseAll(),
  );

  register("cInsight.showIncomingCalls", async () => {
    const target = activePosition();
    if (target) {
      await controller.resolveNow(target.uri, target.position, {
        manualCallHierarchy: true,
      });
      await vscode.commands.executeCommand("cInsight.callers.focus");
    }
  });

  register("cInsight.showOutgoingCalls", async () => {
    const target = activePosition();
    if (target) {
      await controller.resolveNow(target.uri, target.position, {
        manualCallHierarchy: true,
      });
      await vscode.commands.executeCommand("cInsight.callees.focus");
    }
  });

  register("cInsight.callers.expandToDepth", () =>
    views.promptExpandCallHierarchy("incoming"),
  );
  register("cInsight.callees.expandToDepth", () =>
    views.promptExpandCallHierarchy("outgoing"),
  );
  register("cInsight.callHierarchy.stopExpansion", () =>
    views.stopCallExpansion(),
  );
  register("cInsight.callers.search", () =>
    views.searchCallHierarchy("incoming"),
  );
  register("cInsight.callees.search", () =>
    views.searchCallHierarchy("outgoing"),
  );
  register("cInsight.callers.findPath", () =>
    views.findCallPath("incoming"),
  );
  register("cInsight.callees.findPath", () =>
    views.findCallPath("outgoing"),
  );
  register("cInsight.callers.exportText", () =>
    views.exportCallHierarchy("incoming", "text"),
  );
  register("cInsight.callers.exportJson", () =>
    views.exportCallHierarchy("incoming", "json"),
  );
  register("cInsight.callees.exportText", () =>
    views.exportCallHierarchy("outgoing", "text"),
  );
  register("cInsight.callees.exportJson", () =>
    views.exportCallHierarchy("outgoing", "json"),
  );
  register("cInsight.callers.exportMermaid", () =>
    views.exportCallHierarchy("incoming", "mermaid"),
  );
  register("cInsight.callees.exportMermaid", () =>
    views.exportCallHierarchy("outgoing", "mermaid"),
  );

  register("cInsight.pinContext", () => controller.pin());
  register("cInsight.unpinContext", () => controller.unpin());
  register("cInsight.pinReferences", () => views.pinReferences());
  register("cInsight.unpinReferences", () => {
    views.unpinReferences();
    controller.refresh();
  });
  register("cInsight.pinCallHierarchy", () => views.pinCallHierarchy());
  register("cInsight.unpinCallHierarchy", () => {
    views.unpinCallHierarchy();
    controller.refresh();
  });
  register("cInsight.refresh", () => controller.refresh(true));
  register("cInsight.diagnostics.refresh", () => projectDiagnostics.refresh());
  register("cInsight.openProjectDiagnostics", () =>
    vscode.commands.executeCommand("cInsight.status.focus"),
  );
  register("cInsight.diagnostics.showClangdLog", () => manager.showLog());
  register("cInsight.index.refresh", () =>
    vscode.commands.executeCommand("cInsight.restartClangd"),
  );
  register("cInsight.diagnostics.selectCompilationDatabase", async () => {
    const selected = await vscode.window.showOpenDialog({
      title: "Select compile_commands.json",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { JSON: ["json"] },
    });
    if (!selected?.[0]) {
      return;
    }
    if (path.basename(selected[0].fsPath) !== "compile_commands.json") {
      void vscode.window.showErrorMessage(
        "C Insight: Select a file named compile_commands.json.",
      );
      return;
    }
    const directory = path.dirname(selected[0].fsPath);
    await vscode.workspace
      .getConfiguration("cInsight")
      .update(
        "compileCommandsDir",
        directory,
        vscode.ConfigurationTarget.Workspace,
      );
  });
  register("cInsight.diagnostics.clearCompilationDatabase", async () => {
    await vscode.workspace
      .getConfiguration("cInsight")
      .update(
        "compileCommandsDir",
        "",
        vscode.ConfigurationTarget.Workspace,
      );
  });
  register("cInsight.history.preview", async (value: unknown) => {
    const entry = value as NavigationHistoryEntry;
    const selected = navigationHistory.select(entry.id);
    if (!selected) {
      return;
    }
    await views.preview.showLocation(
      navigationHistory.entryLocation(selected),
      selected.mode,
      selected.title,
      "history",
    );
  });
  register("cInsight.history.filter", () => navigationHistory.chooseFilter());
  register("cInsight.history.clear", () => navigationHistory.clear());

  register("cInsight.restartClangd", async () => {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Restarting C Insight clangd",
        },
        () => manager.restart(),
      );
      controller.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `C Insight could not start clangd: ${String(error)}`,
      );
    }
  });

  register("cInsight.searchSymbols", async () => {
    const query = await vscode.window.showInputBox({
      title: "C Insight: Search Workspace Symbols",
      prompt: "Enter a C/C++ symbol name",
    });
    if (query === undefined) {
      return;
    }
    const symbols = await analysis.workspaceSymbols(query);
    const picked = await vscode.window.showQuickPick(
      symbols.slice(0, 500).map((symbol) => ({
        label: symbol.name,
        description: symbol.containerName,
        detail: vscode.workspace.asRelativePath(
          vscode.Uri.parse(symbol.location.uri),
        ),
        symbol,
      })),
      { matchOnDescription: true, matchOnDetail: true },
    );
    if (picked) {
      await vscode.commands.executeCommand(
        "cInsight.openLocation",
        analysis.toVsLocation(picked.symbol.location),
      );
    }
  });
}

function activePosition():
  | { uri: vscode.Uri; position: vscode.Position }
  | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  return {
    uri: editor.document.uri,
    position: editor.selection.active,
  };
}

function activeWord(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const range = editor.document.getWordRangeAtPosition(
    editor.selection.active,
  );
  return range ? editor.document.getText(range) : undefined;
}
