import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import * as vscode from "vscode";
import { RendererProbe } from "../rendererProbe";
import { nearNative, median } from "../searchPerformanceModel";

type Timing = {first?: number; complete: number; renderedMs: number; stable: boolean};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function run(): Promise<void> {
  const probe = await RendererProbe.connect(process.env.C_INSIGHT_SEARCH_CDP_PORT!);
  const rows: unknown[] = [], comparisons: unknown[] = [];
  const nativeOnly = process.env.C_INSIGHT_SEARCH_UI_NATIVE_ONLY === "1";
  try {
    const startup = performance.now();
    await vscode.commands.executeCommand("workbench.action.findInFiles", {query: "CI_SEARCH_WARMUP", filesToInclude: "**/*.{c,h,cpp,hpp}", isCaseSensitive: false, triggerSearch: true});
    const nativeContext = await probe.context(".search-view");
    console.log("SEARCH_UI_FIRST_OPEN", JSON.stringify({kind: "native", ms: performance.now() - startup})); await pause(300);
    assert(!vscode.extensions.getExtension("H9elix.c-insight")?.isActive, "Native first-open baseline must not activate C Insight");
    let ciContext: Awaited<ReturnType<RendererProbe["context"]>> | undefined;
    if (!nativeOnly) {
      const startup = performance.now(); await vscode.commands.executeCommand("cInsight.searchText");
      ciContext = await probe.context("#results .search-space");
      console.log("SEARCH_UI_FIRST_OPEN", JSON.stringify({kind: "cInsight", ms: performance.now() - startup})); await pause(300);
      // A clean profile initially expands the other C Insight panes. Give the measured search a real viewport.
      await probe.evaluate(`(()=>{for(const header of document.querySelectorAll('.pane-header'))if(header.offsetParent!==null&&header.getAttribute('aria-expanded')==='true'&&!header.textContent.includes('Search & Replace'))header.click();})()`, nativeContext);
      await vscode.commands.executeCommand("cInsight.textSearch.focus"); await pause(300);
      assert(await probe.evaluate<boolean>("document.getElementById('results').clientHeight>100", ciContext), "Search benchmark requires a visible results viewport");
      if (process.env.C_INSIGHT_SEARCH_UI_DIRTY === "1") {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "buffer.c"));
        const edit = new vscode.WorkspaceEdit(); edit.insert(document.uri, new vscode.Position(0, 0), "avcodec_receive_frame();\nreturn;\n");
        assert(await vscode.workspace.applyEdit(edit)); await vscode.window.showTextDocument(document); assert(document.isDirty);
      }
    }
    const prepare = (native: boolean) => `window.__ciSearchObserver?.disconnect();
      window.__ciSearchMeasure={start:performance.now(),last:performance.now(),busy:false,generation:${native ? "0" : "state.generation+1"}};
      window.__ciSearchObserver=new MutationObserver(records=>{const m=window.__ciSearchMeasure;
        ${native ? "" : "if(state?.generation!==m.generation)return;"}
        if(records.some(record=>record.target.closest?.(${native ? "'.search-view'" : "'#results,#status'"}))){m.last=performance.now();requestAnimationFrame(()=>m.rendered=performance.now()-m.start);}
        if(document.querySelector(${native ? "'.search-view .monaco-list-row'" : "'#results .match,#results .search-group'"})&&!m.firstPending){m.firstPending=true;requestAnimationFrame(()=>m.first=performance.now()-m.start);}
        const busy=${native ? "[...document.querySelectorAll('.monaco-progress-container.active:not(.done)')].some(bar=>bar.offsetParent!==null)" : "state.loading"};
        if(busy)m.busy=true;else if(m.busy)m.complete??=performance.now()-m.start;
      });window.__ciSearchObserver.observe(document.querySelector(${native ? "'.monaco-workbench'" : "'body'"}),{subtree:true,childList:true,attributes:true,characterData:true});`;
    const read = `(()=>{const m=window.__ciSearchMeasure;return {...m,stable:performance.now()-m.last>150,renderedMs:Math.max(m.rendered||0,m.first||0,m.complete||0)}})()`;
    async function measure(native: boolean, query: string, wholeWord: boolean, regex: boolean): Promise<Timing> {
      if (native) {
        await vscode.commands.executeCommand("search.action.clearSearchResults"); await pause(100);
        await probe.evaluate(prepare(true), nativeContext);
        await vscode.commands.executeCommand("workbench.action.findInFiles", {query, filesToInclude: "**/*.{c,h,cpp,hpp}", isCaseSensitive: false, isWholeWord: wholeWord, isRegex: regex, triggerSearch: true});
      } else {
        await vscode.commands.executeCommand("cInsight.searchText");
        await vscode.commands.executeCommand("cInsight.textSearch.focus");
        await vscode.commands.executeCommand("cInsight.test.textSearchMessage", {type: "input", query, scope: "workspace", include: "**/*.{c,h,cpp,hpp}", exclude: "", useIgnores: true, caseSensitive: false, wholeWord, regex});
        await pause(100); await probe.evaluate(prepare(false), ciContext);
        // Public command dispatch, not an engine call: renderer transfer and painting remain included.
        void vscode.commands.executeCommand("cInsight.textSearch.run");
      }
      let result!: Timing;
      for (let attempt = 0; attempt < 600; attempt++) {
        result = await probe.evaluate<Timing>(read, native ? nativeContext : ciContext);
        if (result.complete !== undefined && result.stable) break; await pause(20);
      }
      assert(result.complete !== undefined && result.stable, `${native ? "Native" : "C Insight"} completion/paint marker unavailable`);
      if (!query.startsWith("CI_SEARCH_ABSENT")) assert(result.first !== undefined, `No first-result paint marker: ${native ? "native" : "cInsight"}, ${query}, ${JSON.stringify(result)}, ${JSON.stringify(await probe.evaluate("({hidden:document.hidden,visibility:document.visibilityState,width:innerWidth,height:innerHeight})", native ? nativeContext : ciContext))}, ${native ? "" : JSON.stringify(await vscode.commands.executeCommand("cInsight.test.textSearchState").then((state: any) => ({generation: state.generation, stats: state.stats, error: state.error})))}`);
      return result;
    }
    for (const [query, wholeWord, regex] of [["CI_SEARCH_ABSENT_c2a6d8e0", false, false], ["avcodec_receive_frame", false, false], ["return", false, false],
      ["avcodec_receive_frame", true, false], ["avcodec_(?:receive_frame|send_packet)", false, true]] as const) {
      const samples = {native: [] as Timing[], cInsight: [] as Timing[]};
      for (let repeat = -1; repeat < 5; repeat++) {
        for (const kind of nativeOnly ? ["native"] as const : repeat % 2 === 0 ? ["native", "cInsight"] as const : ["cInsight", "native"] as const) {
          const result = await measure(kind === "native", query, wholeWord, regex);
          if (repeat >= 0) {samples[kind].push(result); rows.push({kind, query, wholeWord, regex, repeat, firstMs: result.first, completeMs: result.complete, renderedMs: result.renderedMs});}
        }
      }
      if (nativeOnly) {console.log("NATIVE_SEARCH_MEDIAN", JSON.stringify({query, firstMs: samples.native[0].first === undefined ? undefined : median(samples.native.map(sample => sample.first!)), completeMs: median(samples.native.map(sample => sample.complete)), renderedMs: median(samples.native.map(sample => sample.renderedMs))})); continue;}
      const metrics = {first: query.startsWith("CI_SEARCH_ABSENT") ? undefined : nearNative(samples.cInsight.map(sample => sample.first!), samples.native.map(sample => sample.first!)),
        complete: nearNative(samples.cInsight.map(sample => sample.complete), samples.native.map(sample => sample.complete)),
        rendered: nearNative(samples.cInsight.map(sample => sample.renderedMs), samples.native.map(sample => sample.renderedMs))};
      comparisons.push({query, wholeWord, regex, ...metrics}); console.log("SEARCH_UI_COMPARISON", JSON.stringify(comparisons.at(-1)));
    }
    if (!nativeOnly) {
      await measure(false, "return", false, false);
      const started = performance.now(); await vscode.commands.executeCommand("cInsight.textSearch.openResults");
      const snapshot = await probe.context("body.snapshot #results .search-group");
      await probe.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))", snapshot);
      console.log("SEARCH_UI_FIRST_OPEN", JSON.stringify({kind: "snapshot", ms: performance.now() - started}));
      assert(await probe.evaluate<boolean>("getComputedStyle(document.getElementById('controls')).display==='none'&&[...document.querySelectorAll('#results input')].every(input=>input.offsetParent===null)&&document.querySelectorAll('#results .match,#results .search-group').length<=200", snapshot), "Snapshot must hide edit controls and virtualize its DOM");
      const navigation = await vscode.commands.executeCommand<{scheduler: {submitted: number}}>("cInsight.test.navigationState");
      assert.equal(navigation?.scheduler.submitted, 0, "Read-only search benchmarking must not query analysis engines");
    }
    if (process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT) await writeFile(process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT, JSON.stringify({rows, comparisons}, null, 2));
    if (process.env.C_INSIGHT_SEARCH_UI_STRICT !== "0") for (const comparison of comparisons as Array<{first?: {passed: boolean}; complete: {passed: boolean}; rendered: {passed: boolean}}>) {
      assert(comparison.first?.passed !== false && comparison.complete.passed && comparison.rendered.passed, "Near-native UI performance target missed; inspect the saved measurements");
    }
  } finally {probe.dispose();}
}
