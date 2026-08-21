import * as vscode from "vscode";
import { compilationDatabaseChangePresentation } from "./analysis/enginePresentation";
import { AnalysisService } from "./analysis/analysisService";
import { configuredAnalysisEngine } from "./analysis/analysisEngine";
import {
  microsoftProviderStatus,
  MicrosoftProviderConfigurationError,
} from "./analysis/microsoftProviderStatus";
import {
  activeProviderConflicts,
  LLVM_CLANGD_EXTENSION_ID,
  MICROSOFT_CPP_EXTENSION_ID,
} from "./analysis/providerConflictModel";
import { ClangdManager } from "./clangd/clangdManager";
import { ClangdLogOutputChannel } from "./clangd/clangdLog";
import { BookmarkExplorer } from "./bookmarks/bookmarkExplorer";
import { CallHierarchyRepository } from "./callHierarchy/callHierarchyRepository";
import { registerCommands } from "./commands/registerCommands";
import { isCppDocument } from "./configuration/configuration";
import { ContextController } from "./context/contextController";
import { ProjectDiagnostics } from "./diagnostics/projectDiagnostics";
import { ReliabilityStatusBar } from "./diagnostics/reliabilityStatusBar";
import { runtimeDiagnostics } from "./diagnostics/runtimeDiagnostics";
import { NavigationHistoryExplorer } from "./history/navigationHistoryExplorer";
import { SymbolSearchExplorer } from "./symbols/symbolSearchExplorer";
import {
  WorkspaceSessionManager,
  WorkspaceSessionSnapshot,
} from "./session/workspaceSession";
import { sessionForAnalysisEngine } from "./session/workspaceSessionModel";
import { TypeHierarchyExplorer } from "./typeHierarchy/typeHierarchyExplorer";
import { TypeHierarchyRepository } from "./typeHierarchy/typeHierarchyRepository";
import { IncludeHierarchyExplorer } from "./includeHierarchy/includeHierarchyExplorer";
import { IncludeHierarchyRepository } from "./includeHierarchy/includeHierarchyRepository";
import { RelationshipGraphPanel } from "./relationshipGraph/relationshipGraphPanel";
import { ViewRegistry } from "./views/viewRegistry";
import { VIEWS } from "./ids";
import { initializeContextKeys, startAnalysisEngine } from "./activation/runtimeInitialization";

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
  const engine = configuredAnalysisEngine();
  const analysis = new AnalysisService(manager, output, engine);
  const callRepository = new CallHierarchyRepository(analysis);
  const navigationHistory = new NavigationHistoryExplorer();
  const bookmarks = new BookmarkExplorer(context);
  const symbolSearch = new SymbolSearchExplorer(analysis);
  const typeRepository = new TypeHierarchyRepository(analysis);
  const typeHierarchy = new TypeHierarchyExplorer(analysis, typeRepository);
  const includeRepository = new IncludeHierarchyRepository();
  const includeHierarchy = new IncludeHierarchyExplorer(includeRepository);
  const relationshipGraph = new RelationshipGraphPanel(
    analysis,
    callRepository,
    typeRepository,
    includeRepository,
    bookmarks,
    output,
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
  const projectDiagnostics = new ProjectDiagnostics(
    manager,
    analysis,
    context,
    engine,
    callRepository,
  );
  workspaceSession = new WorkspaceSessionManager(context, {
    capture: () => ({
      engine,
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
      relationshipGraph: vscode.workspace
        .getConfiguration("cInsight.session")
        .get<boolean>("restoreRelationshipGraph", true)
        ? relationshipGraph.sessionState()
        : undefined,
    }),
    onSnapshotLimited: (dropped, byteLength) => {
      output.appendLine(
        `Workspace session limited to ${byteLength} bytes; dropped: ${dropped.join(", ")}.`,
      );
    },
  });
  const restoreSnapshot = async (
    snapshot: WorkspaceSessionSnapshot | undefined = workspaceSession?.load(true),
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    token?: vscode.CancellationToken,
  ): Promise<boolean> => {
    if (!snapshot) {
      return false;
    }
    const compatible = sessionForAnalysisEngine(snapshot, engine);
    snapshot = compatible.snapshot;
    if (compatible.dropped.length > 0) {
      output.appendLine(
        `Workspace session engine changed; dropped semantic state: ${compatible.dropped.join(", ")}.`,
      );
    }
    const runStep = async (
      label: string,
      action: () => void | Promise<void>,
    ): Promise<void> => {
      if (token?.isCancellationRequested) {
        return;
      }
      progress?.report({ message: label, increment: 100 / 6 });
      try {
        await action();
      } catch (error) {
        output.appendLine(
          `Workspace session ${label} failed: ${String(error)}`,
        );
      }
    };
    await runStep("restoring navigation history", () => {
      if (
        vscode.workspace
          .getConfiguration("cInsight.session")
          .get<boolean>("persistNavigationHistory", true)
      ) {
        navigationHistory.restoreSession(snapshot.history);
      }
    });
    await runStep("restoring reference and symbol searches", async () => {
      await views.restoreReferenceSession(snapshot.references);
      await symbolSearch.restoreSession(snapshot.symbolSearch);
    });
    await runStep("restoring relationship graph", async () => {
      if (
        snapshot.relationshipGraph &&
        vscode.workspace
          .getConfiguration("cInsight.session")
          .get<boolean>("restoreRelationshipGraph", true)
      ) {
        await relationshipGraph.restoreSession(snapshot.relationshipGraph);
      }
    });
    await runStep("checking call hierarchy location", async () => {
      if (
        !snapshot.callHierarchy ||
        !vscode.workspace
          .getConfiguration("cInsight.session")
          .get<boolean>("restoreCallHierarchy", true)
      ) {
        return;
      }
      const call = snapshot.callHierarchy;
      const uri = vscode.Uri.parse(call.uri);
      if (!(await workspaceUriExists(uri))) {
        output.appendLine(
          `Workspace call hierarchy restore skipped: location is unavailable (${call.uri}).`,
        );
        return;
      }
      await controller.resolveNow(
        uri,
        new vscode.Position(call.position.line, call.position.character),
        { manualCallHierarchy: true, manualReferences: true },
      );
      if (!token?.isCancellationRequested) {
        await views.restoreCallHierarchyDepths(call);
      }
    });
    await runStep("restoring code preview", async () => {
      if (!snapshot.preview) {
        return;
      }
      const uri = vscode.Uri.parse(snapshot.preview.uri);
      if (!(await workspaceUriExists(uri))) {
        output.appendLine(
          `Workspace Code Preview restore skipped: location is unavailable (${snapshot.preview.uri}).`,
        );
        return;
      }
      await views.preview.restoreSession(snapshot.preview);
    });
    await runStep("finalizing workspace session", () => undefined);
    if (token?.isCancellationRequested) {
      output.appendLine("Workspace session restore cancelled; partial state retained.");
    }
    return true;
  };
  const restoreWithProgress = async (
    snapshot: WorkspaceSessionSnapshot | undefined = workspaceSession?.load(true),
  ): Promise<boolean> => {
    if (!snapshot) {
      return false;
    }
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("C Insight: Restoring workspace session"),
        cancellable: true,
      },
      (progress, token) => restoreSnapshot(snapshot, progress, token),
    );
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
  let providerConflictTimer: NodeJS.Timeout | undefined;
  let indexWasRunning = false;
  let documentSymbolsGeneration = 0;
  const providerConflictPromptState: ProviderConflictPromptState = {
    inFlight: false,
    warned: new Set<string>(),
  };
  const scheduleProviderConflictCheck = (
    editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor,
    delay = 250,
  ): void => {
    if (providerConflictTimer) {
      clearTimeout(providerConflictTimer);
      providerConflictTimer = undefined;
    }
    if (engine !== "clangd" || !editor || !isCppDocument(editor.document)) {
      return;
    }
    providerConflictTimer = setTimeout(() => {
      providerConflictTimer = undefined;
      void warnAboutConflicts(
        context,
        engine,
        editor.document.uri,
        providerConflictPromptState,
      );
    }, delay);
  };
  const scheduleDocumentSymbols = (
    editor: vscode.TextEditor | undefined,
    delay: number,
  ): void => {
    documentSymbolsGeneration += 1;
    const generation = documentSymbolsGeneration;
    if (documentSymbolsTimer) {
      clearTimeout(documentSymbolsTimer);
    }
    if (!views.isViewVisible(VIEWS.SYMBOLS)) {
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
        const presentation = compilationDatabaseChangePresentation(
          engine,
          change,
        );
        const action = await vscode.window.showInformationMessage(
          presentation.message,
          presentation.primaryAction,
          "Later",
        );
        if (action === "Restart clangd") {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: vscode.l10n.t("Reloading C Insight compilation database"),
            },
            () => manager!.restart(),
          );
          controller.refresh();
          await projectDiagnostics.refresh();
        } else if (action === "Reload Window") {
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
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
    relationshipGraph.onDidClose(() => {
      void workspaceSession?.save();
    }),
  );

  registerCommands(
    context,
    {
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
      restoreWorkspaceSession: () => restoreWithProgress(),
    },
  );
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(
      vscode.commands.registerCommand("cInsight.test.previewState", () =>
        views.preview.sessionState(),
      ),
      vscode.commands.registerCommand("cInsight.test.clearPreview", () =>
        views.preview.clear(),
      ),
      vscode.commands.registerCommand("cInsight.test.definitionAtCursor", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isCppDocument(editor.document)) return [];
        return analysis.definition(editor.document.uri, editor.selection.active);
      }),
      vscode.commands.registerCommand("cInsight.test.requestTiming", () =>
        analysis.requestTimingStats(),
      ),
      vscode.commands.registerCommand("cInsight.test.runtimeDiagnostics", () =>
        runtimeDiagnostics.snapshot(),
      ),
      vscode.commands.registerCommand("cInsight.test.callHierarchyState", () =>
        views.callHierarchyInteractionState(),
      ),
      vscode.commands.registerCommand(
        "cInsight.test.expandCallHierarchy",
        (direction: "incoming" | "outgoing", depth: number) =>
          views.expandCallHierarchyToDepth(direction, depth),
      ),
      vscode.commands.registerCommand(
        "cInsight.test.activateCallOccurrence",
        (
          direction: "incoming" | "outgoing",
          label: string,
          ordinal: number,
        ) => views.activateCallOccurrenceForTest(direction, label, ordinal),
      ),
      vscode.commands.registerCommand("cInsight.test.invalidateCallHierarchy", () =>
        views.invalidateCallHierarchy(),
      ),
      vscode.commands.registerCommand("cInsight.test.navigationState", () => ({
        visibility: views.navigationVisibility,
        preview: views.preview.sessionState(),
        scheduler: analysis.requestSchedulerStats(),
        timing: analysis.requestTimingStats(),
      })),
      vscode.commands.registerCommand(
        "cInsight.test.followPreviewDefinition",
        (line: number, character: number) =>
          views.preview.followDefinition(new vscode.Position(line, character)),
      ),
      vscode.commands.registerCommand("cInsight.test.referenceBasedCallers", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isCppDocument(editor.document)) return undefined;
        const definitions = await analysis.definition(
          editor.document.uri,
          editor.selection.active,
        );
        const definition = definitions[0];
        if (!definition) return { roots: 0, callers: 0 };
        const wordRange = editor.document.getWordRangeAtPosition(
          editor.selection.active,
        );
        const name = wordRange
          ? editor.document.getText(wordRange)
          : "function";
        const roots = [analysis.callNode({
          name,
          kind: vscode.SymbolKind.Function,
          uri: definition.uri.toString(),
          range: {
            start: {
              line: definition.range.start.line,
              character: definition.range.start.character,
            },
            end: {
              line: definition.range.end.line,
              character: definition.range.end.character,
            },
          },
          selectionRange: {
            start: {
              line: definition.range.start.line,
              character: definition.range.start.character,
            },
            end: {
              line: definition.range.end.line,
              character: definition.range.end.character,
            },
          },
        })];
        if (!roots[0]) {
          return {
            roots: 0,
            callers: 0,
            evidence: callRepository.microsoftCallerEvidenceStats(),
          };
        }
        const callers = await callRepository.incoming(roots[0]);
        return {
          roots: roots.length,
          callers: callers.length,
          evidence: callRepository.microsoftCallerEvidenceStats(),
        };
      }),
      vscode.commands.registerCommand("cInsight.test.referenceDiagnostics", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isCppDocument(editor.document)) return undefined;
        const definitions = await analysis.definition(
          editor.document.uri,
          editor.selection.active,
        );
        const fromCursor = await analysis.references(
          editor.document.uri,
          editor.selection.active,
          false,
        );
        const definition = definitions[0];
        const fromDefinition = definition
          ? await analysis.references(
              definition.uri,
              definition.range.start,
              false,
            )
          : [];
        const firstReference = fromDefinition[0] ?? fromCursor[0];
        const symbols = firstReference
          ? await analysis.documentSymbols(firstReference.uri)
          : [];
        return {
          definition: definition
            ? `${definition.uri}:${definition.range.start.line + 1}`
            : undefined,
          fromCursor: fromCursor.length,
          fromDefinition: fromDefinition.length,
          cursorSamples: fromCursor.slice(0, 5).map((location) =>
            `${location.uri}:${location.range.start.line + 1}`,
          ),
          definitionSamples: fromDefinition.slice(0, 5).map((location) =>
            `${location.uri}:${location.range.start.line + 1}`,
          ),
          symbols: symbols.slice(0, 12).map((symbol) =>
            "location" in symbol
              ? {
                  form: "SymbolInformation",
                  name: symbol.name,
                  kind: symbol.kind,
                  start: symbol.location.range.start.line + 1,
                  end: symbol.location.range.end.line + 1,
                }
              : {
                  form: "DocumentSymbol",
                  name: symbol.name,
                  kind: symbol.kind,
                  start: symbol.range.start.line + 1,
                  end: symbol.range.end.line + 1,
                },
          ),
        };
      }),
      vscode.commands.registerCommand("cInsight.test.microsoftCallees", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isCppDocument(editor.document)) return undefined;
        const roots = await callRepository.prepare(
          editor.document.uri,
          editor.selection.active,
        );
        if (!roots[0]) {
          return {
            roots: 0,
            callees: 0,
            evidence: callRepository.microsoftCalleeEvidenceStats(),
          };
        }
        const callees = await callRepository.outgoing(roots[0]);
        return {
          roots: roots.length,
          callees: callees.length,
          evidence: callRepository.microsoftCalleeEvidenceStats(),
        };
      }),
    );
  }
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
            vscode.l10n.t("C Insight: Open and activate a local C/C++ source or header file first."),
          );
          return;
        }
        await relationshipGraph.showAt(
          editor.document.uri,
          editor.selection.active,
        );
      },
    ),
    vscode.commands.registerCommand(
      "cInsight.relationshipGraph.showFile",
      () => {
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
        relationshipGraph.showFile(editor.document.uri);
      },
    ),
    vscode.commands.registerCommand(
      "cInsight.relationshipGraph.exportText",
      () => relationshipGraph.exportGraph("text"),
    ),
    vscode.commands.registerCommand(
      "cInsight.relationshipGraph.exportJson",
      () => relationshipGraph.exportGraph("json"),
    ),
    vscode.commands.registerCommand(
      "cInsight.relationshipGraph.exportMermaid",
      () => relationshipGraph.exportGraph("mermaid"),
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
      scheduleProviderConflictCheck(editor);
      void projectDiagnostics.refresh(editor);
    }),
    views.onDidChangeNavigationVisibility((id) => {
      if (
        id === VIEWS.SYMBOLS &&
        views.isViewVisible(VIEWS.SYMBOLS)
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
      views.preview.handleDocumentChange(event.document);
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
      if (providerConflictTimer) {
        clearTimeout(providerConflictTimer);
      }
    }),
    vscode.extensions.onDidChange(() => {
      providerConflictPromptState.warned.clear();
      scheduleProviderConflictCheck(undefined, 0);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration("C_Cpp.intelliSenseEngine") ||
        event.affectsConfiguration("clangd.enable")
      ) {
        providerConflictPromptState.warned.clear();
        scheduleProviderConflictCheck(undefined, 0);
      }
      if (event.affectsConfiguration("cInsight.codePreview")) {
        views.preview.refresh();
      }
      if (event.affectsConfiguration("cInsight.callHierarchy")) {
        views.invalidateCallHierarchy();
        relationshipGraph.markStale("call hierarchy configuration changed");
        controller.refresh();
      }
      if (event.affectsConfiguration("cInsight.microsoft.callersMode")) {
        views.invalidateCallHierarchy();
        relationshipGraph.markStale("Microsoft Callers mode changed");
        controller.refresh();
      }
      if (event.affectsConfiguration("cInsight.typeHierarchy")) {
        typeHierarchy.invalidate();
        relationshipGraph.markStale("type hierarchy configuration changed");
      }
      if (event.affectsConfiguration("cInsight.includeHierarchy")) {
        includeHierarchy.invalidate();
        relationshipGraph.markStale(
          "include hierarchy configuration changed",
        );
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
          "cInsight.engine",
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
        if (event.affectsConfiguration("cInsight.engine")) {
          void vscode.window
            .showInformationMessage(
              vscode.l10n.t("C Insight analysis engine changed. Reload the window to apply it."),
              vscode.l10n.t("Reload Window"),
            )
            .then((choice) => {
              if (choice === vscode.l10n.t("Reload Window")) {
                void vscode.commands.executeCommand("workbench.action.reloadWindow");
              }
            });
        } else if (engine === "clangd") {
          await manager?.restart().catch((error: unknown) => {
            output.appendLine(`Configuration restart failed: ${String(error)}`);
          });
          controller.refresh();
        }
      }
    }),
  );

  await initializeContextKeys();
  await projectDiagnostics.refresh();

  registerProviderSettingRestore(context);
  try {
    await startAnalysisEngine(engine, manager, output, () => {
      void showMicrosoftEngineNotice(context);
    });
    await projectDiagnostics.refresh();
    if (initialSession) {
      await restoreWithProgress(initialSession).catch((error: unknown) => {
        output.appendLine(`Workspace session restore failed: ${String(error)}`);
      });
    }
    workspaceSession.startAutosave();
    controller.start();
    await updateDocumentSymbols(
      vscode.window.activeTextEditor,
      analysis,
      views,
      output,
    );
    scheduleProviderConflictCheck(undefined, 0);
  } catch (error) {
    if (engine === "microsoft") {
      manager.failExternalEngine();
    }
    output.appendLine(`${engine} startup failed: ${String(error)}`);
    await projectDiagnostics.refresh();
    if (engine === "microsoft") {
      await handleMicrosoftStartupFailure(
        context,
        error,
        vscode.window.activeTextEditor?.document.uri,
      );
    } else {
      void showAnalysisEngineStartupFailure(engine, error);
    }
  }
}

