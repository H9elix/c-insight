import assert from "node:assert/strict";
import * as vscode from "vscode";
import { verifyPreviewPresentationOwnership } from "./previewPresentationOwnership";
import { verifyCombinedTheme } from "./combinedTheme";
import { verifyCombinedReorder } from "./combinedReorder";

interface Pane {role: string; visible: boolean; generation: number; acknowledged?: number}
interface Surface {slot: number; ready: boolean; visible: boolean; panes: Pane[]}
interface Row {id: string; label: string; expanded: boolean; expandable: boolean; uri?: string}
interface Browser {hovered: number; panes: Array<{role: string; generation: number; width: number; height: number; filter?: string; theme?: string; iconFont?:string; collapsed: boolean}>}
const browser = (slot: number, action?: unknown) => vscode.commands.executeCommand<Browser>("cInsight.test.combinedBrowser", slot, action) as Promise<Browser>;
const state = async () => await vscode.commands.executeCommand<Surface[]>("cInsight.test.combinedState") ?? [];
async function wait<T>(query: () => Promise<T | undefined>, reason: string): Promise<T> {
  const until = Date.now() + 45000;
  while (Date.now() < until) { const value = await query(); if (value !== undefined) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`${reason}: ${JSON.stringify(await state())}`);
}
const tree = (slot: number, role: string, message?: unknown) => vscode.commands.executeCommand<Row[]>("cInsight.test.combinedTree", slot, role, message);

