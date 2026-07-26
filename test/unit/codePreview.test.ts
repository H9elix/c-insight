import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  highlightCppLine,
  highlightTarget,
} from "../../src/views/sourceHighlight";

describe("code preview highlighting", () => {
  it("escapes source text before rendering", () => {
    const html = highlightCppLine("if (left < right && value > 0) return;");
    assert.equal(html.includes("&lt;"), true);
    assert.equal(html.includes("&amp;&amp;"), true);
    assert.equal(html.includes("&gt;"), true);
    assert.equal(html.includes('<span class="kw">if</span>'), true);
  });

  it("does not interpret source strings or comments as HTML", () => {
    const html = highlightCppLine('const char* text = "<script>"; // <tag>');
    assert.equal(html.includes("<script>"), false);
    assert.equal(html.includes("&lt;script&gt;"), true);
    assert.equal(html.includes("&lt;tag&gt;"), true);
  });

  it("highlights only the exact target range", () => {
    const html = highlightTarget("return add(left, right);", 7, 10);
    assert.equal(
      html.includes('<mark class="target-symbol">add</mark>'),
      true,
    );
    assert.equal(html.startsWith('<span class="kw">return</span> '), true);
  });

  it("clamps invalid target ranges without emitting raw HTML", () => {
    const html = highlightTarget("value < limit", -10, 100);
    assert.equal(html.startsWith('<mark class="target-symbol">value'), true);
    assert.equal(html.includes("< limit"), false);
    assert.equal(html.includes("&lt;"), true);
  });
});
