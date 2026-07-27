import type { NavigationMode, SerializedRange } from "../history/navigationHistoryModel";

export interface Bookmark {
  id: string;
  label: string;
  group: string;
  uri: string;
  range: SerializedRange;
  mode: NavigationMode;
  symbol?: string;
  stale: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BookmarkInput {
  label: string;
  group?: string;
  uri: string;
  range: SerializedRange;
  mode: NavigationMode;
  symbol?: string;
}

export type BookmarkSort =
  | "name"
  | "path"
  | "position"
  | "created"
  | "updated";

export interface BookmarkExport {
  format: "c-insight-bookmarks";
  version: 1;
  exportedAt: string;
  bookmarks: Bookmark[];
}

export interface BookmarkImportResult {
  added: number;
  updated: number;
}

export class BookmarkStore {
  private bookmarks: Bookmark[];

  constructor(initial: Bookmark[] = []) {
    this.bookmarks = initial.map((bookmark) => ({ ...bookmark }));
  }

  get all(): readonly Bookmark[] {
    return this.bookmarks;
  }

  add(
    input: BookmarkInput,
    id: string,
    timestamp = Date.now(),
  ): { bookmark: Bookmark; created: boolean } {
    const existing = this.bookmarks.find(
      (bookmark) =>
        bookmark.uri === input.uri &&
        bookmark.range.start.line === input.range.start.line &&
        bookmark.range.start.character === input.range.start.character,
    );
    if (existing) {
      Object.assign(existing, input, {
        group: input.group ?? existing.group,
        stale: false,
        updatedAt: timestamp,
      });
      return { bookmark: existing, created: false };
    }
    const bookmark: Bookmark = {
      ...input,
      id,
      group: input.group?.trim() || "General",
      stale: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.bookmarks.push(bookmark);
    return { bookmark, created: true };
  }

  rename(id: string, label: string, timestamp = Date.now()): boolean {
    const bookmark = this.find(id);
    if (!bookmark || !label.trim()) {
      return false;
    }
    bookmark.label = label.trim();
    bookmark.updatedAt = timestamp;
    return true;
  }

  move(id: string, group: string, timestamp = Date.now()): boolean {
    const bookmark = this.find(id);
    if (!bookmark || !group.trim()) {
      return false;
    }
    bookmark.group = group.trim();
    bookmark.updatedAt = timestamp;
    return true;
  }

  remove(id: string): boolean {
    const index = this.bookmarks.findIndex((bookmark) => bookmark.id === id);
    if (index < 0) {
      return false;
    }
    this.bookmarks.splice(index, 1);
    return true;
  }

  renameGroup(group: string, target: string, timestamp = Date.now()): number {
    const name = target.trim();
    if (!name) {
      return 0;
    }
    let changed = 0;
    for (const bookmark of this.bookmarks) {
      if (bookmark.group === group && bookmark.group !== name) {
        bookmark.group = name;
        bookmark.updatedAt = timestamp;
        changed += 1;
      }
    }
    return changed;
  }

  removeGroup(group: string): number {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter(
      (bookmark) => bookmark.group !== group,
    );
    return before - this.bookmarks.length;
  }

  import(
    bookmarks: Bookmark[],
    mode: "append" | "replace",
  ): BookmarkImportResult {
    if (mode === "replace") {
      this.bookmarks = bookmarks.map((bookmark) => ({ ...bookmark }));
      return { added: bookmarks.length, updated: 0 };
    }
    let added = 0;
    let updated = 0;
    for (const incoming of bookmarks) {
      const existing = this.bookmarks.find(
        (bookmark) =>
          bookmark.uri === incoming.uri &&
          bookmark.range.start.line === incoming.range.start.line &&
          bookmark.range.start.character === incoming.range.start.character,
      );
      if (existing) {
        Object.assign(existing, incoming, { id: existing.id });
        updated += 1;
      } else {
        this.bookmarks.push({ ...incoming });
        added += 1;
      }
    }
    return { added, updated };
  }

  markUriStale(uri: string, timestamp = Date.now()): boolean {
    let changed = false;
    for (const bookmark of this.bookmarks) {
      if (bookmark.uri === uri && !bookmark.stale) {
        bookmark.stale = true;
        bookmark.updatedAt = timestamp;
        changed = true;
      }
    }
    return changed;
  }

  updateLocation(
    id: string,
    range: SerializedRange,
    stale: boolean,
    timestamp = Date.now(),
  ): boolean {
    const bookmark = this.find(id);
    if (!bookmark) {
      return false;
    }
    bookmark.range = range;
    bookmark.stale = stale;
    bookmark.updatedAt = timestamp;
    return true;
  }

  find(id: string): Bookmark | undefined {
    return this.bookmarks.find((bookmark) => bookmark.id === id);
  }
}

export function filterBookmarks(
  bookmarks: readonly Bookmark[],
  query: string,
): Bookmark[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return [...bookmarks];
  }
  return bookmarks.filter((bookmark) =>
    [bookmark.label, bookmark.group, bookmark.uri, bookmark.symbol]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(needle)),
  );
}

