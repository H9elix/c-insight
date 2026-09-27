import type { ViewUpdateIntent } from "../models/types";

export interface CursorSymbolEvidence {
  definitions: readonly unknown[];
  declarations: readonly unknown[];
  callRoots: readonly unknown[];
  hover?: string;
  name?: string;
  qualifiedName?: string;
  symbolId?: string;
}

export function hasCursorSymbolEvidence(
  context: CursorSymbolEvidence,
): boolean {
  return (
    context.definitions.length > 0 ||
    context.declarations.length > 0 ||
    context.callRoots.length > 0 ||
    hasText(context.hover) ||
    hasText(context.name) ||
    hasText(context.qualifiedName) ||
    hasText(context.symbolId)
  );
}

export function shouldPreserveResultsForEmptyCursor(
  context: CursorSymbolEvidence,
  intent: ViewUpdateIntent = {},
): boolean {
  const explicitUpdate = Boolean(
    intent.manualReferences ||
    intent.manualCallHierarchy ||
    intent.manualCallDirection,
  );
  return !explicitUpdate && !hasCursorSymbolEvidence(context);
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}
