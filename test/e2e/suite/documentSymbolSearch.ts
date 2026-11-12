import assert from "node:assert/strict";
import * as vscode from "vscode";

interface Row { id: string; label: string; parent?: string; uri: string; line: number; expanded: boolean; description?: string }
const snapshot = (filter = false) => vscode.commands.executeCommand<Row[]>("cInsight.test.resultTreeInteraction", "cInsight.symbols", filter ? "filterSnapshot" : undefined);

export async function verifyDocumentSymbolSearch(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("cInsight.documentSymbols");
  const previous = configuration.inspect<boolean>("followEditorCenter")?.globalValue;
  const previousSort = configuration.inspect<string>("sortBy")?.globalValue;
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
    await verifyControls(configuration, uri, searchable, member);
    console.log("DOCUMENT_SYMBOLS: materialized collapsed members, stable identities/expansion, preview and editor activation passed.");
  } finally {
    await vscode.commands.executeCommand("cInsight.documentSymbols.unlock");
    await configuration.update("sortBy", previousSort, vscode.ConfigurationTarget.Global);
    await configuration.update("followEditorCenter", previous, vscode.ConfigurationTarget.Global);
  }
}

async function waitRows(filter: boolean, accept: (rows: Row[]) => boolean, message: string): Promise<Row[]> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = await snapshot(filter);
    if (accept(rows)) return rows;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return assert.fail(message);
}

async function verifyControls(configuration: vscode.WorkspaceConfiguration, uri: vscode.Uri, original: Row[], member: Row): Promise<void> {
  const filesBefore = await vscode.commands.executeCommand<{ locked: boolean }>("cInsight.test.projectFilesState");
  await vscode.commands.executeCommand("cInsight.documentSymbols.lock");
  assert.equal(await vscode.commands.executeCommand("cInsight.test.documentSymbolsLocked"), true);
  assert.equal((await vscode.commands.executeCommand<{ locked: boolean }>("cInsight.test.projectFilesState")).locked, filesBefore.locked);
  await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.symbols", { type: "collapseAll" });
  await vscode.commands.executeCommand("cInsight.test.documentSymbolViewport", uri.toString(), member.line);
  assert(!(await snapshot()).some(row => row.id === member.id), "Lock must prevent automatic ancestor expansion");
  assert((await snapshot(true)).find(row => row.id === member.id)?.description?.includes("Editor center"), "Highlighting must remain live while locked");

  await configuration.update("sortBy", "name", vscode.ConfigurationTarget.Global);
  const names = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const expectedNames = original.filter(row => !row.parent).map(row => row.label).sort(names.compare);
  const named = await waitRows(false, rows => JSON.stringify(rows.map(row => row.label)) === JSON.stringify(expectedNames), "Name sorting was not applied");
  const ids = new Set(original.map(row => row.id));
  assert(named.every(row => ids.has(row.id)), "Sorting must preserve stable node IDs");
  const full = await snapshot(true);
  assert.equal(full.find(row => row.id === member.id)?.parent, member.parent);
  assert.equal(full.find(row => row.id === member.id)?.line, member.line);
  assert(full.find(row => row.id === member.id)?.description?.includes("Editor center"));
  await configuration.update("sortBy", "type", vscode.ConfigurationTarget.Global);
  await waitRows(false, rows => rows.at(-1)?.label === "calculate", "Type sorting must place functions after classes in this fixture");
  await configuration.update("sortBy", "position", vscode.ConfigurationTarget.Global);
  await waitRows(false, rows => rows.every((row, i) => i === 0 || rows[i - 1].line <= row.line), "Source-position sorting was not restored");

  await vscode.commands.executeCommand("cInsight.documentSymbols.unlock");
  await waitRows(false, rows => rows.some(row => row.id === member.id), "Unlock should reveal the current center symbol even when it has not changed");
  assert.equal(await vscode.commands.executeCommand("cInsight.test.documentSymbolsLocked"), false);

  await vscode.commands.executeCommand("cInsight.documentSymbols.lock");
  const other = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "src/calculator.cpp");
  await vscode.window.showTextDocument(other);
  await waitRows(true, rows => rows.length > 0 && rows.every(row => row.uri === other.toString()), "Lock should not freeze the active document inventory");
  assert.equal(await vscode.commands.executeCommand("cInsight.test.documentSymbolsLocked"), true);
  console.log("DOCUMENT_SYMBOL_CONTROLS: sibling sorting, stable IDs/parents, independent lock, controlled center highlight/reveal and active-file updates passed.");
}
