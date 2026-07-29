import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandPreviewRange } from "../../src/views/previewRange";

describe("code preview incremental range", () => {
  it("loads batches in both directions and clamps to the document", () => {
    assert.deepEqual(
      expandPreviewRange(
        { startLine: 100, endLine: 114 },
        "before",
        50,
        1000,
        499,
      ),
      {
        startLine: 50,
        endLine: 114,
        addedStartLine: 50,
        addedEndLine: 99,
      },
    );
    assert.deepEqual(
      expandPreviewRange(
        { startLine: 470, endLine: 484 },
        "after",
        50,
        1000,
        499,
      ),
      {
        startLine: 470,
        endLine: 499,
        addedStartLine: 485,
        addedEndLine: 499,
      },
    );
  });

  it("trims the far edge when the loaded-line budget is reached", () => {
    assert.deepEqual(
      expandPreviewRange(
        { startLine: 100, endLine: 199 },
        "after",
        25,
        100,
        999,
      ),
      {
        startLine: 125,
        endLine: 224,
        addedStartLine: 200,
        addedEndLine: 224,
      },
    );
    assert.deepEqual(
      expandPreviewRange(
        { startLine: 100, endLine: 199 },
        "before",
        25,
        100,
        999,
      ),
      {
        startLine: 75,
        endLine: 174,
        addedStartLine: 75,
        addedEndLine: 99,
      },
    );
  });

  it("does not load beyond the first or final line", () => {
    assert.equal(
      expandPreviewRange(
        { startLine: 0, endLine: 20 },
        "before",
        50,
        100,
        99,
      ),
      undefined,
    );
    assert.equal(
      expandPreviewRange(
        { startLine: 80, endLine: 99 },
        "after",
        50,
        100,
        99,
      ),
      undefined,
    );
  });
});
