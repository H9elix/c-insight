import * as path from "node:path";
import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import { AnalysisEngine } from "../analysis/analysisEngine";
import { ClangdManager } from "../clangd/clangdManager";
import { BookmarkExplorer } from "../bookmarks/bookmarkExplorer";
import { isCppDocument } from "../configuration/configuration";
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
import type { CommandId } from "../ids";
import { registerReferenceCommands } from "./referenceCommands";
import { registerCallHierarchyCommands } from "./callHierarchyCommands";

export interface CommandDependencies {
  manager: ClangdManager;
  analysis: AnalysisService;
  controller: ContextController;
  views: ViewRegistry;
  projectDiagnostics: ProjectDiagnostics;
  navigationHistory: NavigationHistoryExplorer;
  bookmarks: BookmarkExplorer;
  symbolSearch: SymbolSearchExplorer;
  typeHierarchy: TypeHierarchyExplorer;
  includeHierarchy: IncludeHierarchyExplorer;
  workspaceSession: WorkspaceSessionManager;
  engine: AnalysisEngine;
  restoreWorkspaceSession: () => Promise<boolean>;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  dependencies: CommandDependencies,
): void {
  const {
    manager,
    analysis,
    controller,
    views,
    projectDiagnostics,
    navigationHistory,
    bookmarks,
    symbolSearch,
    typeHierarchy,
    includeHierarchy,
    workspaceSession,
    engine,
    restoreWorkspaceSession,
  } = dependencies;
  const register = (
    id: CommandId,
    callback: (...args: unknown[]) => unknown,
  ): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, callback));
  };

  register("cInsight.about", async () => {
    const manifest = context.extension.packageJSON as {
      displayName?: string;
      name?: string;
      version?: string;
      author?: string | { name?: string };
      license?: string;
    };
    const developer =
      typeof manifest.author === "string"
        ? manifest.author
        : manifest.author?.name ?? "youjinchun";
    const details = [
      vscode.l10n.t("Version: {version}", { version: manifest.version ?? "unknown" }),
      vscode.l10n.t("Developer: {developer}", { developer }),
      vscode.l10n.t("Semantic engine: {engine}", { engine }),
      vscode.l10n.t("License: {license}", { license: manifest.license ?? "MIT" }),
      vscode.l10n.t("VS Code: {version}", { version: vscode.version }),
      vscode.l10n.t("Platform: {platform} {architecture}", {
        platform: process.platform,
        architecture: process.arch,
      }),
      vscode.l10n.t("Remote: {remote}", { remote: vscode.env.remoteName ?? "local" }),
      vscode.l10n.t("Telemetry: disabled; source code is not uploaded by C Insight"),
    ].join("\n");
    const copyInformation = vscode.l10n.t("Copy Information");
    const openUserGuide = vscode.l10n.t("Open User Guide");
    const action = await vscode.window.showInformationMessage(
      manifest.displayName ?? manifest.name ?? "C Insight",
      { modal: true, detail: details },
      copyInformation,
      openUserGuide,
    );
    if (action === copyInformation) {
      await vscode.env.clipboard.writeText(
        `${manifest.displayName ?? "C Insight"}\n${details}\n`,
      );
    } else if (action === openUserGuide) {
      const guide = vscode.Uri.joinPath(
        context.extensionUri,
        vscode.env.language.toLowerCase().startsWith("zh")
          ? "docs/user-guide.zh-CN.md"
          : "docs/user-guide.en.md",
      );
      await vscode.commands.executeCommand("markdown.showPreview", guide);
    }
  });

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
      void vscode.window.showInformationMessage(
        vscode.l10n.t("C Insight: No definition found."),
      );
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

  registerReferenceCommands(register, analysis, views, activePosition);
  registerCallHierarchyCommands(register, controller, views, activePosition);

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
  register("cInsight.diagnostics.copyReport", () =>
    projectDiagnostics.copyReport("text"),
  );
  register("cInsight.diagnostics.exportText", () =>
    projectDiagnostics.exportReport("text"),
  );
  register("cInsight.diagnostics.exportJson", () =>
    projectDiagnostics.exportReport("json"),
  );
  register("cInsight.index.refresh", () =>
    vscode.commands.executeCommand("cInsight.restartClangd"),
  );
  register("cInsight.diagnostics.selectCompilationDatabase", async () => {
    const selected = await vscode.window.showOpenDialog({
      title: vscode.l10n.t("Select compile_commands.json"),
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
        vscode.l10n.t("C Insight: Select a file named compile_commands.json."),
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
        vscode.l10n.t("C Insight: No saved workspace session is available."),
      );
    }
  });
  register("cInsight.session.clear", async () => {
    await workspaceSession.clear();
    void vscode.window.showInformationMessage(
      vscode.l10n.t("C Insight: Saved workspace session cleared. Autosave is paused until this window closes."),
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
      register(`cInsight.${direction}.export${capitalize(format)}` as CommandId, () =>
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
        vscode.l10n.t("C Insight: Open and activate a local C/C++ source or header file first."),
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
  register("cInsight.includes.stopExpansion", () =>
    includeHierarchy.stopExpansion("includes"),
  );
  register("cInsight.includedBy.stopExpansion", () =>
    includeHierarchy.stopExpansion("includedBy"),
  );
  register("cInsight.includes.search", () =>
    includeHierarchy.search("includes"),
  );
  register("cInsight.includedBy.search", () =>
    includeHierarchy.search("includedBy"),
  );
  for (const direction of ["includes", "includedBy"] as const) {
    for (const format of ["text", "json", "mermaid"] as const) {
      register(`cInsight.${direction}.export${capitalize(format)}` as CommandId, () =>
        includeHierarchy.export(direction, format),
      );
    }
  }

  register("cInsight.restartClangd", async () => {
    if (engine === "microsoft") {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("C Insight is using the Microsoft C/C++ language service (cpptools). Reload Window to restart that extension host."),
      );
      return;
    }
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t("Restarting C Insight clangd"),
        },
        () => manager.restart(),
      );
      controller.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t("C Insight could not start clangd: {error}", { error: String(error) }),
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
