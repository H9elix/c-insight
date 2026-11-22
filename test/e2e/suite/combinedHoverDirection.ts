import assert from "node:assert/strict";
import * as vscode from "vscode";

interface Layout {enabled:boolean;title:string;direction:string;hoverDirection?:string;views:string[];ratios:number[]}
interface Rect {left:number;top:number;width:number;height:number}
interface Pane extends Rect {role:string;generation:number;marker?:string;filter?:string;selected?:string;scrollTop?:number;scrollLeft?:number;headerButton:Rect;embeddedButton?:Rect}
interface Inspection {hovered:number;candidate?:string;hoverDirection:string;controlsPaused:boolean;pendingHoverReset:boolean;panes:Pane[];toolbar:{directionIcon:string;directionTitle:string}}
const browser=(action?:unknown,slot=1)=>vscode.commands.executeCommand<Inspection>("cInsight.test.combinedBrowser",slot,action) as Promise<Inspection>;
const config=()=>vscode.workspace.getConfiguration("cInsight.combinedViews");
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check:()=>Promise<boolean>,reason:string):Promise<void>{
  const until=Date.now()+10000;while(Date.now()<until){if(await check())return;await pause(40);}assert.fail(reason);
}
const pane=(value:Inspection,role:string)=>value.panes.find(pane=>pane.role===role)!;
const near=(a:number,b:number,reason:string)=>assert(Math.abs(a-b)<1.2,`${reason}: ${a} != ${b}`);
const stable=(value:Inspection)=>value.panes.map(({role,generation,marker,filter,selected})=>({role,generation,marker,filter,selected}));
const dimensions=(value:Inspection)=>value.panes.map(({role,left,top,width,height,headerButton,embeddedButton})=>({role,left,top,width,height,headerButton,embeddedButton}));

