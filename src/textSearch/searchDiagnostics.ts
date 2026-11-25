/** Aggregate timings only: no queries, URIs or source text. Concurrent stage durations are not additive. */
export interface SearchDiagnostics {
  backend: "ripgrep";
  elapsedMs: number; firstResultMs?: number;
  enumerationMs: number; statMs: number; readMs: number; decodeMs: number; matchingMs: number; resultsMs: number;
  bytesRead: number; candidateFiles: number; decodedFiles: number; nativeProcesses: number;
}
export function searchDiagnostics(): SearchDiagnostics {
  return {backend: "ripgrep", elapsedMs: 0, enumerationMs: 0, statMs: 0, readMs: 0, decodeMs: 0,
    matchingMs: 0, resultsMs: 0, bytesRead: 0, candidateFiles: 0, decodedFiles: 0, nativeProcesses: 0};
}
