import * as vscode from "vscode";
import { AnalysisService } from "./analysis/analysisService";
import { ClangdManager } from "./clangd/clangdManager";
import { ClangdLogOutputChannel } from "./clangd/clangdLog";
import { BookmarkExplorer } from "./bookmarks/bookmarkExplorer";
import { CallHierarchyRepository } from "./callHierarchy/callHierarchyRepository";
import { registerCommands } from "./commands/registerCommands";
import { isCppDocument } from "./configuration/configuration";
import { ContextController } from "./context/contextController";
import { ProjectDiagnostics } from "./diagnostics/projectDiagnostics";
import { ReliabilityStatusBar } from "./diagnostics/reliabilityStatusBar";
import { NavigationHistoryExplorer } from "./history/navigationHistoryExplorer";
import { SymbolSearchExplorer } from "./symbols/symbolSearchExplorer";
import {
  WorkspaceSessionManager,
  WorkspaceSessionSnapshot,
} from "./session/workspaceSession";
import { TypeHierarchyExplorer } from "./typeHierarchy/typeHierarchyExplorer";
import { IncludeHierarchyExplorer } from "./includeHierarchy/includeHierarchyExplorer";
import { RelationshipGraphPanel } from "./relationshipGraph/relationshipGraphPanel";
import { ViewRegistry } from "./views/viewRegistry";

