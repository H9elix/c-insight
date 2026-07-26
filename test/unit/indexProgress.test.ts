import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  initialIndexProgress,
  parseIndexCounts,
  updateIndexProgress,
} from "../../src/clangd/indexProgress";

describe("clangd background index progress", () => {
  it("parses clangd completed and total file counts", () => {
    assert.deepEqual(parseIndexCounts("233/1000"), {
      completed: 233,
      total: 1000,
    });
    assert.deepEqual(parseIndexCounts("4 / 9 files"), {
      completed: 4,
      total: 9,
    });
    assert.equal(parseIndexCounts("loading"), undefined);
  });

  it("tracks begin, report, and end transitions", () => {
    const idle = initialIndexProgress(true, 1);
    const started = updateIndexProgress(
      idle,
      { kind: "begin", title: "indexing", percentage: 0 },
      2,
    );
    assert.equal(started.status, "indexing");

    const reported = updateIndexProgress(
      started,
      { kind: "report", message: "5/10", percentage: 50 },
      3,
    );
    assert.equal(reported.completed, 5);
    assert.equal(reported.total, 10);
    assert.equal(reported.percentage, 50);

    const finished = updateIndexProgress(
      { ...reported, completed: 10 },
      { kind: "end" },
      4,
    );
    assert.equal(finished.status, "idle");
    assert.equal(finished.percentage, 100);
  });

  it("represents disabled background indexing", () => {
    assert.equal(initialIndexProgress(false).status, "disabled");
  });
});
