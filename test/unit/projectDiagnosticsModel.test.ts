import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compilationCommand,
  isMissingInclude,
} from "../../src/diagnostics/projectDiagnosticsModel";

describe("project diagnostics model", () => {
  it("uses command and arguments forms from compilation databases", () => {
    assert.equal(
      compilationCommand({
        directory: "/workspace",
        file: "main.c",
        command: "gcc -Iinclude -c main.c",
      }),
      "gcc -Iinclude -c main.c",
    );
    assert.equal(
      compilationCommand({
        directory: "/workspace",
        file: "main.cpp",
        arguments: ["clang++", "-std=c++20", "-c", "main.cpp"],
      }),
      "clang++ -std=c++20 -c main.cpp",
    );
  });

  it("recognizes common missing-include diagnostics", () => {
    assert.equal(isMissingInclude("'config.h' file not found"), true);
    assert.equal(
      isMissingInclude("fatal error: generated.h: No such file or directory"),
      true,
    );
    assert.equal(isMissingInclude("use of undeclared identifier 'value'"), false);
  });
});
