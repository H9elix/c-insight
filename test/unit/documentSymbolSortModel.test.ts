import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentSymbolSort, DocumentSymbolSortKey, sortDocumentSymbolSiblings } from "../../src/symbols/documentSymbolSortModel";

const entry = (name: string, line: number, kind = 12, order = line, character = 0): DocumentSymbolSortKey => ({ name, line, kind, order, character });
const identity = (value: DocumentSymbolSortKey) => value;

describe("document symbol sibling sorting", () => {
  it("defaults absent and invalid values to source position", () => {
    for (const value of [undefined, null, false, 12, "unknown", {}, "position"]) assert.equal(documentSymbolSort(value), "position");
    assert.equal(documentSymbolSort("name"), "name"); assert.equal(documentSymbolSort("type"), "type");
  });

  it("sorts source positions and uses provider order for exact ties without mutating the input", () => {
    const values = [entry("late", 10), entry("second", 2, 12, 2, 5), entry("first", 2, 12, 1), entry("tie", 2, 12, 0)];
    const original = [...values];
    const sorted = sortDocumentSymbolSiblings(values, "position", identity);
    assert.deepEqual(sorted.map(value => value.name), ["tie", "first", "second", "late"]);
    assert.deepEqual(values, original); assert.equal(sorted[3], values[0]);
  });

  it("uses case-insensitive natural names, then source positions for duplicate names", () => {
    const values = [entry("node10", 0), entry("Node2", 5), entry("alpha", 10), entry("ALPHA", 2)];
    assert.deepEqual(sortDocumentSymbolSiblings(values, "name", identity).map(value => value.line), [2, 10, 5, 0]);
  });

  it("groups by protocol symbol kind, then natural name and source position", () => {
    const values = [entry("variable", 1, 13), entry("ClassZ", 0, 5), entry("method", 3, 6), entry("ClassA", 2, 5)];
    assert.deepEqual(sortDocumentSymbolSiblings(values, "type", identity).map(value => value.name), ["ClassA", "ClassZ", "method", "variable"]);
  });

  it("sorts only the supplied sibling set and leaves child order and references alone", () => {
    const children = [entry("childZ", 0), entry("childA", 1)];
    const root = { ...entry("rootZ", 0), children };
    const other = { ...entry("rootA", 1), children: [] };
    const sorted = sortDocumentSymbolSiblings([root, other], "name", value => value);
    assert.equal(sorted[1], root); assert.equal(root.children, children);
    assert.deepEqual(children.map(value => value.name), ["childZ", "childA"]);
  });
});
