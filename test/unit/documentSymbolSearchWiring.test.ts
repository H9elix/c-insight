import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderResultTreeWebview } from "../../src/views/resultTreeWebview";

describe("document symbol persistent search wiring", () => {
  it("opts only Document Symbols into the persistent materialized-child filter", () => {
    const registry = readFileSync("src/views/viewRegistry.ts", "utf8");
    assert.match(registry, /id === VIEWS\.SYMBOLS \? \{\s*persistentFilter: true, filterLoadedChildren: true/);
    const adapter = readFileSync("src/views/resultTreeView.ts", "utf8");
    assert.match(adapter, /loadedChildren: options\.filterLoadedChildren \? node => node\.children \?\? \[\] : undefined/);
    assert.match(adapter, /node && options\.filterLoadedChildren && this\.model\.filterSnapshot\(\)/);
    assert.match(adapter, /filterRows: this\.model\.filterSnapshot\(\)\?\.map/);
    assert.match(registry, /filterText: info\.name/);
    assert.match(registry, /filterText: document\.name/);
  });

  it("reuses the file-list input surface with symbol-specific accessible text", () => {
    const html = renderResultTreeWebview({ nonce: "test", cspSource: "vscode-resource:", iconsUri: "icons.css",
      label: "Document Symbols", collapseTitle: "Collapse All", filterTitle: "Filter symbols by name",
      expandTitle: "Expand", collapseNodeTitle: "Collapse", persistentFilter: true,
      clearTitle: "Clear symbol filter", noMatchesTitle: "No matching symbols" });
    assert.match(html, /id="filter"\s+type="search"/);
    assert.match(html, /id="filter-toggle" hidden/);
    assert.match(html, /id="filter-clear" hidden[^>]*title="Clear symbol filter"/);
    assert.match(html, /id="empty" hidden[^>]*>No matching symbols</);
  });

  it("places an independent lock pair in the same slot beside sort and refresh", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const menus = manifest.contributes.menus["view/title"] as Array<{ command: string; when: string; group: string }>;
    const lock = menus.find(item => item.command === "cInsight.documentSymbols.lock")!;
    const unlock = menus.find(item => item.command === "cInsight.documentSymbols.unlock")!;
    assert.equal(lock.group, "navigation@0"); assert.equal(unlock.group, lock.group);
    assert.match(lock.when, /!cInsight\.documentSymbolsLocked/); assert.match(unlock.when, /&& cInsight\.documentSymbolsLocked/);
    assert.equal(menus.find(item => item.command === "cInsight.documentSymbols.sort")?.group, "navigation@1");
    assert.equal(menus.find(item => item.command === "cInsight.refresh" && item.when === "view == cInsight.symbols")?.group, "navigation@2");
    assert.deepEqual(manifest.contributes.configuration.properties["cInsight.documentSymbols.sortBy"].enum, ["position", "name", "type"]);
    assert.equal(manifest.contributes.configuration.properties["cInsight.documentSymbols.sortBy"].default, "position");
  });

  it("gates only viewport reveal and keeps sorting on loaded nodes", () => {
    const registry = readFileSync("src/views/viewRegistry.ts", "utf8");
    const reveal = registry.slice(registry.indexOf("private revealFocusedDocumentSymbol()"), registry.indexOf("updateReliability("));
    assert.match(reveal, /if \(!next \|\| this\.documentSymbolsLocked\) return/);
    assert.match(reveal, /this\.documentSymbolsLocked \|\|/);
    const sort = registry.slice(registry.indexOf("private sortedDocumentSymbols("), registry.indexOf("  clearSymbols():"));
    assert.match(sort, /node\.children = visit\(node\.children\)/); assert.match(sort, /sortDocumentSymbolSiblings/);
    assert.doesNotMatch(sort, /this\.analysis|loadChildren|getChildren/);
    const initializer = readFileSync("src/activation/runtimeInitialization.ts", "utf8");
    assert.match(initializer, /CONTEXT_KEYS\.DOCUMENT_SYMBOLS_LOCKED, false/);
  });
});
