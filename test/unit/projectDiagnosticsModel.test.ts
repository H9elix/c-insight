import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeCompileCommand,
  compilationCommand,
  isMissingInclude,
  redactProjectDiagnosticsReport,
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
      microsoftCallers: {
        mode: "references",
        queriedNodes: 3,
        references: 7,
        mappedReferences: 5,
        unmappedReferences: 2,
        callerFunctions: 4,
      },
      extension: {
        name: "C Insight",
        version: "0.17.6",
        developer: "youjinchun",
        license: "MIT",
        vscodeVersion: "1.130.0",
        nodeVersion: "24.0.0",
        platform: "linux",
        architecture: "x64",
        remoteName: "ssh-remote",
        extensionMode: "test",
      },
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
      runtime: {
        scheduler: {
          submitted: 12,
          coalesced: 2,
          started: 10,
          completed: 8,
          failed: 1,
          cancelledBeforeStart: 1,
          active: 0,
          queued: 0,
          peakActive: 3,
        },
        requests: {
          measured: 9,
          averageDurationMs: 125,
          maximumDurationMs: 1200,
          slow: 1,
          lastSlowMethod: "workspace/symbol",
          lastSlowDurationMs: 1200,
          failed: 1,
          cancelled: 1,
          providerActivationDurationMs: 40,
          last: {
            method: "workspace/symbol",
            engine: "clangd",
            outcome: "completed",
            durationMs: 1200,
            completedAt: "2026-08-01T00:00:00.000Z",
          },
          byMethod: {
            "workspace/symbol": {
              measured: 2,
              completed: 2,
              failed: 0,
              cancelled: 0,
              averageDurationMs: 700,
              maximumDurationMs: 1200,
            },
          },
        },
        counters: { "limits.references.display": 1 },
        gauges: { "cache.references.highlights": 7 },
        limits: { "analysis.maximumConcurrentRequests": 8 },
      },
    });
    assert.match(text, /clangd: ready/);
    assert.match(text, /Extension: C Insight 0\.17\.6/);
    assert.match(text, /Developer: youjinchun/);
    assert.match(text, /Host: linux x64 · ssh-remote · test/);
    assert.match(text, /Command source: inferred-candidate/);
    assert.match(text, /Candidate inferred from: \/workspace\/src\/api.c/);
    assert.match(text, /Line 3 \[error\]: 'config.h' file not found/);
    assert.match(text, /Scheduler: 0 active, 0 queued, peak 3/);
    assert.match(text, /Last slow request: workspace\/symbol \(1200 ms\)/);
    assert.match(text, /Last semantic request: workspace\/symbol \[clangd\/completed\] 1200 ms/);
    assert.match(text, /Method workspace\/symbol: 2 measured, 700 ms average/);
    assert.match(text, /Counter limits.references.display: 1/);
    assert.match(text, /Limit analysis.maximumConcurrentRequests: 8/);
    assert.match(
      text,
      /Microsoft Callers evidence: 3 queried nodes, 7 references, 5 mapped references, 2 unmapped references, 4 caller functions/,
    );
  });

  it("redacts paths and optionally definitions in exported reports", () => {
    const report = {
      schemaVersion: 1 as const,
      generatedAt: "2026-07-30T00:00:00.000Z",
      workspaceTrusted: true,
      clangd: {
        state: "ready",
        executable: "/usr/bin/clangd-20",
        indexStatus: "idle",
      },
      compilationDatabase: { path: "/private/build/compile_commands.json" },
      currentFile: {
        path: "/private/src/main.c",
        kind: "source" as const,
        commandSource: "direct" as const,
        workingDirectory: "/private/build",
        compileCommand: "clang -I/private/include -DAPI_TOKEN=secret",
        fallbackFlags: ["-I/private/include", "-DAPI_TOKEN=secret"],
        command: {
          compiler: "/usr/bin/clang",
          includePaths: ["/private/include"],
          systemIncludePaths: [],
          quoteIncludePaths: [],
          defines: ["API_TOKEN=secret"],
          forcedIncludes: ["/private/config.h"],
          responseFiles: ["/private/flags.rsp"],
        },
      },
      diagnostics: {
        errors: 0,
        warnings: 0,
        information: 0,
        hints: 0,
        missingIncludes: 0,
        currentFileMessages: [],
      },
    };
    const paths = redactProjectDiagnosticsReport(report, "paths");
    assert.equal(paths.currentFile?.path, "<redacted-path>");
    assert.equal(
      paths.currentFile?.command?.includePaths[0],
      "<redacted-path>",
    );
    assert.deepEqual(paths.currentFile?.command?.defines, ["API_TOKEN=secret"]);
    const strict = redactProjectDiagnosticsReport(
      report,
      "paths-and-defines",
    );
    assert.deepEqual(strict.currentFile?.command?.defines, [
      "<redacted-define-1>",
    ]);
    assert.deepEqual(strict.currentFile?.fallbackFlags, [
      "<redacted-flag>",
      "<redacted-flag>",
    ]);
    assert.equal(report.currentFile.path, "/private/src/main.c");
  });
});
