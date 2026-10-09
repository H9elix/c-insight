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
import {
  CursorFollowInputKind,
  CursorFollowSuppression,
} from "../utils/cursorFollowSuppression";
import {
  hasCursorSymbolEvidence,
  shouldPreserveResultsForEmptyCursor,
} from "./cursorSymbolEvidence";
import { CallHierarchyRepository } from "../callHierarchy/callHierarchyRepository";
import {
  CursorRefreshAnchor,
  CursorRefreshModel,
  EditSelectionGuard,
} from "./cursorRefreshModel";
import { runtimeDiagnostics } from "../diagnostics/runtimeDiagnostics";

export class ContextController implements vscode.Disposable {
  private static readonly definitionRetryDelays = [2_000, 10_000];
  private timer?: NodeJS.Timeout;
  private detailsTimer?: NodeJS.Timeout;
  private cancellation?: vscode.CancellationTokenSource;
  private definitionRefreshCancellation?: vscode.CancellationTokenSource;
  private readonly definitionRetryTimers = new Set<NodeJS.Timeout>();
  private generation = 0;
  private pinned = false;
  private current?: {
    uri: vscode.Uri;
    position: vscode.Position;
    generation: number;
  };
  private readonly cursorFollowSuppression = new CursorFollowSuppression();
  private readonly cursorRefresh = new CursorRefreshModel();
  private readonly editSelectionGuard = new EditSelectionGuard();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly analysis: AnalysisService,
    private readonly callRepository: CallHierarchyRepository,
    private readonly views: ViewRegistry,
    private readonly output: vscode.OutputChannel,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          const position = event.selections[0].active;
          if (
            this.cursorFollowSuppression.suppressSelection(
              cursorTarget(event.textEditor.document.uri, position),
              selectionInputKind(event.kind),
            )
          ) {
            return;
          }
          if (
            this.isEditInducedSelection(
              event.textEditor.document,
              position,
            )
          ) {
            return;
          }
          this.scheduleSelection(event.textEditor.document, position);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.editSelectionGuard.clear();
          if (
            this.cursorFollowSuppression.suppressActiveEditor(
              editor.document.uri.toString(),
            )
          ) {
            return;
          }
          const anchor = cursorRefreshAnchor(
            editor.document,
            editor.selection.active,
          );
          this.cursorRefresh.track(anchor);
          this.schedule(editor.document, editor.selection.active, true, {}, anchor);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === event.document) {
          this.documentChanged(event);
        }
      }),
      this.views.onDidChangeNavigationVisibility((id) => {
        if (id === VIEWS.SYMBOLS) {
          return;
        }
        if (this.views.navigationVisible) {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            if (
              this.cursorFollowSuppression.suppressAutomaticUpdate(
                editor.document.uri.toString(),
              )
            ) {
              return;
            }
            const anchor = cursorRefreshAnchor(
              editor.document,
              editor.selection.active,
            );
            this.cursorRefresh.track(anchor);
            this.schedule(
              editor.document,
              editor.selection.active,
              true,
              {},
              anchor,
            );
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
      const anchor = cursorRefreshAnchor(
        editor.document,
        editor.selection.active,
      );
      this.cursorRefresh.track(anchor);
      this.schedule(editor.document, editor.selection.active, true, {}, anchor);
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
      if (manual) {
        this.editSelectionGuard.clear();
      }
      const anchor = cursorRefreshAnchor(
        editor.document,
        editor.selection.active,
      );
      this.cursorRefresh.track(anchor);
      this.schedule(
        editor.document,
        editor.selection.active,
        true,
        manual
          ? { manualReferences: true, manualCallHierarchy: true }
          : undefined,
        anchor,
      );
    }
  }

  async refreshPreferredDefinitionLocations(): Promise<boolean> {
    const current = this.current;
    if (
      this.pinned ||
      !current ||
      current.generation !== this.generation ||
      !this.views.navigationVisible ||
      !this.views.preferredDefinitionNeedsUpgrade ||
      this.cursorFollowSuppression.suppressAutomaticUpdate(
        current.uri.toString(),
      )
    ) {
      return false;
    }
    this.definitionRefreshCancellation?.cancel();
    this.definitionRefreshCancellation?.dispose();
    const cancellation = new vscode.CancellationTokenSource();
    this.definitionRefreshCancellation = cancellation;
    const generation = this.generation;
    try {
      const [definitions, declarations] = await Promise.all([
        this.analysis.definition(
          current.uri,
          current.position,
          cancellation.token,
        ),
        this.analysis.declaration(
          current.uri,
          current.position,
          cancellation.token,
        ),
      ]);
      if (
        cancellation.token.isCancellationRequested ||
        generation !== this.generation ||
        current !== this.current
      ) {
        return false;
      }
      const upgraded = await this.views.updatePreferredDefinitionLocations(
        definitions,
        declarations,
      );
      if (upgraded) {
        this.clearDefinitionRetryTimers();
      }
      return upgraded;
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        this.output.appendLine(
          `Preferred definition refresh failed: ${String(error)}`,
        );
      }
      return false;
    } finally {
      if (this.definitionRefreshCancellation === cancellation) {
        this.definitionRefreshCancellation = undefined;
      }
      cancellation.dispose();
    }
  }

  beginProgrammaticNavigation(
    location: LocationResult,
  ): number {
    this.editSelectionGuard.clear();
    this.cancelPending();
    this.generation += 1;
    return this.cursorFollowSuppression.begin(
      cursorTarget(location.uri, location.range.start),
    );
  }

  completeProgrammaticNavigation(token: number): void {
    this.cursorFollowSuppression.complete(token);
  }

  cancelProgrammaticNavigation(token: number): void {
    this.cursorFollowSuppression.cancel(token);
  }

  async resolveNow(
    uri: vscode.Uri,
    position: vscode.Position,
    intent: ViewUpdateIntent = {},
  ): Promise<SymbolContext | undefined> {
    this.editSelectionGuard.clear();
    if (intent.manualCallHierarchy) {
      this.views.invalidateCallHierarchy();
    }
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
          ? this.callRepository
              .incoming(base.callRoots[0], cancellation.token)
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
      this.current = { uri, position, generation };
      this.views.updateContext(context, intent);
      this.schedulePreferredDefinitionRetries(generation);
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
    this.editSelectionGuard.clear();
    this.cursorRefresh.clear();
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
          ? this.callRepository.prepare(uri, position, token).catch(() => [])
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
    anchor?: CursorRefreshAnchor,
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
      this.cursorRefresh.recordResult(anchor, hasCursorSymbolEvidence(base));
      if (shouldPreserveResultsForEmptyCursor(base, intent)) {
        if (this.cancellation === cancellation) {
          this.cancellation = undefined;
        }
        cancellation.dispose();
        return;
      }
      this.current = { uri, position, generation };
      if (
        !demand.references &&
        !demand.incomingCount &&
        !demand.outgoingCount
      ) {
        this.views.updateContext(
          { ...base, detailsPending: false },
          intent,
        );
        this.schedulePreferredDefinitionRetries(generation);
        if (this.cancellation === cancellation) {
          this.cancellation = undefined;
        }
        cancellation.dispose();
        return;
      }
      this.views.updateContext(base, intent);
      this.schedulePreferredDefinitionRetries(generation);
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
          ? this.callRepository
              .incoming(base.callRoots[0], cancellation.token)
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
    this.definitionRefreshCancellation?.cancel();
    this.definitionRefreshCancellation?.dispose();
    this.definitionRefreshCancellation = undefined;
    this.clearDefinitionRetryTimers();
  }

  private schedulePreferredDefinitionRetries(generation: number): void {
    this.clearDefinitionRetryTimers();
    if (!this.views.preferredDefinitionNeedsUpgrade) {
      return;
    }
    for (const delay of ContextController.definitionRetryDelays) {
      const timer = setTimeout(() => {
        this.definitionRetryTimers.delete(timer);
        if (
          generation === this.generation &&
          this.views.preferredDefinitionNeedsUpgrade
        ) {
          void this.refreshPreferredDefinitionLocations();
        }
      }, delay);
      this.definitionRetryTimers.add(timer);
    }
  }

  private clearDefinitionRetryTimers(): void {
    for (const timer of this.definitionRetryTimers) {
      clearTimeout(timer);
    }
    this.definitionRetryTimers.clear();
  }


  private schedule(
    document: vscode.TextDocument,
    position: vscode.Position,
    immediate = false,
    intent: ViewUpdateIntent = {},
    anchor?: CursorRefreshAnchor,
  ): void {
    const manual =
      intent.manualReferences || intent.manualCallHierarchy;
    if (intent.manualCallHierarchy) {
      this.views.invalidateCallHierarchy();
    }
    if (
      !manual &&
      this.editSelectionGuard.blocksAutomatic(
        document.uri.toString(),
        document.version,
      )
    ) {
      runtimeDiagnostics.increment(
        "navigation.editAutomaticRefreshSuppressed",
      );
      return;
    }
    if (
      !manual &&
      this.cursorFollowSuppression.suppressAutomaticUpdate(
        document.uri.toString(),
      )
    ) {
      return;
    }
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
      void this.resolveCursor(document.uri, position, generation, intent, anchor);
    }, delay);
  }

  private scheduleSelection(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): void {
    const anchor = cursorRefreshAnchor(document, position);
    const decision = this.cursorRefresh.decide(anchor);
    if (decision === "unchanged") {
      runtimeDiagnostics.increment("navigation.cursor.sameTargetSuppressed");
      return;
    }
    if (decision === "preserve") {
      this.cancelPending();
      this.generation += 1;
      runtimeDiagnostics.increment("navigation.cursor.noTargetSuppressed");
      return;
    }
    this.schedule(document, position, false, {}, anchor);
  }

  private documentChanged(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    this.cancelPending();
    this.generation += 1;
    runtimeDiagnostics.increment("navigation.editRefreshSuppressed");
    const active = vscode.window.activeTextEditor?.selection.active;
    const positions = new Set<string>();
    if (active) {
      positions.add(positionKey(active.line, active.character));
    }
    for (const change of event.contentChanges) {
      positions.add(positionAfterChange(change));
    }
    this.editSelectionGuard.begin(
      document.uri.toString(),
      document.version,
      positions,
    );
    this.cursorRefresh.documentChanged(document.uri.toString());
  }

  private isEditInducedSelection(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): boolean {
    const matches = this.editSelectionGuard.shouldSuppress(
      document.uri.toString(),
      document.version,
      positionKey(position.line, position.character),
    );
    if (matches) {
      runtimeDiagnostics.increment(
        "navigation.cursor.editSelectionSuppressed",
      );
    }
    return matches;
  }
}

