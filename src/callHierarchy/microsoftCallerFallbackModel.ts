import type {
  CallHierarchyItem,
  DocumentSymbol,
  Position,
  Range,
  SymbolInformation,
} from "vscode-languageclient/node";

const callableKinds = new Set([6, 9, 12]); // Method, Constructor, Function
const microsoftFunctionKind = 11; // cpptools may expose C functions as Interface.

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
