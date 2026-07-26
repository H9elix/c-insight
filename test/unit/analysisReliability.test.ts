import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateReliability } from "../../src/diagnostics/analysisReliability";

describe("analysis reliability", () => {
  it("reports reliable results when the project is ready and configured", () => {
    assert.deepEqual(
      evaluateReliability({
        clangdState: "ready",
        indexStatus: "idle",
        hasCompilationDatabase: true,
        currentSourceFile: true,
        hasCompileCommand: true,
        missingIncludes: 0,
      }),
      { level: "reliable", issues: [] },
    );
  });

  it("combines incomplete-index and project-configuration warnings", () => {
    const result = evaluateReliability({
      clangdState: "indexing",
      indexStatus: "indexing",
      indexPercentage: 42,
      hasCompilationDatabase: false,
      currentSourceFile: true,
      hasCompileCommand: false,
      missingIncludes: 2,
    });
    assert.equal(result.level, "limited");
    assert.deepEqual(
      result.issues.map((issue) => issue.code),
      ["indexing", "no-compilation-database", "missing-includes"],
    );
    assert.match(result.issues[0].message, /42%/);
  });

  it("treats a stopped or failed clangd as unavailable", () => {
    for (const clangdState of ["stopped", "starting", "restarting", "failed"]) {
      const result = evaluateReliability({
        clangdState,
        indexStatus: "idle",
        hasCompilationDatabase: true,
        currentSourceFile: true,
        hasCompileCommand: true,
        missingIncludes: 0,
      });
      assert.equal(result.level, "unavailable");
      assert.equal(result.issues[0].code, "clangd-not-ready");
    }
  });

  it("distinguishes a missing current-file command from a missing database", () => {
    const result = evaluateReliability({
      clangdState: "ready",
      indexStatus: "idle",
      hasCompilationDatabase: true,
      currentSourceFile: true,
      hasCompileCommand: false,
      missingIncludes: 0,
    });
    assert.equal(result.level, "limited");
    assert.deepEqual(
      result.issues.map((issue) => issue.code),
      ["no-compile-command"],
    );
  });
});
