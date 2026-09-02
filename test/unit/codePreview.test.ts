import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeSemanticTokens,
  highlightCppLine,
  highlightSemanticLine,
  highlightTarget,
  previewTargetSpan,
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

  it("keeps single-line provider ranges eligible for inline highlighting", () => {
    assert.deepEqual(
      previewTargetSpan(
        {
          start: { line: 4, character: 7 },
          end: { line: 4, character: 10 },
        },
        4,
        20,
      ),
      { start: 7, end: 10 },
    );
  });

  it("treats multi-line provider ranges as navigation-only", () => {
    const range = {
      start: { line: 4, character: 0 },
      end: { line: 12, character: 1 },
    };
    assert.equal(previewTargetSpan(range, 4, 30), undefined);
    assert.equal(previewTargetSpan(range, 8, 30), undefined);
    assert.equal(previewTargetSpan(range, 12, 30), undefined);
  });

  it("decodes delta semantic tokens and modifier bits for the preview range", () => {
    const tokens = decodeSemanticTokens(
      new Uint32Array([
        3, 4, 5, 0, 1,
        0, 8, 3, 1, 2,
        2, 1, 4, 0, 0,
      ]),
      {
        tokenTypes: ["function", "variable"],
        tokenModifiers: ["declaration", "readonly"],
      },
      3,
      3,
    );
    assert.deepEqual(tokens.get(3), [
      {
        line: 3,
        start: 4,
        length: 5,
        type: "function",
        modifiers: ["declaration"],
      },
      {
        line: 3,
        start: 12,
        length: 3,
        type: "variable",
        modifiers: ["readonly"],
      },
    ]);
    assert.equal(tokens.has(5), false);
  });

  it("layers semantic symbol classes and target markup over lexical gaps", () => {
    const html = highlightSemanticLine(
      "const int result = add(value);",
      [
        {
          line: 0,
          start: 10,
          length: 6,
          type: "variable",
          modifiers: ["readonly"],
        },
        {
          line: 0,
          start: 19,
          length: 3,
          type: "function",
          modifiers: [],
        },
      ],
      { start: 19, end: 22 },
    );
    assert.equal(html.includes('<span class="kw">const</span>'), true);
    assert.equal(
      html.includes(
        '<span class="sem sem-variable sem-navigable sem-mod-readonly">result</span>',
      ),
      true,
    );
    assert.equal(
      html.includes(
        '<mark class="target-symbol"><span class="sem sem-function sem-navigable">add</span></mark>',
      ),
      true,
    );
  });

  it("marks symbols as navigable without marking syntax tokens", () => {
    const html = highlightSemanticLine("value + 1", [
      {
        line: 0,
        start: 0,
        length: 5,
        type: "variable",
        modifiers: [],
      },
      {
        line: 0,
        start: 6,
        length: 1,
        type: "operator",
        modifiers: [],
      },
    ]);
    assert.equal(
      html.includes("sem sem-variable sem-navigable"),
      true,
    );
    assert.equal(html.includes("sem-operator sem-navigable"), false);
  });

  it("escapes semantic token text", () => {
    const html = highlightSemanticLine("<value>", [
      {
        line: 0,
        start: 0,
        length: 7,
        type: "variable",
        modifiers: [],
      },
    ]);
    assert.equal(html.includes("<value>"), false);
    assert.equal(html.includes("&lt;value&gt;"), true);
  });
});
