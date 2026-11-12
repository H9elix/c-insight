import assert from "node:assert/strict";
import * as vscode from "vscode";

interface Row { id: string; label: string; parent?: string; uri: string; line: number; expanded: boolean }
const snapshot = (filter = false) => vscode.commands.executeCommand<Row[]>("cInsight.test.resultTreeInteraction", "cInsight.symbols", filter ? "filterSnapshot" : undefined);

export async function verifyDocumentSymbolSearch(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("cInsight.documentSymbols");
  const previous = configuration.inspect<boolean>("followEditorCenter")?.globalValue;
  await configuration.update("followEditorCenter", false, vscode.ConfigurationTarget.Global);
  try {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const uri = vscode.Uri.joinPath(root, "include/calculator.hpp");
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand("cInsight.symbols.focus");
    await vscode.window.showTextDocument(document);
    let loaded: Row[] = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      loaded = await snapshot(true);
      if (loaded.some(row => row.uri === uri.toString() && row.label === "Calculator")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(loaded.some(row => row.label === "Calculator" && row.uri === uri.toString()), "Header symbols were not loaded");
    await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.symbols", { type: "collapseAll" });
    const collapsed = await snapshot();
    const searchable = await snapshot(true);
    const calculator = searchable.find(row => row.label === "Calculator")!;
    const member = searchable.find(row => row.parent === calculator.id && /^add\b/.test(row.label));
    assert(member, "Collapsed Calculator::add must be available in the loaded-symbol search index");
    assert(!collapsed.some(row => row.id === member.id), "The test must start with the member hidden by collapse");
    for (let index = 0; index < 10; index++) await snapshot(true);
    assert.deepEqual((await snapshot()).map(row => [row.id, row.expanded]), collapsed.map(row => [row.id, row.expanded]));
    const sourceEditor = vscode.window.activeTextEditor;
    await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.symbols", { type: "activate", id: member.id, intent: "preview" });
    assert.equal(vscode.window.activeTextEditor, sourceEditor);
    await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.symbols", { type: "activate", id: member.id, intent: "open" });
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), member.uri);
    assert.equal(vscode.window.activeTextEditor?.selection.active.line, member.line);
    console.log("DOCUMENT_SYMBOLS: materialized collapsed members, stable identities/expansion, preview and editor activation passed.");
  } finally {
    await configuration.update("followEditorCenter", previous, vscode.ConfigurationTarget.Global);
  }
}
