export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface DocumentSymbolFocusCandidate<T> {
  value: T;
  range: LineRange;
  depth: number;
  order: number;
}

/**
 * Returns the logical source line at the center of the editor viewport.
 * TextEditor.visibleRanges is normally a single range, but treating multiple
 * ranges as one ordered set keeps the calculation deterministic for folded or
 * otherwise discontinuous editor presentations.
 */
export function visibleCenterLine(
  ranges: readonly LineRange[],
): number | undefined {
  const normalized = ranges
    .map((range) => ({
      startLine: Math.max(0, Math.min(range.startLine, range.endLine)),
      endLine: Math.max(0, Math.max(range.startLine, range.endLine)),
    }))
    .filter((range) => Number.isFinite(range.startLine) && Number.isFinite(range.endLine));
  const visibleLineCount = normalized.reduce(
    (total, range) => total + range.endLine - range.startLine + 1,
    0,
  );
  if (visibleLineCount === 0) {
    return undefined;
  }

  let offset = Math.floor((visibleLineCount - 1) / 2);
  for (const range of normalized) {
    const length = range.endLine - range.startLine + 1;
    if (offset < length) {
      return range.startLine + offset;
    }
    offset -= length;
  }
  return normalized.at(-1)?.endLine;
}

/** Selects the deepest and then narrowest symbol containing the center line. */
export function documentSymbolAtLine<T>(
  candidates: readonly DocumentSymbolFocusCandidate<T>[],
  line: number,
): T | undefined {
  let best: DocumentSymbolFocusCandidate<T> | undefined;
  for (const candidate of candidates) {
    if (line < candidate.range.startLine || line > candidate.range.endLine) {
      continue;
    }
    if (!best || compareCandidate(candidate, best) < 0) {
      best = candidate;
    }
  }
  return best?.value;
}

function compareCandidate<T>(
  left: DocumentSymbolFocusCandidate<T>,
  right: DocumentSymbolFocusCandidate<T>,
): number {
  if (left.depth !== right.depth) {
    return right.depth - left.depth;
  }
  const leftLength = left.range.endLine - left.range.startLine;
  const rightLength = right.range.endLine - right.range.startLine;
  if (leftLength !== rightLength) {
    return leftLength - rightLength;
  }
  return left.order - right.order;
}
