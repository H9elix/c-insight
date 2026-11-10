import assert from "node:assert/strict";
import * as vscode from "vscode";
import { verifyProjectFilesFollowing } from "./projectFilesFollowing";

interface State {
  visible: boolean; scanning: boolean; dirty: boolean; scans: number; truncated: boolean; status: string;
  files: Array<{ uri: string; name: string; description: string; active: boolean }>;
}
interface Row { id: string; uri?: string }

const state = () => vscode.commands.executeCommand<State>("cInsight.test.projectFilesState") as Promise<State>;
async function wait<T>(query: () => Promise<T | undefined>, message: string): Promise<T> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await query(); if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
const idle = () => wait(async () => { const value = await state(); return !value.dirty && !value.scanning ? value : undefined; }, "File listing did not finish");

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("H9elix.c-insight"); assert(extension); await extension.activate();
  const folders = vscode.workspace.workspaceFolders!;
  const uri = (name: string) => vscode.Uri.joinPath(folders[0].uri, name);
  assert.equal((await state()).scans, 0, "A collapsed Project Files view must not scan on activation");
  await vscode.commands.executeCommand("cInsight.projectFiles.focus");
  const initial = await idle();
  assert(initial.visible);
  assert(initial.files.some(file => file.name === "ignored.txt"), "Git ignore must not become an implicit file-list exclusion");
  assert(initial.files.some(file => file.name === "search-hidden.txt"));
  assert(initial.files.some(file => file.name === "retained.c"));
  assert(!initial.files.some(file => file.name === "secret.c" || file.uri.includes("/.git/")));
  assert.equal(initial.files.filter(file => file.name === "main.c").length, 2);
  const names = initial.files.map(file => file.name);
  assert(names.indexOf("file2.c") < names.indexOf("file10.c"));

  await vscode.window.showTextDocument(uri("readme.md"));
  await wait(async () => (await state()).files.find(file => file.active && file.uri === uri("readme.md").toString()), "Active file not marked");
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), uri("readme.md").toString(), "Highlight must not take editor focus");
  const before = (await state()).scans;
  const editor = vscode.window.activeTextEditor!;
  await editor.edit(edit => edit.insert(new vscode.Position(0, 0), "Edited\n"));
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.equal((await state()).scans, before, "Editing text must not rescan files");
  const config = vscode.workspace.getConfiguration("cInsight.projectFiles");
  await config.update("sortBy", "path", vscode.ConfigurationTarget.Workspace);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal((await state()).scans, before, "Sorting must not rescan files");
  await config.update("followActiveEditor", false, vscode.ConfigurationTarget.Workspace);
  await wait(async () => (await state()).files.every(file => !file.active) ? true : undefined, "Disabling active file tracking did not remove highlight");
  await config.update("followActiveEditor", true, vscode.ConfigurationTarget.Workspace);

  await vscode.workspace.fs.writeFile(uri("created.txt"), Buffer.from("Created\n"));
  await wait(async () => (await state()).files.some(file => file.name === "created.txt") ? true : undefined, "Created file missing");
  await vscode.workspace.fs.rename(uri("created.txt"), uri("renamed.txt"));
  await wait(async () => { const value = await state(); return value.files.some(file => file.name === "renamed.txt") && !value.files.some(file => file.name === "created.txt") ? true : undefined; }, "Renamed file stale");
  await vscode.workspace.fs.delete(uri("renamed.txt"));
  await wait(async () => !(await state()).files.some(file => file.name === "renamed.txt") ? true : undefined, "Deleted file retained");

  await vscode.commands.executeCommand("cInsight.preview.focus");
  await vscode.commands.executeCommand("cInsight.projectFiles.focus");
  const rows = await vscode.commands.executeCommand<Row[]>("cInsight.test.resultTreeInteraction", "cInsight.projectFiles");
  const target = rows!.find(row => row.uri === vscode.Uri.joinPath(folders[1].uri, "readme.md").toString()); assert(target);
  const original = vscode.window.activeTextEditor?.document.uri.toString();
  await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.projectFiles", { type: "activate", id: target.id, intent: "preview" });
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), original, "Single click must not navigate the editor");
  const preview = await vscode.commands.executeCommand<{ uri: string }>("cInsight.test.previewState");
  assert.equal(preview?.uri, target.uri);
  const binary = rows!.find(row => row.uri === uri("pixel.png").toString()); assert(binary);
  await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.projectFiles", { type: "activate", id: binary.id, intent: "preview" });
  assert.equal((await vscode.commands.executeCommand<{ uri: string }>("cInsight.test.previewState"))?.uri, target.uri, "Binary preview must preserve current text");
  const oversized = rows!.find(row => row.uri === uri("large.txt").toString()); assert(oversized);
  await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.projectFiles", { type: "activate", id: oversized.id, intent: "preview" });
  assert.equal((await vscode.commands.executeCommand<{ uri: string }>("cInsight.test.previewState"))?.uri, target.uri);
  assert(!vscode.workspace.textDocuments.some(document => document.uri.toString() === uri("large.txt").toString()), "Oversized file was opened as text just to preview it");
  await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.projectFiles", { type: "activate", id: target.id, intent: "open" });
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), target.uri);
  assert.equal(vscode.window.activeTextEditor?.selection.active.line, 0);
  await vscode.commands.executeCommand("cInsight.test.resultTreeInteraction", "cInsight.projectFiles", { type: "activate", id: binary.id, intent: "open" });
  await wait(async () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputCustom && input.uri.toString() === uri("pixel.png").toString() ? true : undefined;
  }, "Image did not open in its default resource editor");
  await wait(async () => (await state()).files.find(file => file.active && file.uri === uri("pixel.png").toString()), "Resource editor activity not marked");

  await verifyProjectFilesFollowing(folders);

  await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
  await wait(async () => !(await state()).visible ? true : undefined, "View did not hide");
  const hiddenScans = (await state()).scans;
  await vscode.workspace.fs.writeFile(uri("while-hidden.txt"), Buffer.from("Hidden change\n"));
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal((await state()).scans, hiddenScans, "Hidden view must not scan");
  await vscode.commands.executeCommand("cInsight.projectFiles.focus");
  await wait(async () => (await state()).files.some(file => file.name === "while-hidden.txt") ? true : undefined, "Showing the view did not reconcile hidden changes");

  // Hold a real completed filesystem result before publication, then invalidate it.
  // The actual controller must cancel, serialize, discard it and publish a fresh scan.
  const controller = await vscode.commands.executeCommand<{
    discoverFiles(maximum: number, token: vscode.CancellationToken): Thenable<vscode.Uri[]>;
  }>("cInsight.test.projectFilesController"); assert(controller);
  const discover = controller.discoverFiles.bind(controller);
  let release!: () => void;
  let heldToken: vscode.CancellationToken | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  controller.discoverFiles = async (maximum, token) => {
    const files = await discover(maximum, token);
    heldToken = token; started = true;
    await held;
    return files;
  };
  const filesConfig = vscode.workspace.getConfiguration("files");
  const excludes = filesConfig.get<Record<string, boolean>>("exclude", {});
  try {
    await vscode.commands.executeCommand("cInsight.projectFiles.refresh");
    await wait(async () => started ? true : undefined, "Controlled scan did not start");
    const heldScans = (await state()).scans;
    await vscode.workspace.fs.writeFile(uri("late-create.txt"), Buffer.from("New generation\n"));
    await filesConfig.update("exclude", { ...excludes, "**/readme.md": true }, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal((await state()).scans, heldScans, "A second enumeration ran concurrently");
    assert(heldToken?.isCancellationRequested, "Invalidation did not cancel the old scan");
    controller.discoverFiles = discover;
    release();
    const fresh = await idle();
    assert(fresh.files.some(file => file.name === "late-create.txt"));
    assert(!fresh.files.some(file => file.name === "readme.md"), "Old enumeration replaced the new exclude configuration");
  } finally {
    controller.discoverFiles = discover; release();
    await filesConfig.update("exclude", excludes, vscode.ConfigurationTarget.Workspace);
    await idle();
  }

  // Limit feedback must remain explicit, including the scope of local filtering.
  await vscode.workspace.fs.createDirectory(uri("cap"));
  for (let start = 0; start < 1001; start += 50) {
    await Promise.all(Array.from({ length: Math.min(50, 1001 - start) }, (_, offset) =>
      vscode.workspace.fs.writeFile(uri(`cap/item${start + offset}.txt`), new Uint8Array())));
  }
  await config.update("maximumFiles", 1000, vscode.ConfigurationTarget.Workspace);
  const limited = await wait(async () => { const value = await state(); return !value.scanning && value.truncated ? value : undefined; }, "Limit not reported");
  assert(limited.files.length <= 1000);
  assert(limited.status.includes("incomplete"));
  await config.update("maximumFiles", 50000, vscode.ConfigurationTarget.Workspace);
  await wait(async () => { const value = await state(); return !value.scanning && !value.dirty && !value.truncated && value.files.length > 1000 ? true : undefined; }, "Restoring the limit failed");
  console.log("PROJECT_FILES: multi-root inventory, excludes, natural sort, active text/resource files, edit/sort no-rescan, file events, hidden reconciliation, cancelled/serialized stale-result rejection, preview/open, binary fallback, and explicit limits passed.");
}
