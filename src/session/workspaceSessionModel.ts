import type {
  NavigationHistoryEntry,
  NavigationMode,
  SerializedRange,
} from "../history/navigationHistoryModel";

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
}

export interface WorkspaceSessionSnapshot {
  format: "c-insight-workspace-session";
  version: 1;
  savedAt: number;
  history?: HistorySessionState;
  preview?: PreviewSessionState;
  references?: ReferenceSessionState;
  symbolSearch?: SymbolSearchSessionState;
  callHierarchy?: CallHierarchySessionState;
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
    (value.callHierarchy.outgoingDepth as number) >= 0
  ) {
    snapshot.callHierarchy =
      value.callHierarchy as unknown as CallHierarchySessionState;
  }
  return snapshot;
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
