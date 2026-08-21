export interface CallOccurrencePosition {
  line: number;
  character: number;
}

export interface CallOccurrenceRange {
  start: CallOccurrencePosition;
  end: CallOccurrencePosition;
}

export interface CallOccurrenceInput<T> {
  semanticKey: string;
  callSiteUri: string;
  ranges: readonly CallOccurrenceRange[];
  fallbackUri: string;
  fallbackRange: CallOccurrenceRange;
  value: T;
}

export interface CallOccurrence<T> {
  id: string;
  semanticKey: string;
  uri: string;
  range: CallOccurrenceRange;
  ordinal: number;
  total: number;
  canonical: boolean;
  fallback: boolean;
  value: T;
}

export type CallerPresentationRow<T> =
  | { kind: "occurrence"; occurrence: CallOccurrence<T> }
  | { kind: "definition"; semanticKey: string; value: T };

/**
 * Converts semantic call-hierarchy relations into source-ordered call sites.
 * Exact duplicate ranges are discarded and the earliest occurrence for each
 * semantic relation is the only canonical (expandable) occurrence.
 */
export function projectCallOccurrences<T>(
  inputs: readonly CallOccurrenceInput<T>[],
): CallOccurrence<T>[] {
  const groups = new Map<
    string,
    {
      value: T;
      fallbackUri: string;
      fallbackRange: CallOccurrenceRange;
      ranges: Map<string, { uri: string; range: CallOccurrenceRange }>;
    }
  >();

  for (const input of inputs) {
    let group = groups.get(input.semanticKey);
    if (!group) {
      group = {
        value: input.value,
        fallbackUri: input.fallbackUri,
        fallbackRange: input.fallbackRange,
        ranges: new Map(),
      };
      groups.set(input.semanticKey, group);
    }
    for (const range of input.ranges) {
      const key = rangeKey(input.callSiteUri, range);
      if (!group.ranges.has(key)) {
        group.ranges.set(key, { uri: input.callSiteUri, range });
      }
    }
  }

  const occurrences: CallOccurrence<T>[] = [];
  for (const [semanticKey, group] of groups) {
    const locations = [...group.ranges.values()].sort(compareLocations);
    const fallback = locations.length === 0;
    const effectiveLocations = fallback
      ? [{ uri: group.fallbackUri, range: group.fallbackRange }]
      : locations;
    effectiveLocations.forEach((location, index) => {
      occurrences.push({
        id: occurrenceId(semanticKey, location.uri, location.range, fallback),
        semanticKey,
        uri: location.uri,
        range: location.range,
        ordinal: index + 1,
        total: effectiveLocations.length,
        canonical: index === 0,
        fallback,
        value: group.value,
      });
    });
  }

  return occurrences.sort((left, right) => {
    const locationOrder = compareLocations(left, right);
    return locationOrder !== 0
      ? locationOrder
      : left.semanticKey.localeCompare(right.semanticKey);
  });
}

/** Adds one definition row after the final visible occurrence of each caller. */
export function callerPresentationRows<T>(
  occurrences: readonly CallOccurrence<T>[],
): CallerPresentationRow<T>[] {
  const lastOccurrence = new Map<string, number>();
  occurrences.forEach((occurrence, index) => {
    lastOccurrence.set(occurrence.semanticKey, index);
  });
  const rows: CallerPresentationRow<T>[] = [];
  occurrences.forEach((occurrence, index) => {
    rows.push({ kind: "occurrence", occurrence });
    if (lastOccurrence.get(occurrence.semanticKey) === index) {
      rows.push({
        kind: "definition",
        semanticKey: occurrence.semanticKey,
        value: occurrence.value,
      });
    }
  });
  return rows;
}

export function compareCallOccurrenceLocations(
  left: Pick<CallOccurrence<unknown>, "uri" | "range">,
  right: Pick<CallOccurrence<unknown>, "uri" | "range">,
): number {
  return compareLocations(left, right);
}

function compareLocations(
  left: { uri: string; range: CallOccurrenceRange },
  right: { uri: string; range: CallOccurrenceRange },
): number {
  return (
    left.uri.localeCompare(right.uri) ||
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.range.end.line - right.range.end.line ||
    left.range.end.character - right.range.end.character
  );
}

function occurrenceId(
  semanticKey: string,
  uri: string,
  range: CallOccurrenceRange,
  fallback: boolean,
): string {
  return [
    semanticKey,
    uri,
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
    fallback ? "fallback" : "call-site",
  ].join("\u0000");
}

function rangeKey(uri: string, range: CallOccurrenceRange): string {
  return [
    uri,
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  ].join("\u0000");
}
