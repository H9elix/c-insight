import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { CONTEXT_KEYS } from "../ids";
import { AnalysisService } from "../analysis/analysisService";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import {
  NavigationMode,
  NavigationSource,
} from "../history/navigationHistoryModel";
import { LocationResult } from "../models/types";
import type { PreviewSessionState } from "../session/workspaceSession";
import { runtimeDiagnostics } from "../diagnostics/runtimeDiagnostics";
import {
  expandPreviewRange,
  PreviewLoadDirection,
  restorePreviewRange,
} from "./previewRange";
import {
  escapeHtml,
  decodeSemanticTokens,
  highlightCppLine,
  highlightSemanticLine,
  highlightTarget,
  SemanticTokenSpan,
} from "./sourceHighlight";
import { PreviewClearGuard } from "./previewClearGuard";
export type PreviewMode = NavigationMode;

interface PreviewState {
  mode: PreviewMode;
  title: string;
  location: LocationResult;
}

interface RenderedDocument {
  document: vscode.TextDocument;
  startLine: number;
  endLine: number;
}

interface PreviewMessage {
  type?: unknown;
  line?: unknown;
  character?: unknown;
  selection?: unknown;
  direction?: unknown;
  anchorLine?: unknown;
  anchorOffset?: unknown;
  scrollLeft?: unknown;
}

interface SemanticTokenDocument {
  data: Uint32Array;
  legend: vscode.SemanticTokensLegend;
}

interface SemanticTokenCacheEntry {
  promise: Promise<SemanticTokenDocument | undefined>;
  byteLength?: number;
}

interface PreviewScrollState {
  startLine: number;
  endLine: number;
  anchorLine: number;
  anchorOffset: number;
  scrollLeft: number;
}

