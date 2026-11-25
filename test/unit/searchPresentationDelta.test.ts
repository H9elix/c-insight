import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchPresentationDelta } from "../../src/textSearch/searchPresentationDelta";
import { searchWindow } from "../../src/textSearch/textSearchPresentation";
import type { SearchFile } from "../../src/textSearch/workspaceSearch";
import { findMatches, DEFAULT_SEARCH_OPTIONS } from "../../src/textSearch/searchModel";

const file = (id: string): SearchFile => ({id, label: id, uri: `file:///${id}`, hash: "hash",
  matches: findMatches("x", {...DEFAULT_SEARCH_OPTIONS, query: "x"}, 1).matches.map(match => ({...match, id: `${id}:0`}))});
describe("incremental search presentation", () => {
  it("transmits files once, then only changed records and checkbox deltas", () => {
    const a = file("a"), b = file("b");
    const first = searchPresentationDelta([a], new Set(["a:0"]), 1);
    assert(first.reset); assert.equal(first.files.length, 1);
    const progress = searchPresentationDelta([a], new Set(["a:0"]), 1, first.cursor);
    assert(!progress.reset); assert.deepEqual(progress.files, []); assert.deepEqual(progress.checkedAdded, []);
    const appended = searchPresentationDelta([a, b], new Set(["b:0"]), 1, progress.cursor);
    assert.deepEqual(appended.files.map(file => file.id), ["a", "b"]); assert.deepEqual(appended.checkedRemoved, ["a:0"]);
    const removed = searchPresentationDelta([b], new Set(), 1, appended.cursor); assert.deepEqual(removed.removed, ["a"]);
    assert.equal(searchPresentationDelta([{...b}], new Set(), 1, removed.cursor).files.length, 1);
    assert(searchPresentationDelta([b], new Set(), 2, removed.cursor).reset);
    assert(!("uri" in first.files[0])); assert(!("hash" in first.files[0]));
  });
  it("caps only display matches while retaining full-file counts and hidden checkbox authority", () => {
    const a = file("a"); a.matches.push({...a.matches[0], id: "a:1"}, {...a.matches[0], id: "a:2"});
    const checked = new Set(a.matches.map(match => match.id));
    const prefix = searchPresentationDelta([a, file("b")], checked, 1, undefined, 2);
    assert.equal(prefix.shown, 2); assert.equal(prefix.files.length, 1); assert.equal(prefix.files[0].matches.length, 2);
    assert.equal(prefix.files[0].totalMatches, 3); assert.equal(prefix.files[0].checkedMatches, 3); assert.equal(prefix.hiddenChecked, 1);
    assert.equal(a.matches.length, 3); assert.equal(checked.size, 3);
    const full = searchPresentationDelta([a, file("b")], checked, 1, prefix.cursor, 4);
    assert(full.reset); assert.equal(full.shown, 4);
  });
  it("bounds DOM projection for 100000 rows and changes only the visible range on scroll", () => {
    assert.equal(searchWindow(0, 200, 0).end, 0);
    for (const total of [1, 10000, 100000]) for (const top of [0, 2600, 1000000]) {
      const result = searchWindow(total, 500, top);
      assert(result.end - result.start <= 200); assert(result.end <= total); assert.equal(result.height, total * 26);
    }
    assert(searchWindow(100000, 500, 26000).start > 900);
  });
});