/** CI-REG-053: measure real in-flight geometry and exercise pointer events inside srcdoc. */
export async function verifyCombinedHoverDirection(requestCount:()=>Promise<number>):Promise<void>{
  const original=config().get<Layout>("slot1")!,second=config().get<Layout>("slot2")!;
  const timingKeys=["hoverEnterDelay","hoverAnimationDuration","hoverLeaveDelay"];
  const previous=timingKeys.map(key=>config().inspect(key)?.globalValue);
  const views=["preview",...original.views.filter(role=>role!=="preview")];let point=4000;
  const content=async(role:string)=>{await browser({action:"controlPointer",target:"content",role,x:++point});};
  const control=async(role:string,target:string)=>{
    await browser({action:"controlPointer",target,role,x:++point});
    await wait(async()=>(await browser()).controlsPaused,`${target} pointer did not protect controls`);
  };
  const reset=async()=>{await browser({action:"leave"});await pause(650);};
  try{
    for(const [index,key] of timingKeys.entries())await config().update(key,[100,400,80][index],vscode.ConfigurationTarget.Global);
    await browser({action:"markState"});await pause(100);
    const identity=stable(await browser()),count=await requestCount();
    for(const direction of ["horizontal","vertical"]){
      const layout={...original,direction,hoverDirection:"forward",views,ratios:views.map(()=>1)};
      await config().update("slot1",layout,vscode.ConfigurationTarget.Global);
      await browser({action:"viewport",height:1000});await reset();
      const base=await browser(),axis=direction==="horizontal"?"left":"top",size=direction==="horizontal"?"width":"height";
      assert.equal(base.hoverDirection,"forward");assert(base.toolbar.directionIcon.includes(direction==="horizontal"?"arrow-right":"arrow-down"));
      await content(views[0]);await wait(async()=>(await browser()).hovered===0,"Forward hover did not start");
      for(let sample=0;sample<9;sample++){near(pane(await browser(),views[0])[axis],pane(base,views[0])[axis],"First leading edge moved during animation");await pause(50);}
      const first=await browser();assert(pane(first,views[0])[size]>pane(base,views[0])[size]);
      await content(views[1]);await wait(async()=>(await browser()).hovered===1,"Consecutive forward hover did not start");
      for(let sample=0;sample<9;sample++){
        const current=await browser();near(pane(current,views[1])[axis],pane(first,views[1])[axis],"Next pane leading edge moved");
        near(pane(current,views[0])[size],pane(first,views[0])[size],"A preceding pane was restored too early");await pause(50);
      }
      const beforeLast=await browser();await content(views.at(-1)!);await wait(async()=>(await browser()).hovered===views.length-1,"Last hover did not settle");await pause(450);
      assert.deepEqual(dimensions(await browser()),dimensions(beforeLast),"The last pane must not grow backwards or add overflow");
      await reset();const restored=await browser();for(const role of views)near(pane(restored,role)[size],pane(base,role)[size],"Leaving did not restore base ratios");
      await content(views[0]);await wait(async()=>(await browser()).hovered===0,"Initial mid-animation hover did not start");await pause(60);
      await content(views[1]);await wait(async()=>(await browser()).candidate===views[1],"New candidate did not freeze its predecessor");
      const interrupted=await browser();
      for(let sample=0;sample<11;sample++){
        const current=await browser();near(pane(current,views[1])[axis],pane(interrupted,views[1])[axis],"Interrupted animation moved the new leading edge");
        near(pane(current,views[0])[size],pane(interrupted,views[0])[size],"Predecessor continued animating during the new dwell");await pause(50);
      }
      await reset();await content("preview");await control("preview","header");const cancelled=await browser();await pause(550);
      assert.equal((await browser()).hovered,-1,"Entering controls must cancel a pending dwell");
      assert.deepEqual(dimensions(await browser()),dimensions(cancelled));
      // Entering headers freezes the current pixels rather than finishing or reversing an animation.
      await content("preview");await wait(async()=>(await browser()).hovered===0,"Preview did not expand");await pause(60);
      await control("preview","header");const frozen=await browser();await browser({action:"staleContent",role:"preview"});await pause(500);
      assert((await browser()).controlsPaused,"Delayed content messages must not release newer toolbar protection");
      assert.deepEqual(dimensions(await browser()),dimensions(frozen),"Header hover moved a pending click target");
      await content("preview");await wait(async()=>(await browser()).hovered===0&&!(await browser()).controlsPaused,"Content did not resume hover");await pause(50);
      await control("preview","embedded");const previewControls=await browser();await pause(500);
      assert.deepEqual(dimensions(await browser()),dimensions(previewControls),"Code Preview controls moved during hover");
      await control("callers","embedded");const treeControls=await browser();await pause(500);
      assert.deepEqual(dimensions(await browser()),dimensions(treeControls),"Result toolbar moved during hover");
      await control("symbols","input");const search=await browser();await pause(200);
      assert.deepEqual(dimensions(await browser()),dimensions(search),"Search toolbar did not hold its geometry");
      // A button changes only its own slot and cannot move itself while being operated.
      await control("preview","bar");const beforeToggle=await browser();await browser({action:"toggleHoverDirection"});
      await wait(async()=>(await browser()).hoverDirection==="both","The direction button did not update the slot");
      assert.equal(config().get<Layout>("slot1")!.hoverDirection,"both");assert.deepEqual(config().get("slot2"),second);
      assert.deepEqual(dimensions(await browser()),dimensions(beforeToggle),"Mode switching moved controls before pointer departure");
      assert((await browser()).toolbar.directionIcon.includes("arrow-both"));
      await content(views[1]);await wait(async()=>(await browser()).hovered===1,"Both-direction hover did not resume");await pause(60);
      await control(views[1],"header");const bothFrozen=await browser();await pause(500);
      assert.deepEqual(dimensions(await browser()),dimensions(bothFrozen),"The compatibility mode must also protect controls");
      await reset();
      await config().update("slot1",{...layout,hoverDirection:"forward"},vscode.ConfigurationTarget.Global);
      await browser({action:"narrow"});await reset();const narrow=await browser();
      await content(views[1]);await wait(async()=>(await browser()).hovered===1,"Narrow forward hover did not settle");await pause(450);
      assert.deepEqual(dimensions(await browser()),dimensions(narrow),"Minimum-size neighbors must not be compressed or overflow further");
      assert.deepEqual(stable(await browser()),identity,"Direction and pause changes must retain renderer state");
    }
    assert.equal(await requestCount(),count,"Direction and control protection must not query the engine");
    console.log("COMBINED_HOVER_DIRECTION: anchored forward geometry, consecutive/edge/minimum cases, protected controls, per-slot persistence and retained state passed.");
  }finally{
    await browser({action:"leave"});await config().update("slot1",original,vscode.ConfigurationTarget.Global);
    for(const [index,key] of timingKeys.entries())await config().update(key,previous[index],vscode.ConfigurationTarget.Global);
    await browser({action:"viewport"});await pause(500);
  }
}
