import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import {
  isCppDocument,
  readConfiguration,
} from "../configuration/configuration";
import { LocationResult, SymbolContext, ViewUpdateIntent } from "../models/types";
import { ViewRegistry } from "../views/viewRegistry";
import { CONTEXT_KEYS, VIEWS } from "../ids";
import {
  cursorQueryDemandForEngine,
  CursorQueryDemand,
} from "./navigationDemand";

export class ContextController implements vscode.Disposable {
  private timer?: NodeJS.Timeout;
  private detailsTimer?: NodeJS.Timeout;
  private cancellation?: vscode.CancellationTokenSource;
  private generation = 0;
  private pinned = false;
  private current?: { uri: vscode.Uri; position: vscode.Position };
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly analysis: AnalysisService,
    private readonly views: ViewRegistry,
    private readonly output: vscode.OutputChannel,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.schedule(event.textEditor.document, event.selections[0].active);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.schedule(editor.document, editor.selection.active, true);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === event.document) {
          this.schedule(editor.document, editor.selection.active);
        }
      }),
      this.views.onDidChangeNavigationVisibility((id) => {
        if (id === VIEWS.SYMBOLS) {
          return;
        }
        if (this.views.navigationVisible) {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            this.schedule(editor.document, editor.selection.active, true);
          }
        } else {
          this.cancelPending();
        }
      }),
    );
  }

  start(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.schedule(editor.document, editor.selection.active, true);
    }
  }

  pin(): void {
    this.pinned = true;
    void vscode.commands.executeCommand("setContext", CONTEXT_KEYS.CONTEXT_PINNED, true);
  }

  unpin(): void {
    this.pinned = false;
    void vscode.commands.executeCommand("setContext", CONTEXT_KEYS.CONTEXT_PINNED, false);
    this.refresh();
  }

  refresh(manual = false): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.schedule(
        editor.document,
        editor.selection.active,
        true,
        manual
          ? { manualReferences: true, manualCallHierarchy: true }
          : undefined,
      );
    }
  }

  async resolveNow(
    uri: vscode.Uri,
    position: vscode.Position,
    intent: ViewUpdateIntent = {},
  ): Promise<SymbolContext | undefined> {
    const generation = ++this.generation;
    this.cancelPending();
    const cancellation = new vscode.CancellationTokenSource();
    this.cancellation = cancellation;
    const config = readConfiguration();
    const demand = manualDemand(intent);
    try {
      const base = await this.resolveBase(
        uri,
        position,
        generation,
        cancellation.token,
        demand,
      );
      if (!base || generation !== this.generation) {
        return undefined;
      }
      const [references, incomingCount, outgoingCount] = await Promise.all([
        demand.references
          ? this.analysis.references(
              uri,
              position,
              config.includeDeclarationInReferences,
              cancellation.token,
            )
          : [],
        this.analysis.analysisEngine !== "microsoft" && base.callRoots[0]
          ? this.analysis
              .incomingCalls(base.callRoots[0], cancellation.token)
              .then((calls) => calls.length)
              .catch(() => undefined)
          : undefined,
        this.analysis.analysisEngine !== "microsoft" && base.callRoots[0]
          ? this.analysis
              .outgoingCalls(base.callRoots[0], cancellation.token)
              .then((calls) => calls.length)
              .catch(() => undefined)
          : undefined,
      ]);
      if (generation !== this.generation || cancellation.token.isCancellationRequested) {
        return undefined;
      }
      const context: SymbolContext = {
        ...base,
        references,
        incomingCount,
        outgoingCount,
        detailsPending: false,
        referencesRequested: demand.references,
        incomingRequested: demand.incomingCount,
        outgoingRequested: demand.outgoingCount,
      };
      this.current = { uri, position };
      this.views.updateContext(context, intent);
      return context;
    } catch (error) {
      if (
        generation === this.generation &&
        !cancellation.token.isCancellationRequested
      ) {
        this.output.appendLine(`Context query failed: ${String(error)}`);
        this.views.referencesFailed(error);
      }
      return undefined;
    } finally {
      if (this.cancellation === cancellation) {
        this.cancellation = undefined;
      }
      cancellation.dispose();
    }
  }

  dispose(): void {
    this.cancelPending();
    this.disposables.forEach((item) => item.dispose());
  }

  private async resolveBase(
    uri: vscode.Uri,
    position: vscode.Position,
    generation: number,
    token: vscode.CancellationToken,
    demand: CursorQueryDemand,
    definitionRequest?: Promise<LocationResult[]>,
  ): Promise<SymbolContext | undefined> {
    const [definitions, declarations, callRoots, hover, symbolInfo] =
      await Promise.all([
        demand.definitions
          ? definitionRequest ?? this.analysis.definition(uri, position, token)
          : [],
        demand.declarations
          ? this.analysis.declaration(uri, position, token)
          : [],
        demand.callRoots
          ? this.analysis.prepareCallHierarchy(uri, position, token).catch(() => [])
          : [],
        demand.hover
          ? this.analysis.hover(uri, position, token).catch(() => undefined)
          : undefined,
        demand.symbolInfo
          ? this.analysis.symbolInfo(uri, position, token).catch(() => undefined)
          : undefined,
      ]);
    if (generation !== this.generation || token.isCancellationRequested) {
      return undefined;
    }
    const name = symbolInfo?.name ?? callRoots[0]?.raw.name;
    const qualifiedName =
      symbolInfo?.containerName && name
        ? `${symbolInfo.containerName}::${name}`
        : name;
    return {
      uri,
      position,
      generation,
      definitions,
      declarations,
      references: [],
      callRoots,
      hover,
      name,
      qualifiedName,
      symbolId: symbolInfo?.id,
      detailsPending: true,
      referencesRequested: demand.references,
      incomingRequested: demand.incomingCount,
      outgoingRequested: demand.outgoingCount,
    };
  }

  private async resolveCursor(
    uri: vscode.Uri,
    position: vscode.Position,
    generation: number,
    intent: ViewUpdateIntent,
  ): Promise<void> {
    const cancellation = new vscode.CancellationTokenSource();
    this.cancellation = cancellation;
    // cpptools Call Hierarchy is substantially heavier than the other public
    // providers. Microsoft mode only prepares roots for visible hierarchy
    // views and lets tree expansion request one direction at a time.
    const demand = cursorQueryDemandForEngine(
      this.views.navigationVisibility,
      this.analysis.analysisEngine,
    );
    if (!demand.active) {
      cancellation.dispose();
      this.cancellation = undefined;
      return;
    }
    try {
      const definitionRequest = demand.definitions
        ? this.analysis.definition(uri, position, cancellation.token).catch((error) => {
            if (!cancellation.token.isCancellationRequested) {
              this.output.appendLine(`Definition preview query failed: ${String(error)}`);
            }
            return [];
          })
        : Promise.resolve([]);
      void definitionRequest.then((definitions) => {
        if (
          definitions[0] &&
          generation === this.generation &&
          !cancellation.token.isCancellationRequested
        ) {
          void this.views.preview.showLocation(
            definitions[0],
            "definition",
            "Definition",
            "context",
          );
        }
      });
      const base = await this.resolveBase(
        uri,
        position,
        generation,
        cancellation.token,
        demand,
        definitionRequest,
      );
      if (!base) {
        return;
      }
      this.current = { uri, position };
      if (
        !demand.references &&
        !demand.incomingCount &&
        !demand.outgoingCount
      ) {
        this.views.updateContext(
          { ...base, detailsPending: false },
          intent,
        );
        if (this.cancellation === cancellation) {
          this.cancellation = undefined;
        }
        cancellation.dispose();
        return;
      }
      this.views.updateContext(base, intent);
      const detailDelay = readConfiguration().followCursorDetailsDelay;
      this.detailsTimer = setTimeout(() => {
        void this.resolveDetails(base, cancellation, intent, demand);
      }, detailDelay);
    } catch (error) {
      if (
        generation === this.generation &&
        !cancellation.token.isCancellationRequested
      ) {
        this.output.appendLine(`Context query failed: ${String(error)}`);
      }
      if (this.cancellation === cancellation) {
        this.cancellation = undefined;
      }
      cancellation.dispose();
    }
  }

  private async resolveDetails(
    base: SymbolContext,
    cancellation: vscode.CancellationTokenSource,
    intent: ViewUpdateIntent,
    demand: CursorQueryDemand,
  ): Promise<void> {
    const config = readConfiguration();
    try {
      const [references, incomingCount, outgoingCount] = await Promise.all([
        demand.references
          ? this.analysis.references(
              base.uri,
              base.position,
              config.includeDeclarationInReferences,
              cancellation.token,
            )
          : [],
        demand.incomingCount &&
        this.analysis.analysisEngine !== "microsoft" &&
        base.callRoots[0]
          ? this.analysis
              .incomingCalls(base.callRoots[0], cancellation.token)
              .then((calls) => calls.length)
              .catch(() => undefined)
          : undefined,
        demand.outgoingCount &&
        this.analysis.analysisEngine !== "microsoft" &&
        base.callRoots[0]
          ? this.analysis
              .outgoingCalls(base.callRoots[0], cancellation.token)
              .then((calls) => calls.length)
              .catch(() => undefined)
          : undefined,
      ]);
      if (
        base.generation !== this.generation ||
        cancellation.token.isCancellationRequested
      ) {
        return;
      }
      this.views.updateContext(
        {
          ...base,
          references,
          incomingCount,
          outgoingCount,
          detailsPending: false,
        },
        intent,
      );
    } catch (error) {
      if (
        base.generation === this.generation &&
        !cancellation.token.isCancellationRequested
      ) {
        this.output.appendLine(`Context details failed: ${String(error)}`);
        this.views.referencesFailed(error);
      }
    } finally {
      if (this.cancellation === cancellation) {
        this.cancellation = undefined;
      }
      cancellation.dispose();
    }
  }

  private cancelPending(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.detailsTimer) {
      clearTimeout(this.detailsTimer);
      this.detailsTimer = undefined;
    }
    this.cancellation?.cancel();
    this.cancellation?.dispose();
    this.cancellation = undefined;
  }


  private schedule(
    document: vscode.TextDocument,
    position: vscode.Position,
    immediate = false,
    intent: ViewUpdateIntent = {},
  ): void {
    const manual =
      intent.manualReferences || intent.manualCallHierarchy;
    if (
      (this.pinned || !readConfiguration().followCursor) &&
      !manual
    ) {
      return;
    }
    if (!manual && !this.views.navigationVisible) {
      this.cancelPending();
      return;
    }
    if (!isCppDocument(document) || document.uri.scheme !== "file") {
      this.cancelPending();
      this.generation += 1;
      this.views.clearContext();
      return;
    }
    this.cancelPending();
    const generation = ++this.generation;
    const delay = immediate ? 0 : readConfiguration().followCursorDelay;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.resolveCursor(document.uri, position, generation, intent);
    }, delay);
  }
}

function fullDemand(): CursorQueryDemand {
  return {
    active: true,
    definitions: true,
    declarations: true,
    callRoots: true,
    hover: true,
    symbolInfo: true,
    references: true,
    incomingCount: true,
    outgoingCount: true,
  };
}

function manualDemand(intent: ViewUpdateIntent): CursorQueryDemand {
  if (!intent.manualCallDirection) {
    return fullDemand();
  }
  return {
    active: true,
    definitions: true,
    declarations: false,
    callRoots: true,
    hover: false,
    symbolInfo: false,
    references: false,
    incomingCount: intent.manualCallDirection === "incoming",
    outgoingCount: intent.manualCallDirection === "outgoing",
  };
}