async function handleMicrosoftStartupFailure(
  context: vscode.ExtensionContext,
  error: unknown,
  resource?: vscode.Uri,
): Promise<void> {
  if (
    error instanceof MicrosoftProviderConfigurationError &&
    error.state === "ambiguous"
  ) {
    const status = microsoftProviderStatus(resource);
    if (status.conflicts.includes(LLVM_CLANGD_EXTENSION_ID)) {
      const disableLlvm = vscode.l10n.t("Disable LLVM clangd for This Workspace");
      const openWorkspaceSettings = vscode.l10n.t("Open Workspace Settings");
      const action = await vscode.window.showErrorMessage(
        vscode.l10n.t("C Insight could not start the Microsoft analysis engine because the LLVM clangd extension is also enabled. {target}", {
          target: workspaceSettingTargetDescription(),
        }),
        ...(vscode.workspace.workspaceFolders?.length
          ? [disableLlvm]
          : []),
        openWorkspaceSettings,
      );
      if (action === disableLlvm) {
        try {
          await disableConflictingProviders(context, [
            LLVM_CLANGD_EXTENSION_ID,
          ]);
        } catch (writeError) {
          const followUp = await vscode.window.showErrorMessage(
            vscode.l10n.t("C Insight could not update clangd.enable in Workspace settings: {error}", { error: String(writeError) }),
            openWorkspaceSettings,
          );
          if (followUp === openWorkspaceSettings) {
            await vscode.commands.executeCommand(
              "workbench.action.openWorkspaceSettingsFile",
            );
          }
        }
      } else if (action === openWorkspaceSettings) {
        await vscode.commands.executeCommand(
          "workbench.action.openWorkspaceSettingsFile",
        );
      }
      return;
    }
  }
  await showAnalysisEngineStartupFailure("microsoft", error);
}