export class CodePreviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view?: vscode.WebviewView;
  private state?: PreviewState;
  private rendered?: RenderedDocument;
  private locked = false;
  private definitionGeneration = 0;
  private definitionCancellation?: vscode.CancellationTokenSource;
  private renderGeneration = 0;
  private loadingMore = false;
  private readonly semanticTokens = new Map<
    string,
    SemanticTokenCacheEntry
  >();
  private readonly scrollStates = new Map<string, PreviewScrollState>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly visibilityEmitter = new vscode.EventEmitter<void>();
  private readonly clearGuard = new PreviewClearGuard();
  readonly onDidChangeVisibility = this.visibilityEmitter.event;

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  constructor(
    private readonly analysis: AnalysisService,
    private readonly navigationHistory: NavigationHistoryExplorer,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (this.visible) {
          void this.render();
        }
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: PreviewMessage) => {
        void this.receiveMessage(message).catch((error: unknown) => {
          void vscode.window.showErrorMessage(
            vscode.l10n.t("C Insight Code Preview action failed: {error}", { error: String(error) }),
          );
        });
      }),
      view.onDidDispose(() => {
        if (this.view === view) {
          this.view = undefined;
          this.rendered = undefined;
          this.visibilityEmitter.fire();
        }
      }),
      view.onDidChangeVisibility(() => this.visibilityEmitter.fire()),
    );
    this.visibilityEmitter.fire();
    void this.render();
  }

  async showLocation(
    location: LocationResult,
    mode: PreviewMode,
    title?: string,
    source: NavigationSource = "selection",
  ): Promise<void> {
    if (source === "context" && this.locked) {
      return;
    }
    const next: PreviewState = {
      location,
      mode,
      title: title ?? previewModeLabel(mode),
    };
    const sameTarget = this.state?.mode === mode &&
      this.state.location.uri.toString() === location.uri.toString() &&
      this.state.location.range.isEqual(location.range);
    if (!sameTarget) {
      this.navigationHistory.record(location, mode, next.title, source);
    }
    this.state = next;
    await this.render();
  }

  clear(): void {
    if (this.locked || this.clearGuard.shouldPreserve()) {
      return;
    }
    this.cancelDefinition();
    this.state = undefined;
    this.rendered = undefined;
    if (this.view) {
      this.view.webview.html = emptyHtml();
    }
  }

  refresh(): void {
    this.semanticTokens.clear();
    void this.render();
  }

  preserveForEditorOpen(): void {
    this.clearGuard.arm();
  }

  handleDocumentChange(document: vscode.TextDocument): void {
    const prefix = `${document.uri.toString()}\0`;
    for (const key of this.semanticTokens.keys()) {
      if (key.startsWith(prefix)) {
        this.semanticTokens.delete(key);
      }
    }
    for (const key of this.scrollStates.keys()) {
      if (key.startsWith(prefix)) {
        this.scrollStates.delete(key);
      }
    }
    if (this.visible && this.state?.location.uri.toString() === document.uri.toString()) {
      void this.render();
    }
  }

  sessionState(): PreviewSessionState | undefined {
    if (!this.state) {
      return undefined;
    }
    return {
      uri: this.state.location.uri.toString(),
      range: serializeRange(this.state.location.range),
      mode: this.state.mode,
      title: this.state.title,
      locked: this.locked,
    };
  }

  async restoreSession(state: PreviewSessionState | undefined): Promise<void> {
    if (!state) {
      return;
    }
    this.locked = state.locked;
    await vscode.commands.executeCommand(
      "setContext",
      CONTEXT_KEYS.PREVIEW_LOCKED,
      this.locked,
    );
    this.state = {
      location: {
        uri: vscode.Uri.parse(state.uri),
        range: new vscode.Range(
          state.range.start.line,
          state.range.start.character,
          state.range.end.line,
          state.range.end.character,
        ),
      },
      mode: state.mode,
      title: state.title,
    };
    await this.render();
  }

  dispose(): void {
    this.renderGeneration += 1;
    this.cancelDefinition();
    this.disposables.forEach((item) => item.dispose());
    this.visibilityEmitter.dispose();
    this.view = undefined;
  }

  private async receiveMessage(message: PreviewMessage): Promise<void> {
    switch (message.type) {
      case "previewDefinition": {
        const position = this.validPosition(message);
        if (position) {
          await this.followDefinition(position);
        }
        break;
      }
      case "openPosition": {
        const position = this.validPosition(message);
        if (position && this.rendered) {
          this.cancelDefinition();
          this.clearGuard.arm();
          await openEditor(this.rendered.document, position);
        }
        break;
      }
      case "back":
        await this.moveHistory(-1);
        break;
      case "forward":
        await this.moveHistory(1);
        break;
      case "toggleLock":
        this.locked = !this.locked;
        await vscode.commands.executeCommand(
          "setContext",
          CONTEXT_KEYS.PREVIEW_LOCKED,
          this.locked,
        );
        await this.render();
        break;
      case "openCurrent":
        if (this.state) {
          const document = await vscode.workspace.openTextDocument(
            this.state.location.uri,
          );
          this.clearGuard.arm();
          await openEditor(document, this.state.location.range.start);
        }
        break;
      case "copyPath":
        if (this.state) {
          await vscode.env.clipboard.writeText(
            `${this.state.location.uri.fsPath}:${this.state.location.range.start.line + 1}`,
          );
        }
        break;
      case "copyCode":
        await this.copyCode(
          typeof message.selection === "string"
            ? message.selection
            : undefined,
        );
        break;
      case "loadMore":
        if (message.direction === "before" || message.direction === "after") {
          await this.loadMore(message.direction);
        }
        break;
      case "saveScroll":
        this.saveScrollState(message);
        break;
    }
  }

  private validPosition(message: PreviewMessage): vscode.Position | undefined {
    if (
      !this.rendered ||
      !Number.isInteger(message.line) ||
      !Number.isInteger(message.character)
    ) {
      return undefined;
    }
    const line = message.line as number;
    const character = message.character as number;
    if (
      line < this.rendered.startLine ||
      line > this.rendered.endLine ||
      character < 0
    ) {
      return undefined;
    }
    const text = this.rendered.document.lineAt(line).text;
    if (character > text.length) {
      return undefined;
    }
    return new vscode.Position(line, character);
  }

  async followDefinition(position: vscode.Position): Promise<void> {
    if (!this.rendered) {
      return;
    }
    this.cancelDefinition();
    const generation = ++this.definitionGeneration;
    const cancellation = new vscode.CancellationTokenSource();
    this.definitionCancellation = cancellation;
    const sourceDocument = this.rendered.document;
    try {
      const definitions = await this.analysis.definition(
        sourceDocument.uri,
        position,
        cancellation.token,
      );
      if (
        generation !== this.definitionGeneration ||
        cancellation.token.isCancellationRequested ||
        definitions.length === 0
      ) {
        return;
      }
      const wordRange = sourceDocument.getWordRangeAtPosition(position);
      const word = wordRange ? sourceDocument.getText(wordRange) : "";
      await this.showLocation(
        definitions[0],
        "definition",
        word || "Definition",
        "interaction",
      );
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        throw error;
      }
    } finally {
      if (this.definitionCancellation === cancellation) {
        this.definitionCancellation = undefined;
      }
      cancellation.dispose();
    }
  }

  private cancelDefinition(): void {
    this.definitionGeneration += 1;
    this.definitionCancellation?.cancel();
    this.definitionCancellation?.dispose();
    this.definitionCancellation = undefined;
  }

  private async moveHistory(delta: -1 | 1): Promise<void> {
    const entry =
      delta < 0
        ? this.navigationHistory.back()
        : this.navigationHistory.forward();
    if (!entry) {
      return;
    }
    this.cancelDefinition();
    this.state = {
      location: this.navigationHistory.entryLocation(entry),
      mode: entry.mode,
      title: entry.title,
    };
    await this.render();
  }

  private async copyCode(selection?: string): Promise<void> {
    if (selection) {
      await vscode.env.clipboard.writeText(selection);
      return;
    }
    if (!this.rendered) {
      return;
    }
    const lines: string[] = [];
    for (
      let line = this.rendered.startLine;
      line <= this.rendered.endLine;
      line += 1
    ) {
      lines.push(this.rendered.document.lineAt(line).text);
    }
    await vscode.env.clipboard.writeText(lines.join("\n"));
  }

  private async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    if (!this.view) {
      return;
    }
    if (!this.state) {
      this.rendered = undefined;
      this.view.webview.html = emptyHtml();
      return;
    }
    const { location, mode, title } = this.state;
    try {
      const document = await vscode.workspace.openTextDocument(location.uri);
      const config = vscode.workspace.getConfiguration("cInsight.codePreview");
      const linesBefore = config.get<number>("linesBefore", 6);
      const linesAfter = config.get<number>("linesAfter", 8);
      const targetLine = location.range.start.line;
      let startLine = Math.max(0, targetLine - linesBefore);
      let endLine = Math.min(
        document.lineCount - 1,
        targetLine + linesAfter,
      );
      const maximumLoadedLines = Math.max(
        1,
        Math.floor(config.get<number>("maximumLoadedLines", 1000)),
      );
      const scrollKey = previewScrollKey(this.state);
      const savedScroll = config.get<boolean>("restoreScrollPositions", true)
        ? this.scrollStates.get(scrollKey)
        : undefined;
      const restoredRange = savedScroll
        ? restorePreviewRange(
            savedScroll,
            document.lineCount - 1,
            maximumLoadedLines,
          )
        : undefined;
      if (restoredRange) {
        startLine = restoredRange.startLine;
        endLine = restoredRange.endLine;
      }
      if (endLine - startLine + 1 > maximumLoadedLines) {
        startLine = Math.max(
          0,
          targetLine - Math.min(linesBefore, maximumLoadedLines - 1),
        );
        endLine = Math.min(
          document.lineCount - 1,
          startLine + maximumLoadedLines - 1,
        );
        startLine = Math.max(0, endLine - maximumLoadedLines + 1);
      }
      const semanticHighlighting = config.get<boolean>(
        "semanticHighlighting",
        true,
      );
      const tokens = semanticHighlighting
        ? await this.semanticTokensFor(document, startLine, endLine)
        : undefined;
      if (generation !== this.renderGeneration || !this.view) {
        return;
      }
      this.rendered = { document, startLine, endLine };
      const lines = renderSourceLines(
        document,
        startLine,
        endLine,
        location.range,
        tokens,
      );
      const relative = vscode.workspace.asRelativePath(location.uri);
      const nonce = randomBytes(16).toString("base64");
      this.view.webview.html = htmlDocument(
        `${previewModeLabel(mode)} · ${escapeHtml(title)}`,
        `${escapeHtml(relative)}:${targetLine + 1}`,
        lines,
        nonce,
        {
          back: this.navigationHistory.canBack,
          forward: this.navigationHistory.canForward,
          locked: this.locked,
        },
        {
          enabled: config.get<boolean>("incrementalLoading", true),
          hasBefore: startLine > 0,
          hasAfter: endLine < document.lineCount - 1,
          startLine,
          endLine,
          totalLines: document.lineCount,
          scroll: savedScroll,
        },
      );
    } catch (error) {
      this.rendered = undefined;
      this.view.webview.html = errorHtml(String(error));
    }
  }

  private async loadMore(direction: PreviewLoadDirection): Promise<void> {
    if (this.loadingMore || !this.view || !this.rendered || !this.state) {
      return;
    }
    const config = vscode.workspace.getConfiguration("cInsight.codePreview");
    if (!config.get<boolean>("incrementalLoading", true)) {
      return;
    }
    const rendered = this.rendered;
    const expansion = expandPreviewRange(
      rendered,
      direction,
      config.get<number>("loadBatchLines", 50),
      config.get<number>("maximumLoadedLines", 1000),
      rendered.document.lineCount - 1,
    );
    if (!expansion) {
      await this.view.webview.postMessage({
        type: "incrementalLines",
        direction,
        html: "",
        startLine: rendered.startLine,
        endLine: rendered.endLine,
        hasBefore: rendered.startLine > 0,
        hasAfter: rendered.endLine < rendered.document.lineCount - 1,
        totalLines: rendered.document.lineCount,
      });
      return;
    }
    this.loadingMore = true;
    try {
      const semanticHighlighting = config.get<boolean>(
        "semanticHighlighting",
        true,
      );
      const tokens = semanticHighlighting
        ? await this.semanticTokensFor(
            rendered.document,
            expansion.addedStartLine,
            expansion.addedEndLine,
          )
        : undefined;
      if (
        this.rendered !== rendered ||
        !this.view ||
        this.state.location.uri.toString() !==
          rendered.document.uri.toString()
      ) {
        return;
      }
      const html = renderSourceLines(
        rendered.document,
        expansion.addedStartLine,
        expansion.addedEndLine,
        this.state.location.range,
        tokens,
      );
      rendered.startLine = expansion.startLine;
      rendered.endLine = expansion.endLine;
      await this.view.webview.postMessage({
        type: "incrementalLines",
        direction,
        html,
        startLine: expansion.startLine,
        endLine: expansion.endLine,
        hasBefore: expansion.startLine > 0,
        hasAfter: expansion.endLine < rendered.document.lineCount - 1,
        totalLines: rendered.document.lineCount,
      });
    } catch (error) {
      await this.view?.webview.postMessage({
        type: "incrementalLines",
        direction,
        error: String(error),
        startLine: rendered.startLine,
        endLine: rendered.endLine,
        hasBefore: rendered.startLine > 0,
        hasAfter: rendered.endLine < rendered.document.lineCount - 1,
        totalLines: rendered.document.lineCount,
      });
    } finally {
      this.loadingMore = false;
    }
  }

  private async semanticTokensFor(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
  ): Promise<Map<number, SemanticTokenSpan[]> | undefined> {
    const key = `${document.uri.toString()}\0${document.version}`;
    let entry = this.semanticTokens.get(key);
    if (entry) {
      this.semanticTokens.delete(key);
      this.semanticTokens.set(key, entry);
    } else {
      const promise = requestSemanticTokens(
        document,
        this.analysis.analysisEngine === "microsoft",
      );
      const created: SemanticTokenCacheEntry = { promise };
      entry = created;
      this.semanticTokens.set(key, created);
      void promise.then((result) => {
        if (this.semanticTokens.get(key) !== created) {
          return;
        }
        created.byteLength = result?.data.byteLength ?? 0;
        this.trimSemanticTokenCache();
      });
    }
    this.trimSemanticTokenCache();
    const result = await entry.promise;
    if (!result) return undefined;
    try {
      return decodeSemanticTokens(result.data, result.legend, startLine, endLine);
    } catch {
      if (this.analysis.analysisEngine === "microsoft") {
        runtimeDiagnostics.increment("microsoft.preview.semanticTokens.postProcessingFailed");
        runtimeDiagnostics.increment("microsoft.preview.lexicalFallback");
      }
      return undefined;
    }
  }

  private trimSemanticTokenCache(): void {
    const maximumEntries = vscode.workspace
      .getConfiguration("cInsight.codePreview")
      .get<number>("semanticTokenCacheSize", 32);
    const maximumBytes =
      vscode.workspace
        .getConfiguration("cInsight.codePreview")
        .get<number>("semanticTokenCacheMaximumMegabytes", 16) *
      1024 *
      1024;
    let totalBytes = [...this.semanticTokens.values()].reduce(
      (total, entry) => total + (entry.byteLength ?? 0),
      0,
    );
    while (
      this.semanticTokens.size > maximumEntries ||
      (totalBytes > maximumBytes && this.semanticTokens.size > 0)
    ) {
      const oldest = this.semanticTokens.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) {
        break;
      }
      totalBytes -= this.semanticTokens.get(oldest)?.byteLength ?? 0;
      this.semanticTokens.delete(oldest);
    }
  }

  private saveScrollState(message: PreviewMessage): void {
    if (
      !this.state ||
      !this.rendered ||
      !Number.isInteger(message.anchorLine) ||
      typeof message.anchorOffset !== "number" ||
      !Number.isFinite(message.anchorOffset) ||
      typeof message.scrollLeft !== "number" ||
      !Number.isFinite(message.scrollLeft)
    ) {
      return;
    }
    const anchorLine = message.anchorLine as number;
    if (
      anchorLine < this.rendered.startLine ||
      anchorLine > this.rendered.endLine
    ) {
      return;
    }
    const key = previewScrollKey(this.state);
    this.scrollStates.delete(key);
    this.scrollStates.set(key, {
      startLine: this.rendered.startLine,
      endLine: this.rendered.endLine,
      anchorLine,
      anchorOffset: Math.max(0, message.anchorOffset),
      scrollLeft: Math.max(0, message.scrollLeft),
    });
    const maximum = vscode.workspace
      .getConfiguration("cInsight.codePreview")
      .get<number>("maximumScrollPositions", 100);
    while (this.scrollStates.size > maximum) {
      const oldest = this.scrollStates.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) {
        break;
      }
      this.scrollStates.delete(oldest);
    }
  }
}

