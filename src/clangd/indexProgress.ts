export type IndexProgressStatus = "disabled" | "idle" | "indexing";

export interface IndexProgressState {
  status: IndexProgressStatus;
  completed?: number;
  total?: number;
  percentage?: number;
  message?: string;
  updatedAt: number;
}

export interface WorkProgressValue {
  kind: "begin" | "report" | "end";
  title?: string;
  message?: string;
  percentage?: number;
}

export function initialIndexProgress(
  enabled: boolean,
  now = Date.now(),
): IndexProgressState {
  return {
    status: enabled ? "idle" : "disabled",
    updatedAt: now,
  };
}

export function updateIndexProgress(
  previous: IndexProgressState,
  value: WorkProgressValue,
  now = Date.now(),
): IndexProgressState {
  if (value.kind === "begin") {
    return {
      status: "indexing",
      percentage: value.percentage ?? 0,
      message: value.message,
      updatedAt: now,
    };
  }
  if (value.kind === "end") {
    return {
      ...previous,
      status: "idle",
      percentage:
        previous.total !== undefined &&
        previous.completed === previous.total
          ? 100
          : previous.percentage,
      updatedAt: now,
    };
  }
  const counts = parseIndexCounts(value.message);
  return {
    ...previous,
    status: "indexing",
    completed: counts?.completed ?? previous.completed,
    total: counts?.total ?? previous.total,
    percentage: value.percentage ?? previous.percentage,
    message: value.message ?? previous.message,
    updatedAt: now,
  };
}

export function parseIndexCounts(
  message?: string,
): { completed: number; total: number } | undefined {
  const match = /^\s*(\d+)\s*\/\s*(\d+)(?:\s+files?)?\s*$/i.exec(
    message ?? "",
  );
  if (!match) {
    return undefined;
  }
  return {
    completed: Number(match[1]),
    total: Number(match[2]),
  };
}
