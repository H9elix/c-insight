import assert from "node:assert/strict";
import * as vscode from "vscode";

interface Layout {enabled:boolean;title:string;direction:string;hoverDirection?:string;hoverSizePercentages?:Record<string,number>;views:string[];ratios:number[]}
interface Pane {role:string;left:number;top:number;width:number;height:number;generation:number;marker?:string;filter?:string;selected?:string;headerButton:unknown;embeddedButton?:unknown}
interface Inspection {hovered:number;direction:string;hoverDirections:Record<string,string>;hoverSizePercentages:Record<string,number>;usableSize:number;controlsPaused:boolean;panes:Pane[]}
const config=()=>vscode.workspace.getConfiguration("cInsight.combinedViews");
const browser=(action?:unknown)=>vscode.commands.executeCommand<Inspection>("cInsight.test.combinedBrowser",1,action) as Promise<Inspection>;
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check:()=>Promise<boolean>,reason:string):Promise<void>{
  const until=Date.now()+10000;while(Date.now()<until){if(await check())return;await pause(40);}assert.fail(reason);
}
const pane=(state:Inspection,role:string)=>state.panes.find(pane=>pane.role===role)!;
const near=(a:number,b:number,reason:string)=>assert(Math.abs(a-b)<1.2,`${reason}: ${a} != ${b}`);
const identity=(state:Inspection)=>state.panes.map(({role,generation,marker,filter,selected})=>({role,generation,marker,filter,selected}));
const geometry=(state:Inspection)=>state.panes.map(({role,left,top,width,height,headerButton,embeddedButton})=>({role,left,top,width,height,headerButton,embeddedButton}));

/** Percentage targets stay local to presentation geometry, including protected hot updates. */
export async function verifyCombinedHoverSize(requestCount:()=>Promise<number>):Promise<void>{
  const original=config().get<Layout>("slot1")!,other=config().get<Layout>("slot2");
  const keys=["hoverEnterDelay","hoverAnimationDuration","hoverLeaveDelay"],previous=keys.map(key=>config().inspect(key)?.globalValue);
  const views=["preview","callers",...original.views.filter(role=>role!=="preview"&&role!=="callers")];
  let point=8000;
  const content=async(role:string)=>{
    await browser({action:"controlPointer",target:"content",role,x:++point});
    await wait(async()=>(await browser()).hovered===views.indexOf(role),`No hover for ${role}`);await pause(50);
  };
  const reset=async()=>{await browser({action:"leave"});await pause(100);};
  const save=async(layout:Layout)=>{
    await config().update("slot1",layout,vscode.ConfigurationTarget.Global);
    await wait(async()=>{
      const state=await browser();return state.direction===layout.direction&&state.hoverDirections[layout.views[0]]===layout.hoverDirection&&
        JSON.stringify(state.hoverSizePercentages)===JSON.stringify(layout.hoverSizePercentages??{});
    },"Percentage layout did not reach the browser");
  };
  try{
    for(const [index,key] of keys.entries())await config().update(key,[50,0,20][index],vscode.ConfigurationTarget.Global);
    await browser({action:"markState"});const initial=identity(await browser()),count=await requestCount();
    for(const direction of ["horizontal","vertical"]){
      const layout:Layout={...original,direction,hoverDirection:"both",views,ratios:views.map(()=>1),hoverSizePercentages:{preview:65,callers:50}};
      await save(layout);await browser({action:"viewport",width:2200,height:1500});await reset();
      const base=await browser(),size=direction==="horizontal"?"width":"height",edge=direction==="horizontal"?"left":"top",minimum=direction==="horizontal"?160:80;
      await content("preview");near(pane(await browser(),"preview")[size],base.usableSize*0.65,"The configured 65% target was not applied");
      await browser({action:"controlPointer",target:"header",role:"preview",x:++point});
      const frozen=geometry(await browser());assert((await browser()).controlsPaused);
      await save({...layout,hoverSizePercentages:{preview:80,callers:50}});await pause(150);
      assert.deepEqual(geometry(await browser()),frozen,"Hot updates must not move protected controls");
      await content("preview");near(pane(await browser(),"preview")[size],Math.min(base.usableSize*0.8,base.usableSize-(views.length-1)*minimum),"The new target did not apply after content movement");
      await content("callers");near(pane(await browser(),"callers")[size],base.usableSize*0.5,"Per-pane targets were mixed up");
      await save({...layout,hoverSizePercentages:{callers:50}});await reset();await content("preview");
      near(pane(await browser(),"preview")[size],base.usableSize*2/(views.length+1),"Reset did not restore legacy weighted expansion");
      await save({...layout,hoverSizePercentages:{preview:1}});await reset();await content("preview");
      near(pane(await browser(),"preview")[size],pane(base,"preview")[size],"A small target shrank the base pane");
      await reset();await browser({action:"drag",delta:30});
      await wait(async()=>config().get<Layout>("slot1")!.ratios.some(value=>value!==1),"The ordinary splitter did not save base ratios");
      assert.deepEqual(config().get<Layout>("slot1")!.hoverSizePercentages,{preview:1},"The ordinary splitter overwrote the hover target");
      await save({...layout,hoverDirection:"forward",hoverSizePercentages:{callers:65}});await reset();
      const forward=await browser();await content("callers");const expanded=await browser();
      near(pane(expanded,"preview")[size],pane(forward,"preview")[size],"Forward expansion changed a preceding pane");
      near(pane(expanded,"callers")[edge],pane(forward,"callers")[edge],"Forward expansion moved its leading edge");
      near(pane(expanded,"callers")[size],Math.min(base.usableSize*0.65,base.usableSize-pane(forward,"preview")[size]-(views.length-2)*minimum),"Forward targets exceeded trailing slack");
      const beforeLast=geometry(expanded);await content(views.at(-1)!);
      assert.deepEqual(geometry(await browser()),beforeLast,"The last forward pane must not borrow backwards");
      await browser({action:"narrow"});await reset();const narrow=geometry(await browser());await content("callers");
      assert.deepEqual(geometry(await browser()),narrow,"Percentage expansion created extra overflow in a narrow viewport");
      assert.deepEqual(identity(await browser()),initial,"Changing targets recreated or reset pane content");
      assert.deepEqual(config().get<Layout>("slot1")!.ratios,layout.ratios,"Targets changed the saved base ratios");
      assert.deepEqual(config().get("slot2"),other,"A target changed another combination");
    }
    assert.equal(await requestCount(),count,"Hover targets submitted semantic requests");
    console.log("COMBINED_HOVER_SIZE: percentage targets, direction/minimum limits, protected hot updates, legacy reset, state retention and zero new queries passed.");
  }finally{
    await browser({action:"leave"});await config().update("slot1",original,vscode.ConfigurationTarget.Global);
    for(const [index,key] of keys.entries())await config().update(key,previous[index],vscode.ConfigurationTarget.Global);
    await browser({action:"viewport"});await pause(500);
  }
}
