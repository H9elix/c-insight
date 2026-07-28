export type HierarchyExportFormat = "text" | "json" | "mermaid";
export type HierarchyEdgeDirection = "parent-to-child" | "child-to-parent";

export interface HierarchyExportNode {
  name: string;
  description?: string;
  uri?: string;
  sourceUri?: string;
  line?: number;
  states: string[];
  children: HierarchyExportNode[];
}

export interface HierarchyExportMetadata {
  relation: "call" | "type" | "include";
  direction: string;
  edgeDirection: HierarchyEdgeDirection;
}

export function hierarchyNodeStates(
  label: string,
  description?: string,
): string[] {
  const text = `${label} ${description ?? ""}`.toLowerCase();
  return [
    text.includes("direct recursion") && !text.includes("indirect recursion")
      ? "direct-recursion"
      : undefined,
    text.includes("indirect recursion") ? "indirect-recursion" : undefined,
    text.includes("duplicate") ? "duplicate" : undefined,
    text.includes("cycle") ? "cycle" : undefined,
    text.includes("max depth") || text.includes("maximum depth")
      ? "maximum-depth"
      : undefined,
    text.includes("node limit") || text.includes("maximum node")
      ? "maximum-nodes"
      : undefined,
    text.includes("cancelled") ? "cancelled" : undefined,
    text.includes("possible indirect call") ? "possible-indirect-call" : undefined,
  ].filter((state): state is string => state !== undefined);
}

export function renderHierarchyExport(
  roots: HierarchyExportNode[],
  metadata: HierarchyExportMetadata,
  format: HierarchyExportFormat,
): string {
  if (format === "json") {
    return JSON.stringify(
      {
        schemaVersion: 1,
        ...metadata,
        roots,
      },
      undefined,
      2,
    );
  }
  if (format === "mermaid") {
    return hierarchyMermaid(roots, metadata.edgeDirection);
  }
  return roots.map((root) => hierarchyText(root)).join("\n");
}

function hierarchyText(node: HierarchyExportNode, depth = 0): string {
  const location = node.uri
    ? ` — ${node.uri}${node.line ? `:${node.line}` : ""}`
    : "";
  const states =
    node.states.length > 0 ? ` [${node.states.join(", ")}]` : "";
  const line = `${"  ".repeat(depth)}${node.name}${location}${states}`;
  return node.children.length > 0
    ? `${line}\n${node.children.map((child) => hierarchyText(child, depth + 1)).join("\n")}`
    : line;
}

function hierarchyMermaid(
  roots: HierarchyExportNode[],
  direction: HierarchyEdgeDirection,
): string {
  const lines = ["flowchart TD"];
  let nextId = 0;
  const visit = (node: HierarchyExportNode): string | undefined => {
    if (!node.uri) {
      for (const child of node.children) {
        visit(child);
      }
      return undefined;
    }
    const id = `n${nextId++}`;
    const stateSuffix =
      node.states.length > 0 ? `\\n[${node.states.join(", ")}]` : "";
    lines.push(`  ${id}["${escapeMermaid(`${node.name}${stateSuffix}`)}"]`);
    for (const child of node.children) {
      const childId = visit(child);
      if (childId) {
        lines.push(
          direction === "parent-to-child"
            ? `  ${id} --> ${childId}`
            : `  ${childId} --> ${id}`,
        );
      }
    }
    return id;
  };
  roots.forEach(visit);
  return lines.join("\n");
}

function escapeMermaid(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n");
}