async function showAnalysisEngineStartupFailure(
  engine: "clangd" | "microsoft",
  error: unknown,
): Promise<void> {
  const openSettings = vscode.l10n.t("Open Settings");
  const action = await vscode.window.showErrorMessage(
    vscode.l10n.t("C Insight could not start the {engine} analysis engine. {error}", { engine, error: String(error) }),
    openSettings,
  );
  if (action === openSettings) {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      engine === "clangd"
        ? "cInsight.clangd.path"
        : "C_Cpp.intelliSenseEngine",
    );
  }
}

export async function deactivate(): Promise<void> {
  await workspaceSession?.save();
  await manager?.stop();
}

async function workspaceUriExists(uri: vscode.Uri): Promise<boolean> {
  if (uri.scheme === "untitled") {
    return false;
  }
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function updateDocumentSymbols(
  editor: vscode.TextEditor | undefined,
  analysis: AnalysisService,
  views: ViewRegistry,
  output: vscode.OutputChannel,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!views.isViewVisible(VIEWS.SYMBOLS)) {
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
  engine: "clangd" | "microsoft",
  resource?: vscode.Uri,
  promptState?: ProviderConflictPromptState,
): Promise<void> {
  if (context.workspaceState.get<boolean>("ignoredProviderConflict")) {
    return;
  }
  const conflicts = activeProviderConflicts({
    engine,
    llvmClangdActive: Boolean(
      vscode.extensions.getExtension(LLVM_CLANGD_EXTENSION_ID)?.isActive,
    ),
    llvmClangdEnabled: vscode.workspace
      .getConfiguration("clangd", resource)
      .get<boolean>("enable", true),
    microsoftCppActive: Boolean(
      vscode.extensions.getExtension(MICROSOFT_CPP_EXTENSION_ID),
    ),
    microsoftIntelliSenseEngine: vscode.workspace
      .getConfiguration("C_Cpp", resource)
      .get<string>("intelliSenseEngine", "default"),
  });
  if (conflicts.length === 0) {
    return;
  }
  const fingerprint = conflicts.join("|");
  if (promptState?.inFlight || promptState?.warned.has(fingerprint)) {
    return;
  }
  if (promptState) {
    promptState.inFlight = true;
    promptState.warned.add(fingerprint);
  }
  try {
    const disableWorkspace = vscode.l10n.t("Disable for This Workspace");
    const openSettings = vscode.l10n.t("Open Settings");
    const ignoreWorkspace = vscode.l10n.t("Ignore for Workspace");
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t("C Insight detected enabled C/C++ providers ({providers}). This may cause duplicate navigation results and indexing. {target}", {
        providers: conflicts.join(", "),
        target: workspaceSettingTargetDescription(),
      }),
      ...(vscode.workspace.workspaceFolders?.length
        ? [disableWorkspace]
        : []),
      openSettings,
      ignoreWorkspace,
    );
    if (action === disableWorkspace) {
      try {
        await disableConflictingProviders(context, conflicts);
      } catch (error) {
        const followUp = await vscode.window.showErrorMessage(
          vscode.l10n.t("C Insight could not update the workspace Provider settings: {error}", { error: String(error) }),
          vscode.l10n.t("Open Workspace Settings"),
        );
        if (followUp === vscode.l10n.t("Open Workspace Settings")) {
          await vscode.commands.executeCommand(
            "workbench.action.openWorkspaceSettingsFile",
          );
        }
      }
    } else if (action === openSettings) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        conflicts.includes(MICROSOFT_CPP_EXTENSION_ID)
          ? "C_Cpp.intelliSenseEngine"
          : "clangd.enable",
      );
    } else if (action === ignoreWorkspace) {
      await context.workspaceState.update("ignoredProviderConflict", true);
    }
  } finally {
    if (promptState) {
      promptState.inFlight = false;
    }
  }
}

