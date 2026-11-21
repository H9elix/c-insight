import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { FRAME_BRIDGE } from "../../src/combined/combinedWebview";

describe("embedded presentation bridge", () => {
  it("keeps API state local and accepts host messages only from its owning window", () => {
    const messages: any[] = [], delivered: any[] = [];
    const listeners = new Map<string,(event:any)=>void>();
    const body = {className:"vscode-dark",getAttribute:()=>null,setAttribute:()=>undefined};
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