function previewScrollKey(state: PreviewState): string {
  const { range } = state.location;
  return [
    state.location.uri.toString(),
    state.mode,
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  ].join("\0");
}

function renderSourceLines(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
  targetRange: vscode.Range,
  tokens?: ReadonlyMap<number, readonly SemanticTokenSpan[]>,
): string {
  const lines: string[] = [];
  const targetLine = targetRange.start.line;
  for (let line = startLine; line <= endLine; line += 1) {
    const source = document.lineAt(line).text;
    lines.push(
      `<div class="line${line === targetLine ? " target" : ""}" data-line="${line}">` +
        `<span class="number">${line + 1}</span>` +
        `<code data-line="${line}">${highlightPreviewLine(source, line, targetRange, tokens?.get(line))}</code>` +
        "</div>",
    );
  }
  return lines.join("");
}

function serializeRange(range: vscode.Range): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: {
      line: range.start.line,
      character: range.start.character,
    },
    end: {
      line: range.end.line,
      character: range.end.character,
    },
  };
}

function highlightPreviewLine(
  source: string,
  line: number,
  range: vscode.Range,
  semanticTokens?: readonly SemanticTokenSpan[],
): string {
  if (semanticTokens) {
    const target =
      line >= range.start.line && line <= range.end.line
        ? {
            start: line === range.start.line ? range.start.character : 0,
            end:
              line === range.end.line ? range.end.character : source.length,
          }
        : undefined;
    return highlightSemanticLine(source, semanticTokens, target);
  }
  if (line < range.start.line || line > range.end.line) {
    return highlightCppLine(source);
  }
  const start = line === range.start.line ? range.start.character : 0;
  const end = line === range.end.line ? range.end.character : source.length;
  return highlightTarget(source, start, end);
}

