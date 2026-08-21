export type HierarchyExpansionStopReason =
  | "cancelled"
  | "maximumDepth"
  | "maximumNodes";

export interface HierarchyExpansionState {
  cancelled: boolean;
  loadedNodes: number;
  maximumNodes: number;
  requestedDepth: number;
  maximumDepth: number;
}

export function defaultCallExpansionDirections(
  visibility: { callers: boolean; callees: boolean },
  manualDirection?: "incoming" | "outgoing",
): Array<"incoming" | "outgoing"> {
  if (manualDirection) {
    return [manualDirection];
  }
  return [
    visibility.callers ? "incoming" as const : undefined,
    visibility.callees ? "outgoing" as const : undefined,
  ].filter(
    (direction): direction is "incoming" | "outgoing" =>
      direction !== undefined,
  );
}

export function hierarchyExpansionStopReason(
  state: HierarchyExpansionState,
): HierarchyExpansionStopReason | undefined {
  if (state.cancelled) {
    return "cancelled";
  }
  if (state.loadedNodes >= state.maximumNodes) {
    return "maximumNodes";
  }
  if (state.requestedDepth >= state.maximumDepth) {
    return "maximumDepth";
  }
  return undefined;
}

export function hierarchyExpansionMessage(
  reason: HierarchyExpansionStopReason,
  maximumDepth: number,
  maximumNodes: number,
): { label: string; description: string } {
  switch (reason) {
    case "cancelled":
      return {
        label: "Expansion cancelled",
        description: "already loaded nodes remain available",
      };
    case "maximumDepth":
      return {
        label: `Maximum depth ${maximumDepth} reached`,
        description: "change the hierarchy maximumDepth setting to allow more",
      };
    case "maximumNodes":
      return {
        label: `Maximum node count ${maximumNodes} reached`,
        description: "results are truncated; change maximumNodes to allow more",
      };
  }
}
