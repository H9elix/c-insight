import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClangdArguments } from "../../src/clangd/clangdArguments";
import type { CInsightConfiguration } from "../../src/configuration/configuration";

function configuration(): CInsightConfiguration {
  return {
    clangdPath: "clangd",
    clangdArguments: [],
    clangdLogLevel: "info",
    fallbackFlags: ["-std=c++17"],
    backgroundIndex: true,
    followCursor: true,
    followCursorDelay: 200,
    followCursorDetailsDelay: 600,
    includeDeclarationInReferences: true,
    includeSystemReferences: false,
    exclude: [],
  };
}

describe("clangd arguments", () => {
  it("does not pass a redundant --stdio flag", () => {
    const args = buildClangdArguments(configuration());
    assert.equal(args.includes("--stdio"), false);
    assert.equal(args.includes("--background-index"), true);
  });

  it("appends user arguments after managed arguments", () => {
    const config = configuration();
    config.clangdArguments = ["--limit-results=50"];
    assert.equal(buildClangdArguments(config).at(-1), "--limit-results=50");
  });

  it("passes an automatically discovered compilation database directory", () => {
    const args = buildClangdArguments(configuration(), "/workspace/build");
    assert.ok(
      args.includes("--compile-commands-dir=/workspace/build"),
    );
  });

  it("prefers an explicitly configured compilation database directory", () => {
    const config = configuration();
    config.compileCommandsDir = "/workspace/custom";
    const args = buildClangdArguments(config, "/workspace/build");
    assert.ok(
      args.includes("--compile-commands-dir=/workspace/custom"),
    );
    assert.equal(
      args.includes("--compile-commands-dir=/workspace/build"),
      false,
    );
  });
});
