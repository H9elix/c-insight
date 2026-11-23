import assert from "node:assert/strict";
import * as vscode from "vscode";
import { VIEWS } from "../../../src/ids";
import { EmbeddedView } from "../../../src/combined/embeddedView";
import { embeddedDocument, renderCombinedWebview } from "../../../src/combined/combinedWebview";
import { WebviewResultTree } from "../../../src/views/resultTreeView";
import { ResultTreeFollowController } from "../../../src/views/resultTreeFollowController";
import { MutableTreeProvider, TreeNode } from "../../../src/views/treeNode";

interface Inspection {height:number;top:number;visible:boolean;rows:number;focused:boolean;samples:number[]}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check:()=>Promise<boolean>,reason:string):Promise<void>{
  const until=Date.now()+15000;while(Date.now()<until){if(await check())return;await pause(40);}assert.fail(reason);
}
const PROBE=String.raw`
const viewportTestApi=acquireVsCodeApi();
const viewportSamples=[];
document.getElementById('tree').addEventListener('scroll',()=>{viewportSamples.push(document.getElementById('tree').scrollTop);if(viewportSamples.length>120)viewportSamples.shift();});
window.addEventListener('message',event=>{
  if(event.data?.type!=='viewportProbe')return;
  const tree=document.getElementById('tree'),rows=[...document.querySelectorAll('.row[data-id]')];
  if(typeof event.data.browse==='number'){
    tree.dispatchEvent(new WheelEvent('wheel',{deltaY:event.data.browse-tree.scrollTop,bubbles:true}));
    tree.scrollTop=event.data.browse;viewportSamples.length=0;
  }
  const row=rows.find(row=>row.dataset.id===event.data.id),box=tree.getBoundingClientRect(),rect=row?.getBoundingClientRect();
  viewportTestApi.postMessage({type:'viewportProbeResult',request:event.data.request,result:{
    top:tree.scrollTop,height:tree.clientHeight,rows:rows.length,focused:document.hasFocus(),samples:[...viewportSamples],
    visible:!!rect&&rect.top>=box.top-1&&rect.bottom<=box.top+tree.clientHeight+1}});
});`;

