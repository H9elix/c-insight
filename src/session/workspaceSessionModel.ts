import type {
  NavigationHistoryEntry,
  NavigationMode,
  SerializedRange,
} from "../history/navigationHistoryModel";
import type {
  GraphRelation,
  RelationshipGraphSnapshot,
} from "../relationshipGraph/graphModel";
import type { MemberCallerScope } from "../callHierarchy/memberCallerScopeModel";

export const WORKSPACE_SESSION_VERSION = 1;

export interface HistorySessionState {
  entries: NavigationHistoryEntry[];
  currentId?: number;
  filter: string;
}

export interface PreviewSessionState {
  uri: string;
  range: SerializedRange;
  mode: NavigationMode;
  title: string;
  locked: boolean;
}

export interface ReferenceSessionState {
  query: string;
  scope: "all" | "workspace" | "directory" | "file";
  displayedLimit: number;
}

export interface SymbolSearchSessionState {
  query: string;
  selectedKinds: number[];
}

export interface CallHierarchySessionState {
  uri: string;
  position: { line: number; character: number };
  incomingDepth: number;
  outgoingDepth: number;
  incomingExpandedPaths?: string[];
  outgoingExpandedPaths?: string[];
}

export interface RelationshipGraphSessionState {
  schemaVersion: 1;
  graph: RelationshipGraphSnapshot;
  selectedId?: string;
  enabledRelations: GraphRelation[];
  collapsedIds: string[];
  memberCallerScopes?: Record<string, MemberCallerScope>;
  viewport: {
    scale: number;
    tx: number;
    ty: number;
  };
}

export interface WorkspaceSessionSnapshot {
  format: "c-insight-workspace-session";
  version: 1;
  savedAt: number;
  engine?: "clangd" | "microsoft";
  history?: HistorySessionState;
  preview?: PreviewSessionState;
  references?: ReferenceSessionState;
  symbolSearch?: SymbolSearchSessionState;
  callHierarchy?: CallHierarchySessionState;
  relationshipGraph?: RelationshipGraphSessionState;
}

export interface BoundedWorkspaceSession {
  snapshot: WorkspaceSessionSnapshot;
  dropped: string[];
  byteLength: number;
}

export function boundWorkspaceSessionSnapshot(
  input: WorkspaceSessionSnapshot,
  maximumBytes: number,
): BoundedWorkspaceSession {
  const snapshot = structuredClone(input);
  const dropped: string[] = [];
  const limit = Math.max(1, Math.floor(maximumBytes));
  const size = (): number =>
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  let byteLength = size();
  if (byteLength <= limit) {
    return { snapshot, dropped, byteLength };
  }
  if (snapshot.relationshipGraph) {
    snapshot.relationshipGraph = undefined;
    dropped.push("Relationship Graph");
    byteLength = size();
  }
  if (
    byteLength > limit &&
    snapshot.history &&
    snapshot.history.entries.length > 20
  ) {
    snapshot.history.entries = snapshot.history.entries.slice(-20);
    if (
      snapshot.history.currentId !== undefined &&
      !snapshot.history.entries.some(
        (entry) => entry.id === snapshot.history?.currentId,
      )
    ) {
      snapshot.history.currentId =
        snapshot.history.entries.at(-1)?.id;
    }
    dropped.push("older Navigation History entries");
    byteLength = size();
  }
  for (const [label, key] of [
    ["Call Hierarchy", "callHierarchy"],
    ["References state", "references"],
    ["Symbol Search state", "symbolSearch"],
    ["Code Preview state", "preview"],
    ["Navigation History", "history"],
  ] as const) {
    if (byteLength <= limit) {
      break;
    }
    if (snapshot[key] !== undefined) {
      snapshot[key] = undefined;
      dropped.push(label);
      byteLength = size();
    }
  }
  return { snapshot, dropped, byteLength };
}

