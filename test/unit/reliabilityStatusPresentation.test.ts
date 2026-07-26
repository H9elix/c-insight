import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialIndexProgress } from "../../src/clangd/indexProgress";
import { reliabilityStatusPresentation } from "../../src/diagnostics/reliabilityStatusPresentation";

describe("reliability status bar presentation", () => {
  it("shows a compact ready state", () => {
    const result = reliabilityStatusPresentation(
      { level: "reliable", issues: [] },
      initialIndexProgress(true),
    );
    assert.equal(result.text, "$(check) C Insight");
    assert.equal(result.severity, "normal");
  });

  it("prioritizes unavailable clangd over indexing", () => {
    const result = reliabilityStatusPresentation(
      {
        level: "unavailable",
        issues: [
          {
            code: "clangd-not-ready",
            message: "clangd is failed",
          },
        ],
      },
      {
        status: "indexing",
        percentage: 25,
        updatedAt: 1,
      },
    );
    assert.equal(result.text, "$(error) C Insight unavailable");
    assert.equal(result.severity, "error");
  });

  it("shows live indexing percentage before other limited issues", () => {
    const result = reliabilityStatusPresentation(
      {
        level: "limited",
        issues: [
          {
            code: "indexing",
            message: "Background indexing is in progress",
          },
          {
            code: "no-compilation-database",
            message: "No compilation database",
          },
        ],
      },
      {
        status: "indexing",
        percentage: 42.4,
        updatedAt: 1,
      },
    );
    assert.equal(result.text, "$(sync~spin) C Insight: Indexing 42%");
    assert.equal(result.severity, "warning");
    assert.match(result.tooltip, /No compilation database/);
  });

  it("shows the number of non-indexing project issues", () => {
    const result = reliabilityStatusPresentation(
      {
        level: "limited",
        issues: [
          {
            code: "no-compile-command",
            message: "No compile command",
          },
        ],
      },
      initialIndexProgress(true),
    );
    assert.equal(result.text, "$(warning) C Insight: 1 issue");
    assert.equal(result.severity, "warning");
  });
});
