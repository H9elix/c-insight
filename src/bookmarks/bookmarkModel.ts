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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
