export type NavigationMode =
  | "definition"
  | "declaration"
  | "reference"
  | "caller"
  | "callee-definition"
  | "callee-call-site";

export type NavigationSource =
  | "context"
  | "selection"
  | "interaction"
  | "history";

export type NavigationOrigin =
  | "definition"
  | "declaration"
  | "reference"
  | "caller"
  | "callee"
  | "code-preview";

export interface SerializedPosition {
  line: number;
  character: number;
}

export interface SerializedRange {
  start: SerializedPosition;
  end: SerializedPosition;
}

export interface NavigationHistoryInput {
  uri: string;
  range: SerializedRange;
  mode: NavigationMode;
  origin: NavigationOrigin;
  title: string;
}

export interface NavigationHistoryEntry extends NavigationHistoryInput {
  id: number;
  timestamp: number;
}

export class NavigationHistoryStore {
  private entries: NavigationHistoryEntry[] = [];
  private cursor = -1;
  private nextId = 1;

  constructor(
    private maximumEntries: number,
    private mergeConsecutiveDuplicates: boolean,
  ) {}

  get all(): readonly NavigationHistoryEntry[] {
    return this.entries;
  }

  get current(): NavigationHistoryEntry | undefined {
    return this.entries[this.cursor];
  }

  get canBack(): boolean {
    return this.cursor > 0;
  }

  get canForward(): boolean {
    return this.cursor >= 0 && this.cursor < this.entries.length - 1;
  }

  configure(
    maximumEntries: number,
    mergeConsecutiveDuplicates: boolean,
  ): void {
    this.maximumEntries = maximumEntries;
    this.mergeConsecutiveDuplicates = mergeConsecutiveDuplicates;
    this.trim();
  }

  add(
    input: NavigationHistoryInput,
    timestamp = Date.now(),
  ): NavigationHistoryEntry {
    if (this.cursor < this.entries.length - 1) {
      this.entries.splice(this.cursor + 1);
    }
    const previous = this.entries.at(-1);
    if (
      previous &&
      this.mergeConsecutiveDuplicates &&
      sameNavigation(previous, input)
    ) {
      const merged = { ...previous, ...input, timestamp };
      this.entries[this.entries.length - 1] = merged;
      this.cursor = this.entries.length - 1;
      return merged;
    }
    const entry: NavigationHistoryEntry = {
      ...input,
      id: this.nextId++,
      timestamp,
    };
    this.entries.push(entry);
    this.cursor = this.entries.length - 1;
    this.trim();
    return entry;
  }

  select(id: number): NavigationHistoryEntry | undefined {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return undefined;
    }
    this.cursor = index;
    return this.entries[index];
  }

  back(): NavigationHistoryEntry | undefined {
    if (!this.canBack) {
      return undefined;
    }
    this.cursor -= 1;
    return this.entries[this.cursor];
  }

  forward(): NavigationHistoryEntry | undefined {
    if (!this.canForward) {
      return undefined;
    }
    this.cursor += 1;
    return this.entries[this.cursor];
  }

  clear(): void {
    this.entries = [];
    this.cursor = -1;
  }

  restore(
    entries: readonly NavigationHistoryEntry[],
    currentId?: number,
  ): void {
    this.entries = entries
      .filter((entry) => validEntry(entry))
      .map((entry) => ({ ...entry, range: { ...entry.range } }));
    this.nextId =
      this.entries.reduce((maximum, entry) => Math.max(maximum, entry.id), 0) +
      1;
    const restored = currentId === undefined
      ? this.entries.length - 1
      : this.entries.findIndex((entry) => entry.id === currentId);
    this.cursor = restored >= 0 ? restored : this.entries.length - 1;
    this.trim();
  }

  private trim(): void {
    const overflow = Math.max(0, this.entries.length - this.maximumEntries);
    if (overflow === 0) {
      return;
    }
    this.entries.splice(0, overflow);
    this.cursor = Math.max(0, this.cursor - overflow);
  }
}

function validEntry(entry: NavigationHistoryEntry): boolean {
  return (
    Number.isInteger(entry.id) &&
    entry.id > 0 &&
    typeof entry.uri === "string" &&
    typeof entry.title === "string" &&
    typeof entry.timestamp === "number" &&
    Number.isInteger(entry.range?.start?.line) &&
    Number.isInteger(entry.range?.start?.character)
  );
}

export function navigationOrigin(
  mode: NavigationMode,
  source: NavigationSource,
): NavigationOrigin {
  if (source === "interaction") {
    return "code-preview";
  }
  switch (mode) {
    case "definition":
      return "definition";
    case "declaration":
      return "declaration";
    case "reference":
      return "reference";
    case "caller":
      return "caller";
    case "callee-definition":
    case "callee-call-site":
      return "callee";
  }
}

function sameNavigation(
  left: NavigationHistoryInput,
  right: NavigationHistoryInput,
): boolean {
  return (
    left.uri === right.uri &&
    left.range.start.line === right.range.start.line &&
    left.range.start.character === right.range.start.character &&
    left.range.end.line === right.range.end.line &&
    left.range.end.character === right.range.end.character &&
    left.mode === right.mode &&
    left.origin === right.origin
  );
}