let manager: ClangdManager | undefined;
let workspaceSession: WorkspaceSessionManager | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const output = vscode.window.createOutputChannel("C Insight");
  const clangdOutput = vscode.window.createOutputChannel("C Insight: clangd", {
    log: true,
  });
  context.subscriptions.push(output, clangdOutput);

  manager = new ClangdManager(
    output,
    new ClangdLogOutputChannel(clangdOutput),
  );
  const analysis = new AnalysisService(manager, output);
  const callRepository = new CallHierarchyRepository(analysis);
  const navigationHistory = new NavigationHistoryExplorer();
  const bookmarks = new BookmarkExplorer(context);
  const symbolSearch = new SymbolSearchExplorer(analysis);
  const typeHierarchy = new TypeHierarchyExplorer(analysis);
  const includeHierarchy = new IncludeHierarchyExplorer();
  const relationshipGraph = new RelationshipGraphPanel(
    analysis,
    callRepository,
  );
  const views = new ViewRegistry(
    analysis,
    navigationHistory,
    bookmarks,
    symbolSearch,
    typeHierarchy,
    includeHierarchy,
    callRepository,
  );
  const controller = new ContextController(analysis, views, output);
  const projectDiagnostics = new ProjectDiagnostics(manager);
  workspaceSession = new WorkspaceSessionManager(context, {
    capture: () => ({
      history: vscode.workspace
        .getConfiguration("cInsight.session")
        .get<boolean>("persistNavigationHistory", true)
        ? navigationHistory.sessionState()
        : undefined,
      preview: views.preview.sessionState(),
      references: views.referenceSessionState(),
      symbolSearch: symbolSearch.sessionState(),
      callHierarchy: vscode.workspace
        .getConfiguration("cInsight.session")
        .get<boolean>("restoreCallHierarchy", true)
        ? views.callHierarchySessionState()
        : undefined,
    }),
  });
  const restoreSnapshot = async (
    snapshot: WorkspaceSessionSnapshot | undefined = workspaceSession?.load(true),
  ): Promise<boolean> => {
    if (!snapshot) {
      return false;
    }
    if (
      vscode.workspace
        .getConfiguration("cInsight.session")
        .get<boolean>("persistNavigationHistory", true)
    ) {
      navigationHistory.restoreSession(snapshot.history);
    }
    await views.restoreReferenceSession(snapshot.references);
    await symbolSearch.restoreSession(snapshot.symbolSearch);
    if (
      snapshot.callHierarchy &&
      vscode.workspace
        .getConfiguration("cInsight.session")
        .get<boolean>("restoreCallHierarchy", true)
    ) {
      const call = snapshot.callHierarchy;
      try {
        await controller.resolveNow(
          vscode.Uri.parse(call.uri),
          new vscode.Position(call.position.line, call.position.character),
          { manualCallHierarchy: true, manualReferences: true },
        );
        await views.restoreCallHierarchyDepths(call);
      } catch (error) {
        output.appendLine(
          `Workspace call hierarchy restore failed: ${String(error)}`,
        );
      }
    }
    await views.preview.restoreSession(snapshot.preview);
    return true;
  };
  const initialSession = workspaceSession.load();
  const reliabilityStatusBar = new ReliabilityStatusBar();
  reliabilityStatusBar.update(
    projectDiagnostics.currentReliability,
    manager.currentIndexProgress,
  );
  const compilationDatabaseWatcher = vscode.workspace.createFileSystemWatcher(
    "**/compile_commands.json",
  );
  let documentSymbolsTimer: NodeJS.Timeout | undefined;
  let compilationDatabaseTimer: NodeJS.Timeout | undefined;
  let indexWasRunning = false;
  let documentSymbolsGeneration = 0;
  const scheduleDocumentSymbols = (
    editor: vscode.TextEditor | undefined,
    delay: number,
  ): void => {
    documentSymbolsGeneration += 1;
    const generation = documentSymbolsGeneration;
    if (documentSymbolsTimer) {
      clearTimeout(documentSymbolsTimer);
    }
    if (!views.isViewVisible("cInsight.symbols")) {
      documentSymbolsTimer = undefined;
      return;
    }
    documentSymbolsTimer = setTimeout(() => {
      documentSymbolsTimer = undefined;
      void updateDocumentSymbols(
        editor,
        analysis,
        views,
        output,
        () => generation === documentSymbolsGeneration,
      );
    }, delay);
  };
  const scheduleCompilationDatabaseRefresh = (
    uri: vscode.Uri,
    change: "created" | "changed" | "deleted",
  ): void => {
    if (compilationDatabaseTimer) {
      clearTimeout(compilationDatabaseTimer);
    }
    compilationDatabaseTimer = setTimeout(() => {
      compilationDatabaseTimer = undefined;
      void (async () => {
        const wasActive = projectDiagnostics.usesCompilationDatabase(uri);
        projectDiagnostics.invalidateCompilationDatabase();
        includeHierarchy.invalidate();
        relationshipGraph.markStale("compilation database changed");
        await projectDiagnostics.refresh();
        const isActive = projectDiagnostics.usesCompilationDatabase(uri);
        if (!wasActive && !isActive) {
          return;
        }
        views.markResultsStale("the compilation database changed");
        const action = await vscode.window.showInformationMessage(
          `C Insight: The active compilation database was ${change}. Restart clangd to reload all compile commands?`,
          "Restart clangd",
          "Later",
        );
        if (action === "Restart clangd") {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Reloading C Insight compilation database",
            },
            () => manager!.restart(),
          );
          controller.refresh();
          await projectDiagnostics.refresh();
        }
      })().catch((error: unknown) => {
        output.appendLine(
          `Compilation database refresh failed: ${String(error)}`,
        );
      });
    }, 750);
  };
  context.subscriptions.push(
    manager,
    views,
    navigationHistory,
    bookmarks,
    symbolSearch,
    typeHierarchy,
    includeHierarchy,
    relationshipGraph,
    workspaceSession,
    controller,
    projectDiagnostics,
    reliabilityStatusBar,
    compilationDatabaseWatcher,
  );

  registerCommands(
    context,
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
    () => restoreSnapshot(),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cInsight.relationshipGraph.show",
      async () => {
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
        await relationshipGraph.showAt(
          editor.document.uri,
          editor.selection.active,
        );
      },
    ),
  );
  context.subscriptions.push(
    manager.onDidChangeState((state) => {
      void projectDiagnostics.refresh();
      if (state === "restarting" || state === "starting") {
        views.markResultsStale("clangd restarted");
        views.invalidateCallHierarchy();
        typeHierarchy.invalidate();
        includeHierarchy.invalidate();
        relationshipGraph.markStale("clangd restarted");
      }
    }),
    manager.onDidChangeIndexProgress((progress) => {
      if (progress.status === "indexing" && !indexWasRunning) {
        views.markResultsStale("background indexing restarted");
      }
      indexWasRunning = progress.status === "indexing";
      reliabilityStatusBar.update(
        projectDiagnostics.currentReliability,
        progress,
      );
      void projectDiagnostics.refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      scheduleDocumentSymbols(editor, 0);
      void projectDiagnostics.refresh(editor);
    }),
    views.onDidChangeNavigationVisibility((id) => {
      if (
        id === "cInsight.symbols" &&
        views.isViewVisible("cInsight.symbols")
      ) {
        scheduleDocumentSymbols(vscode.window.activeTextEditor, 0);
      }
    }),
    vscode.languages.onDidChangeDiagnostics(() => {
      void projectDiagnostics.refresh();
    }),
    projectDiagnostics.onDidRefresh((roots) => views.status.setRoots(roots)),
    projectDiagnostics.onDidChangeReliability((reliability) => {
      views.updateReliability(reliability);
      reliabilityStatusBar.update(
        reliability,
        manager!.currentIndexProgress,
      );
    }),
    compilationDatabaseWatcher.onDidChange((uri) =>
      scheduleCompilationDatabaseRefresh(uri, "changed"),
    ),
    compilationDatabaseWatcher.onDidCreate((uri) =>
      scheduleCompilationDatabaseRefresh(uri, "created"),
    ),
    compilationDatabaseWatcher.onDidDelete((uri) =>
      scheduleCompilationDatabaseRefresh(uri, "deleted"),
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      bookmarks.handleDocumentChange(event.document);
      includeHierarchy.handleDocumentChange(event.document);
      relationshipGraph.markStale("source changed");
      if (isCppDocument(event.document)) {
        typeHierarchy.invalidate();
      }
      const editor = vscode.window.activeTextEditor;
      if (editor?.document === event.document) {
        views.markPinnedViewsStale();
        views.invalidateCallHierarchy();
        scheduleDocumentSymbols(editor, 300);
      }
    }),
    new vscode.Disposable(() => {
      if (documentSymbolsTimer) {
        clearTimeout(documentSymbolsTimer);
      }
      if (compilationDatabaseTimer) {
        clearTimeout(compilationDatabaseTimer);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("cInsight.codePreview")) {
        views.preview.refresh();
      }
      if (event.affectsConfiguration("cInsight.callHierarchy")) {
        views.invalidateCallHierarchy();
        relationshipGraph.markStale("call hierarchy configuration changed");
        controller.refresh();
      }
      if (event.affectsConfiguration("cInsight.typeHierarchy")) {
        typeHierarchy.invalidate();
      }
      if (event.affectsConfiguration("cInsight.includeHierarchy")) {
        includeHierarchy.invalidate();
      }
      if (event.affectsConfiguration("cInsight.relationshipGraph")) {
        relationshipGraph.markStale("relationship graph configuration changed");
      }
      if (event.affectsConfiguration("cInsight.history")) {
        navigationHistory.configurationChanged();
      }
      if (event.affectsConfiguration("cInsight.bookmarks")) {
        bookmarks.configurationChanged();
      }
      if (event.affectsConfiguration("cInsight.symbolSearch")) {
        symbolSearch.configurationChanged();
      }
      if (event.affectsConfiguration("cInsight.session")) {
        workspaceSession?.startAutosave();
      }
      if (
        [
          "cInsight.clangd.path",
          "cInsight.clangd.arguments",
          "cInsight.clangd.logLevel",
          "cInsight.compileCommandsDir",
          "cInsight.fallbackFlags",
          "cInsight.backgroundIndex",
        ].some((section) => event.affectsConfiguration(section))
      ) {
        views.markResultsStale("the analysis configuration changed");
        projectDiagnostics.invalidateCompilationDatabase();
        includeHierarchy.invalidate();
        await manager?.restart().catch((error: unknown) => {
          output.appendLine(`Configuration restart failed: ${String(error)}`);
        });
        controller.refresh();
      }
    }),
  );

  await vscode.commands.executeCommand("setContext", "cInsight.active", true);
  await vscode.commands.executeCommand("setContext", "cInsight.pinned", false);
  await vscode.commands.executeCommand(
    "setContext",
    "cInsight.previewLocked",
    false,
  );
  await vscode.commands.executeCommand(
    "setContext",
    "cInsight.referencesPinned",
    false,
  );
  await vscode.commands.executeCommand(
    "setContext",
    "cInsight.callHierarchyPinned",
    false,
  );
  await projectDiagnostics.refresh();

  void warnAboutConflicts(context);
  try {
    await manager.start();
    await projectDiagnostics.refresh();
    controller.start();
    if (initialSession) {
      void restoreSnapshot(initialSession)
        .catch((error: unknown) => {
          output.appendLine(`Workspace session restore failed: ${String(error)}`);
        })
        .finally(() => workspaceSession?.startAutosave());
    } else {
      workspaceSession.startAutosave();
    }
    await updateDocumentSymbols(
      vscode.window.activeTextEditor,
      analysis,
      views,
      output,
    );
  } catch (error) {
    output.appendLine(`clangd startup failed: ${String(error)}`);
    await projectDiagnostics.refresh();
    void vscode.window.showErrorMessage(
      `C Insight could not start clangd. Check C Insight: clangd output. ${String(error)}`,
      "Open Settings",
    ).then((action) => {
      if (action === "Open Settings") {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "cInsight.clangd.path",
        );
      }
    });
  }
}

