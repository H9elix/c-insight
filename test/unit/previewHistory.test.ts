import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreviewHistory } from "../../src/views/previewHistory";

describe("Code Preview history", () => {
  it("moves backward and forward without duplicating equal entries", () => {
    const history = new PreviewHistory<string>((left, right) => left === right);
    history.reset("one");
    history.push("two");
    history.push("two");
    assert.equal(history.canBack, true);
    assert.equal(history.move(-1), "one");
    assert.equal(history.canForward, true);
    assert.equal(history.move(1), "two");
  });

  it("drops forward entries after branching", () => {
    const history = new PreviewHistory<string>((left, right) => left === right);
    history.reset("one");
    history.push("two");
    history.push("three");
    assert.equal(history.move(-1), "two");
    history.push("branch");
    assert.equal(history.canForward, false);
    assert.equal(history.move(-1), "two");
  });

  it("bounds retained entries", () => {
    const history = new PreviewHistory<number>((left, right) => left === right, 2);
    history.reset(1);
    history.push(2);
    history.push(3);
    assert.equal(history.move(-1), 2);
    assert.equal(history.move(-1), undefined);
  });
});
