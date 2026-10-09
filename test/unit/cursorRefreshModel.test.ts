import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CursorRefreshAnchor,
  CursorRefreshModel,
  EditSelectionGuard,
} from "../../src/context/cursorRefreshModel";

function anchor(
  startCharacter = 4,
  version = 1,
  uri = "file:///workspace/main.c",
): CursorRefreshAnchor {
  return {
    uri,
    version,
    startLine: 10,
    startCharacter,
    endLine: 10,
    endCharacter: startCharacter + 5,
  };
}

describe("cursor refresh model", () => {
  it("queries once for a lexical target and skips movement inside it", () => {
    const model = new CursorRefreshModel();
    assert.equal(model.decide(anchor()), "query");
    assert.equal(model.decide(anchor()), "unchanged");
    assert.equal(model.decide(anchor(12)), "query");
  });

  it("preserves results on whitespace and known empty targets", () => {
    const model = new CursorRefreshModel();
    assert.equal(model.decide(undefined), "preserve");
    const commentWord = anchor();
    assert.equal(model.decide(commentWord), "query");
    model.recordResult(commentWord, false);
    assert.equal(model.decide(anchor(20)), "query");
    assert.equal(model.decide(commentWord), "preserve");
  });

  it("invalidates location decisions when the document changes", () => {
    const model = new CursorRefreshModel();
    const empty = anchor();
    model.decide(empty);
    model.recordResult(empty, false);
    model.documentChanged(empty.uri);
    assert.equal(model.decide({ ...empty, version: 2 }), "query");
  });

  it("bounds remembered empty targets", () => {
    const model = new CursorRefreshModel(2);
    for (const start of [1, 10, 20]) {
      const current = anchor(start);
      model.decide(current);
      model.recordResult(current, false);
    }
    assert.equal(model.decide(anchor(1)), "query");
    assert.equal(model.decide(anchor(20)), "preserve");
  });
});

describe("edit selection guard", () => {
  it("suppresses every matching selection event until the edit settles", () => {
    const guard = new EditSelectionGuard();
    guard.begin(
      "file:///workspace/main.c",
      2,
      new Set(["10:5", "10:6"]),
    );
    assert.equal(
      guard.shouldSuppress("file:///workspace/main.c", 2, "10:6"),
      true,
    );
    assert.equal(
      guard.shouldSuppress("file:///workspace/main.c", 2, "10:6"),
      true,
    );
    guard.clear();
    assert.equal(
      guard.shouldSuppress("file:///workspace/main.c", 2, "10:6"),
      false,
    );
  });

  it("releases immediately for deliberate movement away from the edit", () => {
    const guard = new EditSelectionGuard();
    guard.begin("file:///workspace/main.c", 2, new Set(["10:6"]), 1_000);
    assert.equal(
      guard.shouldSuppress("file:///workspace/main.c", 2, "11:0", 1_101),
      false,
    );
    assert.equal(guard.active, false);
  });

  it("releases an exact edit position after the event association window", () => {
    const guard = new EditSelectionGuard();
    guard.begin("file:///workspace/main.c", 2, new Set(["10:6"]), 1_000);
    assert.equal(
      guard.shouldSuppress("file:///workspace/main.c", 2, "10:6", 1_251),
      false,
    );
    assert.equal(guard.active, false);
  });

  it("absorbs a short-lived position mismatch from the same edit event", () => {
    const guard = new EditSelectionGuard();
    guard.begin("file:///workspace/main.c", 2, new Set(["10:6"]), 1_000);
    assert.equal(
      guard.shouldSuppress("file:///workspace/main.c", 2, "10:8", 1_050),
      true,
    );
    assert.equal(guard.active, true);
  });

  it("blocks non-selection automatic refreshes until navigation resumes", () => {
    const guard = new EditSelectionGuard();
    guard.begin("file:///workspace/main.c", 3, new Set(["10:7"]));
    assert.equal(guard.blocksAutomatic("file:///workspace/main.c", 3), true);
    assert.equal(guard.blocksAutomatic("file:///workspace/other.c", 3), false);
    guard.clear();
    assert.equal(guard.blocksAutomatic("file:///workspace/main.c", 3), false);
  });
});
