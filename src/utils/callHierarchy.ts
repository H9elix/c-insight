import type { CallHierarchyItem } from "vscode-languageclient/node";

export function callHierarchyKey(item: CallHierarchyItem): string {
  return [
    item.uri,
    item.selectionRange.start.line,
    item.selectionRange.start.character,
    item.name,
  ].join(":");
}

export function isRecursiveCall(key: string, ancestors: readonly string[]): boolean {
  return ancestors.includes(key);
}

export function recursionKind(
  key: string,
  ancestors: readonly string[],
): "direct" | "indirect" | undefined {
  if (!isRecursiveCall(key, ancestors)) {
    return undefined;
  }
  return ancestors[ancestors.length - 1] === key ? "direct" : "indirect";
}

export function looksLikeExplicitIndirectCall(
  sourceLine: string,
  character: number,
): boolean {
  const before = sourceLine
    .slice(0, Math.max(0, Math.min(character, sourceLine.length)))
    .replace(/\s+$/, "");
  return (
    /\(\s*\*\s*$/.test(before) ||
    /(?:\.\*|->\*)\s*$/.test(before)
  );
}
