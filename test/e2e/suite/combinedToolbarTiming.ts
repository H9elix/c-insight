import assert from "node:assert/strict";
import * as vscode from "vscode";

interface Rect {left:number;top:number;right:number;bottom:number;width:number;height:number}
interface Layout {enabled:boolean;title:string;direction:string;views:string[];ratios:number[]}
interface Inspection {
  hovered:number;reducedMotion:boolean;
  hoverTiming:{enterDelay:number;animationDuration:number;leaveDelay:number};
  panes:Array<{role:string;generation:number;filter?:string;marker?:string;headerDirection:string;transitionDuration:string}>;
  toolbar:{bar:Rect;viewport:Rect;actions:Rect;name:Rect;writingMode:string;actionsDirection:string;orientation:string;title:string;buttonCount:number;lastButton:Rect;scrollLeft:number;scrollTop:number;surfaceWidth:number};
}
const browser=(slot:number,action?:unknown)=>vscode.commands.executeCommand<Inspection>("cInsight.test.combinedBrowser",slot,action) as Promise<Inspection>;
const config=()=>vscode.workspace.getConfiguration("cInsight.combinedViews");
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check:()=>Promise<boolean>,reason:string):Promise<void>{
  const until=Date.now()+10000;
  while(Date.now()<until){if(await check())return;await pause(40);}
  assert.fail(reason);
}

