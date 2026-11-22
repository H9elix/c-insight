import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMBINED_ROLES, COMBINED_SLOTS, combinedLayout, combinedHoverTiming, combinedLayoutRevision, reorderCombinedPane, combinedPaneSizes, matchesPaneCondition } from "../../src/combined/combinedModel";
import { readFileSync } from "node:fs";
import { embeddedDocument, renderCombinedWebview } from "../../src/combined/combinedWebview";
import { EMBEDDED_THEME_CSS } from "../../src/combined/embeddedTheme";

describe("combined layouts", () => {
  it("defaults to four optional, empty horizontal slots", () => {
    assert.deepEqual(COMBINED_SLOTS, [1,2,3,4]); assert.equal(COMBINED_ROLES.length, 15);
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
  it("revisions track only enabled, orientation, order and weights", () => {
    const layout=combinedLayout({enabled:true,views:["preview","callers"],ratios:[2,1]});
    assert.equal(combinedLayoutRevision(layout),combinedLayoutRevision({...layout,title:"Renamed"}));
    for(const changed of [{...layout,enabled:false},{...layout,direction:"vertical" as const},{...layout,ratios:[1,2]},reorderCombinedPane(layout,"preview","callers","after")])
      assert.notEqual(combinedLayoutRevision(layout),combinedLayoutRevision(changed));
  });
  it("honors lower bounds and conserves each available budget", () => {
    for (let count=1;count<=15;count++) for (const total of [100,480,1500,10000]) for (let hovered=-1;hovered<count;hovered++) {
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
