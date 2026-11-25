import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import * as ids from "../../src/ids";
import * as model from "../../src/combined/combinedModel";
import * as manifest from "../../src/combined/combinedManifest";

/** Exercise the shipped manager against the localized packageJSON shape, not only source package.json strings. */
function runtimeManager(title: unknown, name: unknown = "Callers", icon: unknown = "$(pin)", picker?: {
  mode?: number;
  show(items: Array<{label:string;role:string}>, options: {onDidSelectItem?: (item: {label:string;role:string} | string) => void}): Promise<Array<{label:string;role:string}>>;
}) {
  const compiled = ts.transpileModule(readFileSync("src/combined/combinedViewManager.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dispose = () => ({dispose:()=>undefined});
  const settings = new Map<string, unknown>();
  const vscode = {
    window:{registerWebviewViewProvider:dispose,showQuickPick:picker?.show},
    workspace:{onDidChangeConfiguration:dispose,getConfiguration:()=>({get:(key:string)=>settings.get(key),update:async(key:string,value:unknown)=>{settings.set(key,value);}})},
    commands:{executeCommand:async()=>undefined},
    ExtensionMode:{Test:3},ConfigurationTarget:{Global:1},l10n:{t:(value:string)=>value},
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
  return new module.exports.CombinedViewManager({extensionMode:picker?.mode??(picker?3:undefined),extension:{packageJSON:{contributes:{
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
  it("distinguishes surface readiness from native picker focus (CI-REG-045)",async()=>{
    let selected!:(items:Array<{label:string;role:string}>)=>void;
    let report!:(item:{label:string;role:string}|string)=>void;
    let shown!:()=>void;
    const nativeShown=new Promise<void>(resolve=>{shown=resolve;});
    const nativeResult=new Promise<Array<{label:string;role:string}>>(resolve=>{selected=resolve;});
    const manager=runtimeManager("Pin","Callers","$(pin)",{show:(_items,options)=>{report=options.onDidSelectItem!;shown();return nativeResult;}});
    const creating=manager.create();
    try {
      await nativeShown;
      assert.equal(manager.panePickerForTest().open,true);
      assert.equal(manager.panePickerForTest().activeRole,undefined,"Opening the picker alone is not a focus acknowledgement");
      report("not a pane");assert.equal(manager.panePickerForTest().activeRole,undefined);
      report({label:"Preview",role:"preview"});assert.equal(manager.panePickerForTest().activeRole,"preview");
      report({label:"Callers",role:"callers"});assert.equal(manager.panePickerForTest().activeRole,"callers");
      selected([{label:"Callers",role:"callers"}]);await creating;
      assert.equal(manager.panePickerForTest().open,false);
      assert.deepEqual([...manager.layout(1).views],["callers"]);
    }finally{selected([]);await creating;manager.dispose();}
  });
  it("does not install test focus observation in production",async()=>{
    const manager=runtimeManager("Pin","Callers","$(pin)",{mode:1,show:async(items,options)=>{
      assert.equal(options.onDidSelectItem,undefined);return items.filter(item=>item.role==="preview");
    }});
    try{await manager.create();assert.equal(manager.panePickerForTest(),undefined);assert.deepEqual([...manager.layout(1).views],["preview"]);}
    finally{manager.dispose();}
  });
});
