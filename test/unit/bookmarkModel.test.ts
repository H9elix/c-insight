import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BookmarkStore,
  closestSymbolOffset,
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
});
