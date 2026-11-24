import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import { AnalysisEngine } from "../analysis/analysisEngine";
import { BookmarkExplorer } from "../bookmarks/bookmarkExplorer";
import { ClangdManager } from "../clangd/clangdManager";
import { ContextController } from "../context/contextController";
import { ProjectDiagnostics } from "../diagnostics/projectDiagnostics";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import { IncludeHierarchyExplorer } from "../includeHierarchy/includeHierarchyExplorer";
import { VIEWS, type CommandId } from "../ids";
import { WorkspaceSessionManager } from "../session/workspaceSession";
import { SymbolSearchExplorer } from "../symbols/symbolSearchExplorer";
import { TypeHierarchyExplorer } from "../typeHierarchy/typeHierarchyExplorer";
import { ViewRegistry } from "../views/viewRegistry";
import { ProjectFilesExplorer } from "../projectFiles/projectFilesExplorer";
import { TextSearchExplorer } from "../textSearch/textSearchExplorer";
import { registerCallHierarchyCommands } from "./callHierarchyCommands";
import { registerDiagnosticCommands } from "./diagnosticCommands";
import { registerExtensionControlCommands } from "./extensionControlCommands";
import { registerHierarchyCommands } from "./hierarchyCommands";
import { registerNavigationCommands } from "./navigationCommands";
import { registerReferenceCommands } from "./referenceCommands";
import { registerWorkspaceToolCommands } from "./workspaceToolCommands";
import { CombinedViewManager, registerCombinedCommands } from "../combined/combinedViewManager";
import type { ViewDiscovery } from "../views/viewDiscovery";
import { registerViewCommands } from "./viewCommands";

export interface CommandDependencies {
  manager: ClangdManager; analysis: AnalysisService; controller: ContextController;
  views: ViewRegistry; projectDiagnostics: ProjectDiagnostics;
  navigationHistory: NavigationHistoryExplorer; bookmarks: BookmarkExplorer;
  symbolSearch: SymbolSearchExplorer; typeHierarchy: TypeHierarchyExplorer;
  includeHierarchy: IncludeHierarchyExplorer; workspaceSession: WorkspaceSessionManager;
  engine: AnalysisEngine; restoreWorkspaceSession: () => Promise<boolean>;
  projectFiles: ProjectFilesExplorer;
  textSearch: TextSearchExplorer;
  combinedViews: CombinedViewManager;
  viewDiscovery: ViewDiscovery;
}

export function registerCommands(context: vscode.ExtensionContext, dependencies: CommandDependencies): void {
  const register = (id: CommandId, callback: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: unknown[]) => {
      try { return await callback(...args); }
      finally { dependencies.combinedViews.refreshActions(); }
    }));
  };
  const activePosition = (): { uri: vscode.Uri; position: vscode.Position } | undefined => {
    const editor = vscode.window.activeTextEditor;
    return editor ? { uri: editor.document.uri, position: editor.selection.active } : undefined;
  };
  const d = dependencies;
  registerViewCommands(register, d.viewDiscovery);
  registerCombinedCommands(register, d.combinedViews);
  registerExtensionControlCommands(register, context, d.engine, d.manager, d.controller, d.views);
  registerNavigationCommands(
    register,
    d.analysis,
    d.navigationHistory,
    d.views.preview,
    d.controller,
    activePosition,
  );
  registerReferenceCommands(register, d.analysis, d.views, activePosition);
  registerCallHierarchyCommands(register, d.controller, d.views, activePosition);
  registerDiagnosticCommands(register, d.manager, d.projectDiagnostics, () => d.views.focusView(VIEWS.STATUS));
  registerWorkspaceToolCommands(register, {
    history: d.navigationHistory, bookmarks: d.bookmarks, symbolSearch: d.symbolSearch,
    workspaceSession: d.workspaceSession,
    restoreWorkspaceSession: d.restoreWorkspaceSession,
    projectFiles: d.projectFiles,
    textSearch: d.textSearch,
    documentSymbols: {
      chooseSort: () => d.views.chooseDocumentSymbolSort(),
      setLocked: locked => d.views.setDocumentSymbolsLocked(locked),
    },
  });
  registerHierarchyCommands(register, d.typeHierarchy, d.includeHierarchy, activePosition);
}
