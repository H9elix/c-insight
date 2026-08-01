export type MicrosoftCalleeOutcome = "completed" | "failed" | "cancelled";

export interface MicrosoftCalleeEvidence {
  outcome: MicrosoftCalleeOutcome;
  calls: number;
  durationMs: number;
}

export interface MicrosoftCalleeEvidenceStats {
  queriedNodes: number;
  successful: number;
  failed: number;
  cancelled: number;
  empty: number;
  callees: number;
  averageDurationMs: number;
  maximumDurationMs: number;
}

export function summarizeMicrosoftCalleeEvidence(
  evidence: Iterable<MicrosoftCalleeEvidence>,
): MicrosoftCalleeEvidenceStats {
  const result: MicrosoftCalleeEvidenceStats = {
    queriedNodes: 0,
    successful: 0,
    failed: 0,
    cancelled: 0,
    empty: 0,
    callees: 0,
    averageDurationMs: 0,
    maximumDurationMs: 0,
  };
  let totalDurationMs = 0;
  for (const item of evidence) {
    result.queriedNodes += 1;
    totalDurationMs += item.durationMs;
    result.maximumDurationMs = Math.max(result.maximumDurationMs, item.durationMs);
    if (item.outcome === "completed") {
      result.successful += 1;
      result.callees += item.calls;
      if (item.calls === 0) result.empty += 1;
    } else if (item.outcome === "failed") {
      result.failed += 1;
    } else {
      result.cancelled += 1;
    }
  }
  result.averageDurationMs = result.queriedNodes === 0
    ? 0
    : totalDurationMs / result.queriedNodes;
  return result;
}
