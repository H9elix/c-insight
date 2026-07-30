import type { TypeHierarchyItem } from "vscode-languageclient/node";

export type TypeHierarchyRelation =
  | "queried-type"
  | "direct-supertype"
  | "direct-subtype";

export interface TypeHierarchyEvidence {
  relationship: TypeHierarchyRelation;
  source: "clangd";
  method:
    | "textDocument/prepareTypeHierarchy"
    | "typeHierarchy/supertypes"
    | "typeHierarchy/subtypes";
  confidence: "semantic";
}

export interface TypeHierarchySearchRecord {
  kind: string;
  relationship: TypeHierarchyRelation;
}

export function matchesTypeHierarchySearchFilters(
  record: TypeHierarchySearchRecord,
  kind: string,
  relationship: TypeHierarchyRelation | "all",
): boolean {
  return (
    (kind === "all" || record.kind === kind) &&
    (relationship === "all" || record.relationship === relationship)
  );
}

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

export function typeHierarchyEvidence(
  direction: "supertypes" | "subtypes",
  depth: number,
): TypeHierarchyEvidence {
  if (depth === 0) {
    return {
      relationship: "queried-type",
      source: "clangd",
      method: "textDocument/prepareTypeHierarchy",
      confidence: "semantic",
    };
  }
  return {
    relationship:
      direction === "supertypes" ? "direct-supertype" : "direct-subtype",
    source: "clangd",
    method:
      direction === "supertypes"
        ? "typeHierarchy/supertypes"
        : "typeHierarchy/subtypes",
    confidence: "semantic",
  };
}
