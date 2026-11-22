import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { AnalysisService } from "../../../src/analysis/analysisService";
import { NavigationHistoryExplorer } from "../../../src/history/navigationHistoryExplorer";
import { CodePreviewProvider } from "../../../src/views/codePreviewProvider";
import { previewColorStyle } from "../../../src/views/previewColors";
import { renderResultTreeWebview } from "../../../src/views/resultTreeWebview";
import { renderSymbolSearchWebview } from "../../../src/symbols/symbolSearchWebview";
import { embeddedDocument, renderCombinedWebview } from "../../../src/combined/combinedWebview";

interface Inspection {
  theme: string;
  body: Record<string, string>;
  code?: Record<string, string>;
  input?: Record<string, string>;
  menu?: Record<string, string>;
  selected?: Record<string, string>;
  controls?: Record<string, string>;
  scrollbar: Record<string, string>;
  background?: string;
  marker?: string;
  query?: string;
  localClass: boolean;
  top: number;
  left: number;
}

// Appended only to isolated test documents, not shipped in production renderers.
const PROBE = String.raw`
const testApi=acquireVsCodeApi();
const selectedRow=document.createElement('div');selectedRow.className='row selected';selectedRow.hidden=true;document.body.append(selectedRow);
function properties(element,names,pseudo){
  if(!element)return;
  const style=getComputedStyle(element,pseudo);
  return Object.fromEntries(names.map(name=>[name,style.getPropertyValue(name)]));
}
window.addEventListener('message',event=>{
  if(event.data?.type!=='themeProbe')return;
  const code=document.querySelector('.code'),scroll=code||document.querySelector('#tree,#results');
  const input=document.querySelector('input');
  if(event.data.seed){
    document.body.dataset.marker='retained';document.body.classList.add('ci-local-class');
    if(input)input.value='keep this query';
    if(scroll){scroll.scrollTop=30;scroll.scrollLeft=40;}
  }
  testApi.postMessage({type:'themeInspection',request:event.data.request,result:{
    theme:document.body.getAttribute('data-vscode-theme-kind'),
    body:properties(document.body,['font-family','font-size','font-weight','color','background-color','padding']),
    code:properties(document.querySelector('.line > code'),['font-family','font-size','font-weight','line-height','background-color','padding','border-radius']),
    input:properties(input,['font-family','font-size','color','background-color','border-color']),
    menu:properties(document.getElementById('menu'),['color','background-color','border-color']),
    selected:properties(selectedRow,['color','background-color']),
    controls:properties(document.querySelector('button'),['font-family','font-size','color','background-color']),
    scrollbar:{...properties(scroll,['scrollbar-color']),...properties(scroll,['background-color'],'::-webkit-scrollbar-thumb'),
      corner:properties(scroll,['background-color'],'::-webkit-scrollbar-corner')?.['background-color']},
    background:code&&getComputedStyle(code).backgroundColor,
    marker:document.body.dataset.marker,localClass:document.body.classList.contains('ci-local-class'),
    top:scroll?.scrollTop||0,left:scroll?.scrollLeft||0,query:input?.value,
  }});
});
testApi.postMessage({type:'themeProbeReady'});
`;

