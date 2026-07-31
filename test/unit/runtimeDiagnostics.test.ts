import assert from "node:assert/strict";
import test from "node:test";
import { runtimeDiagnostics } from "../../src/diagnostics/runtimeDiagnostics";

test("runtime diagnostics accumulate counters and retain current gauges", () => {
  runtimeDiagnostics.reset();
  runtimeDiagnostics.increment("limits.references.display", 2);
  runtimeDiagnostics.increment("limits.references.display");
  runtimeDiagnostics.increment("ignored", 0);
  runtimeDiagnostics.setGauge("cache.references.highlights", 12);
  runtimeDiagnostics.setGauge("cache.references.highlights", 7);
  assert.deepEqual(runtimeDiagnostics.snapshot(), {
    counters: { "limits.references.display": 3 },
    gauges: { "cache.references.highlights": 7 },
  });
  runtimeDiagnostics.reset();
});
