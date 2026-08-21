import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSymbolSearchWebviewMessage,
  renderSymbolSearchWebview,
} from "../../src/symbols/symbolSearchWebview";

describe("symbol search webview", () => {
  it("keeps the search input before the scrollable result area", () => {
    const html = renderSymbolSearchWebview({
      cspSource: "vscode-webview://test",
      nonce: "safe-nonce",
      placeholder: "Search <symbols>",
      clearTitle: "Clear",
      resultsLabel: "Results",
    });
    assert.ok(html.indexOf('id="query"') < html.indexOf('id="results"'));
    assert.match(html, /\.search-bar \{[^}]*position: sticky/);
    assert.match(html, /#results \{[^}]*overflow: auto/);
    assert.match(html, /script-src 'nonce-safe-nonce'/);
    assert.doesNotMatch(html, /Search <symbols>/);
    assert.match(html, /Search &lt;symbols&gt;/);
  });

  it("accepts only bounded query, activation, and clear messages", () => {
    assert.deepEqual(parseSymbolSearchWebviewMessage({ type: "query", query: "add" }), {
      type: "query",
      query: "add",
    });
    assert.deepEqual(parseSymbolSearchWebviewMessage({ type: "activate", id: "symbol:1" }), {
      type: "activate",
      id: "symbol:1",
    });
    assert.deepEqual(parseSymbolSearchWebviewMessage({ type: "context", id: "symbol:1" }), {
      type: "context",
      id: "symbol:1",
    });
    assert.deepEqual(parseSymbolSearchWebviewMessage({ type: "clear" }), {
      type: "clear",
    });
    assert.deepEqual(parseSymbolSearchWebviewMessage({ type: "ready" }), {
      type: "ready",
    });
    assert.equal(parseSymbolSearchWebviewMessage({ type: "query", query: 1 }), undefined);
    assert.equal(parseSymbolSearchWebviewMessage({ type: "open", id: "x" }), undefined);
    assert.equal(
      parseSymbolSearchWebviewMessage({ type: "query", query: "x".repeat(2_049) }),
      undefined,
    );
  });
});
