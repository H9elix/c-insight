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
        },
        "json",
      ),
    );
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.relation, "call");
    assert.deepEqual(parsed.roots[0].children[0].states, ["duplicate"]);
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
