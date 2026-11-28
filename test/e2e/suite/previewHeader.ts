import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { AnalysisService } from "../../../src/analysis/analysisService";
import { NavigationHistoryExplorer } from "../../../src/history/navigationHistoryExplorer";
import { CodePreviewProvider } from "../../../src/views/codePreviewProvider";
import { embeddedDocument, renderCombinedWebview } from "../../../src/combined/combinedWebview";

interface Inspection {
  headerHeight: number; codeTop: number; codeBottom: number; height: number; width: number; overflow: number;
  symbol: string; file: string; line: string; tooltip: string; status: string; error: boolean; loading: boolean;
  errorLabel: string; labelVisible: boolean; announcement: string; footer: boolean; marker?: string;
  top: number; left: number; firstLine: number; lastLine: number; sourceColor: string; kindColor: string;
  buttonVisible: boolean; controlsLeft: number; targetVisible: boolean; targetTop: number; lineHeight: number;
}

const PROBE = String.raw`
window.addEventListener('message',event=>{
  const message=event.data;if(message?.type!=='headerProbe')return;
  const code=document.querySelector('.code'),header=document.querySelector('.header'),status=document.querySelector('.preview-status');
  if(message.width!==undefined)document.body.style.width=message.width?message.width+'px':'';
  if(message.action==='seed'){
    code.dataset.headerMarker='retained';code.querySelector('.line').dataset.headerMarker='retained';
    const target=code.querySelector('.line.target');code.scrollTop=target.offsetTop-code.querySelector('.line').offsetTop+80;code.scrollLeft=70;
  }
  if(message.action==='load')requestMore(message.direction);
  if(message.action==='focusLast')document.querySelector('.controls button:last-child').focus();
  const bounds=header.getBoundingClientRect(),box=code.getBoundingClientRect(),controls=document.querySelector('.controls'),controlBox=controls.getBoundingClientRect();
  const lastButton=controls.lastElementChild.getBoundingClientRect(),target=code.querySelector('.line.target')?.getBoundingClientRect();
  headerTestApi.postMessage({type:'headerInspection',request:message.request,result:{
    headerHeight:bounds.height,codeTop:box.top,codeBottom:box.bottom,height:document.documentElement.clientHeight,width:document.body.clientWidth,
    overflow:document.body.scrollWidth-document.body.clientWidth,symbol:document.querySelector('.preview-symbol').textContent,
    file:document.querySelector('.preview-file').textContent,line:document.querySelector('.preview-line').textContent,
    tooltip:document.querySelector('.title').title,status:status.title,error:status.classList.contains('error'),loading:status.classList.contains('loading'),
    errorLabel:status.querySelector('.status-label').textContent,labelVisible:!!status.querySelector('.status-label').getClientRects().length,
    announcement:document.getElementById('preview-announcement').textContent,footer:!!document.querySelector('.load-status'),
    marker:code.querySelector('.line')?.dataset.headerMarker,top:code.scrollTop,left:code.scrollLeft,
    firstLine:Number(code.querySelector('.line')?.dataset.line),lastLine:Number(code.querySelector('.line:last-child')?.dataset.line),
    sourceColor:getComputedStyle(code).color,kindColor:getComputedStyle(document.querySelector('.preview-kind')).color,
    buttonVisible:lastButton.left>=controlBox.left-1&&lastButton.right<=controlBox.right+1&&lastButton.top>=controlBox.top-1&&lastButton.bottom<=controlBox.bottom+1,controlsLeft:controls.scrollLeft,
    targetVisible:!!target&&target.top>=box.top&&target.bottom<=box.bottom,targetTop:target?target.top-box.top:0,lineHeight:code.querySelector('.line').getBoundingClientRect().height,
  }});
});
headerTestApi.postMessage({type:'headerProbeReady'});
`;