/** Real production frames, adapters and follow controllers; synthetic roots never query an engine. */
export async function verifyCombinedViewportFollow(requestCount:()=>Promise<number>):Promise<void>{
  const extension=vscode.extensions.getExtension("H9elix.c-insight")!;
  const panel=vscode.window.createWebviewPanel("cInsight.viewportRegression","Viewport follow regression",
    {viewColumn:vscode.ViewColumn.Two,preserveFocus:true},{enableScripts:true,retainContextWhenHidden:true,
      localResourceRoots:[vscode.Uri.joinPath(extension.extensionUri,"dist","codicons")]});
  const parent={webview:panel.webview,show:()=>panel.reveal(vscode.ViewColumn.Two,true)} as unknown as vscode.WebviewView;
  const fixtures=new Map<string,{view:EmbeddedView;tree:WebviewResultTree;provider:MutableTreeProvider;follow:ResultTreeFollowController;armed:boolean;target:TreeNode}>();
  const pending=new Map<number,(value:Inspection)=>void>();let serial=0,ready=false;
  let outerInspection: {request:number;hovered:number;panes:unknown[]}|undefined;
  const nonce="viewport-follow-regression";
  const layout={enabled:true,title:"Viewport",direction:"vertical",hoverDirection:"both",views:["symbols","projectFiles","context"],ratios:[1,1,1],hoverSizePercentages:{symbols:65,projectFiles:65}};
  const publish=()=>{
    if(!ready)return;
    void panel.webview.postMessage({type:"layout",layout,title:"Viewport",hover:true,hoverTiming:{enterDelay:0,animationDuration:120,leaveDelay:0},
      panes:[...fixtures].map(([role,fixture])=>{
        const html=fixture.view.webview.html,innerNonce=html.match(/<script nonce="([^"]+)"/)![1];
        return {role,title:role,generation:1,actions:[],html:embeddedDocument(html.replace("</body>",`<script nonce="${innerNonce}">${PROBE}</script></body>`),nonce,1)};
      }).concat([{role:"context",title:"Context",generation:1,actions:[],html:embeddedDocument("<html><head></head><body>Context</body></html>",nonce,1)}])});
  };
  const receiver=panel.webview.onDidReceiveMessage(message=>{
    if(message.type==="ready"){ready=true;publish();}
    else if(message.type==="inspection")outerInspection=message;
    else if(message.type==="paneMessage"){
      if(message.message?.type==="viewportProbeResult"){pending.get(message.message.request)?.(message.message.result);pending.delete(message.message.request);}
      else fixtures.get(message.role)?.view.webview.receiveMessage(message.message);
    }
  });
  try{
    for(const [role,id] of [["symbols",VIEWS.SYMBOLS],["projectFiles",VIEWS.PROJECT_FILES]] as const){
      const provider=new MutableTreeProvider();provider.setInteractionScope(id);
      const nodes=Array.from({length:100},(_,index):TreeNode=>({id:`${role}-${index}`,label:`${role}_${index}`,...(index===50?{labelHighlights:[[0,role.length]] as Array<[number,number]>}:{})}));
      provider.setRoots(nodes);
      const view=new EmbeddedView(id,parent,role,publish,message=>panel.webview.postMessage({type:"panePost",role,generation:1,message}));
      view.setVisible(true);
      const tree=new WebviewResultTree(id,provider,extension.extensionUri,{persistentFilter:true,trackInteraction:true,hideCollapseAll:true});
      const fixture={view,tree,provider,follow:undefined as unknown as ResultTreeFollowController,armed:false,target:nodes[50]};
      fixture.follow=new ResultTreeFollowController(tree,{target:()=>fixture.armed?fixture.target:undefined,key:node=>node.id!,enabled:()=>true},vscode.window);
      fixtures.set(role,fixture);tree.resolveWebviewView(view);fixture.follow.setLocked(true);
    }
    const assets=vscode.Uri.joinPath(extension.extensionUri,"dist","codicons");
    const [css,font]=await Promise.all([vscode.workspace.fs.readFile(vscode.Uri.joinPath(assets,"codicon.css")),vscode.workspace.fs.readFile(vscode.Uri.joinPath(assets,"codicon.ttf"))]);
    panel.webview.html=renderCombinedWebview(nonce,panel.webview.cspSource,"",{empty:"Empty",add:"Add",direction:"Direction",hover:"Hover",hoverDirection:"Expansion",both:"Both",forwardDown:"Down",forwardRight:"Right",manage:"Manage",collapse:"Collapse",actions:"Actions",splitter:"Resize",reorder:"Reorder",switchHoverDirection:"Switch"},true,{css:Buffer.from(css).toString(),font:Buffer.from(font).toString("base64")});
    await wait(async()=>ready,"Viewport fixture did not initialize");
    const probe=(role:string,browse?:number):Promise<Inspection>=>new Promise((resolve,reject)=>{
      const request=++serial,timer=setTimeout(()=>{pending.delete(request);reject(new Error(`No viewport probe from ${role}`));},5000);
      pending.set(request,value=>{clearTimeout(timer);resolve(value);});
      const fixture=fixtures.get(role)!,id=fixture.tree.model.snapshot().find(row=>row.node===fixture.target)?.id;
      void panel.webview.postMessage({type:"panePost",role,generation:1,message:{type:"viewportProbe",id,request,browse}});
    });
    await vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
    await panel.webview.postMessage({type:"testInteraction",action:"viewport",width:600,height:600});
    for(const role of fixtures.keys())await wait(async()=>(await probe(role)).rows>0,`${role} rows did not render`);
    await pause(300);const count=await requestCount();let point=20000;
    for(const [role,fixture] of fixtures){
      fixture.follow.setLocked(false);
      const base=await probe(role);
      await panel.webview.postMessage({type:"testInteraction",action:"hover",role,x:++point});await pause(250);
      const inspectionRequest=++serial;await panel.webview.postMessage({type:"inspect",request:inspectionRequest});
      await wait(async()=>outerInspection?.request===inspectionRequest,"No combined viewport geometry");
      const hovered=await probe(role);
      assert(hovered.height>base.height+30,`The ${role} pane did not expand: ${JSON.stringify({base,hovered,outerInspection})}`);
      fixture.armed=true;fixture.follow.schedule();
      await wait(async()=>(await probe(role)).visible,`${role} target did not follow in the expanded pane`);
      const expanded=await probe(role),actions=fixture.follow.stateForTest().followActions;assert(!expanded.focused);
      await panel.webview.postMessage({type:"testInteraction",action:"leave"});
      const settled=async()=>{const value=await probe(role);return value.height<=base.height+1&&value.visible&&Math.abs(value.top-(1212-value.height/2))<1;};
      await wait(settled,`${role} target stayed clipped after the pane shrank`);
      await pause(250);assert.equal(fixture.follow.stateForTest().followActions,actions+1,`A shrink must produce exactly one correction: ${JSON.stringify({role,base,expanded,current:await probe(role),state:fixture.follow.stateForTest()})}`);
      assert.equal(fixture.follow.stateForTest().lastFollowAction?.clear,"never");
      const corrected=await probe(role);
      await panel.webview.postMessage({type:"testInteraction",action:"viewport",width:600,height:620});await pause(200);
      await panel.webview.postMessage({type:"testInteraction",action:"viewport",width:600,height:600});await pause(350);
      assert.equal((await probe(role)).top,corrected.top,"A still-visible target must not move");
      assert.equal(fixture.follow.stateForTest().followActions,actions+1);
      for(const [cycle,offset] of [200,1800,400].entries()){
        await panel.webview.postMessage({type:"testInteraction",action:"hover",role,x:++point});await pause(250);
        assert((await probe(role)).height>base.height+30);
        await probe(role,offset);await pause(180);
        assert.equal((await probe(role)).top,offset,"Wheel browsing in the expanded pane must remain untouched");
        const before=fixture.follow.stateForTest().followActions;
        await panel.webview.postMessage({type:"testInteraction",action:"leave"});
        await wait(settled,`${role} did not restore after wheel-browsing cycle ${cycle+1}`);await pause(180);
        const restored=await probe(role);
        assert.equal(fixture.follow.stateForTest().followActions,before+1,"Each contraction must correct once");
        assert(restored.samples.some(top=>Math.abs(top-offset)>1&&Math.abs(top-restored.top)>1),"Centering must include intermediate animation positions");
      }
      fixture.follow.setLocked(true);
    }
    assert.equal(await requestCount(),count,"Viewport correction must not query the engine");
    console.log("COMBINED_VIEWPORT_FOLLOW: real symbol/file frames restore three repeated wheel-browsing cycles with intermediate smooth-scroll positions, correct once, retain visible rows, and perform no semantic queries.");
  }finally{
    receiver.dispose();for(const fixture of fixtures.values()){fixture.follow.dispose();fixture.tree.dispose();fixture.view.dispose();fixture.provider.dispose();}
    panel.dispose();await vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
  }
}
