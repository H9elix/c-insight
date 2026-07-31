export type ViewStatusKind =
  | "idle"
  | "loading"
  | "empty"
  | "cancelled"
  | "stale"
  | "limited"
  | "error"
  | "success";

export interface ViewStatusPresentation {
  icon: string;
  contextValue: string;
}

const presentations: Record<ViewStatusKind, ViewStatusPresentation> = {
  idle: { icon: "info", contextValue: "cInsightStatus.idle" },
  loading: { icon: "loading~spin", contextValue: "cInsightStatus.loading" },
  empty: { icon: "info", contextValue: "cInsightStatus.empty" },
  cancelled: {
    icon: "circle-slash",
    contextValue: "cInsightStatus.cancelled",
  },
  stale: { icon: "history", contextValue: "cInsightStatus.stale" },
  limited: { icon: "warning", contextValue: "cInsightStatus.limited" },
  error: { icon: "error", contextValue: "cInsightStatus.error" },
  success: { icon: "pass", contextValue: "cInsightStatus.success" },
};

export function viewStatusPresentation(
  kind: ViewStatusKind,
): ViewStatusPresentation {
  return presentations[kind];
}