/** Actual native and embedded browser DOM; the controlled provider rejects all semantic queries. */
export async function verifyPreviewHeader(): Promise<void> {
  const config = vscode.workspace.getConfiguration("cInsight.codePreview"), previous = config.inspect("semanticHighlighting")?.globalValue;
  const previousBatch = config.inspect("loadBatchLines")?.globalValue;
  await config.update("semanticHighlighting", false, vscode.ConfigurationTarget.Global);
  await config.update("loadBatchLines", 120, vscode.ConfigurationTarget.Global);
  const history = new NavigationHistoryExplorer();
  const provider = new CodePreviewProvider(new Proxy({}, {get: () => assert.fail("Header display must not query an analysis engine")}) as AnalysisService, history);
  const visibility = new vscode.EventEmitter<void>(), disposed = new vscode.EventEmitter<void>(), received = new vscode.EventEmitter<unknown>();
  const panels: vscode.WebviewPanel[] = [], pending = new Map<number, (value: Inspection) => void>(), ready = new Set<string>(), errors: string[] = [];
  let html = "", writes = 0, serial = 0, live = false;
  const native = vscode.window.createWebviewPanel("cInsight.headerRegression", "Native preview header", vscode.ViewColumn.One, {enableScripts: true, retainContextWhenHidden: true});
  const combined = vscode.window.createWebviewPanel("cInsight.headerRegression", "Combined preview header", vscode.ViewColumn.One, {enableScripts: true, retainContextWhenHidden: true});
  panels.push(native, combined);
  const post = async (message: unknown) => {
    if (!live) return true;
    await native.webview.postMessage(message);
    await combined.webview.postMessage({type: "panePost", role: "preview", generation: 1, message});
    return true;
  };
  const view = {visible: true, onDidChangeVisibility: visibility.event, onDidDispose: disposed.event, webview: {
    options: {}, onDidReceiveMessage: received.event, get html() {return html;}, set html(value: string) {html = value; writes++;}, postMessage: post,
  }};
  const receive = (name: string, message: any) => {
    if (message.type === "headerProbeReady") ready.add(name);
    else if (message.type === "headerProbeError") errors.push(message.detail);
    else if (message.type === "headerInspection") {pending.get(message.request)?.(message.result); pending.delete(message.request);}
    else if (message.type === "loadMore" || message.type === "previewInteraction" || message.type === "saveScroll") received.fire(message);
  };
  native.webview.onDidReceiveMessage(message => receive("native", message));
  combined.webview.onDidReceiveMessage(message => {
    if (message.type === "ready") ready.add("outer");
    if (message.type === "paneMessage") receive("combined", message.message);
  });
  const wait = async (condition: () => Promise<boolean> | boolean, reason: string) => {
    const until = Date.now() + 15000;
    while (Date.now() < until) {if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 50));}
    assert.fail(`${reason}; ready=${JSON.stringify([...ready])}; errors=${JSON.stringify(errors)}`);
  };
  const inspect = (name: "native" | "combined", action: object = {}): Promise<Inspection> => {
    const request = ++serial, message = {type: "headerProbe", request, ...action};
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {pending.delete(request); reject(new Error(`No header inspection from ${name}`));}, 5000);
      pending.set(request, value => {clearTimeout(timer); resolve(value);});
      void (name === "native" ? native.webview.postMessage(message) : combined.webview.postMessage({type: "panePost", role: "preview", generation: 1, message}));
    });
  };
  try {
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const source = await vscode.workspace.openTextDocument({language: "cpp", content: Array.from({length: 500}, (_, i) => `int value_${i} = ${i}; // ${"wide source ".repeat(25)}`).join("\n")});
    const location = {uri: source.uri, range: new vscode.Range(180, 4, 180, 13)};
    await provider.showLocation(location, "definition", 'header_symbol <unsafe> "value"');
    const initialWrites = writes;
    assert(html.includes("&lt;unsafe&gt;")); assert(!html.includes("<unsafe>"));
    const nonce = "preview-header-test", scriptNonce = html.match(/<script nonce="([^"]+)"/)![1];
    const bootstrap = `<script nonce="${scriptNonce}">const headerTestApi=acquireVsCodeApi();window.acquireVsCodeApi=()=>headerTestApi;window.addEventListener('error',event=>headerTestApi.postMessage({type:'headerProbeError',detail:event.message}));</script>`;
    const document = html.replace(/<head([^>]*)>/i, `<head$1>${bootstrap}`).replace("</body>", `<script nonce="${scriptNonce}">${PROBE}</script></body>`);
    native.webview.html = document;
    combined.webview.html = renderCombinedWebview(nonce, combined.webview.cspSource, "", {empty: "Empty"}, true);
    await wait(() => {combined.reveal(undefined, true); return ready.has("outer");}, "Combined header surface did not initialize");
    await combined.webview.postMessage({type: "layout", title: "Header", hover: false, layout: {views: ["preview"], ratios: [1], direction: "horizontal"},
      panes: [{role: "preview", title: "Preview", actions: [], generation: 1, html: embeddedDocument(document, nonce, 1)}]});
    await wait(() => {native.reveal(undefined, true); return ready.has("native") && ready.has("combined");}, "Preview documents did not initialize");
    live = true;
    const baseline = new Map<string, Inspection>();
    for (const name of ["native", "combined"] as const) {
      const value = await inspect(name); baseline.set(name, value);
      assert.equal(value.line, ":181"); assert.equal(value.symbol, 'header_symbol <unsafe> "value"');
      assert.equal(value.footer, false); assert(value.status.includes("500"));
      assert(value.codeTop <= value.headerHeight + 1); assert(Math.abs(value.codeBottom - value.height) < 1, "No footer/padding should occupy code height");
      assert(value.targetVisible, "Initial target must remain visible after the header merge");
      assert(Math.abs((value.targetTop - 4) / value.lineHeight - 6) < 0.1, "Initial target must still respect linesBefore");
      await inspect(name, {action: "seed"});
    }
    const seeded = new Map<string, Inspection>();
    for (const name of ["native", "combined"] as const) seeded.set(name, await inspect(name));
    await provider.showLocation(location, "reference", "updated <symbol>");
    assert.equal(writes, initialWrites, "Metadata updates must not rebuild the source HTML");
    for (const name of ["native", "combined"] as const) {
      await wait(async () => (await inspect(name)).symbol === "updated <symbol>", "Metadata did not reach the compact header");
      const value = await inspect(name), before = seeded.get(name)!;
      assert.equal(value.top, before.top); assert.equal(value.left, before.left); assert.equal(value.marker, "retained");
      assert.equal(value.codeTop, baseline.get(name)!.codeTop);
    }
    await post({type: "incrementalLines", direction: "before", error: "synthetic <failure>"});
    for (const name of ["native", "combined"] as const) {
      await wait(async () => (await inspect(name)).error, "Loading failure was not exposed");
      const value = await inspect(name); assert(value.labelVisible); assert(value.errorLabel); assert(value.announcement.includes("synthetic <failure>"));
      assert.equal(value.headerHeight, baseline.get(name)!.headerHeight); assert.equal(value.codeTop, baseline.get(name)!.codeTop);
      assert.equal(value.top, seeded.get(name)!.top); assert.equal(value.left, seeded.get(name)!.left);
    }
    const earlier = (await inspect("native")).firstLine;
    const loading = await inspect("native", {action: "load", direction: "before"});
    assert(loading.loading); assert(loading.announcement);
    for (const name of ["native", "combined"] as const) {
      await wait(async () => (await inspect(name)).firstLine < earlier, "Incremental source did not arrive");
      const value = await inspect(name); assert(!value.error); assert(!value.loading); assert.equal(value.codeTop, baseline.get(name)!.codeTop);
      assert.equal(value.left, seeded.get(name)!.left);
      const targetOffset = value.top - seeded.get(name)!.top; assert(targetOffset > 0, "Prepending must preserve the visible source anchor");
    }
    for (const name of ["native", "combined"] as const) {
      await inspect(name, {width: 160});
      const narrow = await inspect(name, {action: "focusLast"});
      assert.equal(narrow.headerHeight, baseline.get(name)!.headerHeight); assert(narrow.overflow <= 1);
      assert(narrow.buttonVisible, `Last toolbar action must be reachable in a narrow ${name} view`); assert(narrow.controlsLeft > 0);
      assert.equal(narrow.line, ":181", "Scrolling must not change the target line label");
      await inspect(name, {width: 0});
    }
    assert.deepEqual(errors, []);
    console.log("PREVIEW_HEADER: native/combined single-row layout, safe metadata-only updates, status/errors without shifts, incremental anchors and narrow-toolbar focus passed");
  } finally {
    provider.dispose(); history.dispose(); panels.forEach(panel => panel.dispose());
    visibility.dispose(); disposed.dispose(); received.dispose();
    await config.update("semanticHighlighting", previous, vscode.ConfigurationTarget.Global);
    await config.update("loadBatchLines", previousBatch, vscode.ConfigurationTarget.Global);
  }
}

export const run = verifyPreviewHeader;
