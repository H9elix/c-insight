import * as path from "node:path";
import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import { ClangdManager } from "../clangd/clangdManager";
import { BookmarkExplorer } from "../bookmarks/bookmarkExplorer";
import {
  isCppDocument,
  readConfiguration,
} from "../configuration/configuration";
import { ContextController } from "../context/contextController";
import { ProjectDiagnostics } from "../diagnostics/projectDiagnostics";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import {
  NavigationHistoryEntry,
  NavigationSource,
} from "../history/navigationHistoryModel";
import { LocationResult } from "../models/types";
import { SymbolSearchExplorer } from "../symbols/symbolSearchExplorer";
import { WorkspaceSessionManager } from "../session/workspaceSession";
import {
  TypeHierarchyDirection,
  TypeHierarchyExplorer,
} from "../typeHierarchy/typeHierarchyExplorer";
import {
  IncludeHierarchyDirection,
  IncludeHierarchyExplorer,
} from "../includeHierarchy/includeHierarchyExplorer";
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
  bookmarks: BookmarkExplorer,
  symbolSearch: SymbolSearchExplorer,
  typeHierarchy: TypeHierarchyExplorer,
  includeHierarchy: IncludeHierarchyExplorer,
  workspaceSession: WorkspaceSessionManager,
  restoreWorkspaceSession: () => Promise<boolean>,
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
      includeFileUri?: vscode.Uri;
    };
    const location =
      candidate.contextValue === "includeHierarchyLocation" &&
      candidate.includeFileUri
        ? {
            uri: candidate.includeFileUri,
            range: new vscode.Range(0, 0, 0, 0),
          }
        :
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
        manualCallDirection: "incoming",
      });
      await vscode.commands.executeCommand("cInsight.callers.focus");
    }
  });

  register("cInsight.showOutgoingCalls", async () => {
    const target = activePosition();
    if (target) {
      await controller.resolveNow(target.uri, target.position, {
        manualCallHierarchy: true,
        manualCallDirection: "outgoing",
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
  register("cInsight.bookmarks.addCurrent", () => bookmarks.addCurrent());
  register("cInsight.bookmarks.add", (value: unknown) =>
    bookmarks.addNode(value),
  );
  register("cInsight.bookmarks.rename", (value: unknown) =>
    bookmarks.rename(value),
  );
  register("cInsight.bookmarks.changeGroup", (value: unknown) =>
    bookmarks.changeGroup(value),
  );
  register("cInsight.bookmarks.delete", (value: unknown) =>
    bookmarks.remove(value),
  );
  register("cInsight.bookmarks.refresh", () => bookmarks.refresh());
  register("cInsight.bookmarks.search", () => bookmarks.search());
  register("cInsight.bookmarks.clearSearch", () => bookmarks.clearSearch());
  register("cInsight.bookmarks.sort", () => bookmarks.chooseSort());
  register("cInsight.bookmarks.import", () => bookmarks.importBookmarks());
  register("cInsight.bookmarks.export", (value: unknown) =>
    bookmarks.exportBookmarks(value),
  );
  register("cInsight.bookmarks.renameGroup", (value: unknown) =>
    bookmarks.renameGroup(value),
  );
  register("cInsight.bookmarks.deleteGroup", (value: unknown) =>
    bookmarks.deleteGroup(value),
  );
  register("cInsight.session.restore", async () => {
    if (!(await restoreWorkspaceSession())) {
      void vscode.window.showInformationMessage(
        "C Insight: No saved workspace session is available.",
      );
    }
  });
  register("cInsight.session.clear", async () => {
    await workspaceSession.clear();
    void vscode.window.showInformationMessage(
      "C Insight: Saved workspace session cleared. Autosave is paused until this window closes.",
    );
  });
  const showTypeHierarchy = async (
    direction: TypeHierarchyDirection,
  ): Promise<void> => {
    const target = activePosition();
    if (target) {
      await typeHierarchy.show(direction, target.uri, target.position);
    }
  };
  register("cInsight.typeHierarchy.showSupertypes", () =>
    showTypeHierarchy("supertypes"),
  );
  register("cInsight.typeHierarchy.showSubtypes", () =>
    showTypeHierarchy("subtypes"),
  );
  register("cInsight.supertypes.expandToDepth", () =>
    typeHierarchy.promptExpand("supertypes"),
  );
  register("cInsight.subtypes.expandToDepth", () =>
    typeHierarchy.promptExpand("subtypes"),
  );
  register("cInsight.typeHierarchy.stopExpansion", () =>
    typeHierarchy.stopExpansion(),
  );
  register("cInsight.supertypes.search", () =>
    typeHierarchy.search("supertypes"),
  );
  register("cInsight.subtypes.search", () =>
    typeHierarchy.search("subtypes"),
  );
  for (const direction of ["supertypes", "subtypes"] as const) {
    for (const format of ["text", "json", "mermaid"] as const) {
      register(`cInsight.${direction}.export${capitalize(format)}`, () =>
        typeHierarchy.export(direction, format),
      );
    }
  }
  const showIncludeHierarchy = async (
    direction: IncludeHierarchyDirection,
  ): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (
      !editor ||
      editor.document.uri.scheme !== "file" ||
      !isCppDocument(editor.document)
    ) {
      void vscode.window.showWarningMessage(
        "C Insight: Open and activate a local C/C++ source or header file first.",
      );
      return;
    }
    await includeHierarchy.show(direction, editor.document.uri);
  };
  register("cInsight.includeHierarchy.showIncludes", () =>
    showIncludeHierarchy("includes"),
  );
  register("cInsight.includeHierarchy.showIncludedBy", () =>
    showIncludeHierarchy("includedBy"),
  );
  register("cInsight.includes.expandToDepth", () =>
    includeHierarchy.promptExpand("includes"),
  );
  register("cInsight.includedBy.expandToDepth", () =>
    includeHierarchy.promptExpand("includedBy"),
  );
  register("cInsight.includeHierarchy.stopExpansion", () =>
    includeHierarchy.stopExpansion(),
  );
  register("cInsight.includes.search", () =>
    includeHierarchy.search("includes"),
  );
  register("cInsight.includedBy.search", () =>
    includeHierarchy.search("includedBy"),
  );
  for (const direction of ["includes", "includedBy"] as const) {
    for (const format of ["text", "json", "mermaid"] as const) {
      register(`cInsight.${direction}.export${capitalize(format)}`, () =>
        includeHierarchy.export(direction, format),
      );
    }
  }

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

  register("cInsight.searchSymbols", () => symbolSearch.openSearch());
  register("cInsight.symbolSearch.refresh", () => symbolSearch.refresh());
  register("cInsight.symbolSearch.clear", () => symbolSearch.clear());
  register("cInsight.symbolSearch.groupBy", () => symbolSearch.chooseGrouping());
  register("cInsight.symbolSearch.filterKinds", () =>
    symbolSearch.chooseKinds(),
  );
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
