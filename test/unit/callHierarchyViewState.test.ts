import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CallHierarchyViewState } from "../../src/views/callHierarchyViewState";

describe("Call Hierarchy view state", () => {
  it("shares pin and stale state across both directions", () => {
    const state = new CallHierarchyViewState();
    state.pin("root");
    state.markStale();
    assert.equal(state.pinned, true);
    assert.equal(state.pinnedSymbol, "root");
    assert.equal(state.pinnedStale, true);
    state.replacePinnedSymbol("manual");
    assert.equal(state.pinnedSymbol, "manual");
    assert.equal(state.pinnedStale, false);
    state.unpin();
    assert.equal(state.pinned, false);
    assert.equal(state.pinnedSymbol, undefined);
    assert.equal(state.pinnedStale, false);
  });
});
