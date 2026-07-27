export type SymbolGrouping = "type" | "file" | "directory" | "flat";

export interface WorkspaceSymbolRecord {
  name: string;
  kind: number;
  kindLabel: string;
  containerName?: string;
  uri: string;
  line: number;
  character: number;
}

export interface SymbolGroup {
  label: string;
  symbols: WorkspaceSymbolRecord[];
}

export function groupWorkspaceSymbols(
  symbols: WorkspaceSymbolRecord[],
  grouping: SymbolGrouping,
): SymbolGroup[] {
  if (grouping === "flat") {
    return [{ label: "Results", symbols }];
  }
  const groups = new Map<string, WorkspaceSymbolRecord[]>();
  for (const symbol of symbols) {
    const key =
      grouping === "type"
        ? symbol.kindLabel
        : grouping === "file"
          ? fileName(symbol.uri)
          : directoryName(symbol.uri);
    const values = groups.get(key) ?? [];
    values.push(symbol);
    groups.set(key, values);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, values]) => ({ label, symbols: values }));
}

export function filterWorkspaceSymbols(
  symbols: WorkspaceSymbolRecord[],
  kinds: ReadonlySet<number>,
  limit: number,
): WorkspaceSymbolRecord[] {
  const filtered =
    kinds.size === 0 ? symbols : symbols.filter((symbol) => kinds.has(symbol.kind));
  return filtered.slice(0, Math.max(1, limit));
}

function fileName(uri: string): string {
  const value = decodePath(uri);
  return value.slice(value.lastIndexOf("/") + 1) || value;
}

function directoryName(uri: string): string {
  const value = decodePath(uri);
  const end = value.lastIndexOf("/");
  if (end <= 0) {
    return ".";
  }
  const directory = value.slice(0, end);
  return directory.slice(directory.lastIndexOf("/") + 1) || "/";
}

function decodePath(uri: string): string {
  try {
    return decodeURIComponent(new URL(uri).pathname);
  } catch {
    return uri;
  }
}
