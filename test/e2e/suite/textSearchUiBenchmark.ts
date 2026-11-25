import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import * as vscode from "vscode";
import { RendererProbe } from "../rendererProbe";
import { median } from "../searchPerformanceModel";

export async function run(): Promise<void> {
  const probe = await RendererProbe.connect(process.env.C_INSIGHT_SEARCH_CDP_PORT!);
  const rows: unknown[] = [];
  try {
    await vscode.commands.executeCommand("workbench.action.findInFiles", {query: "CI_SEARCH_WARMUP", filesToInclude: "**/*.{c,h,cpp,hpp}", isCaseSensitive: false, triggerSearch: true});
    const context = await probe.context(".search-view");
    await new Promise(resolve => setTimeout(resolve, 300));
    // A persistent renderer-side observer measures paint and completion without polling from the extension host.
    const prepare = `window.__ciSearchMeasure={start:performance.now(),first:undefined,complete:undefined,last:performance.now(),busy:false};
      window.__ciSearchObserver?.disconnect();
      window.__ciSearchObserver=new MutationObserver(records=>{const m=window.__ciSearchMeasure;
        if(records.some(record=>record.target.closest?.('.search-view'))){m.last=performance.now();requestAnimationFrame(()=>m.rendered=performance.now()-m.start);}
        if(document.querySelector('.search-view .monaco-list-row')&&!m.firstPending){m.firstPending=true;requestAnimationFrame(()=>m.first=performance.now()-m.start);}
        const busy=[...document.querySelectorAll('.monaco-progress-container.active:not(.done)')].some(bar=>bar.offsetParent!==null);
        if(busy)m.busy=true;else if(m.busy)m.complete??=performance.now()-m.start;
      });window.__ciSearchObserver.observe(document.querySelector('.monaco-workbench'),{subtree:true,childList:true,attributes:true,characterData:true});`;
    for (const query of ["CI_SEARCH_ABSENT_c2a6d8e0", "avcodec_receive_frame", "return"]) {
      const samples: Array<{first?: number; complete: number; renderedMs: number}> = [];
      for (let repeat = -1; repeat < 5; repeat++) {
      await vscode.commands.executeCommand("search.action.clearSearchResults"); await new Promise(resolve => setTimeout(resolve, 100));
      await probe.evaluate(prepare, context);
      await vscode.commands.executeCommand("workbench.action.findInFiles", {query, filesToInclude: "**/*.{c,h,cpp,hpp}", isCaseSensitive: false, triggerSearch: true});
      let result: any;
      for (let attempt = 0; attempt < 600; attempt++) {
        result = await probe.evaluate(`(()=>{const m=window.__ciSearchMeasure;return {...m,stable:performance.now()-m.last>150,renderedMs:Math.max(m.rendered||0,m.first||0,m.complete||0),elapsed:performance.now()-m.start,rows:document.querySelectorAll('.search-view .monaco-list-row').length}})()`, context);
        if (result.complete !== undefined && result.stable) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert(result.complete !== undefined, "Native search completion marker was not observed");
      if (repeat >= 0) {samples.push(result); rows.push({kind: "native", query, repeat, firstMs: result.first, completeMs: result.complete, renderedMs: result.renderedMs});}
      }
      console.log("NATIVE_SEARCH_MEDIAN", JSON.stringify({query, firstMs: query.startsWith("CI_SEARCH_ABSENT") ? undefined : median(samples.map(sample => sample.first!)),
        completeMs: median(samples.map(sample => sample.complete)), renderedMs: median(samples.map(sample => sample.renderedMs))}));
    }
    assert(!vscode.extensions.getExtension("H9elix.c-insight")?.isActive, "Native baseline must not activate C Insight engines");
    if (process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT) await writeFile(process.env.C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT, JSON.stringify(rows, null, 2));
  } finally {probe.dispose();}
}
