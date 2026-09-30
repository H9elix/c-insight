import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundWorkspaceSessionSnapshot,
  sessionForAnalysisEngine,
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
      callHierarchy: {
        uri: "file:///workspace/main.cpp",
        position: { line: 1, character: 4 },
        incomingDepth: 3,
        outgoingDepth: 2,
        incomingExpandedPaths: ["root", "root\u0000caller"],
        outgoingExpandedPaths: [],
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
        memberCallerScopes: {
          root: {
            queryUri: "file:///workspace/main.cpp",
            queryPosition: { line: 8, character: 12 },
            memberName: "field",
            memberRange: {
              start: { line: 8, character: 12 },
              end: { line: 8, character: 17 },
            },
            anchor: {
              name: "selected",
              range: {
                start: { line: 8, character: 2 },
                end: { line: 8, character: 10 },
              },
              operator: "->",
              path: [
                { name: "leaf", operator: "->" },
                { name: "field", operator: "->" },
              ],
            },
          },
        },
        viewport: { scale: 1.2, tx: 30, ty: 40 },
      },
    });
    assert.equal(snapshot?.preview?.title, "main");
    assert.deepEqual(snapshot?.symbolSearch?.selectedKinds, [12]);
    assert.deepEqual(snapshot?.callHierarchy?.incomingExpandedPaths, [
      "root",
      "root\u0000caller",
    ]);
    assert.deepEqual(snapshot?.callHierarchy?.outgoingExpandedPaths, []);
    assert.equal(
      snapshot?.relationshipGraph?.graph.nodes[0].name,
      "main",
    );
    assert.equal(snapshot?.relationshipGraph?.viewport.scale, 1.2);
    assert.equal(
      snapshot?.relationshipGraph?.memberCallerScopes?.root.anchor?.name,
      "selected",
    );
    assert.deepEqual(
      snapshot?.relationshipGraph?.memberCallerScopes?.root.anchor?.path,
      [
        { name: "leaf", operator: "->" },
        { name: "field", operator: "->" },
      ],
    );
  });

  it("rejects unbounded call hierarchy expansion identities", () => {
    const snapshot = parseWorkspaceSession({
      format: "c-insight-workspace-session",
      version: 1,
      savedAt: 100,
      callHierarchy: {
        uri: "file:///workspace/main.cpp",
        position: { line: 1, character: 4 },
        incomingDepth: 1,
        outgoingDepth: 1,
        incomingExpandedPaths: Array.from(
          { length: 501 },
          (_, index) => `path-${index}`,
        ),
        outgoingExpandedPaths: [],
      },
    });
    assert.ok(snapshot);
    assert.equal(snapshot.callHierarchy, undefined);
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

  it("degrades oversized sessions in a deterministic priority order", () => {
    const result = boundWorkspaceSessionSnapshot(
      {
        format: "c-insight-workspace-session",
        version: 1,
        savedAt: 100,
        history: {
          entries: Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            uri: `file:///workspace/${"x".repeat(80)}/${index}.cpp`,
            range: {
              start: { line: index, character: 0 },
              end: { line: index, character: 1 },
            },
            mode: "definition",
            title: `Entry ${index}`,
            origin: "definition",
            timestamp: index,
          })),
          currentId: 1,
          filter: "",
        },
        preview: {
          uri: `file:///workspace/${"p".repeat(200)}.cpp`,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          mode: "definition",
          title: "preview",
          locked: false,
        },
      },
      6000,
    );
    assert.ok(result.byteLength <= 6000);
    assert.ok(
      result.dropped.includes("older Navigation History entries"),
    );
    assert.equal(result.snapshot.history?.entries.length, 20);
    assert.equal(result.snapshot.history?.currentId, 100);
  });

  it("drops semantic state restored under a different analysis engine", () => {
    const result = sessionForAnalysisEngine(
      {
        format: "c-insight-workspace-session",
        version: 1,
        savedAt: 100,
        engine: "clangd",
        history: { entries: [], filter: "" },
        preview: {
          uri: "file:///workspace/main.c",
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          mode: "definition",
          title: "main",
          locked: false,
        },
        references: { query: "main", scope: "all", displayedLimit: 100 },
        callHierarchy: {
          uri: "file:///workspace/main.c",
          position: { line: 0, character: 0 },
          incomingDepth: 1,
          outgoingDepth: 1,
        },
      },
      "microsoft",
    );
    assert.equal(result.snapshot.engine, "microsoft");
    assert.ok(result.snapshot.history);
    assert.equal(result.snapshot.preview, undefined);
    assert.equal(result.snapshot.references, undefined);
    assert.equal(result.snapshot.callHierarchy, undefined);
    assert.deepEqual(result.dropped, [
      "Code Preview",
      "References",
      "Call Hierarchy",
    ]);
  });
});
