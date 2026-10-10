import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreviewOwnership } from "../../src/views/previewOwnership";

describe("Code Preview ownership", () => {
  it("rejects stale context writes after an explicit interaction", () => {
    const ownership = new PreviewOwnership();
    ownership.beginContext(1, true);
    assert.equal(ownership.allowsContext(1), true);

    ownership.claimInteraction();
    assert.equal(ownership.allowsContext(1), false);
    assert.equal(ownership.contextOwned, false);
  });

  it("does not let a visibility refresh reclaim an interaction preview", () => {
    const ownership = new PreviewOwnership();
    ownership.beginContext(1, true);
    ownership.claimInteraction();
    ownership.beginContext(2, false);

    assert.equal(ownership.allowsContext(2), false);
  });

  it("lets deliberate navigation reclaim the preview with a new generation", () => {
    const ownership = new PreviewOwnership();
    ownership.beginContext(1, true);
    ownership.claimInteraction();
    ownership.beginContext(2, true);

    assert.equal(ownership.allowsContext(1), false);
    assert.equal(ownership.allowsContext(2), true);
    assert.equal(ownership.contextOwned, true);
  });

  it("advances background context work while context still owns the preview", () => {
    const ownership = new PreviewOwnership();
    ownership.beginContext(1, true);
    ownership.beginContext(2, false);

    assert.equal(ownership.allowsContext(1), false);
    assert.equal(ownership.allowsContext(2), true);
  });
});
