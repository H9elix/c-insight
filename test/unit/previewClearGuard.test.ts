import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreviewClearGuard } from "../../src/views/previewClearGuard";

describe("Code Preview clear guard", () => {
  it("preserves clears during an editor-open transition only", () => {
    const guard = new PreviewClearGuard(1_000);
    assert.equal(guard.shouldPreserve(10), false);
    guard.arm(100);
    assert.equal(guard.shouldPreserve(1_099), true);
    assert.equal(guard.shouldPreserve(1_100), false);
  });

  it("can be reset before its deadline", () => {
    const guard = new PreviewClearGuard(1_000);
    guard.arm(100);
    guard.reset();
    assert.equal(guard.shouldPreserve(101), false);
  });
});
