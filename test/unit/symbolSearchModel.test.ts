import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterWorkspaceSymbols,
  groupWorkspaceSymbols,
  WorkspaceSymbolRecord,
} from "../../src/symbols/symbolSearchModel";

const symbols: WorkspaceSymbolRecord[] = [
  {
    name: "run",
    kind: 12,
    kindLabel: "Function",
    uri: "file:///workspace/src/a.cpp",
    line: 1,
    character: 0,
  },
  {
    name: "value",
    kind: 13,
    kindLabel: "Variable",
    uri: "file:///workspace/lib/b.cpp",
    line: 2,
    character: 0,
  },
  {
    name: "stop",
    kind: 12,
    kindLabel: "Function",
    uri: "file:///workspace/src/a.cpp",
    line: 3,
    character: 0,
  },
];

describe("workspace symbol search model", () => {
  it("filters by kind and applies the result limit", () => {
    assert.deepEqual(
      filterWorkspaceSymbols(symbols, new Set([12]), 1).map((item) => item.name),
      ["run"],
    );
    assert.equal(filterWorkspaceSymbols(symbols, new Set(), 2).length, 2);
  });

  it("groups by type, file, directory, or flat", () => {
    assert.deepEqual(
      groupWorkspaceSymbols(symbols, "type").map((group) => group.label),
      ["Function", "Variable"],
    );
    assert.deepEqual(
      groupWorkspaceSymbols(symbols, "file").map((group) => group.label),
      ["a.cpp", "b.cpp"],
    );
    assert.deepEqual(
      groupWorkspaceSymbols(symbols, "directory").map((group) => group.label),
      ["lib", "src"],
    );
    assert.equal(groupWorkspaceSymbols(symbols, "flat")[0].symbols.length, 3);
  });
});
