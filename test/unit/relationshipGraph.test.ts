import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GraphNode,
  RelationshipGraphModel,
  graphEdgeId,
  graphNodeId,
  renderGraphMermaid,
  renderGraphText,
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
    assert.equal(graph.addNodeState(root.id, "expanded-outgoing"), true);
    assert.deepEqual(graph.snapshot().nodes[0].states, [
      "duplicate",
      "expanded-outgoing",
    ]);
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
    assert.equal(graph.hasPath(caller.id, callee.id), true);
    assert.equal(graph.hasPath(callee.id, caller.id), false);
    const text = renderGraphText(graph.snapshot());
    assert.match(text, /Root: caller/);
    assert.match(text, /caller.*--calls--> callee/);
  });

  it("keeps inheritance directed from supertype to subtype", () => {
    const base = {
      ...node("Base"),
      id: graphNodeId("type", "file:///types.hpp", 1, "Base"),
      kind: "type" as const,
      capabilities: ["inherits" as const],
    };
    const derived = {
      ...node("Derived"),
      id: graphNodeId("type", "file:///types.hpp", 5, "Derived"),
      kind: "type" as const,
      capabilities: ["inherits" as const],
    };
    const graph = new RelationshipGraphModel(10, 10);
    graph.replaceRoot(derived);
    graph.addNode(base);
    graph.addEdge({
      id: graphEdgeId("inherits", base.id, derived.id),
      from: base.id,
      to: derived.id,
      relation: "inherits",
      states: [],
    });
    assert.match(
      renderGraphMermaid(graph.snapshot()),
      /n1 -->\|inherits\| n0/,
    );
  });

  it("keeps includes directed from includer to included file", () => {
    const source = {
      ...node("main.c"),
      id: graphNodeId("source", "file:///main.c", 1, "main.c"),
      kind: "source" as const,
      capabilities: ["includes" as const],
    };
    const header = {
      ...node("common.h"),
      id: graphNodeId("header", "file:///common.h", 1, "common.h"),
      kind: "header" as const,
      capabilities: ["includes" as const],
    };
    const graph = new RelationshipGraphModel(10, 10);
    graph.replaceRoot(source);
    graph.addNode(header);
    graph.addEdge({
      id: graphEdgeId("includes", source.id, header.id),
      from: source.id,
      to: header.id,
      relation: "includes",
      states: [],
    });
    assert.match(
      renderGraphMermaid(graph.snapshot()),
      /n0 -->\|includes\| n1/,
    );
  });

  it("exports definition ownership from container to symbol", () => {
    const file = {
      ...node("owner.cpp"),
      id: graphNodeId("source", "file:///owner.cpp", 1, "owner.cpp"),
      kind: "source" as const,
      capabilities: ["includes" as const],
    };
    const symbol = node("owned");
    const graph = new RelationshipGraphModel(10, 10);
    graph.replaceRoot(symbol);
    graph.addNode(file);
    graph.addEdge({
      id: graphEdgeId("defines", file.id, symbol.id),
      from: file.id,
      to: symbol.id,
      relation: "defines",
      states: [],
    });
    assert.match(
      renderGraphMermaid(graph.snapshot()),
      /n1 -->\|defines\| n0/,
    );
  });

  it("builds and snapshots a large bounded graph without quadratic growth", () => {
    const started = performance.now();
    const graph = new RelationshipGraphModel(5_100, 5_100);
    const root = node("root");
    graph.replaceRoot(root);
    let previous = root;
    for (let index = 0; index < 5_000; index += 1) {
      const current = node(`node-${index}`);
      graph.addNode(current);
      graph.addEdge({
        id: graphEdgeId("calls", previous.id, current.id),
        from: previous.id,
        to: current.id,
        relation: "calls",
        states: [],
      });
      previous = current;
    }
    const snapshot = graph.snapshot();
    assert.equal(snapshot.nodes.length, 5_001);
    assert.equal(snapshot.edges.length, 5_000);
    assert.ok(
      performance.now() - started < 2_000,
      "Large graph construction exceeded the 2 second regression budget",
    );
  });
});