export async function verifyCombinedToolbarTiming(requestCount:()=>Promise<number>):Promise<void>{
  const keys=["hoverEnterDelay","hoverAnimationDuration","hoverLeaveDelay"];
  const previous=keys.map(key=>config().inspect(key)?.globalValue);
  const original=config().get<Layout>("slot1")!,originalMotion=(await browser(1)).reducedMotion;
  const identity=(value:Inspection)=>value.panes.map(pane=>({role:pane.role,generation:pane.generation,filter:pane.filter,marker:pane.marker}));
  const setTiming=async(enterDelay:number,animationDuration:number,leaveDelay:number)=>{
    await config().update(keys[0],enterDelay,vscode.ConfigurationTarget.Global);
    await config().update(keys[1],animationDuration,vscode.ConfigurationTarget.Global);
    await config().update(keys[2],leaveDelay,vscode.ConfigurationTarget.Global);
    await wait(async()=>{
      const values=await Promise.all([1,2].map(async slot=>{
        const timing=(await browser(slot)).hoverTiming;
        return timing.enterDelay===enterDelay&&timing.animationDuration===animationDuration&&timing.leaveDelay===leaveDelay;
      }));return values.every(Boolean);
    },"Timing changes did not reach every open combination");
  };
  try{
    await browser(1,{action:"naturalViewport"});
    await browser(1,{action:"markState"});await pause(100);
    const before=await browser(1),count=await requestCount();
    const horizontal=before.toolbar;
    assert.equal(horizontal.bar.left,0,"CI-REG-052: horizontal toolbar must start at the Webview edge");
    assert.equal(horizontal.viewport.right,horizontal.surfaceWidth,"CI-REG-052: horizontal content must fill the right edge");
    assert.equal(horizontal.actions.left-horizontal.bar.left,2,"Keep the toolbar's own 2px padding");
    assert(horizontal.bar.right<=horizontal.viewport.left+1,"Horizontal toolbar must sit to the left, not above the content");
    assert(Math.abs(horizontal.bar.top-horizontal.viewport.top)<2);
    assert.equal(horizontal.actionsDirection,"column");assert.equal(horizontal.writingMode,"vertical-rl");
    assert.equal(horizontal.orientation,"vertical");assert.equal(horizontal.buttonCount,5);
    assert(horizontal.actions.bottom<=horizontal.name.top+1,"Horizontal toolbar buttons belong above its name");
    await config().update("slot1",{...original,direction:"vertical"},vscode.ConfigurationTarget.Global);
    await wait(async()=>(await browser(1)).toolbar.orientation==="horizontal","Vertical toolbar did not move to the top");
    const vertical=await browser(1),bar=vertical.toolbar;
    assert.equal(bar.bar.left,0,"CI-REG-052: vertical toolbar must start at the Webview edge");
    assert.equal(bar.bar.right,bar.surfaceWidth,"CI-REG-052: vertical toolbar must fill the available width");
    assert.equal(bar.viewport.right,bar.surfaceWidth,"CI-REG-052: vertical content must fill the right edge");
    assert(bar.bar.bottom<=bar.viewport.top+1);assert.equal(bar.actionsDirection,"row");assert.equal(bar.writingMode,"horizontal-tb");
    assert(bar.name.right<=bar.actions.left+1,"Vertical toolbar name belongs to the left of its buttons");
    assert(vertical.panes.every(pane=>pane.headerDirection==="row"),"Child pane headers must retain their original layout");
    assert.deepEqual(identity(vertical),identity(before),"Changing the global toolbar must retain child documents and filters");
    await browser(1,{action:"surfaceSize",width:90,height:250});
    await browser(1,{action:"focusLastToolbarButton"});
    const narrow=(await browser(1)).toolbar;
    assert(narrow.lastButton.right<=narrow.bar.right+1&&narrow.lastButton.left>=narrow.bar.left-1,`Narrow toolbar controls must remain reachable: ${JSON.stringify(narrow)}`);
    await config().update("slot1",original,vscode.ConfigurationTarget.Global);
    await browser(1,{action:"surfaceSize",width:420,height:65});
    await browser(1,{action:"focusLastToolbarButton"});
    const short=(await browser(1)).toolbar;
    assert(short.scrollTop>0&&short.lastButton.bottom<=short.bar.bottom+1,`Short toolbar controls must remain scrollable and reachable: ${JSON.stringify(short)}`);
    await browser(1,{action:"surfaceSize"});
    await browser(1,{action:"viewport"});await pause(300);
    await setTiming(1000,450,1000);
    assert((await browser(1)).panes.every(pane=>pane.transitionDuration===(originalMotion?"0s":"0.45s")));
    await browser(1,{action:"hover",role:"callers",x:901});
    await config().update("slot1",{...original,title:"Timing refresh"},vscode.ConfigurationTarget.Global);
    await wait(async()=>(await browser(1)).toolbar.title==="Timing refresh","Metadata update did not arrive");
    await pause(120);assert.equal((await browser(1)).hovered,-1,"Metadata updates must not bypass the configured dwell");
    await wait(async()=>(await browser(1)).hovered===original.views.indexOf("callers"),"Configured dwell never expanded the target");
    await browser(1,{action:"leave"});await pause(120);
    assert.notEqual((await browser(1)).hovered,-1,"Leave delay must retain the expanded pane before its timer expires");
    await config().update("hoverLeaveDelay",0,vscode.ConfigurationTarget.Global);
    await wait(async()=>(await browser(1)).hovered===-1,"A pending leave did not adopt the changed delay");
    await browser(1,{action:"hover",role:"callers",x:902});await pause(80);assert.equal((await browser(1)).hovered,-1);
    await config().update("hoverEnterDelay",0,vscode.ConfigurationTarget.Global);
    await wait(async()=>(await browser(1)).hovered===original.views.indexOf("callers"),"A pending enter did not adopt the changed delay");
    await setTiming(0,0,0);assert((await browser(1)).panes.every(pane=>pane.transitionDuration==="0s"));
    await browser(1,{action:"leave"});await wait(async()=>(await browser(1)).hovered===-1,"Zero leave delay did not restore the pane");
    await browser(1,{action:"hover",role:"callers",x:903});await wait(async()=>(await browser(1)).hovered===original.views.indexOf("callers"),"Zero dwell did not expand the pane");
    await setTiming(200,450,0);
    await browser(1,{action:"reducedMotion",value:true});assert((await browser(1)).panes.every(pane=>pane.transitionDuration==="0s"),"Reduced motion must override the configured animation");
    await browser(1,{action:"reducedMotion",value:originalMotion});
    await browser(1,{action:"leave"});await wait(async()=>(await browser(1)).hovered===-1,"Restoration did not finish");
    await browser(1,{action:"hover",role:"callers",x:904});await browser(1,{action:"leave"});await pause(300);
    assert.equal((await browser(1)).hovered,-1,"A cancelled dwell must not expand later");
    assert.deepEqual(identity(await browser(1)),identity(before));assert.equal(await requestCount(),count,"Toolbar and timing changes must not query the engine");
    console.log("COMBINED_TOOLBAR_TIMING: adaptive global toolbar, unchanged child headers, live/zero timing, pending timers, reduced motion and retained state passed.");
  }finally{
    await browser(1,{action:"surfaceSize"});
    await browser(1,{action:"leave"});
    await config().update("slot1",original,vscode.ConfigurationTarget.Global);
    for(const [index,key] of keys.entries())await config().update(key,previous[index],vscode.ConfigurationTarget.Global);
    await browser(1,{action:"reducedMotion",value:originalMotion});await browser(1,{action:"viewport"});await pause(300);
  }
}