/** Compare actual renderer DOM in native webviews and srcdoc frames under the same host. */
export async function verifyCombinedTheme(): Promise<void> {
  const nonce = "combined-theme-test";
  const config = vscode.workspace.getConfiguration();
  const keys = ["workbench.colorTheme", "workbench.colorCustomizations", "editor.fontFamily", "editor.fontSize"];
  const previous = keys.map(key => config.inspect(key)?.globalValue);
  const panels: vscode.WebviewPanel[] = [];
  const pending = new Map<number, (value: Inspection) => void>();
  let serial = 0;
  const ready = new Set<string>();
  const browserErrors: string[] = [];
  const panel = (title: string) => {
    const value = vscode.window.createWebviewPanel("cInsight.themeRegression", title, {viewColumn:vscode.ViewColumn.One,preserveFocus:true}, {enableScripts:true,retainContextWhenHidden:true});
    panels.push(value);return value;
  };
  const receive = (role: string, message: {type?: string; request: number; result: Inspection; detail?: string}) => {
    if(message.type === "themeProbeError")browserErrors.push(`${role}: ${message.detail}`);
    if(message.type === "themeProbeReady")ready.add(role);
    if(message.type === "themeInspection"){pending.get(message.request)?.(message.result);pending.delete(message.request);}
  };
  const wait = async (condition: () => boolean | Promise<boolean>, reason: string) => {
    const until = Date.now()+15000;
    while(Date.now()<until){if(await condition())return;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.fail(reason);
  };
  const inspect = (view: vscode.WebviewPanel, role?: string, seed = false): Promise<Inspection> => {
    const request = ++serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(request);reject(new Error(`No theme inspection from ${role??"native"}`));},5000);
      pending.set(request,result=>{clearTimeout(timer);resolve(result);});
      void view.webview.postMessage(role?{type:"panePost",role,generation:1,message:{type:"themeProbe",request,seed}}:{type:"themeProbe",request,seed});
    });
  };
  const combined = panel("Combined theme regression");
  combined.webview.onDidReceiveMessage(message=>{
    if(message.type === "ready")ready.add("outer");
    if(message.type === "paneMessage")receive(`combined:${message.role}`,message.message);
  });
  combined.webview.html=renderCombinedWebview(nonce,combined.webview.cspSource,"",{empty:"Empty"},true);
  const history = new NavigationHistoryExplorer();
  const preview = new CodePreviewProvider(new Proxy({}, {get:()=>assert.fail("Theme regression must not query an analysis engine")}) as AnalysisService,history);
  const visibility = new vscode.EventEmitter<void>(), received = new vscode.EventEmitter<unknown>(), disposed = new vscode.EventEmitter<void>();
  let previewHtml = "";
  const fakeView = {visible:true,onDidChangeVisibility:visibility.event,onDidDispose:disposed.event,webview:{options:{},onDidReceiveMessage:received.event,
    get html(){return previewHtml;},set html(value:string){previewHtml=value;},postMessage:async()=>true}};
  preview.resolveWebviewView(fakeView as unknown as vscode.WebviewView);
  try {
    const source = await vscode.workspace.openTextDocument({language:"cpp",content:Array.from({length:150},(_,i)=>`int value_${i} = ${i}; // ${"source context ".repeat(20)}`).join("\n")});
    await preview.showLocation({uri:source.uri,range:new vscode.Range(60,4,60,12)},"definition","Theme fixture");
    const documents = {
      preview: previewHtml,
      fixedPreview: previewHtml.replace(/(<style id="preview-colors">)[\s\S]*?(<\/style>)/,`$1${previewColorStyle("fixed-dark",{}).css}$2`),
      lightPreview: previewHtml.replace(/(<style id="preview-colors">)[\s\S]*?(<\/style>)/,`$1${previewColorStyle("fixed-light",{}).css}$2`),
      symbols: renderResultTreeWebview({nonce,cspSource:combined.webview.cspSource,iconsUri:"",label:"Symbols",collapseTitle:"Collapse",filterTitle:"Filter",expandTitle:"Expand",collapseNodeTitle:"Collapse",persistentFilter:true}),
      workspaceSymbols: renderSymbolSearchWebview({nonce,cspSource:combined.webview.cspSource,placeholder:"Search",clearTitle:"Clear",resultsLabel:"Symbols"}),
    };
    const natives = new Map<string,vscode.WebviewPanel>();
    const html = (document:string) => {
      const scriptNonce=document.match(/<script nonce="([^"]+)"/)![1];
      const bootstrap=`<script nonce="${scriptNonce}">const themeApi=acquireVsCodeApi();window.acquireVsCodeApi=()=>themeApi;window.addEventListener('error',event=>themeApi.postMessage({type:'themeProbeError',detail:event.message}));</script>`;
      return document.replace(/<head([^>]*)>/i,`<head$1>${bootstrap}`).replace("</body>",`<script nonce="${scriptNonce}">${PROBE}</script></body>`);
    };
    for(const [role,document] of Object.entries(documents)){
      const native=panel(`Native ${role}`);natives.set(role,native);
      native.webview.onDidReceiveMessage(message=>receive(`native:${role}`,message));
      native.webview.html=html(document);
      await wait(()=>{native.reveal(undefined,true);return ready.has(`native:${role}`);},`Native ${role} test document did not load`);
    }
    await wait(()=>ready.has("outer"),"Outer combined theme test did not load");
    const roles=Object.keys(documents);
    combined.reveal(undefined,true);
    await combined.webview.postMessage({type:"layout",title:"Theme",hover:false,layout:{views:roles,ratios:roles.map(()=>1),direction:"horizontal"},
      panes:Object.entries(documents).map(([role,document])=>({role,title:role,actions:[],generation:1,html:embeddedDocument(html(document),nonce,1)}))});
    await wait(()=>ready.size===1+roles.length*2,`Theme renderers did not load: ${[...ready]}`);
    const seeds = new Map<string,Inspection>();
    for(const role of roles)seeds.set(role,await inspect(combined,role,true));
    const themes = [
      ["Default Dark Modern","vscode-dark"], ["Default Light Modern","vscode-light"],
      ["Default High Contrast","vscode-high-contrast"], ["Default High Contrast Light","vscode-high-contrast-light"],
    ];
    await config.update("workbench.colorCustomizations",{"scrollbarSlider.background":"#37546F","scrollbarSlider.hoverBackground":"#4B6C8F","scrollbarSlider.activeBackground":"#6188AF"},vscode.ConfigurationTarget.Global);
    await config.update("editor.fontFamily","monospace",vscode.ConfigurationTarget.Global);
    await config.update("editor.fontSize",19,vscode.ConfigurationTarget.Global);
    for(const [theme,kind] of themes){
      await config.update("workbench.colorTheme",theme,vscode.ConfigurationTarget.Global);
      await wait(async()=>{
        for(const role of roles){
          if((await inspect(natives.get(role)!)).theme!==kind||(await inspect(combined,role)).theme!==kind)return false;
        }return true;
      },`Theme did not synchronize: ${theme}`);
      for(const role of roles){
        const native=await inspect(natives.get(role)!),embedded=await inspect(combined,role);
        assert.deepEqual(embedded.body,native.body,`${theme}: ${role} interface font/color/padding differs`);
        assert.deepEqual(embedded.code,native.code,`${theme}: ${role} source font/line styling differs`);
        assert.deepEqual(embedded.input,native.input,`${theme}: ${role} input differs`);
        assert.deepEqual(embedded.menu,native.menu,`${theme}: ${role} menu differs`);
        assert.deepEqual(embedded.selected,native.selected,`${theme}: ${role} selection differs`);
        assert.deepEqual(embedded.controls,native.controls,`${theme}: ${role} toolbar typography differs`);
        assert.deepEqual(embedded.scrollbar,native.scrollbar,`${theme}: ${role} scrollbar differs`);
        assert.equal(embedded.scrollbar["background-color"],"rgb(55, 84, 111)",`${theme}: scrollbar must use the public theme color`);
        assert.equal(embedded.marker,"retained");assert(embedded.localClass,"Theme updates must preserve renderer-owned classes");
        if(embedded.input)assert.equal(embedded.query,"keep this query","Theme updates must preserve filter input");
        assert.equal(embedded.top,seeds.get(role)!.top,`${theme}: scrollTop changed`);
        assert.equal(embedded.left,seeds.get(role)!.left,`${theme}: scrollLeft changed`);
        if(embedded.code){
          assert.equal(embedded.code["font-size"],"19px");assert.equal(embedded.code["font-family"],"monospace");
          assert.equal(embedded.code["background-color"],"rgba(0, 0, 0, 0)","Source lines must not regain preformatted grey boxes");
        }
        if(role==="fixedPreview")assert.equal(embedded.background,"rgb(30, 30, 30)","The host theme must not replace the fixed palette");
        if(role==="lightPreview")assert.equal(embedded.background,"rgb(255, 255, 255)","The host theme must not replace the fixed light palette");
      }
      console.log(`COMBINED_THEME: ${theme}: native/embedded fonts, controls, scrollbars and retained DOM/scroll match.`);
    }
    assert.deepEqual(browserErrors,[],"Theme comparison must not hide renderer errors");
  } finally {
    preview.dispose();history.dispose();visibility.dispose();received.dispose();disposed.dispose();
    panels.forEach(value=>value.dispose());
    for(const [index,key] of keys.entries())await config.update(key,previous[index],vscode.ConfigurationTarget.Global);
  }
}