interface ProviderConflictPromptState {
  inFlight: boolean;
  warned: Set<string>;
}

type ProviderSettingSection = "C_Cpp" | "clangd";
type ProviderSettingKey = "intelliSenseEngine" | "enable";
type ProviderSettingValue = string | boolean | undefined;
type StoredConfigurationTarget = "workspace" | "workspaceFolder";

interface ProviderSettingChange {
  section: ProviderSettingSection;
  key: ProviderSettingKey;
  target: StoredConfigurationTarget;
  resource?: string;
  previousValue: ProviderSettingValue;
  appliedValue: Exclude<ProviderSettingValue, undefined>;
}

const providerSettingChangesKey = "providerSettingChanges";

async function disableConflictingProviders(
  context: vscode.ExtensionContext,
  conflicts: string[],
): Promise<void> {
  const target: StoredConfigurationTarget = "workspace";
  const configurationTarget = vscode.ConfigurationTarget.Workspace;
  const existing = context.workspaceState.get<ProviderSettingChange[]>(
    providerSettingChangesKey,
    [],
  );
  const changes = [...existing];
  const apply = async (
    section: ProviderSettingSection,
    key: ProviderSettingKey,
    value: Exclude<ProviderSettingValue, undefined>,
  ): Promise<void> => {
    const configuration = vscode.workspace.getConfiguration(section);
    const inspected = configuration.inspect<ProviderSettingValue>(key);
    const previousValue = targetValue(inspected, target);
    const shouldRecord = !changes.some((item) =>
      item.section === section && item.key === key &&
      item.target === target && item.resource === undefined);
    if (shouldRecord) {
      changes.push({
        section,
        key,
        target,
        previousValue,
        appliedValue: value,
      });
    }
    await configuration.update(key, value, configurationTarget);
    if (shouldRecord) {
      await context.workspaceState.update(providerSettingChangesKey, changes);
    }
  };
  if (conflicts.includes(MICROSOFT_CPP_EXTENSION_ID)) {
    await apply("C_Cpp", "intelliSenseEngine", "disabled");
  }
  if (conflicts.includes(LLVM_CLANGD_EXTENSION_ID)) {
    await apply("clangd", "enable", false);
  }
  const action = await vscode.window.showInformationMessage(
    vscode.l10n.t("C Insight updated the Workspace settings for competing language services. Reload Window to apply the change. Use C Insight: Restore Provider Settings to undo it safely."),
    vscode.l10n.t("Reload Window"),
  );
  if (action === vscode.l10n.t("Reload Window")) {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

function registerProviderSettingRestore(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cInsight.restoreProviderSettings",
      () => restoreProviderSettings(context),
    ),
  );
}

