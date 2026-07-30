import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hierarchyNodeStates,
  renderHierarchyExport,
} from "../../src/utils/hierarchyExport";

describe("hierarchy export", () => {
  const roots = [
    {
      name: "callee",
      uri: "file:///callee.c",
      states: [],
      children: [
        {
          name: "caller",
          uri: "file:///caller.c",
          line: 7,
          states: ["duplicate"],
          children: [],
        },
      ],
    },
  ];

  it("uses a versioned common JSON envelope", () => {
    const parsed = JSON.parse(
      renderHierarchyExport(
        roots,
        {
          relation: "call",
          direction: "callers",
          edgeDirection: "child-to-parent",
          summary: { loadedNodes: 2, maximumLoadedDepth: 1 },
        },
        "json",
      ),
    );
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.relation, "call");
    assert.equal(parsed.summary.loadedNodes, 2);
    assert.deepEqual(parsed.roots[0].children[0].states, ["duplicate"]);
  });

  it("includes summaries in text and Mermaid without changing graph direction", () => {
    const metadata = {
      relation: "type" as const,
      direction: "supertypes",
      edgeDirection: "child-to-parent" as const,
      summary: { loadedNodes: 2, truncatedBy: { maximumDepth: false } },
    };
    assert.match(renderHierarchyExport(roots, metadata, "text"), /^# Summary:/);
    const mermaid = renderHierarchyExport(roots, metadata, "mermaid");
    assert.match(mermaid, /^%% Summary:/);
    assert.match(mermaid, /n1 --> n0/);
  });

  it("keeps semantic edge direction in Mermaid", () => {
    const output = renderHierarchyExport(
      roots,
      {
        relation: "call",
        direction: "callers",
        edgeDirection: "child-to-parent",
      },
      "mermaid",
    );
    assert.match(output, /n1 --> n0/);
  });

  it("normalizes hierarchy states", () => {
    assert.deepEqual(
      hierarchyNodeStates(
        "node",
        "indirect recursion · duplicate · max depth",
      ),
      ["indirect-recursion", "duplicate", "maximum-depth"],
    );
  });
});