async function requestSemanticTokens(
  document: vscode.TextDocument,
  microsoft: boolean,
): Promise<SemanticTokenDocument | undefined> {
  if (microsoft) runtimeDiagnostics.increment("microsoft.preview.semanticTokens.queries");
  try {
    const request = Promise.all([
      vscode.commands.executeCommand<vscode.SemanticTokensLegend | undefined>(
        "vscode.provideDocumentSemanticTokensLegend",
        document.uri,
      ),
      vscode.commands.executeCommand<vscode.SemanticTokens | undefined>(
        "vscode.provideDocumentSemanticTokens",
        document.uri,
      ),
    ]);
    const timeout = vscode.workspace
      .getConfiguration("cInsight.codePreview")
      .get<number>("semanticTokenTimeout", 1_500);
    const [legend, tokens] = await settleWithin(request, timeout);
    if (!legend || !tokens) {
      if (microsoft) {
        runtimeDiagnostics.increment("microsoft.preview.semanticTokens.empty");
        runtimeDiagnostics.increment("microsoft.preview.lexicalFallback");
      }
      return undefined;
    }
    if (microsoft) runtimeDiagnostics.increment("microsoft.preview.semanticTokens.completed");
    return { data: tokens.data, legend };
  } catch (error) {
    if (microsoft) {
      runtimeDiagnostics.increment(
        `microsoft.preview.semanticTokens.${String(error).includes("timed out") ? "timeout" : "failed"}`,
      );
      runtimeDiagnostics.increment("microsoft.preview.lexicalFallback");
    }
    return undefined;
  }
}

