export type PreviewLoadDirection = "before" | "after";

export interface PreviewLineRange {
  startLine: number;
  endLine: number;
}

export interface PreviewRangeExpansion extends PreviewLineRange {
  addedStartLine: number;
  addedEndLine: number;
}

export function expandPreviewRange(
  current: PreviewLineRange,
  direction: PreviewLoadDirection,
  batchLines: number,
  maximumLoadedLines: number,
  lastLine: number,
): PreviewRangeExpansion | undefined {
  const batch = Math.max(1, Math.floor(batchLines));
  const currentCount = current.endLine - current.startLine + 1;
  const maximum = Math.max(currentCount, Math.floor(maximumLoadedLines));
  if (direction === "before") {
    const startLine = Math.max(0, current.startLine - batch);
    if (startLine === current.startLine) {
      return undefined;
    }
    return {
      startLine,
      endLine: Math.min(current.endLine, startLine + maximum - 1),
      addedStartLine: startLine,
      addedEndLine: current.startLine - 1,
    };
  }
  const endLine = Math.min(lastLine, current.endLine + batch);
  if (endLine === current.endLine) {
    return undefined;
  }
  return {
    startLine: Math.max(current.startLine, endLine - maximum + 1),
    endLine,
    addedStartLine: current.endLine + 1,
    addedEndLine: endLine,
  };
}
