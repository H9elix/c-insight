import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CursorFollowSuppression,
  CursorFollowTarget,
} from "../../src/utils/cursorFollowSuppression";

const target = (
  uri = "file:///workspace/source.cpp",
  line = 10,
  character = 4,
): CursorFollowTarget => ({ uri, line, character });

describe("cursor-follow suppression", () => {
  it("suppresses the active editor and programmatic target selection", () => {
    const suppression = new CursorFollowSuppression();
    const token = suppression.begin(target());
    assert.equal(suppression.suppressActiveEditor(target().uri), true);
    assert.equal(suppression.suppressSelection(target(), "command"), true);
    suppression.complete(token);
    assert.equal(suppression.suppressSelection(target(), "unknown"), true);
    assert.equal(suppression.suppressAutomaticUpdate(target().uri), true);
  });

  it("resumes after mouse or keyboard movement to another position", () => {
    for (const kind of ["mouse", "keyboard"] as const) {
      const suppression = new CursorFollowSuppression();
      const token = suppression.begin(target());
      suppression.complete(token);
      assert.equal(
        suppression.suppressSelection(target(undefined, 11, 0), kind),
        false,
      );
      assert.equal(suppression.suppressAutomaticUpdate(target().uri), false);
    }
  });

  it("does not resume for the same position or command navigation", () => {
    const suppression = new CursorFollowSuppression();
    const token = suppression.begin(target());
    suppression.complete(token);
    assert.equal(suppression.suppressSelection(target(), "mouse"), true);
    assert.equal(
      suppression.suppressSelection(target(undefined, 12, 0), "command"),
      true,
    );
  });

  it("resumes when another editor becomes active", () => {
    const suppression = new CursorFollowSuppression();
    suppression.begin(target());
    assert.equal(
      suppression.suppressActiveEditor("file:///workspace/other.cpp"),
      false,
    );
    assert.equal(suppression.suppressAutomaticUpdate(target().uri), false);
  });

  it("replaces an older navigation and only cancels the matching token", () => {
    const suppression = new CursorFollowSuppression();
    const first = suppression.begin(target());
    const secondTarget = target("file:///workspace/other.cpp", 3, 2);
    const second = suppression.begin(secondTarget);
    suppression.cancel(first);
    assert.equal(suppression.suppressActiveEditor(secondTarget.uri), true);
    suppression.cancel(second);
    assert.equal(suppression.suppressActiveEditor(secondTarget.uri), false);
  });

  it("does not resume from user-looking events while navigation is opening", () => {
    const suppression = new CursorFollowSuppression();
    suppression.begin(target());
    assert.equal(
      suppression.suppressSelection(target(undefined, 20, 0), "mouse"),
      true,
    );
  });
});
