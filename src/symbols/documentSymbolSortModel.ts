export type DocumentSymbolSort = "position" | "name" | "type";

export interface DocumentSymbolSortKey {
  name: string;
  kind: number;
  line: number;
  character: number;
  order: number;
}

const names = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function documentSymbolSort(value: unknown): DocumentSymbolSort {
  return value === "name" || value === "type" ? value : "position";
}

/** Sort only siblings. Node identity, parent links and provider tie-break order stay intact. */
export function sortDocumentSymbolSiblings<T>(
  nodes: readonly T[], mode: DocumentSymbolSort, key: (node: T) => DocumentSymbolSortKey,
): T[] {
  return [...nodes].sort((left, right) => {
    const a = key(left), b = key(right);
    const position = a.line - b.line || a.character - b.character || a.order - b.order;
    if (mode === "name") return names.compare(a.name, b.name) || position;
    if (mode === "type") return a.kind - b.kind || names.compare(a.name, b.name) || position;
    return position;
  });
}
