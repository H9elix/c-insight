import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeExportWithinBudget } from "../../src/utils/exportBudget";

describe("export memory budget", () => {
  it("encodes output within the configured byte budget", () => {
    const result = encodeExportWithinBudget("hello", 1);
    assert.equal(result.bytes, 5);
    assert.equal(new TextDecoder().decode(result.data), "hello");
  });

  it("rejects oversized UTF-8 output without returning a retained byte copy", () => {
    const result = encodeExportWithinBudget("界".repeat(400_000), 1);
    assert.ok(result.bytes > result.maximumBytes);
    assert.equal(result.data, undefined);
  });
});
