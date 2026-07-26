import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeMermaidLabel,
  mermaidCallEdge,
} from "../../src/utils/mermaid";

describe("call hierarchy Mermaid export", () => {
  it("escapes labels that could alter Mermaid syntax", () => {
    assert.equal(
      escapeMermaidLabel('decode<&"frame">'),
      "decode&lt;&amp;&quot;frame&quot;&gt;",
    );
  });

  it("uses semantic call direction for callers and callees", () => {
    assert.equal(mermaidCallEdge("callee", "caller", "incoming"), "caller --> callee");
    assert.equal(mermaidCallEdge("caller", "callee", "outgoing"), "caller --> callee");
  });
});