async function settleWithin<T>(request: PromiseLike<T>, timeout: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Semantic tokens timed out after ${timeout} ms`)),
          timeout,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function openEditor(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<void> {
  const editor = await vscode.window.showTextDocument(document, {
    preview: true,
    preserveFocus: false,
  });
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter,
  );
}

function previewModeLabel(mode: PreviewMode): string {
  switch (mode) {
    case "definition":
      return vscode.l10n.t("Definition");
    case "declaration":
      return vscode.l10n.t("Declaration");
    case "reference":
      return vscode.l10n.t("Reference");
    case "caller":
      return vscode.l10n.t("Caller");
    case "callee-definition":
      return vscode.l10n.t("Callee Definition");
    case "callee-call-site":
      return vscode.l10n.t("Callee Call Site");
  }
}

function emptyHtml(): string {
  return staticHtml(
    vscode.l10n.t("Code Preview"),
    "",
    `<p class="empty">${escapeHtml(vscode.l10n.t("Move the cursor to a symbol or select a code location."))}</p>`,
  );
}

function errorHtml(error: string): string {
  return staticHtml(
    vscode.l10n.t("Code Preview"),
    "",
    `<p class="error">${escapeHtml(error)}</p>`,
  );
}

function staticHtml(title: string, location: string, body: string): string {
  return htmlDocument(
    title,
    location,
    body,
    "",
    {
      back: false,
      forward: false,
      locked: false,
    },
    {
      enabled: false,
      hasBefore: false,
      hasAfter: false,
      startLine: 0,
      endLine: 0,
      totalLines: 0,
    },
  );
}

function htmlDocument(
  title: string,
  location: string,
  body: string,
  nonce: string,
  controls: { back: boolean; forward: boolean; locked: boolean },
  incremental: {
    enabled: boolean;
    hasBefore: boolean;
    hasAfter: boolean;
    startLine: number;
    endLine: number;
    totalLines: number;
    scroll?: PreviewScrollState;
  },
): string {
  const scriptPolicy = nonce ? ` script-src 'nonce-${nonce}';` : "";
  const text = {
    back: escapeHtml(vscode.l10n.t("Back")),
    forward: escapeHtml(vscode.l10n.t("Forward")),
    lock: escapeHtml(vscode.l10n.t("Lock preview")),
    unlock: escapeHtml(vscode.l10n.t("Unlock preview")),
    copyCode: escapeHtml(vscode.l10n.t("Copy selected text or preview code")),
    copyPath: escapeHtml(vscode.l10n.t("Copy file path and line")),
    path: escapeHtml(vscode.l10n.t("Path")),
    open: escapeHtml(vscode.l10n.t("Open current preview in editor")),
  };
  const scriptText = JSON.stringify({
    completeFile: vscode.l10n.t("Complete file"),
    startOfFile: vscode.l10n.t("Start of file"),
    endOfFile: vscode.l10n.t("End of file"),
    scrollForMore: vscode.l10n.t("Scroll for more context"),
    lines: vscode.l10n.t("Lines"),
    loadingEarlier: vscode.l10n.t("Loading earlier source lines…"),
    loadingLater: vscode.l10n.t("Loading later source lines…"),
    sourceLoadingFailed: vscode.l10n.t("Source loading failed: "),
  }).replaceAll("<", "\\u003c");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';${scriptPolicy}">
  <style>
    html, body { height: 100%; }
    body {
      box-sizing: border-box; display: flex; flex-direction: column;
      overflow: hidden; margin: 0; padding: 0 8px 12px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
    }
    .header { flex: none; padding: 6px 0; }
    .heading { display: flex; align-items: center; gap: 4px; }
    .title {
      min-width: 0; flex: 1; font-weight: 600; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    }
    .controls { display: flex; gap: 2px; }
    button {
      border: 0; padding: 2px 5px; color: var(--vscode-foreground);
      background: transparent; border-radius: 3px; cursor: pointer;
    }
    button:hover { background: var(--vscode-toolbar-hoverBackground); }
    button:disabled { opacity: .35; cursor: default; }
    button.locked { color: var(--vscode-charts-yellow); }
    .location {
      color: var(--vscode-descriptionForeground); margin-top: 2px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .code {
      box-sizing: border-box; flex: 1 1 auto; min-height: 0;
      width: 100%; max-width: 100%; overflow: auto; padding: 4px 0;
      overflow-anchor: none;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .line {
      display: flex; width: max-content; min-width: 100%;
      min-height: 1.45em; white-space: pre; cursor: text;
    }
    .line.target {
      background: var(--vscode-editor-selectionBackground);
      border-left: 2px solid var(--vscode-focusBorder);
    }
    .number {
      flex: 0 0 3.5em; padding-right: 1em; text-align: right;
      color: var(--vscode-editorLineNumber-foreground); user-select: none;
    }
    code { color: var(--vscode-editor-foreground); }
    .line code { flex: none; width: max-content; }
    .target-symbol {
      color: inherit;
      background: var(--vscode-editor-findMatchHighlightBackground);
      outline: 1px solid var(--vscode-editor-findMatchHighlightBorder, var(--vscode-focusBorder));
    }
    .kw { color: var(--vscode-symbolIcon-keywordForeground, #c586c0); }
    .str { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
    .comment { color: var(--vscode-editorLineNumber-foreground); }
    .num { color: var(--vscode-symbolIcon-numberForeground, #b5cea8); }
    .sem-namespace { color: var(--vscode-symbolIcon-namespaceForeground, #4ec9b0); }
    .sem-type, .sem-class, .sem-struct, .sem-interface, .sem-enum,
    .sem-typeParameter {
      color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
    }
    .sem-function, .sem-method {
      color: var(--vscode-symbolIcon-methodForeground, #dcdcaa);
    }
    .sem-macro {
      color: var(--vscode-symbolIcon-constantForeground, #c586c0);
    }
    .sem-parameter {
      color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
      font-style: italic;
    }
    .sem-variable, .sem-property, .sem-enumMember, .sem-event {
      color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
    }
    .sem-label {
      color: var(--vscode-symbolIcon-keyForeground, #c8c8c8);
    }
    .sem-keyword, .sem-modification {
      color: var(--vscode-symbolIcon-keywordForeground, #c586c0);
    }
    .sem-comment { color: var(--vscode-editorLineNumber-foreground); }
    .sem-string {
      color: var(--vscode-symbolIcon-stringForeground, #ce9178);
    }
    .sem-number {
      color: var(--vscode-symbolIcon-numberForeground, #b5cea8);
    }
    .sem-operator {
      color: var(--vscode-symbolIcon-operatorForeground, var(--vscode-editor-foreground));
    }
    .sem-navigable { cursor: pointer; }
    .sem-mod-deprecated { text-decoration: line-through; }
    .sem-mod-readonly { font-style: italic; }
    .load-status {
      flex: none; min-height: 1.2em; padding: 3px 0 0;
      color: var(--vscode-descriptionForeground); font-size: .9em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .load-status.error { color: var(--vscode-errorForeground); }
    .empty, .error { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="header">
    <div class="heading">
      <div class="title">${title}</div>
      <div class="controls">
        <button data-action="back" title="${text.back}"${controls.back ? "" : " disabled"}>←</button>
        <button data-action="forward" title="${text.forward}"${controls.forward ? "" : " disabled"}>→</button>
        <button data-action="toggleLock" title="${controls.locked ? text.unlock : text.lock}" class="${controls.locked ? "locked" : ""}">⌖</button>
        <button data-action="copyCode" title="${text.copyCode}">⧉</button>
        <button data-action="copyPath" title="${text.copyPath}">${text.path}</button>
        <button data-action="openCurrent" title="${text.open}">↗</button>
      </div>
    </div>
    <div class="location">${location}</div>
  </div>
  <div class="code">${body}</div>
  <div class="load-status" aria-live="polite"></div>
  ${nonce ? `<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const text = ${scriptText};
    let clickTimer;
    let loadingMore = false;
    let pendingDirection;
    let hasBefore = ${incremental.hasBefore};
    let hasAfter = ${incremental.hasAfter};
    let startLine = ${incremental.startLine};
    let endLine = ${incremental.endLine};
    const totalLines = ${incremental.totalLines};
    const restoredScroll = ${JSON.stringify(incremental.scroll ?? null)};
    const incrementalLoading = ${incremental.enabled};
    const codeContainer = document.querySelector('.code');
    const loadStatus = document.querySelector('.load-status');
    function updateLoadStatus(message, error = false) {
      if (!loadStatus) return;
      loadStatus.classList.toggle('error', error);
      if (message) {
        loadStatus.textContent = message;
        return;
      }
      const boundary =
        !hasBefore && !hasAfter
          ? text.completeFile
          : !hasBefore
            ? text.startOfFile
            : !hasAfter
              ? text.endOfFile
              : text.scrollForMore;
      loadStatus.textContent =
        text.lines + ' ' + (startLine + 1) + '–' + (endLine + 1) +
        ' / ' + totalLines + ' · ' + boundary;
    }
    function requestMore(direction) {
      if (!incrementalLoading) return;
      if (loadingMore) {
        pendingDirection = direction;
        return;
      }
      if (direction === 'before' ? !hasBefore : !hasAfter) return;
      loadingMore = true;
      updateLoadStatus(
        direction === 'before'
          ? text.loadingEarlier
          : text.loadingLater
      );
      vscode.postMessage({ type: 'loadMore', direction });
    }
    function loadAtScrollEdge(deltaY) {
      if (!codeContainer) return;
      const threshold = 80;
      if (deltaY <= 0 && codeContainer.scrollTop <= threshold) {
        requestMore('before');
      } else if (
        deltaY >= 0 &&
        codeContainer.scrollTop + codeContainer.clientHeight >=
          codeContainer.scrollHeight - threshold
      ) {
        requestMore('after');
      }
    }
    let scrollSaveTimer;
    function saveScroll() {
      if (!codeContainer) return;
      const lines = codeContainer.querySelectorAll('.line[data-line]');
      let anchor = lines[0];
      for (const line of lines) {
        if (line.offsetTop + line.offsetHeight >= codeContainer.scrollTop) {
          anchor = line;
          break;
        }
      }
      if (!anchor) return;
      vscode.postMessage({
        type: 'saveScroll',
        anchorLine: Number(anchor.dataset.line),
        anchorOffset: Math.max(0, codeContainer.scrollTop - anchor.offsetTop),
        scrollLeft: codeContainer.scrollLeft
      });
    }
    function scheduleScrollSave() {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(saveScroll, 150);
    }
    codeContainer?.addEventListener('scroll', () => {
      loadAtScrollEdge(0);
      scheduleScrollSave();
    });
    codeContainer?.addEventListener(
      'wheel',
      event => loadAtScrollEdge(event.deltaY),
      { passive: true }
    );
    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || message.type !== 'incrementalLines' || !codeContainer) return;
      if (message.error) {
        loadingMore = false;
        updateLoadStatus(text.sourceLoadingFailed + message.error, true);
        pendingDirection = undefined;
        return;
      }
      const direction = message.direction;
      const existing = codeContainer.querySelectorAll('.line');
      const anchor = direction === 'before'
        ? existing[0]
        : existing[existing.length - 1];
      const anchorTop = anchor?.offsetTop ?? 0;
      const scrollLeft = codeContainer.scrollLeft;
      if (message.html) {
        codeContainer.insertAdjacentHTML(
          direction === 'before' ? 'afterbegin' : 'beforeend',
          message.html
        );
      }
      for (const line of codeContainer.querySelectorAll('.line[data-line]')) {
        const number = Number(line.dataset.line);
        if (number < message.startLine || number > message.endLine) {
          line.remove();
        }
      }
      if (anchor?.isConnected) {
        codeContainer.scrollTop += anchor.offsetTop - anchorTop;
      }
      codeContainer.scrollLeft = scrollLeft;
      hasBefore = Boolean(message.hasBefore);
      hasAfter = Boolean(message.hasAfter);
      startLine = Number(message.startLine);
      endLine = Number(message.endLine);
      loadingMore = false;
      updateLoadStatus();
      scheduleScrollSave();
      const queued = pendingDirection;
      pendingDirection = undefined;
      if (queued) setTimeout(() => requestMore(queued), 0);
    });
    if (restoredScroll && codeContainer) {
      const anchor = codeContainer.querySelector(
        '.line[data-line="' + restoredScroll.anchorLine + '"]'
      );
      if (anchor) {
        codeContainer.scrollTop = anchor.offsetTop + restoredScroll.anchorOffset;
        codeContainer.scrollLeft = restoredScroll.scrollLeft;
      }
    }
    updateLoadStatus();
    function sourcePosition(event, allowLineFallback = false) {
      const code = event.target.closest && event.target.closest('code[data-line]');
      if (!code) {
        if (!allowLineFallback) return undefined;
        let line = event.target.closest && event.target.closest('.line[data-line]');
        if (!line && codeContainer) {
          const lines = [...codeContainer.querySelectorAll('.line[data-line]')];
          line = lines.find(candidate => {
            const bounds = candidate.getBoundingClientRect();
            return event.clientY >= bounds.top && event.clientY <= bounds.bottom;
          });
          if (!line && lines.length > 0) {
            const firstBounds = lines[0].getBoundingClientRect();
            line = event.clientY < firstBounds.top ? lines[0] : lines[lines.length - 1];
          }
        }
        return line ? { line: Number(line.dataset.line), character: 0 } : undefined;
      }
      let range;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(event.clientX, event.clientY);
      } else if (document.caretPositionFromPoint) {
        const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
        if (caret) range = { startContainer: caret.offsetNode, startOffset: caret.offset };
      }
      if (!range || !code.contains(range.startContainer)) return undefined;
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let character = 0;
      let node;
      while ((node = walker.nextNode())) {
        if (node === range.startContainer) {
          character += range.startOffset;
          return { line: Number(code.dataset.line), character };
        }
        character += node.textContent.length;
      }
      return undefined;
    }
    document.querySelector('.code')?.addEventListener('click', event => {
      if (!window.getSelection().isCollapsed) return;
      const position = sourcePosition(event);
      if (!position) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(
        () => vscode.postMessage({ type: 'previewDefinition', ...position }),
        250
      );
    });
    document.querySelector('.code')?.addEventListener('dblclick', event => {
      clearTimeout(clickTimer);
      const position = sourcePosition(event, true);
      if (position) vscode.postMessage({ type: 'openPosition', ...position });
    });
    document.querySelector('.controls')?.addEventListener('click', event => {
      const action = event.target.closest && event.target.closest('button[data-action]');
      if (!action || action.disabled) return;
      const type = action.dataset.action;
      vscode.postMessage({
        type,
        selection: type === 'copyCode' ? window.getSelection().toString() : undefined
      });
    });
  </script>` : ""}
</body>
</html>`;
}
