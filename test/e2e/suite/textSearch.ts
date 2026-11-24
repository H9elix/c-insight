import assert from "node:assert/strict";
import { WorkspaceTextSearch, DEFAULT_SEARCH_BUDGET, type SearchFile, type SearchRequest, type SearchStats } from "../../../src/textSearch/workspaceSearch";
import { DEFAULT_SEARCH_OPTIONS, contentHash } from "../../../src/textSearch/searchModel";
import { createReplacementPlan, applyReplacementPlan } from "../../../src/textSearch/replacementPlan";
import * as vscode from "vscode";
import { join } from "node:path";

interface State {revision: number; generation: number; request: SearchRequest; results: SearchFile[]; stats: SearchStats; stale: boolean; ready: boolean; plan?: string; error?: string}
const state = () => vscode.commands.executeCommand<State>("cInsight.test.textSearchState") as Promise<State>;
const message = (value: object) => vscode.commands.executeCommand("cInsight.test.textSearchMessage", value);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("H9elix.c-insight"); assert(extension); await extension.activate();
  const roots = vscode.workspace.workspaceFolders!;
  const a = vscode.Uri.joinPath(roots[0].uri, "src/a.txt"), b = vscode.Uri.joinPath(roots[1].uri, "b.txt");
  const engine = new WorkspaceTextSearch(join(extension.extensionPath, "dist/textSearchWorker.js"));
  const request: SearchRequest = {...DEFAULT_SEARCH_OPTIONS, query: "needle", scope: "workspace", include: "**/*.{txt,log}", exclude: "", useIgnores: true};
  const collect = async (options = request, budget = DEFAULT_SEARCH_BUDGET) => {
    const files: SearchFile[] = [];
    const stats = await engine.run(options, a, budget, new AbortController().signal, file => files.push(file), () => undefined);
    return {files, stats};
  };
  const baseline = await collect();
  assert.equal(baseline.stats.matches, 4); assert.equal(baseline.files.length, 3);
  assert(baseline.files.every(file => !/ignored|search-hidden|drop|private/.test(file.label)));
  assert(!vscode.workspace.textDocuments.some(doc => doc.uri.toString() === b.toString()), "Scanning must not open files as documents");
  assert.equal((await collect({...request, useIgnores: false})).stats.matches, 7);
  assert((await collect(request, {...DEFAULT_SEARCH_BUDGET, maximumMatches: 1})).stats.limited);
  assert((await collect(request, {...DEFAULT_SEARCH_BUDGET, maximumFiles: 1})).stats.limited);
  assert.equal((await collect({...request, scope: "folder", folder: vscode.Uri.joinPath(roots[0].uri, "src").toString()})).stats.matches, 3);
  const document = await vscode.workspace.openTextDocument(a); await vscode.window.showTextDocument(document);
  const dirty = new vscode.WorkspaceEdit(); dirty.insert(a, new vscode.Position(0, 0), "needle dirty\n"); assert(await vscode.workspace.applyEdit(dirty));
  const current = await collect({...request, scope: "file"}); assert.equal(current.stats.matches, 3); assert(document.isDirty);
  assert.equal((await collect({...request, scope: "open"})).stats.matches, 3);

  const plan = await createReplacementPlan(current.files, new Set(current.files.flatMap(file => file.matches.map(match => match.id))), 1,
    request, "thread", false, uri => engine.read(uri, DEFAULT_SEARCH_BUDGET.maximumFileBytes));
  const before = document.getText(); assert(plan.files[0].after.startsWith("thread dirty"));
  assert.equal(document.getText(), before, "Diff planning is read-only");
  await assert.rejects(applyReplacementPlan(plan, request, "thread", false, () => false)); assert.equal(document.getText(), before);
  await applyReplacementPlan(plan, request, "thread", false, () => true); assert(document.getText().startsWith("thread dirty"));
  assert(document.isDirty); await vscode.commands.executeCommand("undo"); assert.equal(document.getText(), before);
  const two = await collect({...request, include: "**/*.txt"});
  const both = await createReplacementPlan(two.files, new Set(two.files.flatMap(file => file.matches.map(match => match.id))), 2,
    request, "changed", false, uri => engine.read(uri, DEFAULT_SEARCH_BUDGET.maximumFileBytes));
  await applyReplacementPlan(both, request, "changed", false, () => true);
  const other = await vscode.workspace.openTextDocument(b); assert(other.getText().includes("changed"));
  await vscode.window.showTextDocument(document); await vscode.commands.executeCommand("undo");
  assert.equal(document.getText(), before); assert(other.getText().includes("needle"), "One workspace edit must undo across files");
  const conflict = new vscode.WorkspaceEdit(); conflict.insert(b, new vscode.Position(0, 0), "new\n"); await vscode.workspace.applyEdit(conflict);
  await assert.rejects(applyReplacementPlan(both, request, "changed", false, () => true)); assert.equal(document.getText(), before, "Conflicts must not partially edit other files");
  const cancelled = new AbortController(); cancelled.abort();
  const stopped = await engine.run(request, a, DEFAULT_SEARCH_BUDGET, cancelled.signal, () => assert.fail("Cancelled search yielded results"), () => undefined);
  assert(stopped.cancelled);
  console.log("TEXT_SEARCH_ENGINE: ignore, multi-root, dirty content, caps, cancellation, diff, conflict and multi-file undo passed");

  await vscode.commands.executeCommand("cInsight.searchText");
  await message({type: "input", ...request, scope: "file", replacement: "needle_updated"});
  const generation = (await state()).generation; await pause(300); assert.equal((await state()).generation, generation, "Typing must not start a query");
  const scheduler = await vscode.commands.executeCommand<{scheduler: {submitted: number}}>("cInsight.test.navigationState");
  await message({type: "search"}); let result = await state(); assert.equal(result.stats.matches, 3); assert(result.ready);
  const target = result.results[0].matches[0];
  const editorBefore = vscode.window.activeTextEditor?.document.uri.toString();
  await message({type: "activate", id: target.id, intent: "preview", revision: result.revision});
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), editorBefore);
  assert.equal((await vscode.commands.executeCommand<{uri: string}>("cInsight.test.previewState"))?.uri, a.toString());
  await message({type: "activate", id: target.id, intent: "open", revision: result.revision});
  assert.equal(vscode.window.activeTextEditor?.selection.active.line, 0); assert.equal((await state()).request.query, "needle");
  await message({type: "plan", mode: "all", revision: result.revision}); result = await state(); assert(result.plan);
  const planId = result.plan;
  await message({type: "check", id: target.id, checked: false, revision: result.revision}); assert(!(await state()).plan);
  await message({type: "apply", plan: planId, revision: (await state()).revision}); assert.equal(document.getText(), before);
  await message({type: "plan", mode: "all", revision: (await state()).revision});
  const appliedPlan = (await state()).plan; assert(appliedPlan);
  await vscode.commands.executeCommand("cInsight.test.textSearchApply", appliedPlan);
  const replaced = await state(); assert(!replaced.error, replaced.error); assert.equal(replaced.stats.matches, 0, "Inserted search text must not be rediscovered for repeated replacement");
  assert(document.getText().includes("needle_updated"));
  await vscode.window.showTextDocument(document); await vscode.commands.executeCommand("undo"); assert.equal(document.getText(), before);
  await message({type: "search"});
  const edit = new vscode.WorkspaceEdit(); edit.insert(a, new vscode.Position(0, 0), " "); await vscode.workspace.applyEdit(edit);
  result = await state(); assert(result.stale); assert.equal(result.generation, generation + 2, "Editing may invalidate, never rescan");
  const after = await vscode.commands.executeCommand<{scheduler: {submitted: number}}>("cInsight.test.navigationState");
  assert.equal(after?.scheduler.submitted, scheduler?.scheduler.submitted, "Text search must not use the analysis engine");
  assert.equal(contentHash(document.getText()), contentHash(" " + before));
  console.log("TEXT_SEARCH_VIEW: manual start, source preview/open, retained query, selection invalidation and zero engine requests passed");
}
