import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TypeHierarchyItem } from "vscode-languageserver-types";
import {
  isTypeHierarchyRecursion,
  typeHierarchyKey,
  typeHierarchyMermaidEdge,
} from "../../src/utils/typeHierarchy";

const item: TypeHierarchyItem = {
  name: "Derived",
  kind: 5,
  uri: "file:///workspace/type.hpp",
  range: {
    start: { line: 1, character: 0 },
    end: { line: 3, character: 1 },
  },
  selectionRange: {
    start: { line: 1, character: 6 },
    end: { line: 1, character: 13 },
  },
};

describe("type hierarchy helpers", () => {
  it("creates stable keys and detects recursive ancestry", () => {
    const key = typeHierarchyKey(item);
    assert.equal(typeHierarchyKey({ ...item }), key);
    assert.equal(isTypeHierarchyRecursion(item, [key]), true);
    assert.equal(isTypeHierarchyRecursion(item, []), false);
  });

  it("always renders inheritance from supertype to subtype", () => {
    assert.equal(typeHierarchyMermaidEdge("base", "derived"), "base --> derived");
  });
});
