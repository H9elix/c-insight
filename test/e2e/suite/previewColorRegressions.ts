import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { AnalysisService } from "../../../src/analysis/analysisService";
import type { NavigationHistoryExplorer } from "../../../src/history/navigationHistoryExplorer";
import type { LocationResult } from "../../../src/models/types";
import { CodePreviewProvider } from "../../../src/views/codePreviewProvider";

export async function verifyPreviewColors(): Promise<void> {
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "src", "calculator.cpp");
  const config = vscode.workspace.getConfiguration("cInsight.codePreview", uri);
  const previousScheme = config.inspect("colorScheme")?.globalValue;
  const previousColors = config.inspect("tokenColors")?.globalValue;
  const noQueries = new Proxy({}, { get: () => assert.fail("A style update must not access the analysis engine") });
  const preview = new CodePreviewProvider(
    noQueries as AnalysisService,
    { canBack: false, canForward: false } as NavigationHistoryExplorer,
  );
  const probe = preview as unknown as {
    state: { mode: string; title: string; location: LocationResult };
    rendered: unknown;
    locked: boolean;
    semanticTokens: Map<string, unknown>;
    scrollStates: Map<string, unknown>;
    semanticTokensFor(): Promise<unknown>;
    render(): Promise<void>;
    receiveMessage(message: { type: string }): Promise<void>;
  };
  const messages: Array<{ type: string; css: string }> = [];
  const visibility = new vscode.EventEmitter<void>();
  const disposed = new vscode.EventEmitter<void>();
  const received = new vscode.EventEmitter<unknown>();
  let html = "", htmlWrites = 0, tokenRequests = 0;
  const view = {
    visible: true,
    onDidChangeVisibility: visibility.event,
    onDidDispose: disposed.event,
    webview: {
      options: {},
      onDidReceiveMessage: received.event,
      get html() { return html; },
      set html(value: string) { html = value; htmlWrites++; },
      postMessage: async (message: { type: string; css: string }) => { messages.push(message); return true; },
    },
  };
  preview.resolveWebviewView(view as unknown as vscode.WebviewView);
  htmlWrites = 0; // Exclude the initial, target-free shell.
  probe.state = { mode: "definition", title: "add", location: {
    uri, range: new vscode.Range(2, 0, 2, 3),
  } };
  probe.semanticTokensFor = async () => { tokenRequests++; return new Map(); };
  const event = (setting: string): vscode.ConfigurationChangeEvent => ({
    affectsConfiguration: section => section === "cInsight.codePreview" || section === `cInsight.codePreview.${setting}`,
  });
  try {
    await config.update("colorScheme", "fixed-dark", vscode.ConfigurationTarget.Global);
    await config.update("tokenColors", { function: "#123456" }, vscode.ConfigurationTarget.Global);
    await probe.render();
    assert.equal(htmlWrites, 1);
    assert.equal(tokenRequests, 1);
    assert.match(html, /<style id="preview-colors">/);
    assert.match(html, /--ci-preview-background: #1E1E1E;/);
    assert.match(html, /--ci-preview-function: #123456;/);
    const rendered = probe.rendered;
    const state = probe.state;
    const tokenSentinel = { promise: Promise.resolve(undefined) };
    const scrollSentinel = { anchorLine: 2, scrollLeft: 150 };
    probe.semanticTokens.set("sentinel", tokenSentinel);
    probe.scrollStates.set("sentinel", scrollSentinel);
    probe.locked = true;

    await config.update("colorScheme", "fixed-light", vscode.ConfigurationTarget.Global);
    preview.configurationChanged(event("colorScheme"));
    assert.equal(messages.at(-1)?.type, "previewColors");
    assert.match(messages.at(-1)!.css, /--ci-preview-background: #FFFFFF;/);
    assert.match(messages.at(-1)!.css, /--ci-preview-function: #123456;/);
    assert.doesNotMatch(messages.at(-1)!.css, /--vscode-/);

    await config.update("tokenColors", { property: "#ABCDEF" }, vscode.ConfigurationTarget.Global);
    preview.configurationChanged(event("tokenColors"));
    assert.match(messages.at(-1)!.css, /--ci-preview-property: #ABCDEF;/);
    assert.match(messages.at(-1)!.css, /--ci-preview-function: #795E26;/);
    assert.equal(htmlWrites, 1, "Color changes rebuilt the preview HTML");
    assert.equal(tokenRequests, 1, "Color changes requested semantic tokens");
    assert.equal(probe.semanticTokens.get("sentinel"), tokenSentinel);
    assert.equal(probe.scrollStates.get("sentinel"), scrollSentinel);
    assert.equal(probe.rendered, rendered);
    assert.equal(probe.state, state);
    assert.equal(preview.isLocked, true);

    const beforeHidden = messages.length;
    view.visible = false;
    visibility.fire();
    await config.update("colorScheme", "fixed-dark", vscode.ConfigurationTarget.Global);
    preview.configurationChanged(event("colorScheme"));
    assert.equal(messages.length, beforeHidden, "A hidden view received style work");
    view.visible = true;
    visibility.fire();
    assert.equal(messages.length, beforeHidden + 1, "A shown, locked view missed current colors");
    assert.match(messages.at(-1)!.css, /--ci-preview-background: #1E1E1E;/);
    await probe.receiveMessage({ type: "previewReady" });
    assert.equal(messages.length, beforeHidden + 2, "A newly ready Webview missed current colors");
    assert.equal(htmlWrites, 1);

    await config.update("colorScheme", "theme", vscode.ConfigurationTarget.Global);
    preview.refreshColors();
    assert.match(messages.at(-1)!.css, /--vscode-symbolIcon/);
    assert.equal(tokenRequests, 1);
    assert.equal(htmlWrites, 1);
    console.log("Code Preview color regressions passed: initial presets, custom/reset colors, style-only updates, retained caches/state/lock, hidden views, and ready synchronization.");
  } finally {
    preview.dispose();
    visibility.dispose();
    disposed.dispose();
    received.dispose();
    await config.update("colorScheme", previousScheme, vscode.ConfigurationTarget.Global);
    await config.update("tokenColors", previousColors, vscode.ConfigurationTarget.Global);
  }
}
