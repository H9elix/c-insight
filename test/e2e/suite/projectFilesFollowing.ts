import assert from "node:assert/strict";
import * as vscode from "vscode";

interface FollowState {
  focused: boolean; locked: boolean; followActions: number;
  lastFollowAction?: { uri: string; clear: "always" | "ifHidden"; reveal: boolean };
  files: Array<{ uri: string; active: boolean }>;
}
interface Row { id: string; uri?: string }
const state = () => vscode.commands.executeCommand<FollowState>("cInsight.test.projectFilesState") as Promise<FollowState>;
async function wait<T>(query: () => Promise<T | undefined>, message: string): Promise<T> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await query(); if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message + " " + JSON.stringify(await state()));
}
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
const activate = (row: Row, intent: "preview" | "open") => vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.projectFiles", { type: "activate", id: row.id, intent });

/** Native focus and host policy; actual filter text/scroll effects are tested by the shipped-client DOM harness. */
export async function verifyProjectFilesFollowing(folders: readonly vscode.WorkspaceFolder[]): Promise<void> {
  const uriA = vscode.Uri.joinPath(folders[0].uri, "readme.md");
  const uriB = vscode.Uri.joinPath(folders[1].uri, "readme.md");
  const rows = await vscode.commands.executeCommand<Row[]>("cInsight.test.resultTreeInteraction", "cInsight.projectFiles");
  const a = rows!.find(row => row.uri === uriA.toString())!;
  const b = rows!.find(row => row.uri === uriB.toString())!; assert(a && b);
  const focusList = async () => {
    await vscode.commands.executeCommand("cInsight.projectFiles.focus");
    await wait(async () => (await state()).focused ? true : undefined, "Whole-view focus did not reach host");
  };
  const follow = async (before: number, uri: vscode.Uri, clear: "always" | "ifHidden") => wait(async () => {
    const value = await state();
    return value.followActions > before && value.lastFollowAction?.uri === uri.toString() && value.lastFollowAction.clear === clear ? value : undefined;
  }, `Missing ${clear} follow action`);

  await vscode.window.showTextDocument(uriA);
  await pause();
  await focusList();
  const focusedCount = (await state()).followActions;
  await vscode.window.showTextDocument(uriB, { preserveFocus: true });
  await wait(async () => (await state()).files.some(file => file.active && file.uri === uriB.toString()) ? true : undefined, "Highlight must follow even while the list is focused");
  await pause();
  assert((await state()).focused);
  assert.equal((await state()).followActions, focusedCount, "File-view focus must suppress automatic clear/reveal");
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  await follow(focusedCount, uriB, "ifHidden");

  await vscode.commands.executeCommand("cInsight.projectFiles.lock");
  const lockedCount = (await state()).followActions;
  await vscode.window.showTextDocument(uriA);
  await pause();
  assert((await state()).locked);
  assert((await state()).files.some(file => file.active && file.uri === uriA.toString()));
  assert.equal((await state()).followActions, lockedCount);
  await focusList(); await activate(b, "preview"); await activate(b, "open");
  await pause();
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), uriB.toString());
  assert.equal((await state()).followActions, lockedCount, "Locked explicit opens must not trigger automatic clearing");
  assert.equal(vscode.workspace.getConfiguration("cInsight.projectFiles").get("followActiveEditor"), true);
  await vscode.commands.executeCommand("cInsight.projectFiles.unlock");
  await follow(lockedCount, uriB, "ifHidden");

  for (let repeat = 0; repeat < 2; repeat++) {
    await focusList(); const count = (await state()).followActions;
    await activate(a, "open");
    await follow(count, uriA, "always");
  }
  await focusList();
  const menuCount = (await state()).followActions;
  await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.projectFiles", { type: "action", id: b.id, command: "cInsight.openLocation" });
  await follow(menuCount, uriB, "always");

  // Delay only the first file's stat: the newer open must win before old work resumes.
  const controller = await vscode.commands.executeCommand<{ statFile(uri: vscode.Uri): Thenable<vscode.FileStat> }>("cInsight.test.projectFilesController"); assert(controller);
  const stat = controller.statFile.bind(controller);
  let release!: () => void, entered = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  controller.statFile = async uri => {
    const value = await stat(uri);
    if (uri.toString() === uriA.toString()) { entered = true; await held; }
    return value;
  };
  try {
    await focusList(); const count = (await state()).followActions;
    const old = activate(a, "open");
    await wait(async () => entered ? true : undefined, "Old activation was not held");
    await activate(b, "open");
    release(); await old;
    await follow(count, uriB, "always");
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), uriB.toString());
  } finally { release(); controller.statFile = stat; }

  // A newer preview also revokes an old in-flight open's automatic-follow gate.
  let releasePreview!: () => void, previewEntered = false;
  const previewHeld = new Promise<void>(resolve => { releasePreview = resolve; });
  controller.statFile = async uri => {
    const value = await stat(uri);
    if (uri.toString() === uriA.toString()) { previewEntered = true; await previewHeld; }
    return value;
  };
  try {
    await focusList();
    const old = activate(a, "open");
    await wait(async () => previewEntered ? true : undefined, "Preview takeover fixture did not start");
    await activate(b, "preview");
    const count = (await state()).followActions;
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    await follow(count, uriB, "ifHidden");
    releasePreview(); await old;
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), uriB.toString());
  } finally { releasePreview(); controller.statFile = stat; }

  const failing = vscode.Uri.joinPath(folders[0].uri, "open-failure.txt");
  await vscode.workspace.fs.writeFile(failing, Buffer.from("Failure control\n"));
  await wait(async () => (await state()).files.some(file => file.uri === failing.toString()) ? true : undefined, "Failure fixture missing");
  await focusList();
  const failureRows = await vscode.commands.executeCommand<Row[]>("cInsight.test.resultTreeInteraction", "cInsight.projectFiles");
  const failure = failureRows!.find(row => row.uri === failing.toString())!; assert(failure);
  const failedCount = (await state()).followActions;
  await vscode.workspace.fs.delete(failing);
  await activate(failure, "open"); await pause();
  assert.equal((await state()).followActions, failedCount, "An unsuccessful open must not dispatch a clear request");
  console.log("PROJECT_FILES_FOLLOW: native focus gating, independent lock/highlight, explicit opens including unchanged files and context action, latest-open ownership, and failure preservation passed.");
}