export function parseWorkspaceSession(
  value: unknown,
): WorkspaceSessionSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.format !== "c-insight-workspace-session" ||
    value.version !== WORKSPACE_SESSION_VERSION ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt)
  ) {
    return undefined;
  }
  const snapshot: WorkspaceSessionSnapshot = {
    format: "c-insight-workspace-session",
    version: 1,
    savedAt: value.savedAt,
  };
  if (value.engine === "clangd" || value.engine === "microsoft") {
    snapshot.engine = value.engine;
  }
  if (
    isRecord(value.history) &&
    Array.isArray(value.history.entries) &&
    typeof value.history.filter === "string"
  ) {
    snapshot.history = value.history as unknown as HistorySessionState;
  }
  if (
    isRecord(value.preview) &&
    typeof value.preview.uri === "string" &&
    isRange(value.preview.range) &&
    isNavigationMode(value.preview.mode) &&
    typeof value.preview.title === "string" &&
    typeof value.preview.locked === "boolean"
  ) {
    snapshot.preview = value.preview as unknown as PreviewSessionState;
  }
  if (
    isRecord(value.references) &&
    typeof value.references.query === "string" &&
    ["all", "workspace", "directory", "file"].includes(
      String(value.references.scope),
    ) &&
    Number.isInteger(value.references.displayedLimit) &&
    (value.references.displayedLimit as number) > 0
  ) {
    snapshot.references =
      value.references as unknown as ReferenceSessionState;
  }
  if (
    isRecord(value.symbolSearch) &&
    typeof value.symbolSearch.query === "string" &&
    Array.isArray(value.symbolSearch.selectedKinds)
  ) {
    snapshot.symbolSearch =
      value.symbolSearch as unknown as SymbolSearchSessionState;
  }
  if (
    isRecord(value.callHierarchy) &&
    typeof value.callHierarchy.uri === "string" &&
    isPosition(value.callHierarchy.position) &&
    Number.isInteger(value.callHierarchy.incomingDepth) &&
    (value.callHierarchy.incomingDepth as number) >= 0 &&
    Number.isInteger(value.callHierarchy.outgoingDepth) &&
    (value.callHierarchy.outgoingDepth as number) >= 0 &&
    isStringArrayWithin(value.callHierarchy.incomingExpandedPaths, 500) &&
    isStringArrayWithin(value.callHierarchy.outgoingExpandedPaths, 500)
  ) {
    snapshot.callHierarchy =
      value.callHierarchy as unknown as CallHierarchySessionState;
  }
  const relationshipGraph = parseRelationshipGraph(value.relationshipGraph);
  if (relationshipGraph) {
    snapshot.relationshipGraph = relationshipGraph;
  }
  return snapshot;
}

export function sessionForAnalysisEngine(
  input: WorkspaceSessionSnapshot,
  engine: "clangd" | "microsoft",
): { snapshot: WorkspaceSessionSnapshot; dropped: string[] } {
  const snapshot = structuredClone(input);
  const savedEngine = snapshot.engine ?? "clangd";
  snapshot.engine = engine;
  if (savedEngine === engine) return { snapshot, dropped: [] };
  const dropped: string[] = [];
  for (const [label, key] of [
    ["Code Preview", "preview"],
    ["References", "references"],
    ["Call Hierarchy", "callHierarchy"],
    ["Relationship Graph", "relationshipGraph"],
  ] as const) {
    if (snapshot[key] !== undefined) {
      snapshot[key] = undefined;
      dropped.push(label);
    }
  }
  return { snapshot, dropped };
}

function isStringArrayWithin(value: unknown, maximum: number): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= maximum &&
      value.every((item) => typeof item === "string" && item.length <= 8_192))
  );
}

