import { createHash } from "node:crypto";

export type GraphNodeKind =
  | "function"
  | "method"
  | "type"
  | "source"
  | "header"
  | "unresolved";

export type GraphRelation = "calls" | "inherits" | "includes";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  name: string;
  detail?: string;
  uri?: string;
  line?: number;
  states: string[];
  capabilities: GraphRelation[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: GraphRelation;
  sourceUri?: string;
  line?: number;
  states: string[];
}

export interface RelationshipGraphSnapshot {
  schemaVersion: 1;
  rootId?: string;
  revision: number;
  staleReason?: string;
  limitedBy?: "maximumNodes" | "maximumEdges";
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class RelationshipGraphModel {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private rootId?: string;
  private revision = 0;
  private staleReason?: string;
  private limitedBy?: "maximumNodes" | "maximumEdges";

  constructor(
    private readonly maximumNodes: number,
    private readonly maximumEdges: number,
  ) {}

  replaceRoot(root: GraphNode): void {
    this.nodes.clear();
    this.edges.clear();
    this.rootId = root.id;
    this.staleReason = undefined;
    this.limitedBy = undefined;
    this.nodes.set(root.id, normalizeNode(root));
    this.revision += 1;
  }

  addNode(node: GraphNode): boolean {
    const existing = this.nodes.get(node.id);
    if (existing) {
      this.nodes.set(node.id, mergeNode(existing, node));
      this.revision += 1;
      return true;
    }
    if (this.nodes.size >= this.maximumNodes) {
      this.limitedBy = "maximumNodes";
      return false;
    }
    this.nodes.set(node.id, normalizeNode(node));
    this.revision += 1;
    return true;
  }

  addEdge(edge: GraphEdge): boolean {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      return false;
    }
    const existing = this.edges.get(edge.id);
    if (existing) {
      this.edges.set(edge.id, {
        ...existing,
        ...edge,
        states: unique([...existing.states, ...edge.states]),
      });
      this.revision += 1;
      return true;
    }
    if (this.edges.size >= this.maximumEdges) {
      this.limitedBy = "maximumEdges";
      return false;
    }
    this.edges.set(edge.id, { ...edge, states: unique(edge.states) });
    this.revision += 1;
    return true;
  }

  node(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  hasPath(from: string, to: string): boolean {
    const queue = [from];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === to) {
        return true;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const edge of this.edges.values()) {
        if (edge.from === current && !visited.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }
    return false;
  }

  markStale(reason: string): void {
    this.staleReason = reason;
    this.revision += 1;
  }

  snapshot(): RelationshipGraphSnapshot {
    return {
      schemaVersion: 1,
      rootId: this.rootId,
      revision: this.revision,
      staleReason: this.staleReason,
      limitedBy: this.limitedBy,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }
}

export function graphNodeId(
  kind: GraphNodeKind,
  uri: string,
  line: number,
  name: string,
): string {
  return stableId("node", [kind, uri, String(line), name]);
}

export function graphEdgeId(
  relation: GraphRelation,
  from: string,
  to: string,
  sourceUri = "",
  line = 0,
): string {
  return stableId("edge", [
    relation,
    from,
    to,
    sourceUri,
    String(line),
  ]);
}

export function renderGraphJson(snapshot: RelationshipGraphSnapshot): string {
  return JSON.stringify(snapshot, undefined, 2);
}

export function renderGraphMermaid(
  snapshot: RelationshipGraphSnapshot,
): string {
  const ids = new Map(
    snapshot.nodes.map((node, index) => [node.id, `n${index}`]),
  );
  const lines = ["flowchart LR"];
  for (const node of snapshot.nodes) {
    lines.push(`  ${ids.get(node.id)}["${escapeMermaid(node.name)}"]`);
  }
  for (const edge of snapshot.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from && to) {
      lines.push(`  ${from} -->|${edge.relation}| ${to}`);
    }
  }
  return lines.join("\n");
}

export function renderGraphText(
  snapshot: RelationshipGraphSnapshot,
): string {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const lines = [
    `Relationship Graph (${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges)`,
    "",
  ];
  if (snapshot.rootId) {
    lines.push(`Root: ${formatTextNode(nodes.get(snapshot.rootId))}`, "");
  }
  lines.push("Nodes:");
  for (const node of snapshot.nodes) {
    lines.push(`- ${formatTextNode(node)}`);
  }
  lines.push("", "Relations:");
  for (const edge of snapshot.edges) {
    lines.push(
      `- ${formatTextNode(nodes.get(edge.from))} --${edge.relation}--> ${formatTextNode(nodes.get(edge.to))}`,
    );
  }
  if (snapshot.staleReason) {
    lines.push("", `Stale: ${snapshot.staleReason}`);
  }
  if (snapshot.limitedBy) {
    lines.push("", `Limited by: ${snapshot.limitedBy}`);
  }
  return lines.join("\n");
}

function normalizeNode(node: GraphNode): GraphNode {
  return {
    ...node,
    states: unique(node.states),
    capabilities: unique(node.capabilities),
  };
}

function mergeNode(existing: GraphNode, incoming: GraphNode): GraphNode {
  return {
    ...existing,
    ...incoming,
    detail: incoming.detail ?? existing.detail,
    uri: incoming.uri ?? existing.uri,
    line: incoming.line ?? existing.line,
    states: unique([...existing.states, ...incoming.states]),
    capabilities: unique([
      ...existing.capabilities,
      ...incoming.capabilities,
    ]),
  };
}

function stableId(prefix: string, parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 20);
  return `${prefix}:${digest}`;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function escapeMermaid(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function formatTextNode(node: GraphNode | undefined): string {
  if (!node) {
    return "<missing>";
  }
  const location = node.uri
    ? ` (${node.uri}${node.line ? `:${node.line}` : ""})`
    : "";
  return `${node.name} [${node.kind}]${location}`;
}
