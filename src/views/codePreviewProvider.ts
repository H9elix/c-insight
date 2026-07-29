import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import {
  NavigationMode,
  NavigationSource,
} from "../history/navigationHistoryModel";
import { LocationResult } from "../models/types";
import type { PreviewSessionState } from "../session/workspaceSession";
import {
  escapeHtml,
  decodeSemanticTokens,
  highlightCppLine,
  highlightSemanticLine,
  highlightTarget,
  SemanticTokenSpan,
} from "./sourceHighlight";
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
}

interface SemanticTokenDocument {
  data: Uint32Array;
  legend: vscode.SemanticTokensLegend;
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
  private readonly semanticTokens = new Map<
    string,
    Promise<SemanticTokenDocument | undefined>
  >();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly visibilityEmitter = new vscode.EventEmitter<void>();
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
            `C Insight Code Preview action failed: ${String(error)}`,
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
    this.navigationHistory.record(location, mode, next.title, source);
    this.state = next;
    await this.render();
  }

  clear(): void {
    if (this.locked) {
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

  handleDocumentChange(document: vscode.TextDocument): void {
    const prefix = `${document.uri.toString()}\0`;
    for (const key of this.semanticTokens.keys()) {
      if (key.startsWith(prefix)) {
        this.semanticTokens.delete(key);
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
      "cInsight.previewLocked",
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
          await this.previewDefinition(position);
        }
        break;
      }
      case "openPosition": {
        const position = this.validPosition(message);
        if (position && this.rendered) {
          this.cancelDefinition();
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
          "cInsight.previewLocked",
          this.locked,
        );
        await this.render();
        break;
      case "openCurrent":
        if (this.state) {
          const document = await vscode.workspace.openTextDocument(
            this.state.location.uri,
          );
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

  private async previewDefinition(position: vscode.Position): Promise<void> {
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
      const startLine = Math.max(0, targetLine - linesBefore);
      const endLine = Math.min(document.lineCount - 1, targetLine + linesAfter);
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
      const lines: string[] = [];
      for (let line = startLine; line <= endLine; line += 1) {
        const source = document.lineAt(line).text;
        lines.push(
          `<div class="line${line === targetLine ? " target" : ""}" data-line="${line}">` +
            `<span class="number">${line + 1}</span>` +
            `<code data-line="${line}">${highlightPreviewLine(source, line, location.range, tokens?.get(line))}</code>` +
            "</div>",
        );
      }
      const relative = vscode.workspace.asRelativePath(location.uri);
      const nonce = randomBytes(16).toString("base64");
      this.view.webview.html = htmlDocument(
        `${previewModeLabel(mode)} · ${escapeHtml(title)}`,
        `${escapeHtml(relative)}:${targetLine + 1}`,
        lines.join(""),
        nonce,
        {
          back: this.navigationHistory.canBack,
          forward: this.navigationHistory.canForward,
          locked: this.locked,
        },
      );
    } catch (error) {
      this.rendered = undefined;
      this.view.webview.html = errorHtml(String(error));
    }
  }

  private async semanticTokensFor(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
  ): Promise<Map<number, SemanticTokenSpan[]> | undefined> {
    const key = `${document.uri.toString()}\0${document.version}`;
    let request = this.semanticTokens.get(key);
    if (!request) {
      request = requestSemanticTokens(document);
      this.semanticTokens.set(key, request);
    }
    const maximumEntries = vscode.workspace
      .getConfiguration("cInsight.codePreview")
      .get<number>("semanticTokenCacheSize", 32);
    while (this.semanticTokens.size > maximumEntries) {
      const oldest = this.semanticTokens.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) {
        break;
      }
      this.semanticTokens.delete(oldest);
    }
    const result = await request;
    return result
      ? decodeSemanticTokens(result.data, result.legend, startLine, endLine)
      : undefined;
  }
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
): Promise<SemanticTokenDocument | undefined> {
  try {
    const [legend, tokens] = await Promise.all([
      vscode.commands.executeCommand<vscode.SemanticTokensLegend | undefined>(
        "vscode.provideDocumentSemanticTokensLegend",
        document.uri,
      ),
      vscode.commands.executeCommand<vscode.SemanticTokens | undefined>(
        "vscode.provideDocumentSemanticTokens",
        document.uri,
      ),
    ]);
    if (!legend || !tokens) {
      return undefined;
    }
    return { data: tokens.data, legend };
  } catch {
    return undefined;
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
      return "Definition";
    case "declaration":
      return "Declaration";
    case "reference":
      return "Reference";
    case "caller":
      return "Caller";
    case "callee-definition":
      return "Callee Definition";
    case "callee-call-site":
      return "Callee Call Site";
  }
}

function emptyHtml(): string {
  return staticHtml(
    "Code Preview",
    "",
    '<p class="empty">Move the cursor to a symbol or select a code location.</p>',
  );
}

function errorHtml(error: string): string {
  return staticHtml(
    "Code Preview",
    "",
    `<p class="error">${escapeHtml(error)}</p>`,
  );
}

function staticHtml(title: string, location: string, body: string): string {
  return htmlDocument(title, location, body, "", {
    back: false,
    forward: false,
    locked: false,
  });
}

function htmlDocument(
  title: string,
  location: string,
  body: string,
  nonce: string,
  controls: { back: boolean; forward: boolean; locked: boolean },
): string {
  const scriptPolicy = nonce ? ` script-src 'nonce-${nonce}';` : "";
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
    .sem-mod-deprecated { text-decoration: line-through; }
    .sem-mod-readonly { font-style: italic; }
    .empty, .error { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="header">
    <div class="heading">
      <div class="title">${title}</div>
      <div class="controls">
        <button data-action="back" title="Back"${controls.back ? "" : " disabled"}>←</button>
        <button data-action="forward" title="Forward"${controls.forward ? "" : " disabled"}>→</button>
        <button data-action="toggleLock" title="${controls.locked ? "Unlock preview" : "Lock preview"}" class="${controls.locked ? "locked" : ""}">⌖</button>
        <button data-action="copyCode" title="Copy selected text or preview code">⧉</button>
        <button data-action="copyPath" title="Copy file path and line">Path</button>
        <button data-action="openCurrent" title="Open current preview in editor">↗</button>
      </div>
    </div>
    <div class="location">${location}</div>
  </div>
  <div class="code">${body}</div>
  ${nonce ? `<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let clickTimer;
    function sourcePosition(event) {
      const code = event.target.closest && event.target.closest('code[data-line]');
      if (!code) return undefined;
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
      const position = sourcePosition(event);
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
