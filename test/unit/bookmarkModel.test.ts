import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BookmarkStore,
  closestSymbolOffset,
  filterBookmarks,
  parseBookmarkExport,
  sortBookmarks,
} from "../../src/bookmarks/bookmarkModel";

function input(line = 3) {
  return {
    label: "calculate",
    uri: "file:///workspace/main.cpp",
    range: {
      start: { line, character: 4 },
      end: { line, character: 13 },
    },
    mode: "definition" as const,
    symbol: "calculate",
  };
}

describe("bookmark model", () => {
  it("adds bookmarks to General and deduplicates the same position", () => {
    const store = new BookmarkStore();
    const first = store.add(input(), "one", 10);
    const duplicate = store.add(
      { ...input(), label: "Updated", group: "Important" },
      "two",
      20,
    );
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(store.all.length, 1);
    assert.equal(store.all[0].id, "one");
    assert.equal(store.all[0].label, "Updated");
    assert.equal(store.all[0].group, "Important");
  });

  it("renames, moves, marks stale, relocates, and removes", () => {
    const store = new BookmarkStore();
    store.add(input(), "one");
    assert.equal(store.rename("one", "Calculator"), true);
    assert.equal(store.move("one", "API"), true);
    assert.equal(store.markUriStale(input().uri), true);
    assert.equal(store.find("one")?.stale, true);
    assert.equal(
      store.updateLocation(
        "one",
        {
          start: { line: 8, character: 2 },
          end: { line: 8, character: 11 },
        },
        false,
      ),
      true,
    );
    assert.equal(store.find("one")?.range.start.line, 8);
    assert.equal(store.find("one")?.stale, false);
    assert.equal(store.remove("one"), true);
    assert.equal(store.all.length, 0);
  });

  it("finds the closest whole-symbol occurrence", () => {
    const text =
      "int calculate();\nint calculate_more();\nreturn calculate();\n";
    const first = text.indexOf("calculate");
    const last = text.lastIndexOf("calculate");
    assert.equal(closestSymbolOffset(text, "calculate", first), first);
    assert.equal(closestSymbolOffset(text, "calculate", text.length), last);
    assert.equal(closestSymbolOffset(text, "missing", 0), undefined);
    assert.equal(closestSymbolOffset(text, "not valid", 0), undefined);
  });

  it("filters and sorts bookmarks", () => {
    const store = new BookmarkStore();
    store.add(input(8), "later", 20);
    store.add(
      {
        ...input(2),
        label: "Alpha",
        group: "API",
        uri: "file:///workspace/api.cpp",
      },
      "earlier",
      10,
    );
    assert.deepEqual(
      filterBookmarks(store.all, "api").map((bookmark) => bookmark.id),
      ["earlier"],
    );
    assert.deepEqual(
      sortBookmarks(store.all, "name").map((bookmark) => bookmark.label),
      ["Alpha", "calculate"],
    );
    assert.deepEqual(
      sortBookmarks(store.all, "created").map((bookmark) => bookmark.id),
      ["later", "earlier"],
    );
  });

  it("renames, merges, and removes groups", () => {
    const store = new BookmarkStore();
    store.add({ ...input(1), group: "One" }, "one");
    store.add({ ...input(2), group: "Two" }, "two");
    assert.equal(store.renameGroup("One", "Two"), 1);
    assert.equal(store.all.every((bookmark) => bookmark.group === "Two"), true);
    assert.equal(store.removeGroup("Two"), 2);
    assert.equal(store.all.length, 0);
  });

  it("imports by replacing or merging duplicate positions", () => {
    const original = new BookmarkStore();
    original.add(input(), "original", 10);
    const imported = parseBookmarkExport({
      format: "c-insight-bookmarks",
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      bookmarks: [
        {
          ...original.all[0],
          id: "imported",
          label: "Imported",
        },
      ],
    });
    assert.deepEqual(original.import(imported, "append"), {
      added: 0,
      updated: 1,
    });
    assert.equal(original.all[0].id, "original");
    assert.equal(original.all[0].label, "Imported");
    assert.deepEqual(original.import(imported, "replace"), {
      added: 1,
      updated: 0,
    });
    assert.equal(original.all[0].id, "imported");
  });

  it("rejects unsupported or malformed import files", () => {
    assert.throws(
      () => parseBookmarkExport({ format: "c-insight-bookmarks", version: 2 }),
      /Unsupported/,
    );
    assert.throws(
      () =>
        parseBookmarkExport({
          format: "c-insight-bookmarks",
          version: 1,
          bookmarks: [{ label: "broken" }],
        }),
      /valid object/,
    );
  });
});
