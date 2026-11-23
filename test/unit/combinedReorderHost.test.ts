import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import * as ids from "../../src/ids";
import * as model from "../../src/combined/combinedModel";
import * as manifest from "../../src/combined/combinedManifest";

function harness() {
  let layout=model.combinedLayout({enabled:true,views:["symbols","callers","preview"],ratios:[3,2,1]});
  let fail=false,writes=0,choice:any,input:string|undefined,onInput:(()=>void)|undefined;const picks:any[]=[],inputs:any[]=[];
  const second=model.combinedLayout({enabled:true,title:"Other",views:["preview"],ratios:[1]});
  const posted:any[]=[];
  const dispose=()=>({dispose:()=>undefined});
  const vscode={l10n:{t:(value:string)=>value},ConfigurationTarget:{Global:1},window:{registerWebviewViewProvider:dispose,
    showQuickPick:async(items:any)=>{picks.push(items);return choice;},showInputBox:async(options:any)=>{inputs.push(options);onInput?.();return input;}},commands:{executeCommand:async()=>undefined},
    workspace:{onDidChangeConfiguration:dispose,getConfiguration:()=>({get:(key:string,fallback:unknown)=>key==="slot1"?layout:key==="slot2"?second:fallback,update:async(key:string,value:model.CombinedLayout,target:number)=>{
      assert.equal(key,"slot1");assert.equal(target,1);writes++;if(fail)throw new Error("settings are read-only");layout=value;
    }})}};
  const module={exports:{} as any};
  const compiled=ts.transpileModule(readFileSync("src/combined/combinedViewManager.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(compiled,{module,exports:module.exports,clearTimeout,require:(id:string)=>{
    if(id==="vscode")return vscode;
    if(id==="../ids")return ids;if(id==="./combinedModel")return model;if(id==="./combinedManifest")return manifest;
    if(["node:crypto","../views/resultTreeView","./embeddedView","./combinedWebview"].includes(id))return {};
    throw new Error(`Unexpected import: ${id}`);
  }});
  const manager=new module.exports.CombinedViewManager({extension:{packageJSON:{contributes:{commands:[],menus:{"view/title":[]},views:{}}}}},{prefer:()=>undefined,flags:()=>({})});
  const panes=new Map(layout.views.map(role=>[role,{view:{webview:{html:""},dispose:()=>undefined},generation:1,sentGeneration:1}]));
  const surface={view:{visible:true,webview:{postMessage:async(message:unknown)=>{posted.push(message);return true;}}},ready:true,panes,listeners:[]};
  manager.surfaces.set(1,surface);
  return {manager,surface,posted,get layout(){return layout;},set layout(value:model.CombinedLayout){layout=value;},get writes(){return writes;},
    choose:(value:any)=>{choice=value;},picks,inputs,second,
    input:(value:string|undefined,duringInput?:()=>void)=>{input=value;onInput=duringInput;},
    fail:()=>{fail=true;},send:(extra:Record<string,unknown>={})=>manager.receive(1,surface,{type:"reorder",request:1,role:"symbols",target:"preview",side:"after",revision:model.combinedLayoutRevision(layout),...extra})};
}