async function restoreProviderSettings(
  context: vscode.ExtensionContext,
): Promise<void> {
  const changes = context.workspaceState.get<ProviderSettingChange[]>(
    providerSettingChangesKey,
    [],
  );
  let restored = 0;
  let skipped = 0;
  let failed = 0;
  const retained: ProviderSettingChange[] = [];
  for (const change of changes) {
    const resource = change.resource
      ? vscode.Uri.parse(change.resource)
      : undefined;
    const configuration = vscode.workspace.getConfiguration(
      change.section,
      resource,
    );
    const current = targetValue(
      configuration.inspect<ProviderSettingValue>(change.key),
      change.target,
    );
    if (current !== change.appliedValue) {
      skipped += 1;
      continue;
    }
    try {
      await configuration.update(
        change.key,
        change.previousValue,
        change.target === "workspaceFolder"
          ? vscode.ConfigurationTarget.WorkspaceFolder
          : vscode.ConfigurationTarget.Workspace,
      );
      restored += 1;
    } catch {
      failed += 1;
      retained.push(change);
    }
  }
  await context.workspaceState.update(
    providerSettingChangesKey,
    retained.length ? retained : undefined,
  );
  void vscode.window.showInformationMessage(
    vscode.l10n.t("C Insight restored {restored} provider setting(s); skipped {skipped}; failed {failed}. Reload Window to apply the change.", { restored, skipped, failed }),
  );
}

