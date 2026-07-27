import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NavigationHistoryInput,
  NavigationHistoryStore,
  navigationOrigin,
} from "../../src/history/navigationHistoryModel";

function entry(
  line: number,
  title = `symbol${line}`,
): NavigationHistoryInput {
  return {
    uri: "file:///workspace/main.cpp",
    range: {
      start: { line, character: 1 },
      end: { line, character: 5 },
    },
    mode: "definition",
    origin: "definition",
    title,
  };
}

describe("navigation history", () => {
  it("merges consecutive duplicate locations when enabled", () => {
    const store = new NavigationHistoryStore(20, true);
    const first = store.add(entry(1, "first"), 10);
    const merged = store.add(entry(1, "updated"), 20);
    assert.equal(store.all.length, 1);
    assert.equal(merged.id, first.id);
    assert.equal(merged.title, "updated");
    assert.equal(merged.timestamp, 20);
  });

  it("restores entries, cursor, and continues with a higher id", () => {
    const store = new NavigationHistoryStore(20, true);
    const first = store.add(entry(1), 10);
    const second = store.add(
      { ...entry(2), mode: "reference", origin: "reference" },
      20,
    );
    const restored = new NavigationHistoryStore(20, true);
    restored.restore(store.all, first.id);
    assert.equal(restored.current?.id, first.id);
    assert.equal(restored.canForward, true);
    const next = restored.add(
      { ...entry(3), mode: "caller", origin: "caller" },
      30,
    );
    assert.ok(next.id > second.id);
  });

  it("retains duplicates when merging is disabled", () => {
    const store = new NavigationHistoryStore(20, false);
    store.add(entry(1));
    store.add(entry(1));
    assert.equal(store.all.length, 2);
  });

  it("enforces the maximum entry count", () => {
    const store = new NavigationHistoryStore(3, true);
    store.add(entry(1));
    store.add(entry(2));
    store.add(entry(3));
    store.add(entry(4));
    assert.deepEqual(
      store.all.map((item) => item.range.start.line),
      [2, 3, 4],
    );
  });

  it("supports back, forward, selection, and branch truncation", () => {
    const store = new NavigationHistoryStore(20, true);
    const first = store.add(entry(1));
    store.add(entry(2));
    const third = store.add(entry(3));
    assert.equal(store.back()?.range.start.line, 2);
    assert.equal(store.back()?.id, first.id);
    assert.equal(store.forward()?.range.start.line, 2);
    assert.equal(store.select(third.id)?.id, third.id);
    assert.equal(store.back()?.range.start.line, 2);
    store.add(entry(4));
    assert.equal(store.canForward, false);
    assert.deepEqual(
      store.all.map((item) => item.range.start.line),
      [1, 2, 4],
    );
  });

  it("maps modes and interaction sources to filter origins", () => {
    assert.equal(navigationOrigin("definition", "selection"), "definition");
    assert.equal(navigationOrigin("declaration", "selection"), "declaration");
    assert.equal(navigationOrigin("reference", "selection"), "reference");
    assert.equal(navigationOrigin("caller", "selection"), "caller");
    assert.equal(
      navigationOrigin("callee-call-site", "selection"),
      "callee",
    );
    assert.equal(
      navigationOrigin("definition", "interaction"),
      "code-preview",
    );
  });
});
