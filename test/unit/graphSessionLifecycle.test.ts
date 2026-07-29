import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionAfterPanelDispose } from "../../src/relationshipGraph/graphSessionLifecycle";

describe("relationship graph session lifecycle", () => {
  const snapshot = { rootId: "function:main" };

  it("drops the graph session when the user closes the panel", () => {
    assert.equal(sessionAfterPanelDispose(snapshot, false), undefined);
  });

  it("retains the graph session while the extension is shutting down", () => {
    assert.equal(sessionAfterPanelDispose(snapshot, true), snapshot);
  });
});
