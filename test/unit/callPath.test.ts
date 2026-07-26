import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findCallPaths } from "../../src/utils/callPath";

interface Node {
  name: string;
  children: string[];
}

const graph = new Map<string, Node>([
  ["A", { name: "A", children: ["B", "C"] }],
  ["B", { name: "B", children: ["D"] }],
  ["C", { name: "C", children: ["D", "A"] }],
  ["D", { name: "target", children: [] }],
]);

async function search(overrides: Partial<{
  maximumDepth: number;
  maximumPaths: number;
  maximumVisitedNodes: number;
}> = {}) {
  return findCallPaths({
    roots: [graph.get("A")!],
    key: (node) => node.name,
    label: (node) => node.name,
    target: "target",
    neighbors: async (node) =>
      node.children.map((name) => graph.get(name)!),
    maximumDepth: overrides.maximumDepth ?? 4,
    maximumPaths: overrides.maximumPaths ?? 10,
    maximumVisitedNodes: overrides.maximumVisitedNodes ?? 100,
  });
}

describe("call path search", () => {
  it("finds multiple paths while avoiding cycles", async () => {
    const result = await search();
    assert.deepEqual(
      result.paths.map((path) => path.map((node) => node.name)),
      [
        ["A", "B", "target"],
        ["A", "C", "target"],
      ],
    );
  });

  it("obeys depth and path limits", async () => {
    assert.equal((await search({ maximumDepth: 1 })).paths.length, 0);
    const limited = await search({ maximumPaths: 1 });
    assert.equal(limited.paths.length, 1);
    assert.equal(limited.truncated, true);
  });

  it("obeys the visited-node limit", async () => {
    const result = await search({ maximumVisitedNodes: 2 });
    assert.equal(result.paths.length, 0);
    assert.equal(result.truncated, true);
  });
});
