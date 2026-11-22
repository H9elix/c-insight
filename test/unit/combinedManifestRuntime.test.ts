import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import * as ids from "../../src/ids";
import * as model from "../../src/combined/combinedModel";
import * as manifest from "../../src/combined/combinedManifest";

/** Exercise the shipped manager against the localized packageJSON shape, not only source package.json strings. */
function runtimeManager(title: unknown, name: unknown = "Callers", icon: unknown = "$(pin)") {
  const compiled = ts.transpileModule(readFileSync("src/combined/combinedViewManager.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dispose = () => ({dispose:()=>undefined});
  const vscode = {
    window:{registerWebviewViewProvider:dispose},
    workspace:{onDidChangeConfiguration:dispose,getConfiguration:()=>({get:()=>undefined})},
    commands:{executeCommand:async()=>undefined},
  };
  const module = {exports:{} as any};
  runInNewContext(compiled, {exports:module.exports,module,require:(id:string)=>{
    if(id==="vscode")return vscode;
    if(id==="../ids")return ids;
    if(id==="./combinedModel")return model;
    if(id==="./combinedManifest")return manifest;
    if(["node:crypto","../views/resultTreeView","./embeddedView","./combinedWebview"].includes(id))return {};
    throw new Error(`Unexpected manager import: ${id}`);
  }});
  return new module.exports.CombinedViewManager({extension:{packageJSON:{contributes:{
    commands:[{command:"cInsight.pinCallHierarchy",title,icon}],
    menus:{"view/title":[{command:"cInsight.pinCallHierarchy",when:"view == cInsight.callers",group:"navigation@0"}]},
    views:{cInsight:[{id:"cInsight.callers",name}]},
  }}}},{flags:()=>({}),create:()=>undefined,prefer:()=>undefined});
}

describe("localized runtime combined-view metadata (CI-REG-050)",()=>{
  for(const [title,expected] of [
    ["C Insight: Pin Call Hierarchy","Pin Call Hierarchy"],
    [{value:"C Insight: 固定调用层次",original:"C Insight: Pin Call Hierarchy"},"固定调用层次"],
    [{value:"C Insight：固定调用层次",original:"C Insight: Pin Call Hierarchy"},"固定调用层次"],
    [{original:"C Insight: Pin Call Hierarchy"},"Pin Call Hierarchy"],
    [{value:42,original:"C Insight: Pin Call Hierarchy"},"Pin Call Hierarchy"],
    [{value:"",original:"C Insight: Pin Call Hierarchy"},"Pin Call Hierarchy"],
    [null,"cInsight.pinCallHierarchy"],
    [undefined,"cInsight.pinCallHierarchy"],
    [{value:42},"cInsight.pinCallHierarchy"],
  ] as const) {
    it(`renders title ${JSON.stringify(title)} without assuming a string`,()=>{
      const manager=runtimeManager(title);
      try {
        assert.equal(manager.actions("callers")[0].title,expected);
        assert.equal(manager.actions("callers")[0].icon,"pin");
      } finally {manager.dispose();}
    });
  }
  it("normalizes localized view names and safely ignores unsupported icon objects",()=>{
    const manager=runtimeManager("C Insight: Pin Call Hierarchy",{value:"调用者",original:"Callers"},{light:"light.svg",dark:"dark.svg"});
    try {
      assert.equal(manager.names.get("callers"),"调用者");
      assert.equal(manager.actions("callers")[0].icon,undefined);
    } finally {manager.dispose();}
  });
});
