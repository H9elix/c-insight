import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMBINED_ROLES, COMBINED_SLOTS, combinedLayout, combinedHoverTiming, combinedLayoutRevision, reorderCombinedPane, combinedPaneSizes, combinedForwardSizes, combinedOneWaySizes, combinedPaneHoverDirection, matchesPaneCondition } from "../../src/combined/combinedModel";
import { readFileSync } from "node:fs";
import { embeddedDocument, renderCombinedWebview } from "../../src/combined/combinedWebview";
import { EMBEDDED_THEME_CSS } from "../../src/combined/embeddedTheme";

describe("combined layouts", () => {
  it("defaults to four optional, empty horizontal slots", () => {
    assert.deepEqual(COMBINED_SLOTS, [1,2,3,4]); assert.equal(COMBINED_ROLES.length, 16);
    assert.deepEqual(combinedLayout(undefined), {enabled: false, title: "", direction: "horizontal", views: [], ratios: []});
  });
  it("retains only supported unique roles and finite bounded ratios", () => {
    const layout = combinedLayout({enabled: true, title: "  Browser  ", views: ["preview", "callers", "preview", "relationshipGraph", "file:///private.c"], ratios: [2, NaN]});
    assert.deepEqual(layout, {enabled: true, title: "Browser", direction: "horizontal", views: ["preview", "callers"], ratios: [2,1]});
    assert.equal(JSON.stringify(layout).includes("private"), false);
    assert.deepEqual(combinedLayout({views:["references"],ratios:[Infinity]}).ratios,[1]);
  });
  it("normalizes hover timing with zero, bounded integers and matching public defaults", () => {
    assert.deepEqual(combinedHoverTiming(),{enterDelay:200,animationDuration:200,leaveDelay:250});
    assert.deepEqual(combinedHoverTiming({enterDelay:0,animationDuration:0,leaveDelay:0}),{enterDelay:0,animationDuration:0,leaveDelay:0});
    assert.deepEqual(combinedHoverTiming({enterDelay:-3,animationDuration:1.9,leaveDelay:20001}),{enterDelay:0,animationDuration:1,leaveDelay:10000});
    assert.deepEqual(combinedHoverTiming({enterDelay:"12",animationDuration:NaN,leaveDelay:Infinity}),combinedHoverTiming());
    const properties=JSON.parse(readFileSync("package.json","utf8")).contributes.configuration.properties;
    for(const [name,value] of [["hoverEnterDelay",200],["hoverAnimationDuration",200],["hoverLeaveDelay",250]]){
      const setting=properties[`cInsight.combinedViews.${name}`];
      assert.equal(setting.type,"integer");assert.equal(setting.scope,"application");assert.equal(setting.default,value);
      assert.equal(setting.minimum,0);assert.equal(setting.maximum,10000);
    }
  });
  it("doubles hover weight by compressing neighbors, not growing the outer view", () => {
    assert.deepEqual(combinedPaneSizes(900,[1,1,1],160,-1),[300,300,300]);
    assert.deepEqual(combinedPaneSizes(900,[1,1,1],160,1),[225,450,225]);
    assert.deepEqual(combinedPaneSizes(900,[1],160,0),[900]);
    assert.deepEqual(combinedPaneSizes(480,[1,1,1],160,1),[160,160,160]);
    assert.deepEqual(combinedPaneSizes(300,[1,1,1],160,1),[160,160,160]);
    assert.deepEqual(combinedPaneSizes(320,[3,1],80,0),[240,80]);
  });
  it("keeps only valid per-role hover percentages for panes present in the layout", () => {
    const raw = {views:["preview","callers","symbols"], hoverSizePercentages:{preview:65, callers:1, symbols:100, status:50, unknown:70}};
    const layout = combinedLayout(raw);
    assert.deepEqual(layout.hoverSizePercentages,{preview:65,callers:1,symbols:100});
    for (const value of [0,101,-1,1.5,NaN,Infinity,"65",null,undefined]) {
      assert.equal(combinedLayout({views:["preview"],hoverSizePercentages:{preview:value}}).hoverSizePercentages,undefined);
    }
    assert.equal(combinedLayout({views:["preview"],hoverSizePercentages:[65]}).hoverSizePercentages,undefined);
    assert.equal(combinedLayout({views:["preview"],hoverSizePercentages:Object.create({preview:65})}).hoverSizePercentages,undefined);
    assert.equal(combinedLayout({...layout,views:["references"]}).hoverSizePercentages,undefined);
    assert.deepEqual(reorderCombinedPane(layout,"preview","symbols","after").hoverSizePercentages,layout.hoverSizePercentages);
    const properties=JSON.parse(readFileSync("package.json","utf8")).contributes.configuration.properties;
    for(const slot of COMBINED_SLOTS){
      const field=properties[`cInsight.combinedViews.slot${slot}`].properties.hoverSizePercentages;
      assert.deepEqual(field.default,{});assert.equal(field.additionalProperties,false);
      const [[pattern,range]]=Object.entries(field.patternProperties) as [string,{type:string;minimum:number;maximum:number}][];
      assert(COMBINED_ROLES.every(role=>new RegExp(pattern).test(role)));assert(!new RegExp(pattern).test("unknown"));
      assert.deepEqual(range,{type:"integer",minimum:1,maximum:100});
    }
  });
  it("uses a target percentage without shrinking a base pane or breaking minima", () => {
    assert.deepEqual(combinedPaneSizes(1200,[1,1,1],160,1,65),[210,780,210]);
    assert.deepEqual(combinedPaneSizes(1200,[1,1,1],160,1,20),[400,400,400]);
    assert.deepEqual(combinedPaneSizes(1200,[1,1,1],160,1,100),[160,880,160]);
    assert.deepEqual(combinedPaneSizes(1200,[1,2,1],160,1,65),[210,780,210]);
    const desired=combinedPaneSizes(1200,[1,1,1],160,1,65);
    assert.deepEqual(combinedForwardSizes([400,400,400],160,1,desired[1]),[400,640,160]);
    for(const percentage of [undefined,0,101,1.5,NaN,Infinity])
      assert.deepEqual(combinedPaneSizes(1200,[1,1,1],160,1,percentage),combinedPaneSizes(1200,[1,1,1],160,1));
    assert.deepEqual(combinedPaneSizes(600,[1],160,0,65),[600]);
    for(const minimum of [80,160])for(let count=1;count<=16;count++)for(const total of [100,480,1200]){
      const ratios=Array.from({length:count},(_,index)=>index+1),base=combinedPaneSizes(total,ratios,minimum,-1);
      for(let index=0;index<count;index++)for(const percentage of [1,20,65,100]){
        const sizes=combinedPaneSizes(total,ratios,minimum,index,percentage);
        assert(sizes.every(size=>size>=minimum-0.001));assert(sizes[index]>=base[index]-0.001);
        assert(Math.abs(sizes.reduce((a,b)=>a+b,0)-Math.max(total,count*minimum))<0.001);
      }
    }
  });
  it("reads legacy directions as explicit pane choices and exposes compatible per-slot schemas", () => {
    const legacy={enabled:true,views:["preview","callers"],ratios:[2,1],direction:"vertical"};
    for(const value of [undefined,"right",null,42])assert.equal(combinedLayout({...legacy,hoverDirection:value}).hoverDirections,undefined);
    const layout=combinedLayout({...legacy,hoverDirection:"both"});assert.deepEqual(layout.hoverDirections,Object.fromEntries(layout.views.map(role=>[role,"both"])));
    assert.deepEqual(layout.views,legacy.views);assert.deepEqual(layout.ratios,legacy.ratios);
    const properties=JSON.parse(readFileSync("package.json","utf8")).contributes.configuration.properties;
    for(const slot of COMBINED_SLOTS){const setting=properties[`cInsight.combinedViews.slot${slot}`];
      assert.equal(setting.default.hoverDirection,undefined);assert.equal(setting.properties.hoverDirection.default,undefined);
      assert.deepEqual(setting.properties.hoverDirection.enum,["forward","both"]);}
  });
  it("defaults only the last expanded pane to both and keeps overrides through reorder and normalization",()=>{
    const layout=combinedLayout({enabled:true,views:["preview","callers","symbols"],hoverDirections:{callers:"backward",unknown:"both",status:"forward"}});
    assert.deepEqual(layout.hoverDirections,{callers:"backward"});
    assert.equal(combinedPaneHoverDirection(layout,"preview"),"forward");assert.equal(combinedPaneHoverDirection(layout,"symbols"),"both");
    assert.equal(combinedPaneHoverDirection(layout,"callers"),"backward");
    assert.equal(combinedPaneHoverDirection(layout,"preview",["preview"]),"both");
    const reordered=reorderCombinedPane(layout,"preview","symbols","after");
    assert.equal(combinedPaneHoverDirection(reordered,"preview"),"both");assert.equal(combinedPaneHoverDirection(reordered,"symbols"),"forward");
    assert.equal(combinedPaneHoverDirection(reordered,"callers"),"backward");
    assert.equal(combinedLayout({...layout,hoverDirection:"both",hoverDirections:{}}).hoverDirections,undefined);
    for(const value of ["invalid",42,null])assert.equal(combinedLayout({views:["preview"],hoverDirections:{preview:value}}).hoverDirections,undefined);
    assert.deepEqual(combinedLayout({views:["preview"],hoverDirection:"forward"}).hoverDirections,{preview:"forward"});
    assert.deepEqual(combinedLayout({...layout,hoverDirections:{preview:"both"},views:["callers"]}).hoverDirections,undefined);
    for(const slot of COMBINED_SLOTS){
      const property=JSON.parse(readFileSync("package.json","utf8")).contributes.configuration.properties[`cInsight.combinedViews.slot${slot}`].properties.hoverDirections;
      assert.equal(property.default,undefined);assert.equal(property.additionalProperties,false);
      assert.deepEqual(Object.values(property.patternProperties)[0],{type:"string",enum:["forward","backward","both"]});
    }
  });
  it("mirrors one-way growth while preserving the trailing edge and all following panes",()=>{
    assert.deepEqual(combinedOneWaySizes([300,300,300],160,1,450,"backward"),[160,440,300]);
    assert.deepEqual(combinedOneWaySizes([300,300,300],160,0,450,"backward"),[300,300,300]);
    for(let count=1;count<=16;count++)for(let index=0;index<count;index++){
      const sizes=Array.from({length:count},(_,i)=>160+i*15),before=sizes.slice(0,index+1).reduce((a,b)=>a+b,0);
      const grown=combinedOneWaySizes(sizes,160,index,1500,"backward");
      assert(grown.every(size=>size>=160-0.001));assert(Math.abs(grown.reduce((a,b)=>a+b,0)-sizes.reduce((a,b)=>a+b,0))<0.001);
      assert(Math.abs(grown.slice(0,index+1).reduce((a,b)=>a+b,0)-before)<0.001);assert.deepEqual(grown.slice(index+1),sizes.slice(index+1));
    }
  });
  it("keeps the current leading edge through consecutive forward expansions (CI-REG-053)", () => {
    const base=[300,300,300],first=combinedForwardSizes(base,160,0,450),second=combinedForwardSizes(first,160,1,450);
    assert.deepEqual(first,[450,225,225]);assert.deepEqual(second,[450,290,160]);assert.deepEqual(base,[300,300,300]);
    assert.deepEqual(combinedForwardSizes(second,160,2,450),second,"The last pane must never borrow from its leading neighbors");
    assert.deepEqual(combinedForwardSizes(second,160,0,400),second,"A new hover does not shrink an already enlarged pane");
    assert.deepEqual(combinedForwardSizes([160,160,160],160,1,300),[160,160,160]);
    assert.deepEqual(combinedForwardSizes([900],160,0,1000),[900]);
    for(const index of [-1,9,NaN,0.5])assert.deepEqual(combinedForwardSizes(base,160,index,450),base);
    assert.deepEqual(combinedForwardSizes(base,160,0,Infinity),base);
  });
  it("conserves forward budgets, minima and preceding pixels for either orientation", () => {
    for(const minimum of [80,160])for(let count=1;count<=16;count++){
      let sizes=combinedPaneSizes(count*minimum*3,Array.from({length:count},(_,i)=>i+1),minimum,-1);
      for(let index=0;index<count;index++){
        const before=[...sizes];sizes=combinedForwardSizes(sizes,minimum,index,count*minimum*2);
        assert.deepEqual(sizes.slice(0,index),before.slice(0,index));assert(sizes.every(value=>value>=minimum-0.001));
        assert(Math.abs(sizes.reduce((a,b)=>a+b,0)-before.reduce((a,b)=>a+b,0))<0.001);
      }
    }
  });
  it("inserts panes at either end while retaining each role's weight and input arrays", () => {
    const layout=combinedLayout({enabled:true,title:"Browser",views:["preview","callers","references","symbols"],ratios:[3,2,1,4]});
    const snapshot=JSON.stringify(layout);
    const last=reorderCombinedPane(layout,"preview","symbols","after");
    assert.deepEqual(last.views,["callers","references","symbols","preview"]);assert.deepEqual(last.ratios,[2,1,4,3]);
    const first=reorderCombinedPane(layout,"symbols","preview","before");
    assert.deepEqual(first.views,["symbols","preview","callers","references"]);assert.deepEqual(first.ratios,[4,3,2,1]);
    const middle=reorderCombinedPane(layout,"preview","references","before");
    assert.deepEqual(middle.views,["callers","preview","references","symbols"]);assert.deepEqual(middle.ratios,[2,3,1,4]);
    assert.equal(JSON.stringify(layout),snapshot);assert.equal(last.title,layout.title);
    assert.equal(reorderCombinedPane(layout,"callers","preview","after"),layout);
    assert.equal(reorderCombinedPane(layout,"preview","callers","before"),layout);
    assert.equal(reorderCombinedPane(layout,"preview","preview","after"),layout);
    assert.equal(reorderCombinedPane(layout,"unknown","preview","after"),layout);
    assert.equal(reorderCombinedPane(layout,"preview","unknown","after"),layout);
    assert.equal(reorderCombinedPane(layout,"preview","callers","invalid" as "after"),layout);
    const disabled={...layout,enabled:false};assert.equal(reorderCombinedPane(disabled,"symbols","preview","before"),disabled);
  });
  it("revisions track geometry settings, including per-pane hover targets", () => {
    const layout=combinedLayout({enabled:true,views:["preview","callers"],ratios:[2,1]});
    assert.equal(combinedLayoutRevision(layout),combinedLayoutRevision({...layout,title:"Renamed"}));
    for(const changed of [{...layout,enabled:false},{...layout,direction:"vertical" as const},{...layout,hoverDirections:{preview:"both" as const}},{...layout,hoverSizePercentages:{preview:65}},{...layout,ratios:[1,2]},reorderCombinedPane(layout,"preview","callers","after")])
      assert.notEqual(combinedLayoutRevision(layout),combinedLayoutRevision(changed));
  });
  it("honors lower bounds and conserves each available budget", () => {
    for (let count=1;count<=16;count++) for (const total of [100,480,1500,10000]) for (let hovered=-1;hovered<count;hovered++) {
      const sizes=combinedPaneSizes(total,Array.from({length:count},(_,index)=>index+1),80,hovered);
      assert(sizes.every(size=>size>=80-0.0001));
      assert(Math.abs(sizes.reduce((a,b)=>a+b,0)-Math.max(total,count*80))<0.0001);
    }
  });
  it("uses the outer nonce and inserts the bridge before renderer scripts", () => {
    const html=embeddedDocument('<html><head><meta http-equiv="Content-Security-Policy" content="default-src none"><style nonce="inner">p{}</style><script nonce="inner">acquireVsCodeApi()</script></head></html>',"outer",3);
    assert.doesNotMatch(html,/nonce="inner"|http-equiv="Content-Security-Policy"/);
    assert.match(html,/nonce="outer"/);assert(html.indexOf("window.acquireVsCodeApi")<html.lastIndexOf("acquireVsCodeApi()"));
    assert.match(html,/null\/\*cInsightFrameState\*\//);
  });
  it("inlines the official icon stylesheet regardless of HTML attribute order", () => {
    for (const link of ['<link href="https://local/codicon.css" rel="stylesheet">','<link rel="stylesheet" href="https://local/codicon.css">']) {
      const html=embeddedDocument(`<html><head>${link}</head></html>`,"outer",1);
      assert.match(html,/<!--cInsightIcons-->/);assert.doesNotMatch(html,/<link/);
    }
  });
  it("supplies low-priority native-style theme defaults before renderer styles", () => {
    const html=embeddedDocument('<html><head><style id="renderer">code{background:transparent}</style></head></html>',"outer",1);
    assert(html.indexOf('id="c-insight-embedded-theme"')<html.indexOf('id="renderer"'));
    assert.match(EMBEDDED_THEME_CSS,/@layer c-insight-embedded-default/);
    for(const state of ["background","hoverBackground","activeBackground"])assert(EMBEDDED_THEME_CSS.includes(`--vscode-scrollbarSlider-${state}`));
    assert.match(EMBEDDED_THEME_CSS,/::-webkit-scrollbar-corner/);
    assert.match(EMBEDDED_THEME_CSS,/font-weight: var\(--vscode-font-weight\)/);
    assert.match(EMBEDDED_THEME_CSS,/vscode-high-contrast-light/);
    assert.doesNotMatch(EMBEDDED_THEME_CSS,/textPreformat|#[0-9a-f]{3,8}\b/i,"Baseline styles must not introduce hard-coded colors or source-line boxes");
  });
  it("selects only whitelisted role commands and current pin states without evaluating code", () => {
    assert(matchesPaneCondition("view == cInsight.callers && !cInsight.callHierarchyPinned", "cInsight.callers", {"cInsight.callHierarchyPinned":false}));
    assert(!matchesPaneCondition("view == cInsight.callers && !cInsight.callHierarchyPinned", "cInsight.callers", {"cInsight.callHierarchyPinned":true}));
    assert(matchesPaneCondition("view == cInsight.supertypes || view == cInsight.subtypes", "cInsight.subtypes", {}));
    assert(matchesPaneCondition("view =~ /cInsight\\.(context|preview|references|callers|callees)/", "cInsight.references", {}));
    assert(!matchesPaneCondition("view == cInsight.callers && unknown()", "cInsight.callers", {}));
    assert(!matchesPaneCondition("view == cInsight.callers && !cInsight.unknown", "cInsight.callers", {}));
  });
  it("escapes labels and keeps styles, resizing and motion inside the webview", () => {
    const html=renderCombinedWebview("nonce","vscode-resource:","icons.css",{empty:"<script>",manage:"Manage"});
    assert.match(html,/&lt;script&gt;/);assert.match(html,/prefers-reduced-motion:reduce/);
    assert.match(html,/var\(--ci-combined-animation-duration,200ms\) ease/);assert.doesNotMatch(html,/unsafe-eval|https:\/\/|vscode-workbench/);
    assert.match(html,/id="bar-actions"/);assert.match(html,/\.combined-vertical #name\{writing-mode:horizontal-tb/);
    assert.match(html,/item\.generation!==pane\.generation/);
    assert.match(html,/item\.iframe\.contentWindow===event\.source/);
  });
  it("removes native outer padding while retaining toolbar and child gutters (CI-REG-052)", () => {
    const html=renderCombinedWebview("nonce","vscode-resource:","icons.css",{empty:"Empty"});
    assert.match(html,/body\{padding:0;/,"The combined surface must override native Webview body padding");
    assert.match(html,/#bar\{[^}]*padding:3px 2px/,"The toolbar keeps its own internal padding");
    assert.match(EMBEDDED_THEME_CSS,/padding: 0 20px;/,"Child renderer defaults must not change with the outer surface");
  });
});