function workspaceSettingTargetDescription(): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return vscode.l10n.t("The quick fix will update Workspace settings ({path}).", { path: vscode.Uri.joinPath(folders[0].uri, ".vscode", "settings.json").toString(true) });
  }
  if (folders.length > 1) {
    return vscode.l10n.t("The quick fix will update the shared multi-root Workspace settings because clangd.enable does not support Workspace Folder scope.");
  }
  return vscode.l10n.t("Open Settings to configure the language services manually.");
}

function targetValue(
  inspected: ReturnType<vscode.WorkspaceConfiguration["inspect"]>,
  target: StoredConfigurationTarget,
): ProviderSettingValue {
  if (!inspected) return undefined;
  return target === "workspaceFolder"
    ? inspected.workspaceFolderValue as ProviderSettingValue
    : inspected.workspaceValue as ProviderSettingValue;
}

async function showMicrosoftEngineNotice(
  context: vscode.ExtensionContext,
): Promise<void> {
  const key = "microsoftEngineSemanticProviderNoticeShown";
  if (context.globalState.get<boolean>(key)) return;
  await context.globalState.update(key, true);
  void vscode.window.showInformationMessage(
    vscode.l10n.t("C Insight is using Microsoft C/C++ language service (cpptools) as its semantic analysis provider. Performance and query results may differ from clangd."),
  );
}
