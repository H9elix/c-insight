import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cursorQueryDemand,
  cursorQueryDemandForEngine,
} from "../../src/context/navigationDemand";

const hidden = {
  context: false,
  preview: false,
  references: false,
  callers: false,
  callees: false,
};

describe("navigation visibility query demand", () => {
  it("does no automatic semantic work when every navigation view is hidden", () => {
    assert.deepEqual(cursorQueryDemand(hidden), {
      active: false,
      definitions: false,
      declarations: false,
      callRoots: false,
      hover: false,
      symbolInfo: false,
      references: false,
      incomingCount: false,
      outgoingCount: false,
    });
  });

  it("queries each detailed relationship only for its own visible view", () => {
    const references = cursorQueryDemand({ ...hidden, references: true });
    assert.equal(references.references, true);
    assert.equal(references.incomingCount, false);
    assert.equal(references.outgoingCount, false);

    const callers = cursorQueryDemand({ ...hidden, callers: true });
    assert.equal(callers.references, false);
    assert.equal(callers.callRoots, true);
    assert.equal(callers.definitions, true);
    assert.equal(callers.declarations, true);
    assert.equal(callers.incomingCount, false);
    assert.equal(callers.outgoingCount, false);

    const contextAndCallers = cursorQueryDemand({
      ...hidden,
      context: true,
      callers: true,
    });
    assert.equal(contextAndCallers.incomingCount, true);
  });

  it("keeps preview lightweight and context self-contained", () => {
    const preview = cursorQueryDemand({ ...hidden, preview: true });
    assert.equal(preview.definitions, true);
    assert.equal(preview.declarations, true);
    assert.equal(preview.callRoots, false);
    assert.equal(preview.hover, false);

    const context = cursorQueryDemand({ ...hidden, context: true });
    assert.equal(context.hover, true);
    assert.equal(context.symbolInfo, true);
    assert.equal(context.references, false);
  });

  it("demand-gates Microsoft Call Hierarchy and avoids eager counts", () => {
    const context = cursorQueryDemandForEngine(
      { ...hidden, context: true },
      "microsoft",
    );
    assert.equal(context.callRoots, false);

    const hierarchy = cursorQueryDemandForEngine(
      { ...hidden, context: true, callers: true, callees: true },
      "microsoft",
    );
    assert.equal(hierarchy.callRoots, true);
    assert.equal(hierarchy.incomingCount, false);
    assert.equal(hierarchy.outgoingCount, false);
  });

  it("never requests a hidden detail relation across all visibility combinations", () => {
    for (let mask = 0; mask < 32; mask += 1) {
      const visibility = {
        context: Boolean(mask & 1),
        preview: Boolean(mask & 2),
        references: Boolean(mask & 4),
        callers: Boolean(mask & 8),
        callees: Boolean(mask & 16),
      };
      const demand = cursorQueryDemand(visibility);
      if (!visibility.references) assert.equal(demand.references, false);
      if (!visibility.callers) assert.equal(demand.incomingCount, false);
      if (!visibility.callees) assert.equal(demand.outgoingCount, false);
    }
  });
});
