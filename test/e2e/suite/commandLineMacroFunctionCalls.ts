import assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";

interface CallState {
  incomingRoots: string[];
  incomingOccurrences: Array<{ label: string; uri: string; line: number; depth: number }>;
}

/** Real Provider results and C Insight tree projection, not a physical UI click. */
export async function verifyCommandLineMacroFunctionCalls(document: vscode.TextDocument, feature: string): Promise<unknown[]> {
  const editor = await vscode.window.showTextDocument(document);
  const text = document.getText();
  const position = (snippet: string) => {
    const offset = text.indexOf(snippet);
    assert(offset >= 0, `Missing function-call fixture: ${snippet}`);
    return document.positionAt(offset);
  };
  const expected = (snippets: string[]) => snippets.map(snippet => position(snippet).line + 1).sort((a, b) => a - b);
  const reports = [];
  for (const [name, snippets] of [
    ["branch_target", [`branch_target(${feature === "1" ? 1 : 2})`, `branch_target(${feature === "1" ? 4 : 3})`]],
    ["compiler_macro_target", ["CI_BUILD_CALL(5)", "compiler_macro_target(6)"]],
  ] as const) {
    const at = position(`${name}(int value)`).translate(0, 1);
    editor.selection = new vscode.Selection(at, at);
    const roots = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>("vscode.prepareCallHierarchy", document.uri, at);
    assert.equal(roots?.length, 1, `Missing Provider function root: ${name}`);
    const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>("vscode.provideIncomingCalls", roots![0]);
    const nativeSites = incoming!.flatMap(call => call.fromRanges.map(range => ({
      name: call.from.name, file: path.basename(call.from.uri.fsPath), line: range.start.line + 1,
    })));
    assert.deepEqual(nativeSites.map(site => site.line).sort((a, b) => a - b), expected([...snippets]), `Provider Callers mismatch: ${name}`);
    assert(nativeSites.every(site => site.file === "conditional-calls.c"));
    await vscode.commands.executeCommand("cInsight.showIncomingCalls");
    await vscode.commands.executeCommand("cInsight.test.expandCallHierarchy", "incoming", 1);
    const state = await vscode.commands.executeCommand<CallState>("cInsight.test.callHierarchyState");
    assert.deepEqual(state!.incomingRoots, [name]);
    const sites = state!.incomingOccurrences.filter(row => row.depth === 1).map(row => ({
      name: row.label, file: path.basename(vscode.Uri.parse(row.uri).fsPath), line: row.line + 1,
    }));
    assert.deepEqual(sites.map(site => site.line).sort((a, b) => a - b), expected([...snippets]), `C Insight Callers mismatch: ${name}`);
    assert(sites.every(site => site.file === "conditional-calls.c"));
    const byLine = (left: { line: number }, right: { line: number }) => left.line - right.line;
    assert.deepEqual([...sites].sort(byLine), [...nativeSites].sort(byLine), "Tree projection must retain Provider caller names and locations");
    reports.push({ name, nativeSites, cInsightSites: sites });
  }

  // A function-like -D macro keeps its own spelling until the explicit expansion action.
  const macroAt = position("CI_BUILD_CALL(5)").translate(0, 1);
  editor.selection = new vscode.Selection(macroAt, macroAt);
  await vscode.commands.executeCommand("cInsight.showIncomingCalls");
  await vscode.commands.executeCommand("cInsight.test.expandCallHierarchy", "incoming", 1);
  const macro = await vscode.commands.executeCommand<CallState>("cInsight.test.callHierarchyState");
  assert.deepEqual(macro!.incomingRoots, ["CI_BUILD_CALL"]);
  assert.deepEqual(macro!.incomingOccurrences.filter(row => row.depth === 1).map(row => row.line + 1), [macroAt.line + 1]);
  await vscode.commands.executeCommand("cInsight.callers.showExpandedTarget");
  const deadline = Date.now() + 30_000;
  let expanded: CallState | undefined;
  while (Date.now() < deadline) {
    expanded = await vscode.commands.executeCommand<CallState>("cInsight.test.callHierarchyState");
    if (expanded?.incomingRoots[0] === "compiler_macro_target" && expanded.incomingOccurrences.filter(row => row.depth === 1).length === 2) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(expanded?.incomingRoots, ["compiler_macro_target"]);
  assert.deepEqual(expanded?.incomingOccurrences.filter(row => row.depth === 1).map(row => row.line + 1).sort((a, b) => a - b),
    expected(["CI_BUILD_CALL(5)", "compiler_macro_target(6)"]));
  reports.push({ name: "CI_BUILD_CALL", macroUseLine: macroAt.line + 1, macroRoots: macro!.incomingRoots, expandedRoots: expanded?.incomingRoots });
  return reports;
}