export async function run(): Promise<void> {
  const config = vscode.workspace.getConfiguration("cInsight"), combined = vscode.workspace.getConfiguration("cInsight.combinedViews");
  const engine = process.env.C_INSIGHT_COMBINED_ENGINE === "microsoft" ? "microsoft" : "clangd";
  await config.update("engine", engine, vscode.ConfigurationTarget.Global);
  await config.update("session.restore", false, vscode.ConfigurationTarget.Global);
  await config.update("codePreview.semanticHighlighting", false, vscode.ConfigurationTarget.Global);
  if (engine === "clangd") await config.update("clangd.path", "/usr/bin/clangd-20", vscode.ConfigurationTarget.Global);
  if (engine === "microsoft") await vscode.extensions.getExtension("ms-vscode.cpptools")?.activate();
  const extension = vscode.extensions.getExtension("H9elix.c-insight"); assert(extension);
  console.log(`COMBINED_LOCALE: ${vscode.env.language}; first command title: ${JSON.stringify(extension.packageJSON.contributes.commands[0].title)}`);
  if (process.env.C_INSIGHT_COMBINED_SEEDED) {
    await vscode.commands.executeCommand("cInsight.combined1.focus");
    const until=Date.now()+15000;
    while(!extension.isActive&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,100));
    assert(extension.isActive,"A persisted combined view must activate without first opening a C/C++ document");
  }
  await extension.activate();
  await verifyCombinedTheme();
  const layout = {enabled: true, title: "Browser", direction: "horizontal", views: ["symbols", "callers", "callees", "references", "preview"], ratios: [1, 1, 1, 1, 1]};
  try {
    if (!process.env.C_INSIGHT_COMBINED_SEEDED) {
      let settled=false;
      const creating=Promise.resolve(vscode.commands.executeCommand("cInsight.combinedViews.create")).finally(()=>{settled=true;});
      try {
        await wait(async()=>{const surface=(await state()).find(surface=>surface.slot===1);return surface?.ready?true:undefined;},"Create Combined View did not resolve its native surface");
        await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
        await vscode.commands.executeCommand("workbench.action.quickPickManyToggle");
        await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
        await wait(async()=>settled?true:undefined,"Create Combined View did not finish after accepting its pane picker");
        await creating;
        assert(vscode.workspace.getConfiguration("cInsight.combinedViews").get<typeof layout>("slot1")?.views.length,"The create command must add the selected pane");
      } finally {
        if(!settled)await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
        await creating;
      }
    }
    await combined.update("slot1", layout, vscode.ConfigurationTarget.Global);
    await wait(async()=>{
      await vscode.commands.executeCommand("cInsight.combined1.focus");
      return (await state()).some(surface=>surface.slot===1)?true:undefined;
    },"Combined view did not become available after updating its global layout");
    await wait(async () => { const value = (await state()).find(surface => surface.slot === 1); return value?.panes.length === 5 && value.panes.every(pane => pane.acknowledged === pane.generation) ? value : undefined; }, "Pane scripts did not start under the combined CSP");
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "src/calculator.cpp");
    const editor = await vscode.window.showTextDocument(uri);
    editor.selection = new vscode.Selection(10, 12, 10, 12);
    await wait(async()=>{
      const definitions=await vscode.commands.executeCommand<Array<vscode.Location|vscode.LocationLink>>("vscode.executeDefinitionProvider",uri,new vscode.Position(10,12));
      return definitions?.length?true:undefined;
    },"The semantic provider did not finish initial analysis");
    await vscode.commands.executeCommand("cInsight.showIncomingCalls");
    let lastCallerRetry=0;
    const rows = await wait(async () => {
      const rows = await tree(1, "callers");
      if(rows?.some(row => row.uri))return rows;
      if(Date.now()-lastCallerRetry>2000){lastCallerRetry=Date.now();await vscode.commands.executeCommand("cInsight.showIncomingCalls");}
      return undefined;
    }, "Combined callers have no semantic result");
    const root = rows.find(row => row.uri && row.expandable)!; assert(root);
    await tree(1, "callers", {type: "activate", id: root.id, intent: "preview"});
    const preview = await vscode.commands.executeCommand<{uri: string}>("cInsight.test.previewState"); assert(preview?.uri);
    await wait(async () => { const value = (await state()).find(surface => surface.slot === 1); return value?.panes.every(pane => pane.acknowledged === pane.generation) ? value : undefined; }, "Preview renderer bridge did not restart");
    await tree(1, "callers", {type: "expand", id: root.id, expanded: true});
    const second = {...layout, title: "Second", direction: "vertical", views: ["callers", "projectFiles", "workspaceSymbols", "context"], ratios:[1,1,1,1]};
    await combined.update("slot2", second, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("cInsight.combined2.focus");
    await wait(async () => { const value = (await state()).find(surface => surface.slot === 2); return value?.panes.length === 4 && value.panes.every(pane => pane.acknowledged === pane.generation) ? value : undefined; }, "Second combined view did not render");
    await wait(async () => (await tree(2, "projectFiles"))?.some(row => row.label === "calculator.cpp") ? true : undefined, "Combined Project Files did not scan");
    const secondRows = await tree(2, "callers");
    const secondRoot = secondRows?.find(row => row.uri && row.expandable); assert(secondRoot);
    await tree(2, "callers", {type:"expand", id:secondRoot.id, expanded:false});
    assert((await tree(1, "callers"))?.find(row => row.id === root.id)?.expanded, "Expansion must remain presentation-local");
    await browser(1, {action:"filter",role:"symbols",value:"add"});
    assert.equal((await browser(1)).panes.find(pane=>pane.role==="symbols")?.filter,"add");
    await vscode.commands.executeCommand("cInsight.pinContext");
    await vscode.commands.executeCommand("cInsight.pinReferences");
    await vscode.commands.executeCommand("cInsight.pinCallHierarchy");
    await new Promise(resolve=>setTimeout(resolve,1000));
    const requestCount = async () => (await vscode.commands.executeCommand<{scheduler:{submitted:number}}>("cInsight.test.navigationState"))!.scheduler.submitted;
    const countBeforeHover = await requestCount();
    await combined.update("slot3",{...layout,views:["callers"],ratios:[1]},vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("cInsight.combined3.focus");
    await wait(async()=>{
      const pane=(await state()).find(surface=>surface.slot===3)?.panes[0];
      return pane?.acknowledged===pane?.generation&&pane?true:undefined;
    },"Duplicate caller presentation did not start");
    assert.equal(await requestCount(),countBeforeHover,"Adding a duplicate role must reuse existing semantic results");
    await combined.update("slot3",undefined,vscode.ConfigurationTarget.Global);
    await browser(1, {action:"viewport"});
    await new Promise(resolve=>setTimeout(resolve,350));
    const base = await browser(1);
    assert(base.panes.every(pane=>pane.theme?.trim()),`Theme variables must reach nested documents: ${JSON.stringify(base.panes.map(pane=>({role:pane.role,theme:pane.theme})))}`);
    assert(base.panes.find(pane=>pane.role==="callers")?.iconFont?.includes("codicon"),"Nested result-tree icon CSS must load");
    await browser(1, {action:"hover",role:"callers",x:100});
    await new Promise(resolve=>setTimeout(resolve,500));
    const enlarged = await browser(1);
    assert.equal(enlarged.hovered,1);
    assert(enlarged.panes[1].width > base.panes[1].width,"Hover must enlarge its pane when there is room");
    assert(Math.abs(enlarged.panes.reduce((sum,pane)=>sum+pane.width,0)-base.panes.reduce((sum,pane)=>sum+pane.width,0))<5,"Hover must conserve the layout width");
    assert.deepEqual(enlarged.panes.map(pane=>pane.generation),base.panes.map(pane=>pane.generation));
    assert.equal(enlarged.panes.find(pane=>pane.role==="symbols")?.filter,"add","Resizing must preserve filters");
    await browser(1, {action:"leave"});await new Promise(resolve=>setTimeout(resolve,550));
    const restored = await browser(1);assert.equal(restored.hovered,-1);
    await browser(1,{action:"drag",delta:30});await new Promise(resolve=>setTimeout(resolve,300));
    const resized=await browser(1);assert(resized.panes[0].width>restored.panes[0].width,"Dragging must change the base proportion");
    assert(resized.panes[1].width<restored.panes[1].width,"Dragging must compress the adjacent pane");
    assert.equal(await requestCount(),countBeforeHover,"Hovering must not submit semantic requests");
    await verifyCombinedReorder(requestCount);
    await browser(2, {action:"collapse",role:"projectFiles"});
    await wait(async()=>!(await state()).find(surface=>surface.slot===2)?.panes.find(pane=>pane.role==="projectFiles")?.visible?true:undefined,"Collapsed panes must withdraw demand");
    const before = (await state()).find(surface => surface.slot === 1)!.panes.map(pane => [pane.role, pane.generation]);
    await combined.update("slot1", {...layout, direction: "vertical", ratios: [2, 1, 1, 1, 1]}, vscode.ConfigurationTarget.Global);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual((await state()).find(surface => surface.slot === 1)!.panes.map(pane => [pane.role, pane.generation]), before, "Layout must not reload inner documents");
    await new Promise(resolve=>setTimeout(resolve,200));
    const verticalBase=await browser(1);
    await browser(1,{action:"hover",role:"callers",x:200});await new Promise(resolve=>setTimeout(resolve,500));
    const verticalExpanded=await browser(1);
    assert(verticalExpanded.panes[1].height>verticalBase.panes[1].height,"Vertical hover must enlarge height rather than width");
    await browser(1,{action:"leave"});await new Promise(resolve=>setTimeout(resolve,550));
    await combined.update("slot1",{...layout,direction:"vertical",views:[...layout.views].reverse(),ratios:[1,1,1,1,2]},vscode.ConfigurationTarget.Global);
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.deepEqual((await state()).find(surface=>surface.slot===1)!.panes.map(pane=>[pane.role,pane.generation]),before,"Reordering must retain child documents and local state");
    await vscode.commands.executeCommand("cInsight.pinReferences");
    await vscode.commands.executeCommand("cInsight.pinCallHierarchy");
    await combined.update("slot3", {...layout, views: ["supertypes", "subtypes", "includes", "includedBy"]}, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("cInsight.combined3.focus");
    await combined.update("slot4", {...layout, views: ["history", "bookmarks", "status"]}, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("cInsight.combined4.focus");
    await wait(async () => { const values = await state(); return values.length === 4 && values.every(surface => surface.panes.every(pane => pane.acknowledged === pane.generation)) ? true : undefined; }, "Not all 15 roles initialized");
    const previousCallerGeneration=(await state()).find(surface=>surface.slot===1)!.panes.find(pane=>pane.role==="callers")!.generation;
    const savedLayout=vscode.workspace.getConfiguration("cInsight.combinedViews").get<typeof layout>("slot1")!;
    await vscode.commands.executeCommand("workbench.view.explorer");
    await wait(async()=>!(await state()).find(surface=>surface.slot===1)?.visible?true:undefined,"Combined view did not hide");
    await combined.update("slot1",{...savedLayout,views:["preview"],ratios:[1]},vscode.ConfigurationTarget.Global);
    await combined.update("slot1",savedLayout,vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("cInsight.combined1.focus");
    await wait(async()=>{
      const caller=(await state()).find(surface=>surface.slot===1)?.panes.find(pane=>pane.role==="callers");
      return caller&&caller.generation!==previousCallerGeneration&&caller.acknowledged===caller.generation?true:undefined;
    },"Removing and re-adding a hidden pane must not reuse the obsolete child document");
    await combined.update("slot1", {...layout, enabled: false}, vscode.ConfigurationTarget.Global);
    await wait(async () => !(await state()).find(surface => surface.slot === 1)?.panes.length ? true : undefined, "Disabled layout retained presentation demand");
    const scope=vscode.workspace.getConfiguration("cInsight.combinedViews").inspect<typeof layout>("slot2");
    assert.equal(scope?.workspaceValue, undefined, "Layouts belong to user settings, not project settings");
    assert.equal(scope?.globalValue?.enabled,true,"The layout must persist in user settings");
    await verifyPreviewPresentationOwnership(uri);
    console.log(`Combined view real-frame lifecycle and shared navigation passed (${engine}, VS Code ${vscode.version}).`);
  } finally {
    for (let slot = 1; slot <= 4; slot++) await combined.update(`slot${slot}`, undefined, vscode.ConfigurationTarget.Global);
  }
}
