export function escapeMermaidLabel(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function mermaidCallEdge(
  parentId: string,
  childId: string,
  direction: "incoming" | "outgoing",
): string {
  return direction === "incoming"
    ? `${childId} --> ${parentId}`
    : `${parentId} --> ${childId}`;
}
