/** The agreed acceptance policy; times are comparable only with identical scopes/options and result completeness. */
export function median(samples: readonly number[]): number {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error("Invalid timing samples");
  const values = [...samples].sort((a, b) => a - b), middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}
export function nearNative(actual: readonly number[], reference: readonly number[]): {actualMs: number; referenceMs: number; maximumMs: number; passed: boolean} {
  if (actual.length !== 5 || reference.length !== 5) throw new Error("Acceptance requires five samples per implementation");
  const actualMs = median(actual), referenceMs = median(reference), maximumMs = Math.max(referenceMs * 1.2, referenceMs + 100);
  return {actualMs, referenceMs, maximumMs, passed: actualMs <= maximumMs};
}
