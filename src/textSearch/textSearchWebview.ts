import type { textSearchLabels } from "./textSearchLabels";
import { TEXT_SEARCH_CLIENT } from "./textSearchClient";
import { searchDisclosureState, searchWindow } from "./textSearchPresentation";

export function renderTextSearch(cspSource: string, nonce: string, labels: ReturnType<typeof textSearchLabels>, readOnly = false, uiSession = ""): string {
  return String.raw`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root{color-scheme:light dark}body.vscode-dark,body.vscode-high-contrast{color-scheme:dark}body.vscode-light,body.vscode-high-contrast-light{color-scheme:light}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-sideBar-background,var(--vscode-editor-background));font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}*{box-sizing:border-box}body{height:100vh;display:flex;flex-direction:column}#controls{padding:6px;flex:none;border-bottom:1px solid var(--vscode-panel-border)}.row{display:flex;gap:4px;align-items:center;margin:3px 0;flex-wrap:wrap}.row>input[type=text],.row>textarea{flex:1;min-width:80px}input,textarea,select{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:4px}textarea{resize:vertical;height:30px;min-height:28px}input:focus,textarea:focus,select:focus,button:focus-visible,.match:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:4px 7px;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button:disabled{opacity:.5;cursor:default}.option{display:inline-flex;gap:2px;align-items:center}.option input{accent-color:var(--vscode-focusBorder)}.compact{font-size:.92em}#status{white-space:pre-wrap;padding:4px 6px;color:var(--vscode-descriptionForeground)}#results{position:relative;overflow:auto;flex:1;min-height:0}details>summary{padding:4px;cursor:pointer;white-space:nowrap}details>summary:hover,.match:hover{background:var(--vscode-list-hoverBackground)}.match{display:flex;align-items:center;gap:4px;padding:2px 8px 2px 18px;cursor:pointer;white-space:pre;min-width:max-content}.match.selected{color:var(--vscode-list-activeSelectionForeground);background:var(--vscode-list-activeSelectionBackground)}.location{color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums}.snippet{font-family:var(--vscode-editor-font-family,monospace);font-size:var(--vscode-editor-font-size,13px)}mark{color:inherit;background:var(--vscode-editor-findMatchHighlightBackground);border:1px solid var(--vscode-editor-findMatchHighlightBorder,transparent)}#plan{padding:4px 6px;border-bottom:1px solid var(--vscode-panel-border)}[hidden]{display:none!important}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background)}::-webkit-scrollbar-thumb:hover{background:var(--vscode-scrollbarSlider-hoverBackground)}::-webkit-scrollbar-track{background:transparent}#clear{background:transparent;color:var(--vscode-foreground)}
.search-space{position:relative}.search-layer{position:absolute;left:0;top:0;width:max-content;min-width:100%}.search-group{overflow:hidden;white-space:nowrap}.search-group>summary{height:100%;padding:0 4px}.search-group input,.search-group button{vertical-align:middle}.match{padding-top:0;padding-bottom:0}
.result-actions{flex:none;padding:3px 6px}.snapshot #controls,.snapshot #plan,.snapshot .result-actions,.snapshot .match>input,.snapshot .search-group input,.snapshot .search-group button{display:none!important}#snapshotQuery{padding:8px;font-weight:600;white-space:pre-wrap;flex:none}.snapshot{background:var(--vscode-editor-background)}
body{padding:0}
#controls{max-height:65vh;overflow:auto}
.query-row{flex-wrap:nowrap}
.query-box{display:flex;flex-wrap:wrap;align-items:center;flex:1;min-width:0;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent)}
.query-box:focus-within{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
.query-box>textarea{flex:1;width:0;min-width:30px;border:0;outline:none;max-height:120px}
.query-box>textarea:focus{outline:none}
.icon-button,#clear{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:26px;padding:2px;background:transparent;color:var(--vscode-foreground);border:1px solid transparent;border-radius:3px}
.icon-button:hover,#clear:hover,.disclosure-button:hover{background:var(--vscode-toolbar-hoverBackground)}
.icon-button svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.5}
.match-options{display:flex;flex:none;gap:1px}
.match-option{position:relative;display:inline-flex;cursor:pointer}
.match-option>input{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);padding:0;border:0}
.match-option>span{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:1px 3px;border:1px solid transparent;border-radius:3px;color:var(--vscode-input-foreground)}
.match-option:hover>span{background:var(--vscode-toolbar-hoverBackground)}
.match-option>input:checked+span{background:var(--vscode-inputOption-activeBackground);color:var(--vscode-inputOption-activeForeground,var(--vscode-foreground));border-color:var(--vscode-inputOption-activeBorder,var(--vscode-focusBorder))}
.match-option:focus-within>span{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
.whole-word>span{text-decoration:underline}
.scope-row{gap:3px}
.scope-row>select{flex:1;min-width:65px;width:0}
.disclosure-button{background:transparent;color:var(--vscode-foreground);padding:3px 5px;border:1px solid transparent;border-radius:3px;white-space:nowrap}
.disclosure-button::before{content:'▸';display:inline-block;margin-right:4px}
.disclosure-button[aria-expanded=true]::before{content:'▾'}
.disclosure-button.active{color:var(--vscode-inputOption-activeForeground,var(--vscode-foreground));border-color:var(--vscode-inputOption-activeBorder,var(--vscode-focusBorder))}
#filterArea{padding:2px 0 4px}
.filter-fields>input{min-width:0!important;flex-basis:120px!important}
.filter-summary{display:block;width:100%;padding:1px 3px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent;color:var(--vscode-descriptionForeground)}
#statusBar{flex:none;padding:2px 6px;border-bottom:1px solid var(--vscode-panel-border)}
.status-row{display:flex;gap:4px;align-items:center;flex-wrap:wrap;min-height:24px}
#resultSummary{flex:1;min-width:0;color:var(--vscode-descriptionForeground);font-size:.92em}
.result-actions{padding:0}
.result-actions>button{padding:2px 4px;background:transparent;color:var(--vscode-textLink-foreground)}
#status{padding:2px 0;font-size:.92em}
#statistics{padding:4px 0;white-space:pre-wrap;font-size:.92em;color:var(--vscode-descriptionForeground)}
#statisticsToggle{height:24px}
.snapshot #statusBar{border-bottom:0}
#replaceArea .row>textarea{min-width:0}
#replaceArea>.row:last-child>button{font-size:.92em;padding:3px 5px}
#resultSummary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.icon-button[aria-expanded=true]{background:var(--vscode-inputOption-activeBackground);border-color:var(--vscode-inputOption-activeBorder,var(--vscode-focusBorder))}
</style></head><body class="${readOnly ? "snapshot" : ""}"><div id="snapshotQuery" ${readOnly ? "" : "hidden"}></div><section id="controls" data-ci-hover-pause>
<div class="row scope-row"><select id="scope"></select><button id="folder" class="icon-button" hidden>…</button><button id="previous" class="icon-button">↑</button><button id="next" class="icon-button">↓</button><button id="filtersToggle" class="disclosure-button" aria-controls="filterArea" aria-expanded="false"></button></div>
<button id="filterSummary" class="filter-summary" hidden></button><section id="filterArea" hidden><div class="row filter-fields"><input type="text" id="include"><input type="text" id="exclude"></div><label class="option compact"><input id="useIgnores" type="checkbox" checked><span id="ignoresLabel"></span></label></section>
<div class="row query-row"><button id="toggle" class="icon-button" aria-controls="replaceArea" aria-expanded="false">▸</button><div class="query-box"><textarea id="query" spellcheck="false" aria-label="query"></textarea><button id="clear">×</button><div id="options" class="match-options" role="group"></div></div><button id="search" class="icon-button"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5"/><path d="m10 10 4 4"/></svg></button><button id="cancel" class="icon-button" hidden>■</button></div>
<section id="replaceArea" hidden><div class="row"><textarea id="replacement" spellcheck="false"></textarea><label class="option"><input id="preserveCase" type="checkbox"><span id="preserveLabel"></span></label></div><div class="row"><button id="current"></button><button id="checked"></button><button id="all"></button></div></section>
</section><section id="plan" hidden data-ci-hover-pause></section><section id="statusBar" data-ci-hover-pause><div id="statusRow" class="status-row" hidden><span id="resultSummary"></span><div class="result-actions" hidden><button id="openResultsTop"></button></div><button id="statisticsToggle" class="icon-button" aria-controls="statistics" aria-expanded="false"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 7v5M8 4v1"/></svg></button></div><div id="status" role="status" aria-live="polite"></div><section id="statistics" hidden></section></section><main id="results" aria-label="Search results"></main>
<script nonce="${nonce}">
const labels=${JSON.stringify(labels).replace(/</g, "\\u003c")};const readOnly=${readOnly};const client="client-${nonce}";const windowFor=${searchWindow.toString()};
const uiSession=${JSON.stringify(uiSession).replace(/</g, "\\u003c")};const disclosureFor=${searchDisclosureState.toString()};
${TEXT_SEARCH_CLIENT}
</script></body></html>`;
}
