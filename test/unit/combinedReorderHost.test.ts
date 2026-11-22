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
  let fail=false,writes=0;
  const posted:any[]=[];
  const dispose=()=>({dispose:()=>undefined});
  const vscode={l10n:{t:(value:string)=>value},ConfigurationTarget:{Global:1},window:{registerWebviewViewProvider:dispose},commands:{executeCommand:async()=>undefined},
    workspace:{onDidChangeConfiguration:dispose,getConfiguration:()=>({get:()=>layout,update:async(_key:string,value:model.CombinedLayout,target:number)=>{
      assert.equal(target,1);writes++;if(fail)throw new Error("settings are read-only");layout=value;
    }})}};
  const module={exports:{} as any};
  const compiled=ts.transpileModule(readFileSync("src/combined/combinedViewManager.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(compiled,{module,exports:module.exports,clearTimeout,require:(id:string)=>{
    if(id==="vscode")return vscode;
    if(id==="../ids")return ids;if(id==="./combinedModel")return model;if(id==="./combinedManifest")return manifest;
    if(["node:crypto","../views/resultTreeView","./embeddedView","./combinedWebview"].includes(id))return {};
    throw new Error(`Unexpected import: ${id}`);
  }});
  const manager=new module.exports.CombinedViewManager({extension:{packageJSON:{contributes:{commands:[],menus:{"view/title":[]},views:{}}}}},{});
  const surface={view:{visible:true,webview:{postMessage:async(message:unknown)=>{posted.push(message);return true;}}},ready:true,panes:new Map(),listeners:[]};
  manager.surfaces.set(1,surface);
  return {manager,surface,posted,get layout(){return layout;},set layout(value:model.CombinedLayout){layout=value;},get writes(){return writes;},
    fail:()=>{fail=true;},send:(extra:Record<string,unknown>={})=>manager.receive(1,surface,{type:"reorder",request:1,role:"symbols",target:"preview",side:"after",revision:model.combinedLayoutRevision(layout),...extra})};
}

describe("combined pane reorder persistence",()=>{
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
