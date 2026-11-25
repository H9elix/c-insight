import assert from "node:assert/strict";
import { WorkspaceTextSearch, DEFAULT_SEARCH_BUDGET, type SearchFile, type SearchRequest, type SearchStats } from "../../../src/textSearch/workspaceSearch";
import { DEFAULT_SEARCH_OPTIONS, contentHash } from "../../../src/textSearch/searchModel";
import { createReplacementPlan, applyReplacementPlan } from "../../../src/textSearch/replacementPlan";
import * as vscode from "vscode";
import { join } from "node:path";
import { searchDiagnostics } from "../../../src/textSearch/searchDiagnostics";
import * as iconv from "iconv-lite";

interface State {revision: number; generation: number; request: SearchRequest; results: SearchFile[]; stats: SearchStats; stale: boolean; ready: boolean; plan?: string; error?: string; visible: number; selected?: string;
  resultWindows: Array<{generation: number; query: string; matches: number; stale: boolean; loading: boolean; selected?: string; cancelled: boolean}>}
const state = () => vscode.commands.executeCommand<State>("cInsight.test.textSearchState") as Promise<State>;
const message = (value: object) => vscode.commands.executeCommand("cInsight.test.textSearchMessage", value);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("H9elix.c-insight"); assert(extension); await extension.activate();
  const roots = vscode.workspace.workspaceFolders!;
  const a = vscode.Uri.joinPath(roots[0].uri, "src/a.txt"), b = vscode.Uri.joinPath(roots[1].uri, "b.txt");
  const engine = new WorkspaceTextSearch(join(extension.extensionPath, "dist/textSearchWorker.js"));
  const request: SearchRequest = {...DEFAULT_SEARCH_OPTIONS, query: "needle", scope: "workspace", include: "", exclude: "", useIgnores: true};
  const collect = async (options = request, budget = DEFAULT_SEARCH_BUDGET) => {
    const files: SearchFile[] = [];
    const stats = await engine.run(options, a, budget, new AbortController().signal, file => files.push(file), () => undefined);
    return {files, stats};
  };
  const baseline = await collect();
  const fallback = new WorkspaceTextSearch(join(extension.extensionPath, "dist/textSearchWorker.js"), {ripgrepPath: join(extension.extensionPath, "missing-ripgrep")});
  await assert.rejects(fallback.run(request, a, DEFAULT_SEARCH_BUDGET, new AbortController().signal, () => undefined, () => undefined), /unavailable/);
  const nativeDiagnostics = searchDiagnostics();
  await engine.run(request, a, DEFAULT_SEARCH_BUDGET, new AbortController().signal, () => undefined, () => undefined, nativeDiagnostics);
  assert.equal(nativeDiagnostics.backend, "ripgrep"); assert(nativeDiagnostics.decodedFiles < nativeDiagnostics.candidateFiles);
  assert.equal(baseline.stats.matches, 4); assert.equal(baseline.files.length, 3);
  assert(baseline.files.every(file => !/ignored|search-hidden|drop|private/.test(file.label)));
  assert(!vscode.workspace.textDocuments.some(doc => doc.uri.toString() === b.toString()), "Scanning must not open files as documents");
  assert.equal((await collect({...request, useIgnores: false})).stats.matches, 8);
  assert((await collect(request, {...DEFAULT_SEARCH_BUDGET, maximumMatches: 1})).stats.limited);
  assert.equal((await collect({...request, scope: "folder", folder: vscode.Uri.joinPath(roots[0].uri, "src").toString()})).stats.matches, 3);
  const document = await vscode.workspace.openTextDocument(a); await vscode.window.showTextDocument(document);
  const dirty = new vscode.WorkspaceEdit(); dirty.insert(a, new vscode.Position(0, 0), "needle dirty\n"); assert(await vscode.workspace.applyEdit(dirty));
  assert.equal((await collect({...request, query: "dirty"})).stats.matches, 1, "Workspace prefilter must retain new matches present only in unsaved buffers");
  const current = await collect({...request, scope: "file"}); assert.equal(current.stats.matches, 3); assert(document.isDirty);
  assert.equal((await collect({...request, scope: "open"})).stats.matches, 3);
  assert.equal((await collect({...request, query: "dirty"})).stats.matches, 1, "Native disk filtering must not hide a match present only in an unsaved buffer");

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
  const single = await state(), middle = single.results[0].matches[1], following = single.results[0].matches[2];
  await message({type: "activate", id: middle.id, intent: "preview", revision: single.revision});
  await message({type: "plan", mode: "current", revision: single.revision});
  await vscode.commands.executeCommand("cInsight.test.textSearchApply", (await state()).plan);
  assert.equal((await state()).selected, following.id, "Single replacement must move to the next original match, not an earlier hit");
  assert.equal((await state()).stats.matches, 2); assert(!(await state()).error);
  await vscode.window.showTextDocument(document); await vscode.commands.executeCommand("undo"); assert.equal(document.getText(), before);
  await message({type: "search"});
  const edit = new vscode.WorkspaceEdit(); edit.insert(a, new vscode.Position(0, 0), " "); await vscode.workspace.applyEdit(edit);
  result = await state(); assert(result.stale); assert.equal(result.generation, generation + 3, "Editing may invalidate, never rescan");
  const after = await vscode.commands.executeCommand<{scheduler: {submitted: number}}>("cInsight.test.navigationState");
  assert.equal(after?.scheduler.submitted, scheduler?.scheduler.submitted, "Text search must not use the analysis engine");
  assert.equal(contentHash(document.getText()), contentHash(" " + before));
  console.log("TEXT_SEARCH_VIEW: manual start, source preview/open, retained query, selection invalidation and zero engine requests passed");

  const scale = vscode.Uri.joinPath(roots[0].uri, "scale"); await vscode.workspace.fs.createDirectory(scale);
  for (let batch = 0; batch < 20; batch++) await Promise.all(Array.from({length: 50}, (_, index) =>
    vscode.workspace.fs.writeFile(vscode.Uri.joinPath(scale, `${batch * 50 + index}.txt`), Buffer.from("PERF_NEEDLE\n".repeat(24)))));
  let ticks = 0; const timer = setInterval(() => ticks++, 5), started = Date.now(), documentsBefore = vscode.workspace.textDocuments.length;
  const performanceFiles: SearchFile[] = [];
  const performance = await engine.run({...request, query: "PERF_NEEDLE", scope: "folder", folder: scale.toString()}, a,
    DEFAULT_SEARCH_BUDGET, new AbortController().signal, file => performanceFiles.push(file), () => undefined);
  clearInterval(timer);
  assert(performance.limited); assert.equal(performance.matches, 20000); assert(ticks > 0);
  assert.equal(vscode.workspace.textDocuments.length, documentsBefore, "Scanning must not open matched files as documents");
  assert.equal(performanceFiles.reduce((sum, file) => sum + file.matches.length, 0), 20000);
  console.log(`TEXT_SEARCH_SCALE: 1000-file fixture, 20000 retained matches, ${Date.now() - started} ms, ${ticks} responsive ticks, zero opened documents`);

  await vscode.commands.executeCommand("cInsight.searchText");
  await message({type: "input", query: "PERF_NEEDLE", scope: "workspace", include: "**/scale/**/*.txt"});
  const scanning = message({type: "search"}); await pause(25);
  await vscode.commands.executeCommand("workbench.action.closeSidebar"); await scanning;
  const hidden = await state(); assert.equal(hidden.visible, 0); assert(hidden.stats.cancelled, "All hidden presentations must cancel the search");
  await vscode.commands.executeCommand("cInsight.searchText"); await pause(100);
  assert.equal((await state()).generation, hidden.generation, "Showing partial results must not restart a scan");
  console.log("TEXT_SEARCH_VISIBILITY: hide-all cancellation and show-without-rescan passed");
  const combined = vscode.workspace.getConfiguration("cInsight.combinedViews");
  for (const slot of [1, 2]) {
    await combined.update(`slot${slot}`, {enabled: true, title: `Search ${slot}`, direction: "horizontal", views: ["textSearch", "preview"], ratios: [1, 1]}, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand(`cInsight.combined${slot}.focus`);
  }
  type Inspection = {panes: Array<{role: string; searchQuery?: string; searchChecked?: number; searchOpen?: boolean; searchRowMarker?: string; searchTokenMarker?: string; searchRendered?: number; searchTotal?: number}>};
  const browser = async (slot: number, action?: object): Promise<Inspection> => {
    try { return await vscode.commands.executeCommand<Inspection>("cInsight.test.combinedBrowser", slot, action) as Inspection; }
    catch (error) { throw new Error(`Search browser slot=${slot} action=${JSON.stringify(action)} surfaces=${JSON.stringify(await vscode.commands.executeCommand("cInsight.test.combinedState"))}: ${String(error)}`); }
  };
  const pane = async (slot: number) => (await browser(slot)).panes.find(pane => pane.role === "textSearch");
  const until = async (query: () => Promise<boolean>, reason: string) => {
    for (let i = 0; i < 100; i++) { if (await query()) return; await pause(50); } assert.fail(reason);
  };
  await until(async () => {
    const surfaces = await vscode.commands.executeCommand<Array<{slot: number; ready: boolean; panes: Array<{generation: number; acknowledged?: number}>}>>("cInsight.test.combinedState");
    return [1, 2].every(slot => surfaces?.some(surface => surface.slot === slot && surface.ready && surface.panes.length === 2 && surface.panes.every(pane => pane.generation === pane.acknowledged)));
  }, "Combined bridges and child renderers did not acknowledge initialization");
  await until(async () => (await pane(1))?.searchQuery === "PERF_NEEDLE" && (await pane(2))?.searchQuery === "PERF_NEEDLE", "Search renderers were not initialized");
  for (const [control, value] of [["scope", "file"], ["include", ""], ["query", "needle"]]) await browser(1, {action: "textSearch", role: "textSearch", control, value});
  await until(async () => (await pane(2))?.searchQuery === "needle", "Query was not shared across presentations");
  const beforeBrowserQuery = (await state()).generation;
  await browser(1, {action: "textSearch", role: "textSearch", control: "search"});
  await until(async () => (await state()).generation === beforeBrowserQuery + 1 && (await pane(2))?.searchChecked === 3, "Browser Enter/Search did not populate both renderers");
  await browser(1, {action: "textSearch", role: "textSearch", control: "preview"}); await pause(100);
  assert.equal((await pane(1))?.searchRowMarker, "stable", "Preview selection must retain row DOM so a subsequent double-click reaches the same target");
  assert.equal((await pane(1))?.searchTokenMarker, "stable", "Selection-only updates must retain the clicked token node");
  await browser(1, {action: "textSearch", role: "textSearch", control: "collapse"});
  await browser(2, {action: "textSearch", role: "textSearch", control: "check"});
  await until(async () => (await pane(2))?.searchChecked === 2, "Replacement selections were not shared");
  assert.equal((await pane(1))?.searchOpen, false); assert.equal((await pane(2))?.searchOpen, true);
  assert.equal((await state()).generation, beforeBrowserQuery + 1, "Presentation actions started another search");
  await message({type: "input", scope: "workspace", include: "**/*.txt", query: "other"}); await message({type: "search"});
  const originalMatches = await state();
  const unrelated = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(roots[0].uri, "src/no-hit.txt"));
  const change = new vscode.WorkspaceEdit(); change.insert(unrelated.uri, new vscode.Position(0, 0), "other\n");
  await vscode.workspace.applyEdit(change);
  assert((await state()).stale, "Changing an initially unmatched file must invalidate a workspace search snapshot");
  assert.equal((await state()).generation, originalMatches.generation, "Source invalidation must not rescan");
  await message({type: "input", scope: "workspace", include: "**/scale/**/*.txt", query: "PERF_NEEDLE"}); await message({type: "search"});
  await until(async () => ((await pane(1))?.searchTotal ?? 0) >= 200, "Inline result prefix did not arrive");
  assert(((await pane(1))?.searchTotal ?? 0) <= 210, "Inline limit counts matches, not the complete query");
  assert(((await pane(1))?.searchRendered ?? 1000) <= 200, "Large result sets must not create all DOM rows");
  await browser(1, {action: "textSearch", role: "textSearch", control: "scroll", value: 100000}); await pause(50);
  assert(((await pane(1))?.searchRendered ?? 1000) <= 200);
  console.log("TEXT_SEARCH_COMBINED: live browser controls, shared query/results/checkboxes and independent group expansion passed");

  const parity = vscode.Uri.joinPath(roots[0].uri, "parity"); await vscode.workspace.fs.createDirectory(parity);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(parity, "a.txt"), Buffer.from("Needle needle needles ſ K 中文\n😀needle\r\n"));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(parity, "bom.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("needle 中文", "utf16le")]));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(parity, "multi.txt"), Buffer.from("first\nsecond\n"));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(parity, ".rgignore"), Buffer.from("a.txt\n"));
  const compare = async (service: WorkspaceTextSearch, options: SearchRequest) => {
    const found: string[] = [], diagnostics = searchDiagnostics();
    const stats = await service.run(options, a, DEFAULT_SEARCH_BUDGET, new AbortController().signal,
      file => found.push(...file.matches.map(match => `${file.uri}:${match.start}:${match.end}`)), () => undefined, diagnostics);
    return {found: found.sort(), stats, diagnostics};
  };
  for (const [options, count] of [
    [{...request, query: "needle", wholeWord: true}, 4], [{...request, query: "k"}, 1],
    [{...request, query: "中文"}, 2], [{...request, query: "first.*second", regex: true, multiline: true}, 0],
    [{...request, query: "first\\nsecond", regex: true}, 1],
  ] as const) {
    const query: SearchRequest = {...options, scope: "folder", folder: parity.toString(), include: "**/*.txt", useIgnores: false};
    const fast = await compare(engine, query);
    assert.equal(fast.found.length, count, JSON.stringify(options)); assert.equal(fast.diagnostics.backend, "ripgrep");
  }
  assert.equal((await collect({...request, scope: "folder", folder: parity.toString(), include: ""})).stats.matches, 1, ".rgignore must be respected without an explicit overriding include glob");
  const encoding = vscode.workspace.getConfiguration("files", roots[0].uri);
  const previousEncoding = encoding.inspect<string>("encoding")?.workspaceFolderValue;
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(parity, "gbk.txt"), iconv.encode("needle 中文\r\n", "gbk"));
  try {
    await encoding.update("encoding", "gbk", vscode.ConfigurationTarget.WorkspaceFolder);
    const query: SearchRequest = {...request, scope: "folder", folder: parity.toString(), include: "**/gbk.txt"};
    const result = await compare(engine, query);
    assert.equal(result.found.length, 1); assert.equal(result.diagnostics.backend, "ripgrep");
  } finally { await encoding.update("encoding", previousEncoding, vscode.ConfigurationTarget.WorkspaceFolder); }
  const unlimited = await collect({...request, scope: "folder", folder: scale.toString()}, {...DEFAULT_SEARCH_BUDGET, maximumMatches: Infinity});
  assert.equal(unlimited.stats.matches, 24000); assert(!unlimited.stats.limited);
  console.log("TEXT_SEARCH_PARITY: native positions, Unicode words, BOM/GBK, newline detection, missing-binary errors and unlimited results passed");

  await message({type: "input", scope: "workspace", include: "**/scale/**/*.txt", query: "PERF_NEEDLE", regex: false});
  const streaming = message({type: "search"});
  await until(async () => {const current = await state(); return current.stats.matches > 0 && (current as State & {loading: boolean}).loading;}, "No streaming results before query completion");
  await vscode.commands.executeCommand("cInsight.textSearch.openResults");
  assert((await state()).resultWindows[0].loading, "Opening during a scan must retain a live snapshot");
  await vscode.commands.executeCommand("workbench.action.closeSidebar"); await streaming;
  const large = await state(); assert(!large.stats.cancelled, "A visible snapshot of the current query must keep its scan alive");
  await pause(50);
  assert.equal((await state()).resultWindows.length, 1); assert.equal((await state()).resultWindows[0].matches, 20000);
  await vscode.commands.executeCommand("cInsight.textSearch.openResults"); assert.equal((await state()).resultWindows.length, 1, "Opening the same query must focus its existing snapshot");
  const nextScan = message({type: "search"});
  await until(async () => {const current = await state(); return current.stats.matches > 0 && (current as State & {loading: boolean}).loading;}, "Second query did not begin streaming");
  await vscode.commands.executeCommand("workbench.action.closeSidebar"); await nextScan;
  assert((await state()).stats.cancelled, "A visible old snapshot must not keep a different query scanning");
  assert.equal((await state()).resultWindows[0].generation, large.generation);
  await message({type: "input", scope: "file", include: "", query: "needle"}); await message({type: "search"});
  const small = await state();
  assert.equal(small.resultWindows[0].query, "PERF_NEEDLE"); assert.equal(small.resultWindows[0].matches, 20000);
  await vscode.commands.executeCommand("cInsight.textSearch.openResults");
  assert.equal((await state()).resultWindows.length, 2);
  const snapshotMessage = (generation: number, value: object) => vscode.commands.executeCommand("cInsight.test.textSearchResultMessage", generation, {revision: generation, ...value});
  await snapshotMessage(small.generation, {type: "input", query: "not-allowed"});
  await snapshotMessage(small.generation, {type: "plan", mode: "all"});
  assert.equal((await state()).request.query, "needle"); assert(!(await state()).plan);
  const hit = small.results[0].matches[0];
  await snapshotMessage(small.generation, {type: "activate", id: hit.id, intent: "preview"});
  assert.equal((await state()).resultWindows.find(window => window.generation === small.generation)?.selected, hit.id);
  assert.equal((await vscode.commands.executeCommand<{uri: string}>("cInsight.test.previewState"))?.uri, a.toString());
  const mutation = new vscode.WorkspaceEdit(); mutation.insert(a, new vscode.Position(0, 0), "snapshot changed\n"); await vscode.workspace.applyEdit(mutation);
  assert((await state()).resultWindows.find(window => window.generation === small.generation)?.stale);
  const selection = vscode.window.activeTextEditor?.selection;
  await snapshotMessage(small.generation, {type: "activate", id: hit.id, intent: "open"});
  assert.deepEqual(vscode.window.activeTextEditor?.selection, selection, "Stale snapshot targets must not open incorrect positions");
  assert.equal((await state()).resultWindows.find(window => window.generation === large.generation)?.matches, 20000);
  const panels = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes("cInsight.textSearchResults"));
  assert.equal(panels.length, 2); await vscode.window.tabGroups.close(panels, true); assert.equal((await state()).resultWindows.length, 0);
  console.log("TEXT_SEARCH_SNAPSHOTS: inline cap, frozen distinct queries, same-query reuse, preview, read-only messages, stale navigation and close cleanup passed");
  const nativeConfig = vscode.workspace.getConfiguration("search"), ownConfig = vscode.workspace.getConfiguration("cInsight.textSearch");
  const nativeLimit = nativeConfig.inspect<number | null>("maxResults")?.workspaceValue;
  const legacyLimit = ownConfig.inspect<number>("maximumMatches")?.workspaceValue;
  try {
    await nativeConfig.update("maxResults", 1, vscode.ConfigurationTarget.Workspace);
    await message({type: "input", scope: "workspace", query: "PERF_NEEDLE", include: "**/scale/**/*.txt"}); await message({type: "search"});
    assert.equal((await state()).stats.matches, 1); assert((await state()).stats.limited);
    await nativeConfig.update("maxResults", null, vscode.ConfigurationTarget.Workspace);
    await ownConfig.update("maximumMatches", 1, vscode.ConfigurationTarget.Workspace);
    await message({type: "search"}); assert.equal((await state()).stats.matches, 24000); assert(!(await state()).stats.limited);
  } finally {
    await nativeConfig.update("maxResults", nativeLimit, vscode.ConfigurationTarget.Workspace);
    await ownConfig.update("maximumMatches", legacyLimit, vscode.ConfigurationTarget.Workspace);
  }
  console.log("TEXT_SEARCH_SETTINGS: native maxResults/null and ignored legacy caps passed");
}
