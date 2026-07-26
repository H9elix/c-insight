import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldUpdatePinnedView } from "../../src/utils/viewPin";

describe("per-view pin update policy", () => {
  it("allows all updates while unpinned", () => {
    assert.equal(shouldUpdatePinnedView(false, false), true);
    assert.equal(shouldUpdatePinnedView(false, true), true);
  });

  it("blocks automatic but permits explicit manual updates while pinned", () => {
    assert.equal(shouldUpdatePinnedView(true, false), false);
    assert.equal(shouldUpdatePinnedView(true, undefined), false);
    assert.equal(shouldUpdatePinnedView(true, true), true);
  });
});