export async function deactivate(): Promise<void> {
  await workspaceSession?.save();
  await manager?.stop();
}

async function updateDocumentSymbols(
  editor: vscode.TextEditor | undefined,
  analysis: AnalysisService,
  views: ViewRegistry,
  output: vscode.OutputChannel,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!views.isViewVisible("cInsight.symbols")) {
    return;
  }
  if (!editor || !isCppDocument(editor.document)) {
    if (isCurrent()) {
      views.symbols.clear();
    }
    return;
  }
  try {
    const symbols = await analysis.documentSymbols(editor.document.uri);
    if (isCurrent()) {
      views.updateSymbols(editor.document.uri, symbols);
    }
  } catch (error) {
    if (isCurrent()) {
      output.appendLine(`Document symbols failed: ${String(error)}`);
    }
  }
}

async function warnAboutConflicts(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (context.workspaceState.get<boolean>("ignoredProviderConflict")) {
    return;
  }
  const conflicts = [
    "llvm-vs-code-extensions.vscode-clangd",
    "ms-vscode.cpptools",
  ].filter((id) => vscode.extensions.getExtension(id)?.isActive);
  if (conflicts.length === 0) {
    return;
  }
  const action = await vscode.window.showWarningMessage(
    `C Insight detected active C/C++ providers (${conflicts.join(", ")}). This may cause duplicate navigation results and indexing.`,
    "Ignore for Workspace",
  );
  if (action === "Ignore for Workspace") {
    await context.workspaceState.update("ignoredProviderConflict", true);
  }
}
