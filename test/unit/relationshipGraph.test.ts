import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GraphNode,
  RelationshipGraphModel,
  graphEdgeId,
  graphNodeId,
  renderGraphMermaid,
} from "../../src/relationshipGraph/graphModel";

function node(name: string): GraphNode {
  const uri = `file:///${name}.c`;
  return {
    id: graphNodeId("function", uri, 1, name),
    kind: "function",
    name,
    uri,
    line: 1,
    states: [],
    capabilities: ["calls"],
  };
}

describe("relationship graph model", () => {
  it("creates stable IDs and merges repeated semantic nodes", () => {
    assert.equal(
      graphNodeId("function", "file:///a.c", 1, "f"),
      graphNodeId("function", "file:///a.c", 1, "f"),
    );
    const root = node("root");
    const graph = new RelationshipGraphModel(10, 10);
    graph.replaceRoot(root);
    graph.addNode({ ...root, states: ["duplicate"] });
    assert.equal(graph.snapshot().nodes.length, 1);
    assert.deepEqual(graph.snapshot().nodes[0].states, ["duplicate"]);
  });

  it("enforces independent node and edge budgets", () => {
    const root = node("root");
    const child = node("child");
    const graph = new RelationshipGraphModel(2, 1);
    graph.replaceRoot(root);
    assert.equal(graph.addNode(child), true);
    assert.equal(graph.addNode(node("overflow")), false);
    assert.equal(graph.snapshot().limitedBy, "maximumNodes");
    assert.equal(
      graph.addEdge({
        id: graphEdgeId("calls", root.id, child.id),
        from: root.id,
        to: child.id,
        relation: "calls",
        states: [],
      }),
      true,
    );
  });

  it("exports semantic edge direction directly", () => {
    const caller = node("caller");
    const callee = node("callee");
    const graph = new RelationshipGraphModel(10, 10);
    graph.replaceRoot(caller);
    graph.addNode(callee);
    graph.addEdge({
      id: graphEdgeId("calls", caller.id, callee.id),
      from: caller.id,
      to: callee.id,
      relation: "calls",
      states: [],
    });
    assert.match(renderGraphMermaid(graph.snapshot()), /n0 -->\\|calls\\| n1/);
  });
});
