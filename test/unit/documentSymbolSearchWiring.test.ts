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
});
