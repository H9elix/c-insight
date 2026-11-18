import assert from "node:assert/strict";
import * as vscode from "vscode";

interface Row { id: string; uri: string; line: number; label: string; description?: string }
interface State {
  locked: boolean; focused: boolean; followActions: number;
  lastFollowAction?: { uri: string; line: number; clear: "always" | "ifHidden"; reveal: boolean };
}
const state = () => vscode.commands.executeCommand<State>("cInsight.test.documentSymbolsFollowState") as Promise<State>;
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
async function wait(check: () => Promise<boolean>, message: string): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message + " " + JSON.stringify(await state()));
}

/** Native focus and dispatched host actions; shipped-browser tests verify actual query and scroll changes. */
export async function verifyDocumentSymbolFollowing(configuration: vscode.WorkspaceConfiguration, member: Row, rows: Row[]): Promise<void> {
  const focusList = async () => {
    await vscode.commands.executeCommand("cInsight.symbols.focus");
    await wait(async () => (await state()).focused, "Document Symbols focus did not reach the follow controller");
  };
  const activate = (intent: "preview" | "open", menu = false) => vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.symbols",
    menu ? { type: "action", id: member.id, command: "cInsight.openLocation" } : { type: "activate", id: member.id, intent });
  const follow = async (before: number, clear: "always" | "ifHidden", line = member.line) => wait(async () => {
    const value = await state();
    return value.followActions > before && value.lastFollowAction?.clear === clear && value.lastFollowAction.line === line;
  }, `Missing Document Symbols ${clear} follow action`);

  // Follow is disabled by the caller: explicit opens must still clear, without expanding or scrolling.
  for (const menu of [false, false, true]) {
    await focusList(); const before = (await state()).followActions;
    await activate("open", menu);
    await follow(before, "always");
    assert.equal((await state()).lastFollowAction?.reveal, false);
    assert.equal(vscode.window.activeTextEditor?.selection.active.line, member.line);
    const visible = await vscode.commands.executeCommand<Row[]>("cInsight.test.resultTreeInteraction", "cInsight.symbols");
    assert(!visible?.some(row => row.id === member.id), "Disabled follow must not expand ordinary ancestors just to clear the query");
  }
  await focusList(); const previewCount = (await state()).followActions;
  await activate("preview"); await pause();
  assert.equal((await state()).followActions, previewCount, "Single-click preview must not clear the query");

  await configuration.update("followEditorCenter", true, vscode.ConfigurationTarget.Global);
  await pause(); await focusList();
  const beforeFocus = (await state()).followActions;
  await vscode.commands.executeCommand("cInsight.test.documentSymbolViewport", member.uri, member.line);
  await pause(); assert.equal((await state()).followActions, beforeFocus, "View focus must protect search input and scroll");

  const other = rows.find(row => row.label === "calculate")!; assert(other);
  await vscode.commands.executeCommand("cInsight.documentSymbols.lock");
  const beforeLock = (await state()).followActions;
  await vscode.commands.executeCommand("cInsight.test.documentSymbolViewport", member.uri, other.line);
  const marked = await vscode.commands.executeCommand<Row[]>("cInsight.test.resultTreeInteraction", "cInsight.symbols", "filterSnapshot");
  assert(marked?.find(row => row.id === other.id)?.description?.includes("Editor center"));
  await pause(); assert.equal((await state()).followActions, beforeLock);
  await vscode.commands.executeCommand("cInsight.documentSymbols.unlock"); await pause();
  assert.equal((await state()).followActions, beforeLock, "Unlock inside the view must wait for focus to leave");
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  await follow(beforeLock, "ifHidden", other.line);

  await vscode.commands.executeCommand("cInsight.documentSymbols.lock");
  await focusList(); const lockedOpenCount = (await state()).followActions;
  await activate("open"); await pause();
  assert.equal(vscode.window.activeTextEditor?.selection.active.line, member.line);
  assert.equal((await state()).followActions, lockedOpenCount, "Locked explicit opens must preserve the query");
  await configuration.update("followEditorCenter", false, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand("cInsight.documentSymbols.unlock");
  console.log("DOCUMENT_SYMBOL_FOLLOW: native focus, repeated and context opens, disabled-follow clearing, preview preservation, independent lock/highlight and focus-gated unlock passed.");
}
