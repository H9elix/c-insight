import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { median, nearNative } from "../e2e/searchPerformanceModel";

describe("native search performance acceptance", () => {
  it("uses medians and the wider 20-percent or 100-ms allowance", () => {
    assert.equal(median([100, 9, 8, 7, 6]), 8);
    assert(nearNative([120, 120, 120, 120, 5000], [20, 20, 20, 20, 20]).passed);
    assert.equal(nearNative([1200, 1200, 1200, 1200, 1200], [1000, 1000, 1000, 1000, 1000]).maximumMs, 1200);
    assert(!nearNative([121, 121, 121, 121, 121], [20, 20, 20, 20, 20]).passed);
    assert.throws(() => nearNative([1], [1])); assert.throws(() => median([NaN]));
  });
});