export function sortBookmarks(
  bookmarks: readonly Bookmark[],
  sort: BookmarkSort,
): Bookmark[] {
  const values = [...bookmarks];
  values.sort((left, right) => {
    switch (sort) {
      case "name":
        return left.label.localeCompare(right.label);
      case "path":
        return (
          left.uri.localeCompare(right.uri) ||
          comparePosition(left, right)
        );
      case "position":
        return comparePosition(left, right);
      case "created":
        return right.createdAt - left.createdAt;
      case "updated":
        return right.updatedAt - left.updatedAt;
    }
  });
  return values;
}

export function parseBookmarkExport(value: unknown): Bookmark[] {
  if (!isRecord(value)) {
    throw new Error("The import file must contain a JSON object.");
  }
  if (
    value.format !== "c-insight-bookmarks" ||
    value.version !== 1 ||
    !Array.isArray(value.bookmarks)
  ) {
    throw new Error("Unsupported C Insight bookmark format or version.");
  }
  return value.bookmarks.map((bookmark, index) =>
    parseBookmark(bookmark, index),
  );
}

export function closestSymbolOffset(
  text: string,
  symbol: string,
  preferredOffset: number,
): number | undefined {
  if (!symbol || !/^[$A-Z_a-z][$\w]*$/.test(symbol)) {
    return undefined;
  }
  const expression = new RegExp(
    `(?<![$\\w])${escapeRegExp(symbol)}(?![$\\w])`,
    "g",
  );
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const match of text.matchAll(expression)) {
    const offset = match.index;
    const distance = Math.abs(offset - preferredOffset);
    if (distance < bestDistance) {
      best = offset;
      bestDistance = distance;
    }
  }
  return best;
}

function parseBookmark(value: unknown, index: number): Bookmark {
  if (!isRecord(value) || !isRecord(value.range)) {
    throw new Error(`Bookmark ${index + 1} is not a valid object.`);
  }
  const start = parsePosition(value.range.start, index);
  const end = parsePosition(value.range.end, index);
  const modes: NavigationMode[] = [
    "definition",
    "declaration",
    "reference",
    "caller",
    "callee-definition",
    "callee-call-site",
  ];
  if (
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    !value.label.trim() ||
    typeof value.group !== "string" ||
    !value.group.trim() ||
    typeof value.uri !== "string" ||
    !value.uri ||
    !modes.includes(value.mode as NavigationMode)
  ) {
    throw new Error(`Bookmark ${index + 1} has invalid required fields.`);
  }
  return {
    id: value.id,
    label: value.label.trim(),
    group: value.group.trim(),
    uri: value.uri,
    range: { start, end },
    mode: value.mode as NavigationMode,
    symbol: typeof value.symbol === "string" ? value.symbol : undefined,
    stale: typeof value.stale === "boolean" ? value.stale : true,
    createdAt:
      typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    updatedAt:
      typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
  };
}

function parsePosition(
  value: unknown,
  index: number,
): { line: number; character: number } {
  if (
    !isRecord(value) ||
    typeof value.line !== "number" ||
    !Number.isInteger(value.line) ||
    value.line < 0 ||
    typeof value.character !== "number" ||
    !Number.isInteger(value.character) ||
    value.character < 0
  ) {
    throw new Error(`Bookmark ${index + 1} has an invalid source range.`);
  }
  return { line: value.line, character: value.character };
}

function comparePosition(left: Bookmark, right: Bookmark): number {
  return (
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.label.localeCompare(right.label)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