describe("combined pane reorder persistence",()=>{
  it("retains targets across base resizing and reordering, but removes a deleted pane's target",async()=>{
    const h=harness();try{
      h.layout=model.combinedLayout({...h.layout,hoverSizePercentages:{preview:65,callers:50}});
      await h.manager.receive(1,h.surface,{type:"ratios",ratios:[2,2,1]});
      assert.deepEqual(h.layout.hoverSizePercentages,{callers:50,preview:65});
      await h.send();assert.equal(h.layout.hoverSizePercentages?.preview,65);
      h.choose({layoutAction:"remove"});await h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"});
      assert(!h.layout.views.includes("preview"));assert.deepEqual(h.layout.hoverSizePercentages,{callers:50});
    }finally{h.manager.dispose();}
  });
  it("offers set/reset per-pane percentages and preserves the base layout and other slots",async()=>{
    const h=harness();try{
      const original=h.layout,other=JSON.stringify(h.second);
      h.choose({layoutAction:"hoverSize"});h.input("65");
      await h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"});
      assert.equal(h.layout.hoverSizePercentages?.preview,65);assert.equal(h.inputs.at(-1).value,"");
      assert(h.picks.at(-1).some((item:any)=>item.layoutAction==="hoverSize"));
      assert(!h.picks.at(-1).some((item:any)=>item.layoutAction==="resetHoverSize"));
      assert.deepEqual(h.layout.ratios,original.ratios);assert.deepEqual(h.layout.views,original.views);
      assert.equal(h.layout.hoverDirection,original.hoverDirection);assert.equal(JSON.stringify(h.second),other);
      h.choose(undefined);await h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"});
      assert(h.picks.at(-1).some((item:any)=>item.layoutAction==="resetHoverSize"));
      h.choose({layoutAction:"hoverSize"});h.input("50");await h.manager.receive(1,h.surface,{type:"paneMenu",role:"callers"});
      h.choose({layoutAction:"resetHoverSize"});await h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"});
      assert.deepEqual(h.layout.hoverSizePercentages,{callers:50});
      await h.manager.receive(1,h.surface,{type:"paneMenu",role:"callers"});assert.equal(h.layout.hoverSizePercentages,undefined);
      assert.equal(h.posted.at(-1).value,false);
    }finally{h.manager.dispose();}
  });
  it("rejects invalid or cancelled percentage input without saving and reports validation",async()=>{
    const h=harness();try{
      h.choose({layoutAction:"hoverSize"});
      for(const value of [undefined,"","0","101","65.5","NaN","65%","6.5e1"]){
        h.input(value);await h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"});
        assert.equal(h.writes,0);if(value!==undefined)assert(h.inputs.at(-1).validateInput(value));
      }
      h.input(" 65 ");await h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"});
      assert.equal(h.layout.hoverSizePercentages?.preview,65);assert.equal(h.inputs.at(-1).validateInput("65"),undefined);
      await h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"});
      assert.equal(h.inputs.at(-1).value,"65");assert.equal(h.writes,1,"The same percentage need not be written twice");
      h.input("80");h.fail();await assert.rejects(h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"}),/read-only/);
      assert.equal(h.layout.hoverSizePercentages?.preview,65);assert.equal(h.posted.at(-1).value,false);
    }finally{h.manager.dispose();}
  });
  it("merges a late input into the latest layout and ignores removed or disabled panes",async()=>{
    const h=harness();try{
      h.choose({layoutAction:"hoverSize"});h.input("65",()=>{h.layout=model.combinedLayout({...h.layout,title:"Renamed",ratios:[1,2,3],hoverDirection:"both",hoverSizePercentages:{callers:40}});});
      await h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"});
      assert.equal(h.layout.title,"Renamed");assert.deepEqual(h.layout.ratios,[1,2,3]);
      assert.equal(h.layout.hoverDirection,"both");assert.deepEqual(h.layout.hoverSizePercentages,{callers:40,preview:65});
      h.input("80",()=>{h.layout=model.combinedLayout({...h.layout,views:["symbols","callers"],ratios:[1,2]});});
      await h.manager.receive(1,h.surface,{type:"paneMenu",role:"preview"});assert.equal(h.writes,1);
      h.input("80",()=>{h.layout={...h.layout,enabled:false};});
      await h.manager.receive(1,h.surface,{type:"paneMenu",role:"callers"});assert.equal(h.writes,1);
      h.layout={...h.layout,enabled:true};h.input("90",()=>h.manager.dispose());
      await h.manager.receive(1,h.surface,{type:"paneMenu",role:"callers"});assert.equal(h.writes,1,"Disposed managers must not save late input");
    }finally{h.manager.dispose();}
  });
  it("persists direction through the toolbar and explicit menu without changing base layout",async()=>{
    const h=harness();try{
      const original=h.layout;
      await h.manager.receive(1,h.surface,{type:"manage",action:"toggleHoverDirection"});
      assert.equal(h.layout.hoverDirection,"both");assert.equal(h.writes,1);
      assert.deepEqual(h.layout.views,original.views);assert.deepEqual(h.layout.ratios,original.ratios);
      assert.deepEqual(h.posted.filter(message=>message.type==="suspend").map(message=>message.value),[true,false]);
      h.choose({value:"forward"});await h.manager.perform(1,"hoverDirection");assert.equal(h.layout.hoverDirection,"forward");
      assert.equal(h.picks.at(-1).find((item:any)=>item.value==="both").picked,true);
      h.choose(undefined);await h.manager.perform(1,"hoverDirection");assert.equal(h.writes,2,"Cancelling the picker must not save");
      h.fail();await assert.rejects(h.manager.receive(1,h.surface,{type:"manage",action:"toggleHoverDirection"}),/read-only/);
      assert.equal(h.layout.hoverDirection,"forward");assert.equal(h.posted.at(-1).value,false,"A failed save must release suspended interaction");
    }finally{h.manager.dispose();}
  });
  it("saves one ordered layout and carries weights without touching feature owners",async()=>{
    const h=harness();try{
      await h.send();assert.equal(h.writes,1);
      assert.deepEqual(h.layout.views,["callers","preview","symbols"]);assert.deepEqual(h.layout.ratios,[2,1,3]);
      assert.equal(h.posted.at(-1).type,"reorderResult");assert.equal(h.posted.at(-1).success,true);
      assert.deepEqual(h.posted.find(message=>message.type==="layout").layout,h.layout);
    }finally{h.manager.dispose();}
  });
  it("ignores stale, unknown, hidden and no-op drops without overwriting current settings",async()=>{
    const h=harness();try{
      const revision=model.combinedLayoutRevision(h.layout);h.layout={...h.layout,direction:"vertical"};
      await h.send({revision});assert.equal(h.posted.at(-1).success,false);
      for(const extra of [{role:"unknown"},{target:"unknown"},{side:"invalid"}]){await h.send(extra);assert.equal(h.posted.at(-1).success,false);}
      h.surface.view.visible=false;await h.send();assert.equal(h.posted.at(-1).success,false);h.surface.view.visible=true;
      await h.send({target:"callers",side:"before"});assert.equal(h.posted.at(-1).success,true);
      assert.equal(h.writes,0);assert.equal(h.layout.direction,"vertical");
    }finally{h.manager.dispose();}
  });
  it("resynchronizes and releases the browser after a failed settings write",async()=>{
    const h=harness();try{
      const original=h.layout;h.fail();await assert.rejects(h.send(),/settings are read-only/);
      assert.equal(h.layout,original);assert.equal(h.writes,1);
      assert.equal(h.posted.at(-1).type,"reorderResult");assert.equal(h.posted.at(-1).success,false);
      assert.deepEqual(h.posted.find(message=>message.type==="layout").layout,original);
    }finally{h.manager.dispose();}
  });
});
