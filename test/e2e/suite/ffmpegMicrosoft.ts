import assert from "node:assert/strict";
import * as vscode from "vscode";

interface PreviewState {
  uri: string;
  title: string;
}

interface CallerProbe {
  roots: number;
  callers: number;
}

export async function run(): Promise<void> {
  const engine = vscode.workspace.getConfiguration("cInsight");
  const microsoft = vscode.workspace.getConfiguration("cInsight.microsoft");
  await engine.update("engine", "microsoft", vscode.ConfigurationTarget.Global);
  await microsoft.update(
    "callersMode",
    "references",
    vscode.ConfigurationTarget.Global,
  );
  const extension = vscode.extensions.getExtension("c-insight.c-insight");
  assert.ok(extension);
  await extension.activate();

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(workspace);
  const uri = vscode.Uri.joinPath(workspace, "tools", "decode_simple.c");
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const position = symbolPosition(document, "avcodec_receive_frame");
  editor.selection = new vscode.Selection(position, position);
  await vscode.commands.executeCommand("cInsight.preview.focus");

  const preview = await waitFor(async () => {
    const state = await vscode.commands.executeCommand<PreviewState | undefined>(
      "cInsight.test.previewState",
    );
    return state && state.uri !== uri.toString() ? state : undefined;
  }, 30_000);
  assert.match(preview.uri, /libavcodec\/(?:avcodec\.c|avcodec\.h)$/);

  const callerEditor = await vscode.window.showTextDocument(document);
  callerEditor.selection = new vscode.Selection(position, position);
  const callers = await vscode.commands.executeCommand<CallerProbe>(
    "cInsight.test.referenceBasedCallers",
  );
  assert.ok(callers.roots > 0);
  assert.ok(Number.isInteger(callers.callers));
  assert.ok(callers.callers >= 0);
}

function symbolPosition(document: vscode.TextDocument, symbol: string): vscode.Position {
  for (let line = 0; line < document.lineCount; line += 1) {
    const column = document.lineAt(line).text.indexOf(symbol);
    if (column >= 0) return new vscode.Position(line, column + 1);
  }
  throw new Error(`Symbol not found: ${symbol}`);
}

async function waitFor<T>(action: () => Promise<T | undefined>, timeout: number): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeout} ms`);
}
