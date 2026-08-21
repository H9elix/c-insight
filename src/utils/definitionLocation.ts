export interface ComparableDefinitionLocation {
  uri: { toString(): string };
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export type FunctionLocationKind = "definition" | "declaration-fallback";

export interface PreferredFunctionLocation<T> {
  location: T;
  kind: FunctionLocationKind;
}

/**
 * Prefers a provider definition that is distinct from every declaration.
 * During indexing, clangd may temporarily return the declaration from both
 * requests; keep it as an explicit fallback until a later refresh upgrades it.
 */
export function preferredFunctionLocation<
  T extends ComparableDefinitionLocation,
>(
  definitions: readonly T[],
  declarations: readonly T[],
  providerFallback?: T,
): PreferredFunctionLocation<T> | undefined {
  const definition = definitions.find(
    (candidate) =>
      !declarations.some((declaration) =>
        sameDefinitionLocation(candidate, declaration),
      ),
  );
  if (definition) {
    return { location: definition, kind: "definition" };
  }
  const fallback = definitions[0] ?? declarations[0] ?? providerFallback;
  return fallback
    ? { location: fallback, kind: "declaration-fallback" }
    : undefined;
}

export function sameDefinitionLocation(
  left: ComparableDefinitionLocation,
  right: ComparableDefinitionLocation,
): boolean {
  return left.uri.toString() === right.uri.toString() &&
    left.range.start.line === right.range.start.line &&
    left.range.start.character === right.range.start.character &&
    left.range.end.line === right.range.end.line &&
    left.range.end.character === right.range.end.character;
}

export function functionLocationSignature(
  value: PreferredFunctionLocation<ComparableDefinitionLocation> | undefined,
): string {
  if (!value) {
    return "";
  }
  const { location } = value;
  return [
    value.kind,
    location.uri.toString(),
    location.range.start.line,
    location.range.start.character,
    location.range.end.line,
    location.range.end.character,
  ].join("\0");
}
