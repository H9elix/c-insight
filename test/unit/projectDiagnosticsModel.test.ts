import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeCompileCommand,
  compilationCommand,
  isMissingInclude,
  renderProjectDiagnosticsText,
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

  it("breaks down compiler, standard, paths, defines, and forced inputs", () => {
    assert.deepEqual(
      analyzeCompileCommand({
        directory: "/workspace/build",
        file: "../main.c",
        arguments: [
          "/usr/bin/clang",
          "-x",
          "c",
          "-std=c17",
          "-I../include",
          "-isystem",
          "/opt/sdk/include",
          "-iquote../config",
          "-DDEBUG=1",
          "-D",
          "FEATURE",
          "-include",
          "../config/generated.h",
          "@flags.rsp",
          "-c",
          "../main.c",
        ],
      }),
      {
        compiler: "/usr/bin/clang",
        language: "c",
        standard: "c17",
        includePaths: ["/workspace/include"],
        systemIncludePaths: ["/opt/sdk/include"],
        quoteIncludePaths: ["/workspace/config"],
        defines: ["DEBUG=1", "FEATURE"],
        forcedIncludes: ["../config/generated.h"],
        responseFiles: ["flags.rsp"],
      },
    );
  });

  it("renders a shareable project diagnostics report", () => {
    const text = renderProjectDiagnosticsText({
      schemaVersion: 1,
      generatedAt: "2026-07-29T00:00:00.000Z",
      workspaceTrusted: true,
      clangd: {
        state: "ready",
        executable: "/usr/bin/clangd-20",
        version: "clangd version 20.1.0",
        indexStatus: "idle",
      },
      compilationDatabase: {
        path: "/workspace/build/compile_commands.json",
        source: "automatic",
        entries: 42,
      },
      currentFile: {
        path: "/workspace/include/api.h",
        kind: "header",
        commandSource: "inferred-candidate",
        inferredFrom: "/workspace/src/api.c",
      },
      diagnostics: {
        errors: 1,
        warnings: 0,
        information: 0,
        hints: 0,
        missingIncludes: 1,
        currentFileMessages: [
          { line: 3, severity: "error", message: "'config.h' file not found" },
        ],
      },
    });
    assert.match(text, /clangd: ready/);
    assert.match(text, /Command source: inferred-candidate/);
    assert.match(text, /Candidate inferred from: \/workspace\/src\/api.c/);
    assert.match(text, /Line 3 \[error\]: 'config.h' file not found/);
  });
});
