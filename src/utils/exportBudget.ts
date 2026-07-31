export interface EncodedExport {
  bytes: number;
  data?: Uint8Array;
  maximumBytes: number;
}

export function encodeExportWithinBudget(
  content: string,
  maximumMegabytes: number,
): EncodedExport {
  const maximumBytes =
    positiveNumber(maximumMegabytes, 64) * 1024 * 1024;
  const bytes = new TextEncoder().encode(content);
  return bytes.byteLength <= maximumBytes
    ? { bytes: bytes.byteLength, data: bytes, maximumBytes }
    : { bytes: bytes.byteLength, maximumBytes };
}

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