function parseRelationshipGraph(
  value: unknown,
): RelationshipGraphSessionState | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.graph) ||
    value.graph.schemaVersion !== 1 ||
    !Array.isArray(value.graph.nodes) ||
    !Array.isArray(value.graph.edges) ||
    value.graph.nodes.length === 0 ||
    value.graph.nodes.length > 2_000 ||
    value.graph.edges.length > 5_000 ||
    !Array.isArray(value.enabledRelations) ||
    !Array.isArray(value.collapsedIds) ||
    !isRecord(value.viewport) ||
    !isFiniteNumber(value.viewport.scale) ||
    value.viewport.scale < 0.1 ||
    value.viewport.scale > 5 ||
    !isFiniteNumber(value.viewport.tx) ||
    !isFiniteNumber(value.viewport.ty)
  ) {
    return undefined;
  }
  const nodes = value.graph.nodes.filter(isGraphNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodes.length !== value.graph.nodes.length) {
    return undefined;
  }
  const edges = value.graph.edges.filter(
    (edge) =>
      isGraphEdge(edge) &&
      nodeIds.has(edge.from as string) &&
      nodeIds.has(edge.to as string),
  );
  if (edges.length !== value.graph.edges.length) {
    return undefined;
  }
  const rootId =
    typeof value.graph.rootId === "string" &&
    nodeIds.has(value.graph.rootId)
      ? value.graph.rootId
      : nodes[0]?.id;
  const relations = value.enabledRelations.filter(isGraphRelation);
  const memberCallerScopes: Record<string, MemberCallerScope> = {};
  if (isRecord(value.memberCallerScopes)) {
    for (const [nodeId, scope] of Object.entries(value.memberCallerScopes)) {
      if (nodeIds.has(nodeId) && isMemberCallerScope(scope)) {
        memberCallerScopes[nodeId] = scope;
      }
    }
  }
  return {
    schemaVersion: 1,
    graph: {
      schemaVersion: 1,
      rootId,
      revision:
        typeof value.graph.revision === "number"
          ? value.graph.revision
          : 1,
      staleReason:
        typeof value.graph.staleReason === "string"
          ? value.graph.staleReason
          : undefined,
      limitedBy:
        value.graph.limitedBy === "maximumNodes" ||
        value.graph.limitedBy === "maximumEdges"
          ? value.graph.limitedBy
          : undefined,
      nodes,
      edges,
    },
    selectedId:
      typeof value.selectedId === "string" &&
      nodeIds.has(value.selectedId)
        ? value.selectedId
        : rootId,
    enabledRelations: relations,
    collapsedIds: value.collapsedIds.filter(
      (id): id is string => typeof id === "string" && nodeIds.has(id),
    ),
    memberCallerScopes:
      Object.keys(memberCallerScopes).length > 0
        ? memberCallerScopes
        : undefined,
    viewport: {
      scale: value.viewport.scale,
      tx: value.viewport.tx,
      ty: value.viewport.ty,
    },
  };
}

function isGraphNode(value: unknown): value is RelationshipGraphSnapshot["nodes"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length <= 256 &&
    typeof value.kind === "string" &&
    typeof value.name === "string" &&
    value.name.length <= 1_024 &&
    Array.isArray(value.states) &&
    value.states.every((state) => typeof state === "string") &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every(isGraphRelation) &&
    (value.uri === undefined ||
      (typeof value.uri === "string" && value.uri.length <= 8_192)) &&
    (value.line === undefined ||
      (Number.isInteger(value.line) && (value.line as number) > 0)) &&
    (value.character === undefined ||
      (Number.isInteger(value.character) &&
        (value.character as number) >= 0))
  );
}

function isGraphEdge(value: unknown): value is RelationshipGraphSnapshot["edges"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length <= 256 &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    isGraphRelation(value.relation) &&
    Array.isArray(value.states) &&
    value.states.every((state) => typeof state === "string")
  );
}

function isGraphRelation(value: unknown): value is GraphRelation {
  return ["calls", "inherits", "includes", "defines"].includes(
    String(value),
  );
}

function isMemberCallerScope(value: unknown): value is MemberCallerScope {
  return (
    isRecord(value) &&
    typeof value.queryUri === "string" &&
    value.queryUri.length <= 8_192 &&
    isPosition(value.queryPosition) &&
    typeof value.memberName === "string" &&
    value.memberName.length <= 1_024 &&
    isRange(value.memberRange) &&
    (value.anchor === undefined ||
      (isRecord(value.anchor) &&
        typeof value.anchor.name === "string" &&
        value.anchor.name.length <= 1_024 &&
        isRange(value.anchor.range) &&
        (value.anchor.operator === "." || value.anchor.operator === "->") &&
        (value.anchor.path === undefined ||
          (Array.isArray(value.anchor.path) &&
            value.anchor.path.length > 0 &&
            value.anchor.path.length <= 64 &&
            value.anchor.path.every(
              (segment) =>
                isRecord(segment) &&
                typeof segment.name === "string" &&
                segment.name.length > 0 &&
                segment.name.length <= 1_024 &&
                (segment.operator === "." || segment.operator === "->"),
            )))))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPosition(
  value: unknown,
): value is { line: number; character: number } {
  return (
    isRecord(value) &&
    Number.isInteger(value.line) &&
    (value.line as number) >= 0 &&
    Number.isInteger(value.character) &&
    (value.character as number) >= 0
  );
}

function isRange(value: unknown): value is SerializedRange {
  return (
    isRecord(value) &&
    isPosition(value.start) &&
    isPosition(value.end)
  );
}

function isNavigationMode(value: unknown): value is NavigationMode {
  return [
    "definition",
    "declaration",
    "reference",
    "caller",
    "callee-definition",
    "callee-call-site",
  ].includes(String(value));
}
