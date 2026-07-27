import type { TypeHierarchyItem } from "vscode-languageclient/node";

export function typeHierarchyKey(item: TypeHierarchyItem): string {
  return [
    item.uri,
    item.selectionRange.start.line,
    item.selectionRange.start.character,
    item.name,
  ].join(":");
}

export function isTypeHierarchyRecursion(
  item: TypeHierarchyItem,
  ancestors: readonly string[],
): boolean {
  return ancestors.includes(typeHierarchyKey(item));
}

export function typeHierarchyMermaidEdge(
  supertypeId: string,
  subtypeId: string,
): string {
  return `${supertypeId} --> ${subtypeId}`;
}
