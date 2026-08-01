import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeMicrosoftCalleeEvidence } from "../../src/callHierarchy/microsoftCalleeEvidenceModel";

describe("Microsoft Callees evidence", () => {
  it("summarizes success, empty, failure, cancellation, and latency", () => {
    assert.deepEqual(
      summarizeMicrosoftCalleeEvidence([
        { outcome: "completed", calls: 3, durationMs: 20 },
        { outcome: "completed", calls: 0, durationMs: 10 },
        { outcome: "failed", calls: 0, durationMs: 40 },
        { outcome: "cancelled", calls: 0, durationMs: 30 },
      ]),
      {
        queriedNodes: 4,
        successful: 2,
        failed: 1,
        cancelled: 1,
        empty: 1,
        callees: 3,
        averageDurationMs: 25,
        maximumDurationMs: 40,
      },
    );
  });
});
