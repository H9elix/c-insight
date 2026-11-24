import assert from "node:assert/strict";
import * as vscode from "vscode";

interface DiscoveryState {
  registered: string[]; visible: string[]; noticeAttempted: boolean; pickerOpen: boolean;
  activeEntry?: {action: string; viewId?: string; slot?: number};
}
const state = async () => (await vscode.commands.executeCommand<DiscoveryState>("cInsight.test.viewDiscoveryState"))!;
const submitted = async () => (await vscode.commands.executeCommand<{scheduler: {submitted: number}}>("cInsight.test.navigationState"))!.scheduler.submitted;
async function wait(predicate: () => Promise<boolean>, message: string): Promise<void> {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`${message}: ${JSON.stringify(await state())}`);
}

async function choose(query: string, predicate: (entry: DiscoveryState["activeEntry"]) => boolean, accept: boolean): Promise<void> {
  const opening = vscode.commands.executeCommand("cInsight.openView");
  try {
    await wait(async () => { const value = await state(); return value.pickerOpen && Boolean(value.activeEntry); }, "View picker did not become interactive");
    // `type` targets an editor, not the native Quick Input textbox. Exercise the
    // native picker's selection commands; typed filtering remains a manual check.
    for (let index = 0; index < 24 && !predicate((await state()).activeEntry); index++) {
      const previous = JSON.stringify((await state()).activeEntry);
      await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
      await wait(async () => JSON.stringify((await state()).activeEntry) !== previous, `Picker selection did not advance toward ${query}`);
    }
    assert(predicate((await state()).activeEntry), `Picker did not list ${query}`);
    await vscode.commands.executeCommand(accept ? "workbench.action.acceptSelectedQuickOpenItem" : "workbench.action.closeQuickOpen");
    await opening;
  } finally {
    if ((await state()).pickerOpen) await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    await opening;
  }
}

export async function verifyViewPickerCancellation(): Promise<void> {
  const before = await state(), count = await submitted();
  assert.equal(before.registered.length, 20, "All sixteen independent views and four native slots must be observed");
  await choose("Project Files", entry => entry?.viewId === "cInsight.projectFiles", false);
  const after = await state();
  assert.deepEqual(after.visible.sort(), before.visible.sort(), "Browsing and cancelling must not open a pane");
  assert.equal(after.noticeAttempted, before.noticeAttempted, "Picker visibility alone must not trigger the first-view notice");
  assert.equal(await submitted(), count, "Browsing and cancelling must not submit analysis requests");
}

export async function verifyViewPickerOpening(): Promise<void> {
  // Slot 2 is already enabled with Callers in the shared combined suite.
  await choose("Callers", entry => entry?.viewId === "cInsight.callers", true);
  await wait(async () => (await state()).visible.includes("cInsight.callers"), "Independent Callers was redirected to a combined presentation");
  await choose("Combined View 2", entry => entry?.slot === 2, true);
  await wait(async () => (await state()).visible.includes("cInsight.combined2"), "The chosen existing combined slot did not open");
  await choose("Navigation History", entry => entry?.viewId === "cInsight.history", true);
  await wait(async () => (await state()).visible.includes("cInsight.history"), "The non-query History view did not open");
  assert((await state()).noticeAttempted, "A visible C Insight pane must trigger the once-only guide");
  console.log(`View discovery native picker, cancellation, exact native focus and first-view observation passed (VS Code ${vscode.version}).`);
}
