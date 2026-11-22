import assert from "node:assert/strict";
import * as vscode from "vscode";

interface Layout {enabled:boolean;title:string;direction:string;views:string[];ratios:number[]}
interface Pane {role:string;generation:number;marker?:string;filter?:string;selected?:string;scrollTop?:number;scrollLeft?:number;collapsed:boolean}
interface Inspection {visualOrder:string[];ratios:number[];panes:Pane[];reordering:boolean;reorderPending:boolean;scrollTop:number;scrollLeft:number;hovered:number}
const browser=(action?:unknown)=>vscode.commands.executeCommand<Inspection>("cInsight.test.combinedBrowser",1,action) as Promise<Inspection>;
const config=()=>vscode.workspace.getConfiguration("cInsight.combinedViews");
const saved=()=>config().get<Layout>("slot1")!;
async function wait(check:()=>Promise<boolean>,reason:string):Promise<void>{
  const until=Date.now()+10000;
  while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.fail(reason);
}

/** Drives PointerEvents through the real browser controller, then checks host persistence. */
export async function verifyCombinedReorder(requestCount:()=>Promise<number>):Promise<void>{
  const original=saved(),counts=await requestCount();
  let verifiedInterlocks=false;
  const stable=(inspection:Inspection)=>inspection.panes.map(pane=>({role:pane.role,generation:pane.generation,marker:pane.marker,filter:pane.filter,selected:pane.selected,collapsed:pane.collapsed}));
  const settle=()=>wait(async()=>!(await browser()).reorderPending,"A reorder acknowledgement did not arrive");
  const move=async(role:string,target:string,side:string)=>{
    await browser({action:"reorderStart",role});
    const moving=await browser({action:"reorderMove",role:target,side});assert(moving.reordering,"Title movement did not start a reorder");
    if(!verifiedInterlocks){
      const snapshot=JSON.stringify(saved());
      await browser({action:"hover",role:target,x:345});await browser({action:"drag",delta:30});
      await new Promise(resolve=>setTimeout(resolve,300));
      assert.equal((await browser()).hovered,-1,"Hover expansion must remain paused while reordering");
      assert.equal(JSON.stringify(saved()),snapshot,"Splitter resizing must not run during reordering");verifiedInterlocks=true;
    }
    await browser({action:"reorderDrop"});await settle();
  };
  try{
    await browser({action:"markState"});
    await new Promise(resolve=>setTimeout(resolve,100));
    const baseline=await browser();assert(baseline.panes.every(pane=>pane.marker===pane.role));
    const source=original.views[0],last=original.views.at(-1)!;
    await move(source,last,"after");
    const expected=[...original.views.slice(1),source];
    assert.deepEqual(saved().views,expected);assert.deepEqual(saved().ratios,[...original.ratios.slice(1),original.ratios[0]]);
    const reordered=await browser();assert.deepEqual(reordered.visualOrder,expected);assert.deepEqual(stable(reordered),stable(baseline));
    for(const pane of reordered.panes){
      const before=baseline.panes.find(value=>value.role===pane.role)!;
      assert.equal(pane.scrollTop,before.scrollTop,`${pane.role}: reorder changed vertical scroll`);
      assert.equal(pane.scrollLeft,before.scrollLeft,`${pane.role}: reorder changed horizontal scroll`);
    }
    await move(source,expected[0],"before");assert.deepEqual(saved().views,original.views);
    // An adjacent insertion is a no-op; it must not leave pending interaction state.
    await move(source,original.views[1],"before");assert.deepEqual(saved().views,original.views);
    const previous=JSON.stringify(saved());
    for(const mode of ["escape","pointercancel","blur","outside"]){
      await browser({action:"reorderStart",role:source});await browser({action:"reorderMove",role:last,side:"after"});
      if(mode==="outside")await browser({action:"reorderDrop",outside:true});else await browser({action:"reorderCancel",mode});
      assert(!(await browser()).reordering);assert.equal(JSON.stringify(saved()),previous,`Cancel ${mode} changed settings`);
    }
    // Mutating layout during a drag cancels its snapshot rather than overwriting it.
    await browser({action:"reorderStart",role:source});await browser({action:"reorderMove",role:last,side:"after"});
    await config().update("slot1",{...saved(),direction:"vertical"},vscode.ConfigurationTarget.Global);
    await wait(async()=>!(await browser()).reordering,"An external orientation change did not cancel dragging");
    await browser({action:"reorderDrop"});assert.deepEqual(saved().views,original.views);
    await move(last,source,"before");assert.deepEqual((await browser()).visualOrder,[last,...original.views.slice(0,-1)]);
    // Collapse belongs to the role and survives reordering without making it visible.
    await browser({action:"collapse",role:last});
    await move(last,source,"after");assert((await browser()).panes.find(pane=>pane.role===last)?.collapsed);
    await browser({action:"collapse",role:last});
    await config().update("slot1",original,vscode.ConfigurationTarget.Global);
    await browser({action:"narrow"});
    await new Promise(resolve=>setTimeout(resolve,250));
    const narrow=await browser();
    await browser({action:"reorderStart",role:source});await browser({action:"reorderMove",edge:"end"});
    await wait(async()=>(await browser()).scrollLeft>narrow.scrollLeft,"Dragging at a narrow viewport edge did not scroll");
    await browser({action:"reorderCancel",mode:"escape"});
    assert(!(await browser()).reordering);assert.equal(JSON.stringify(saved()),JSON.stringify(original));
    assert.equal(await requestCount(),counts,"Reordering must not submit semantic requests");
    console.log("COMBINED_REORDER: pointer insertion, persisted weights, cancellation, collapsed state, edge scrolling and retained child state passed.");
  }finally{
    await browser({action:"reorderCancel",mode:"escape"});
    await config().update("slot1",original,vscode.ConfigurationTarget.Global);
    await browser({action:"viewport"});
  }
}
