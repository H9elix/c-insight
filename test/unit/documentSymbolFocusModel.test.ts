import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  documentSymbolAtLine,
  visibleCenterLine,
  type DocumentSymbolFocusCandidate,
} from "../../src/symbols/documentSymbolFocusModel";

function candidate(
  value: string,
  startLine: number,
  endLine: number,
  depth: number,
  order: number,
): DocumentSymbolFocusCandidate<string> {
  return {
    value,
    range: { startLine, endLine },
    depth,
    order,
  };
}

describe("document symbol viewport focus", () => {
  it("uses the logical center of one or more visible ranges", () => {
    assert.equal(visibleCenterLine([{ startLine: 10, endLine: 20 }]), 15);
    assert.equal(
      visibleCenterLine([
        { startLine: 2, endLine: 4 },
        { startLine: 20, endLine: 22 },
      ]),
      4,
    );
    assert.equal(visibleCenterLine([]), undefined);
  });

  it("selects the deepest symbol containing the center line", () => {
    const candidates = [
      candidate("namespace", 0, 100, 0, 0),
      candidate("class", 10, 80, 1, 1),
      candidate("method", 20, 40, 2, 2),
    ];
    assert.equal(documentSymbolAtLine(candidates, 30), "method");
    assert.equal(documentSymbolAtLine(candidates, 60), "class");
  });

  it("uses the narrowest range and stable provider order for overlap ties", () => {
    const candidates = [
      candidate("wide", 10, 50, 1, 0),
      candidate("first narrow", 20, 30, 1, 1),
      candidate("second narrow", 20, 30, 1, 2),
    ];
    assert.equal(documentSymbolAtLine(candidates, 25), "first narrow");
    assert.equal(documentSymbolAtLine(candidates, 75), undefined);
  });
});
