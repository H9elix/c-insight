import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import {
  isCppDocument,
  readConfiguration,
} from "../configuration/configuration";
import { SymbolContext, ViewUpdateIntent } from "../models/types";
import { ViewRegistry } from "../views/viewRegistry";

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
      this.views.onDidChangeNavigationVisibility(() => {
        if (this.views.navigationVisible && this.current) {
          const editor = vscode.window.activeTextEditor;
          if (editor && editor.document.uri.toString() === this.current.uri.toString()) {
            this.schedule(editor.document, editor.selection.active, true);
          }
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
    void vscode.commands.executeCommand("setContext", "cInsight.pinned", true);
  }

  unpin(): void {
    this.pinned = false;
    void vscode.commands.executeCommand("setContext", "cInsight.pinned", false);
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
    try {
      const base = await this.resolveBase(
        uri,
        position,
        generation,
        cancellation.token,
      );
      if (!base || generation !== this.generation) {
        return undefined;
      }
      const [references, incomingCount, outgoingCount] = await Promise.all([
        this.analysis.references(
          uri,
          position,
          config.includeDeclarationInReferences,
          cancellation.token,
        ),
        base.callRoots[0]
          ? this.analysis
              .incomingCalls(base.callRoots[0], cancellation.token)
              .then((calls) => calls.length)
              .catch(() => undefined)
          : undefined,
        base.callRoots[0]
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
  ): Promise<SymbolContext | undefined> {
    const [definitions, declarations, callRoots, hover, symbolInfo] =
      await Promise.all([
        this.analysis.definition(uri, position, token),
        this.analysis.declaration(uri, position, token),
        this.analysis.prepareCallHierarchy(uri, position, token).catch(() => []),
        this.analysis.hover(uri, position, token).catch(() => undefined),
        this.analysis.symbolInfo(uri, position, token).catch(() => undefined),
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
    try {
      const base = await this.resolveBase(
        uri,
        position,
        generation,
        cancellation.token,
      );
      if (!base) {
        return;
      }
      this.current = { uri, position };
      this.views.updateContext(base, intent);
      if (!this.views.navigationVisible) {
        if (this.cancellation === cancellation) {
          this.cancellation = undefined;
        }
        cancellation.dispose();
        return;
      }
      const detailDelay = readConfiguration().followCursorDetailsDelay;
      this.detailsTimer = setTimeout(() => {
        void this.resolveDetails(base, cancellation, intent);
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
  ): Promise<void> {
    const config = readConfiguration();
    try {
      const [references, incomingCount, outgoingCount] = await Promise.all([
        this.analysis.references(
          base.uri,
          base.position,
          config.includeDeclarationInReferences,
          cancellation.token,
        ),
        base.callRoots[0]
          ? this.analysis
              .incomingCalls(base.callRoots[0], cancellation.token)
              .then((calls) => calls.length)
              .catch(() => undefined)
          : undefined,
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