function positionAfterChange(change: vscode.TextDocumentContentChangeEvent): string {
  const lines = change.text.split(/\r?\n/);
  const line = change.range.start.line + lines.length - 1;
  const character = lines.length === 1
    ? change.range.start.character + lines[0].length
    : lines.at(-1)?.length ?? 0;
  return positionKey(line, character);
}

function positionKey(line: number, character: number): string {
  return `${line}:${character}`;
}

function cursorRefreshAnchor(
  document: vscode.TextDocument,
  position: vscode.Position,
): CursorRefreshAnchor | undefined {
  if (position.line < 0 || position.line >= document.lineCount) {
    return undefined;
  }
  const word = document.getWordRangeAtPosition(
    position,
    /[A-Za-z_][A-Za-z0-9_]*/,
  );
  if (word) {
    return refreshAnchor(document, word);
  }
  const line = document.lineAt(position.line).text;
  const character = line[position.character];
  if (character === undefined || /\s/.test(character)) {
    return undefined;
  }
  return refreshAnchor(
    document,
    new vscode.Range(
      position.line,
      position.character,
      position.line,
      position.character + 1,
    ),
  );
}

function refreshAnchor(
  document: vscode.TextDocument,
  range: vscode.Range,
): CursorRefreshAnchor {
  return {
    uri: document.uri.toString(),
    version: document.version,
    startLine: range.start.line,
    startCharacter: range.start.character,
    endLine: range.end.line,
    endCharacter: range.end.character,
  };
}

function cursorTarget(
  uri: vscode.Uri,
  position: vscode.Position,
): { uri: string; line: number; character: number } {
  return {
    uri: uri.toString(),
    line: position.line,
    character: position.character,
  };
}

function selectionInputKind(
  kind: vscode.TextEditorSelectionChangeKind | undefined,
): CursorFollowInputKind {
  switch (kind) {
    case vscode.TextEditorSelectionChangeKind.Keyboard:
      return "keyboard";
    case vscode.TextEditorSelectionChangeKind.Mouse:
      return "mouse";
    case vscode.TextEditorSelectionChangeKind.Command:
      return "command";
    default:
      return "unknown";
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
    declarations: true,
    callRoots: true,
    hover: false,
    symbolInfo: false,
    references: false,
    incomingCount: intent.manualCallDirection === "incoming",
    outgoingCount: intent.manualCallDirection === "outgoing",
  };
}
