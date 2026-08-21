import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HierarchyTreeState } from "../../src/utils/hierarchyTreeState";

describe("hierarchy tree state", () => {
  it("tracks duplicates and node budget independently", () => {
    const callers = new HierarchyTreeState();
    const callees = new HierarchyTreeState();

    assert.equal(callers.record("f", false).duplicate, false);
    assert.equal(callers.record("f", false).duplicate, true);
    assert.equal(callers.record("f", true).duplicate, false);
    assert.equal(callers.loadedNodes, 3);
    assert.equal(callers.atLimit(3), true);
    assert.equal(callers.remaining(5), 2);

    assert.equal(callers.observe("g", false), false);
    assert.equal(callers.observe("g", false), true);
    assert.equal(callers.loadedNodes, 3);
    callers.consume(2);
    assert.equal(callers.loadedNodes, 5);
    assert.equal(callees.loadedNodes, 0);
  });

  it("clears both duplicate and budget state", () => {
    const state = new HierarchyTreeState();
    state.record("f", false);
    state.reset();
    assert.equal(state.loadedNodes, 0);
    assert.equal(state.record("f", false).duplicate, false);
  });
});
