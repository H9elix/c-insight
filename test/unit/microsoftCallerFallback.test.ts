import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentSymbol } from "vscode-languageclient/node";
import { enclosingCaller } from "../../src/callHierarchy/microsoftCallerFallbackModel";

const range = (startLine: number, endLine: number) => ({
  start: { line: startLine, character: 0 },
  end: { line: endLine, character: 80 },
});

describe("Microsoft reference-based Callers", () => {
  it("selects the innermost callable containing a reference", () => {
    const nested: DocumentSymbol = {
      name: "outer",
      kind: 12,
      range: range(1, 30),
      selectionRange: range(1, 1),
      children: [{
        name: "inner",
        kind: 12,
        range: range(10, 20),
        selectionRange: range(10, 10),
        children: [],
      }],
    };
    assert.equal(
      enclosingCaller("file:///caller.c", { line: 15, character: 4 }, [nested])?.name,
      "inner",
    );
  });

  it("ignores non-callable containers and out-of-range symbols", () => {
    const variable: DocumentSymbol = {
      name: "global",
      kind: 13,
      range: range(1, 2),
      selectionRange: range(1, 1),
      children: [],
    };
    assert.equal(
      enclosingCaller("file:///caller.c", { line: 5, character: 0 }, [variable]),
      undefined,
    );
  });
});
