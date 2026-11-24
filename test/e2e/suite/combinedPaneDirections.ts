import assert from "node:assert/strict";
import * as vscode from "vscode";

interface Layout {enabled:boolean;title:string;direction:string;views:string[];ratios:number[];hoverDirection?:string;hoverDirections?:Record<string,string>}
interface Pane {role:string;left:number;top:number;width:number;height:number;generation:number;marker?:string;filter?:string;selected?:string}
interface State {hovered:number;hoverDirections:Record<string,string>;panes:Pane[];toolbar:{buttonCount:number}}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const config=()=>vscode.workspace.getConfiguration("cInsight.combinedViews");
const browser=(action?:unknown)=>vscode.commands.executeCommand<State>("cInsight.test.combinedBrowser",1,action) as Promise<State>;
async function wait(check:()=>Promise<boolean>,reason:string){const until=Date.now()+10000;while(Date.now()<until){if(await check())return;await pause(30);}assert.fail(reason);}
const pane=(state:State,role:string)=>state.panes.find(pane=>pane.role===role)!;
const near=(a:number,b:number)=>assert(Math.abs(a-b)<1.2,`Boundary changed: ${a} != ${b}`);
const identity=(state:State)=>state.panes.map(({role,generation,marker,filter,selected})=>({role,generation,marker,filter,selected}));

/** Per-role defaults, mirrored geometry and mixed directions use the real child frames. */
export async function verifyCombinedPaneDirections(requestCount:()=>Promise<number>):Promise<void>{
  const original=config().get<Layout>("slot1")!,other=config().get("slot2"),views=original.views;
  const keys=["hoverEnterDelay","hoverAnimationDuration","hoverLeaveDelay"],previous=keys.map(key=>config().inspect(key)?.globalValue);
  const first=views[0],middle=views[1],last=views.at(-1)!;let point=30000;
  const content=async(role:string)=>{await browser({action:"controlPointer",target:"content",role,x:++point});await wait(async()=>(await browser()).hovered===views.indexOf(role),"Pane did not expand");};
  const reset=async()=>{await browser({action:"leave"});await pause(220);};
  try{
    for(const [i,key] of keys.entries())await config().update(key,[0,120,0][i],vscode.ConfigurationTarget.Global);
    const count=await requestCount(),before=identity(await browser());
    for(const direction of ["horizontal","vertical"]){
      const automatic={...original,direction,views,ratios:views.map(()=>1),hoverDirections:{}};
      await config().update("slot1",automatic,vscode.ConfigurationTarget.Global);
      await browser({action:"viewport",width:1800,height:1200});await reset();
      const base=await browser(),axis=direction==="horizontal"?"left":"top",size=direction==="horizontal"?"width":"height";
      assert.equal(base.toolbar.buttonCount,4);assert(views.every(role=>base.hoverDirections[role]===(role===last?"both":"forward")));
      await content(last);await pause(180);assert(pane(await browser(),last)[size]>pane(base,last)[size],"Default last pane must expand on both sides");await reset();
      await browser({action:"collapse",role:last});await wait(async()=>(await browser()).hoverDirections[views.at(-2)!]==="both","Last expanded pane did not inherit the positional default");
      await browser({action:"collapse",role:last});await reset();
      await config().update("slot1",{...automatic,views:[...views.slice(1),first]},vscode.ConfigurationTarget.Global);
      await wait(async()=>(await browser()).hoverDirections[first]==="both"&& (await browser()).hoverDirections[last]==="forward","Reorder did not update defaults");
      const explicit={...automatic,hoverDirections:{[first]:"backward",[middle]:"backward"},hoverSizePercentages:{[middle]:65}};
      await config().update("slot1",explicit,vscode.ConfigurationTarget.Global);await reset();const reverseBase=await browser();
      await content(middle);
      for(let i=0;i<5;i++){
        const current=await browser();near(pane(current,middle)[axis]+pane(current,middle)[size],pane(reverseBase,middle)[axis]+pane(reverseBase,middle)[size]);
        for(const role of views.slice(2)){near(pane(current,role)[size],pane(reverseBase,role)[size]);near(pane(current,role)[axis],pane(reverseBase,role)[axis]);}
        await pause(40);
      }
      const enlarged=await browser();assert(pane(enlarged,middle)[size]>pane(reverseBase,middle)[size]);
      assert(pane(enlarged,first)[size]>= (direction==="horizontal"?160:80)-1);
      await reset();const edge=await browser();await content(first);await pause(180);
      for(const role of views){near(pane(await browser(),role)[size],pane(edge,role)[size]);}
      await config().update("slot1",{...explicit,hoverDirections:{[first]:"forward",[middle]:"backward"}},vscode.ConfigurationTarget.Global);await reset();
      await content(first);await pause(180);const mixed=await browser();await content(middle);
      for(let i=0;i<5;i++){const current=await browser();near(pane(current,middle)[axis]+pane(current,middle)[size],pane(mixed,middle)[axis]+pane(mixed,middle)[size]);await pause(40);}
      assert.deepEqual(identity(await browser()),before,"Changing directions recreated or reset child frames");
    }
    assert.deepEqual(config().get("slot2"),other);assert.equal(await requestCount(),count,"Per-pane geometry must not query an engine");
    console.log("COMBINED_PANE_DIRECTIONS: positional defaults, collapse/reorder, backward trailing edges, mixed directions, limits, retained frames and zero new queries passed.");
  }finally{
    await config().update("slot1",original,vscode.ConfigurationTarget.Global);
    for(const [i,key] of keys.entries())await config().update(key,previous[i],vscode.ConfigurationTarget.Global);
    await browser({action:"naturalViewport"});await reset();
  }
}
