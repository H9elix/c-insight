import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseWorkspaceSession,
  WORKSPACE_SESSION_VERSION,
} from "../../src/session/workspaceSessionModel";

describe("workspace session snapshot", () => {
  it("accepts a supported snapshot and preserves valid view state", () => {
    const snapshot = parseWorkspaceSession({
      format: "c-insight-workspace-session",
      version: WORKSPACE_SESSION_VERSION,
      savedAt: 100,
      preview: {
        uri: "file:///workspace/main.cpp",
        range: {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 7 },
        },
        mode: "definition",
        title: "main",
        locked: true,
      },
      symbolSearch: {
        query: "decode",
        selectedKinds: [12],
      },
    });
    assert.equal(snapshot?.preview?.title, "main");
    assert.deepEqual(snapshot?.symbolSearch?.selectedKinds, [12]);
  });

  it("rejects unsupported envelopes and drops malformed sections", () => {
    assert.equal(
      parseWorkspaceSession({
        format: "c-insight-workspace-session",
        version: 2,
        savedAt: 100,
      }),
      undefined,
    );
    const snapshot = parseWorkspaceSession({
      format: "c-insight-workspace-session",
      version: 1,
      savedAt: 100,
      preview: { uri: "file:///broken" },
      references: { query: 42 },
    });
    assert.equal(snapshot?.preview, undefined);
    assert.equal(snapshot?.references, undefined);
  });
});
