import type {
  CallHierarchyItem,
  DocumentSymbol,
  Position,
  Range,
  SymbolInformation,
} from "vscode-languageclient/node";

const callableKinds = new Set([6, 9, 12]); // Method, Constructor, Function
const microsoftFunctionKind = 11; // cpptools may expose C functions as Interface.

export interface MicrosoftCallerEvidence {
  references: number;
  mappedReferences: number;
  unmappedReferences: number;
  callerFunctions: number;
}

export function microsoftEmptyCallersMessage(
  evidence: MicrosoftCallerEvidence | undefined,
): string {
  if (evidence && evidence.references > 0) {
    return `${evidence.references} reference${evidence.references === 1 ? "" : "s"} found, but enclosing caller functions could not be identified`;
  }
  return "No callers found by Microsoft References query — results may be incomplete";
}

export function enclosingCaller(
  uri: string,
  position: Position,
  symbols: Array<DocumentSymbol | SymbolInformation>,
): CallHierarchyItem | undefined {
  const candidates: CallHierarchyItem[] = [];
  for (const symbol of symbols) collectCallables(uri, position, symbol, candidates);
  return candidates.sort(
    (left, right) => rangeSpan(left.range) - rangeSpan(right.range),
  )[0];
}

function collectCallables(
  uri: string,
  position: Position,
  symbol: DocumentSymbol | SymbolInformation,
  output: CallHierarchyItem[],
): void {
  if ("location" in symbol) {
    if (
      symbol.location.uri === uri &&
      isFlatCallable(symbol) &&
      contains(symbol.location.range, position)
    ) {
      output.push({
        name: symbol.name,
        kind: symbol.kind,
        tags: symbol.tags,
        detail: symbol.containerName,
        uri,
        range: symbol.location.range,
        selectionRange: symbol.location.range,
      });
    }
    return;
  }
  if (callableKinds.has(symbol.kind) && contains(symbol.range, position)) {
    output.push({
      name: symbol.name,
      kind: symbol.kind,
      tags: symbol.tags,
      detail: symbol.detail,
      uri,
      range: symbol.range,
      selectionRange: symbol.selectionRange,
    });
  }
  for (const child of symbol.children ?? []) {
    collectCallables(uri, position, child, output);
  }
}

function isFlatCallable(symbol: SymbolInformation): boolean {
  if (callableKinds.has(symbol.kind)) return true;
  // The Microsoft C/C++ provider currently reports some C functions returned
  // by DocumentSymbolProvider as Interface (11). Restrict compatibility to a
  // flat symbol whose display name ends in a parameter list, so a real
  // interface/type symbol is not mistaken for a caller.
  return symbol.kind === microsoftFunctionKind && /\([^()]*\)\s*$/.test(symbol.name);
}

function contains(range: Range, position: Position): boolean {
  return compare(range.start, position) <= 0 && compare(position, range.end) <= 0;
}

function compare(left: Position, right: Position): number {
  return left.line - right.line || left.character - right.character;
}

function rangeSpan(range: Range): number {
  return (range.end.line - range.start.line) * 1_000_000 +
    range.end.character - range.start.character;
}
