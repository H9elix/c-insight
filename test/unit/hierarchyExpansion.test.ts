import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultCallExpansionDirections,
  hierarchyExpansionMessage,
  hierarchyExpansionStopReason,
} from "../../src/utils/hierarchyExpansion";

describe("hierarchy expansion status", () => {
  it("expands only visible call directions unless a command requests one", () => {
    assert.deepEqual(
      defaultCallExpansionDirections({ callers: true, callees: false }),
      ["incoming"],
    );
    assert.deepEqual(
      defaultCallExpansionDirections({ callers: false, callees: true }),
      ["outgoing"],
    );
    assert.deepEqual(
      defaultCallExpansionDirections({ callers: true, callees: true }),
      ["incoming", "outgoing"],
    );
    assert.deepEqual(
      defaultCallExpansionDirections(
        { callers: false, callees: false },
        "incoming",
      ),
      ["incoming"],
    );
  });

  it("prioritizes cancellation, then node and depth limits", () => {
    assert.equal(
      hierarchyExpansionStopReason({
        cancelled: true,
        loadedNodes: 2000,
        maximumNodes: 2000,
        requestedDepth: 10,
        maximumDepth: 10,
      }),
      "cancelled",
    );
    assert.equal(
      hierarchyExpansionStopReason({
        cancelled: false,
        loadedNodes: 2000,
        maximumNodes: 2000,
        requestedDepth: 10,
        maximumDepth: 10,
      }),
      "maximumNodes",
    );
    assert.equal(
      hierarchyExpansionStopReason({
        cancelled: false,
        loadedNodes: 100,
        maximumNodes: 2000,
        requestedDepth: 10,
        maximumDepth: 10,
      }),
      "maximumDepth",
    );
  });

  it("does not report a limit for a smaller completed request", () => {
    assert.equal(
      hierarchyExpansionStopReason({
        cancelled: false,
        loadedNodes: 100,
        maximumNodes: 2000,
        requestedDepth: 5,
        maximumDepth: 10,
      }),
      undefined,
    );
    assert.match(
      hierarchyExpansionMessage("maximumNodes", 10, 2000).description,
      /maximumNodes/,
    );
  });
});
