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
      relationshipGraph: {
        schemaVersion: 1,
        graph: {
          schemaVersion: 1,
          rootId: "root",
          revision: 3,
          nodes: [
            {
              id: "root",
              kind: "function",
              name: "main",
              uri: "file:///workspace/main.cpp",
              line: 1,
              character: 4,
              states: [],
              capabilities: ["calls"],
            },
          ],
          edges: [],
        },
        selectedId: "root",
        enabledRelations: ["calls"],
        collapsedIds: [],
        viewport: { scale: 1.2, tx: 30, ty: 40 },
      },
    });
    assert.equal(snapshot?.preview?.title, "main");
    assert.deepEqual(snapshot?.symbolSearch?.selectedKinds, [12]);
    assert.equal(
      snapshot?.relationshipGraph?.graph.nodes[0].name,
      "main",
    );
    assert.equal(snapshot?.relationshipGraph?.viewport.scale, 1.2);
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

  it("drops an incompatible relationship graph section without losing the session", () => {
    const snapshot = parseWorkspaceSession({
      format: "c-insight-workspace-session",
      version: 1,
      savedAt: 100,
      relationshipGraph: {
        schemaVersion: 2,
        graph: { nodes: [], edges: [] },
      },
    });
    assert.ok(snapshot);
    assert.equal(snapshot.relationshipGraph, undefined);
  });
});
