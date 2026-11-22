import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { FRAME_BRIDGE } from "../../src/combined/combinedWebview";

function themeBody(initial: string[]) {
  const classes = new Set(initial), attributes = new Map<string,string>();
  return {classes,attributes,classList:{contains:(name:string)=>classes.has(name),toggle:(name:string,value:boolean)=>value?classes.add(name):classes.delete(name)},
    getAttribute:(name:string)=>attributes.get(name)??null,setAttribute:(name:string,value:string)=>attributes.set(name,value),removeAttribute:(name:string)=>attributes.delete(name)};
}

describe("embedded presentation bridge", () => {
  it("reports protected toolbar activity separately from content and selection", () => {
    const messages:any[]=[],listeners=new Map<string,(event:any)=>void>();
    const body=themeBody([]);let now=100;
    const parent={document:{body,documentElement:{style:{length:0}}},getComputedStyle:()=>({length:0}),postMessage:(value:unknown)=>messages.push(value)};
    const window={addEventListener:()=>undefined,getSelection:()=>""};
    runInNewContext(`(${FRAME_BRIDGE})(3,{})`,{parent,window,performance:{timeOrigin:1000,now:()=>now},
      document:{body,documentElement:{style:{setProperty:()=>undefined}},getElementById:()=>undefined,addEventListener:(name:string,fn:(event:any)=>void)=>listeners.set(name,fn)}});
    const event=(protectedArea:boolean,type="pointermove")=>({type,screenX:10,screenY:20,buttons:0,target:{closest:(selector:string)=>selector==="[data-ci-hover-pause]"&&protectedArea?{}:null}});
    listeners.get("pointerover")!(event(true,"pointerover"));assert.equal(messages.at(-1).payload.protected,true);assert.equal(messages.at(-1).payload.move,false);
    listeners.get("pointermove")!(event(true));assert.equal(messages.at(-1).payload.protected,true);assert.equal(messages.at(-1).payload.at,1100);
    now+=80;listeners.get("pointermove")!(event(false));assert.equal(messages.at(-1).payload.protected,false);assert.equal(messages.at(-1).payload.move,true);
    listeners.get("focusin")!(event(true,"focusin"));assert.equal(messages.at(-1).payload.protected,true);
    listeners.get("selectionchange")!({});assert.equal(messages.at(-1).payload.protected,undefined,"Selection evidence must not clear pointer protection");
  });
  it("keeps API state local and accepts host messages only from its owning window", () => {
    const messages: any[] = [], delivered: any[] = [];
    const listeners = new Map<string,(event:any)=>void>();
    const body = themeBody(["vscode-dark"]);
    const applied = new Map<string,string>();
    const parent = {document:{body,documentElement:{style:{0:"--vscode-foreground",length:1,getPropertyValue:()=>"#aabbcc"}}},getComputedStyle:()=>({length:0}),postMessage:(value:unknown)=>messages.push(value)};
    const window: any = {addEventListener:(name:string,callback:(event:any)=>void)=>listeners.set(name,callback),
      dispatchEvent:(event:unknown)=>delivered.push(event)};
    runInNewContext(`(${FRAME_BRIDGE})(7,{scroll:32})`,{window,parent,performance:{now:()=>100},
      document:{body,documentElement:{style:{setProperty:(name:string,value:string)=>applied.set(name,value)}},addEventListener:()=>undefined},
      MessageEvent:class { constructor(readonly type:string,readonly options:unknown){} },
    });
    const api = window.acquireVsCodeApi();
    assert.equal(api.getState().scroll,32);
    api.setState({scroll:45});assert.equal(api.getState().scroll,45);
    api.postMessage({type:"activate",id:"one"});
    assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{bridge:"cInsight.pane",generation:7,kind:"message",payload:{type:"activate",id:"one"}});
    listeners.get("message")!({source:{},data:{bridge:"cInsight.host",payload:{type:"state"}}});
    assert.equal(delivered.length,0);
    listeners.get("message")!({source:parent,data:{bridge:"cInsight.host",payload:{type:"state"}}});
    assert.equal(delivered.length,1);
    assert.equal(messages[0].kind,"ready");
    assert.equal(applied.get("--vscode-foreground"),"#aabbcc","Older Chromium's non-enumerable computed theme variables must still synchronize");
    let prevented=false;
    listeners.get("keydown")!({key:"P",code:"KeyP",keyCode:80,ctrlKey:true,shiftKey:true,preventDefault:()=>{prevented=true;}});
    assert(prevented);assert.equal(messages.at(-1).kind,"key");assert.equal(messages.at(-1).payload.keyCode,80);
    const count=messages.length;
    listeners.get("keydown")!({key:"c",ctrlKey:true});
    listeners.get("keydown")!({key:"f",ctrlKey:true,defaultPrevented:true});
    assert.equal(messages.length,count,"Clipboard and locally handled shortcuts must not be replayed twice");
  });

  it("updates theme-owned state without retaining removed colors or replacing local state", () => {
    const host=themeBody(["vscode-dark"]),child=themeBody(["ci-local-class"]);
    host.attributes.set("data-vscode-theme-name","Dark");
    const declared = new Map([["--vscode-foreground","#111111"],["--vscode-removed-color","#aabbcc"]]);
    const computed = new Map([["--vscode-foreground","#222222"]]);
    const style = (values:Map<string,string>)=>({...Object.fromEntries([...values.keys()].map((name,index)=>[index,name])),length:values.size,getPropertyValue:(name:string)=>values.get(name)});
    const applied=new Map([["--ci-local-color","#123456"]]);
    const listeners=new Map<string,(event:unknown)=>void>();
    const parent={document:{body:host,documentElement:{get style(){return style(declared);}}},getComputedStyle:()=>style(computed),postMessage:()=>undefined};
    runInNewContext(`(${FRAME_BRIDGE})(1,{})`,{parent,window:{addEventListener:(name:string,listener:(event:unknown)=>void)=>listeners.set(name,listener)},
      document:{body:child,documentElement:{style:{setProperty:(name:string,value:string)=>applied.set(name,value),removeProperty:(name:string)=>applied.delete(name)}},addEventListener:()=>undefined}});
    assert.equal(applied.get("--vscode-foreground"),"#222222","Computed body overrides must win over root declarations");
    assert(child.classes.has("vscode-dark"));assert(child.classes.has("ci-local-class"));
    host.classes.clear();host.classes.add("vscode-high-contrast-light");host.classes.add("vscode-high-contrast");host.classes.add("vscode-reduce-motion");
    host.attributes.delete("data-vscode-theme-name");declared.delete("--vscode-removed-color");
    listeners.get("message")!({source:parent,data:{bridge:"cInsight.theme"}});
    assert(!applied.has("--vscode-removed-color"));assert.equal(applied.get("--ci-local-color"),"#123456");
    assert(!child.classes.has("vscode-dark"));assert(child.classes.has("vscode-high-contrast-light"));
    assert(child.classes.has("vscode-reduce-motion"));assert(child.classes.has("ci-local-class"));
    assert(!child.attributes.has("data-vscode-theme-name"));
  });

  it("registers optional slots with persisted startup and runtime context visibility", () => {
    const manifest=JSON.parse(readFileSync("package.json","utf8"));
    const views=Object.values(manifest.contributes.views).flat() as Array<{id:string;when?:string}>;
    for(let slot=1;slot<=4;slot++){
      const setting=manifest.contributes.configuration.properties[`cInsight.combinedViews.slot${slot}`];
      assert.equal(setting.scope,"application");assert.equal(setting.default.enabled,false);
      const view=views.find(view=>view.id===`cInsight.combined${slot}`)!;
      assert.match(view.when!,/cInsight\.combinedReady/);
      assert(view.when!.includes(`config.cInsight.combinedViews.slot${slot}.enabled`));
      assert(view.when!.includes(`cInsight.combined${slot}Enabled`));
    }
    assert.equal(manifest.engines.vscode,"^1.95.0");
  });
});
