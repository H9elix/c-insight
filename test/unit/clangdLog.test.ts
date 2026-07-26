import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyClangdLog } from "../../src/clangd/clangdLogClassifier";

describe("clangd log classification", () => {
  it("maps clangd prefixes to VS Code levels", () => {
    assert.equal(classifyClangdLog("I[12:00] <-- hover(1)"), "info");
    assert.equal(classifyClangdLog("V[12:00] AST details"), "trace");
    assert.equal(classifyClangdLog("W[12:00] warning"), "warning");
    assert.equal(classifyClangdLog("E[12:00] failure"), "error");
  });

  it("keeps unstructured client failures at error level", () => {
    assert.equal(
      classifyClangdLog("Server process exited with code 1"),
      "error",
    );
  });

  it("inherits the level for multiline clangd log continuations", () => {
    assert.equal(
      classifyClangdLog("[/home/user/FFmpeg]", "info"),
      "info",
    );
    assert.equal(
      classifyClangdLog("/usr/bin/gcc -I. -std=c17 source.c", "info"),
      "info",
    );
  });

  it("does not hide real diagnostics inside an info continuation", () => {
    assert.equal(
      classifyClangdLog("source.c:10:2: error: unknown name", "info"),
      "error",
    );
    assert.equal(
      classifyClangdLog("source.c:11:2: warning: unused value", "info"),
      "warning",
    );
  });
});
