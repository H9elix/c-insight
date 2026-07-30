import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWorkspaceSession } from "../../src/session/workspaceSessionModel";
import { renderHierarchyExport } from "../../src/utils/hierarchyExport";

describe("second-phase compatibility", () => {
  it("accepts pre-0.15 call hierarchy snapshots without exact paths", () => {
    const snapshot = parseWorkspaceSession({
      format: "c-insight-workspace-session",
      version: 1,
      savedAt: 100,
      callHierarchy: {
        uri: "file:///workspace/main.cpp",
        position: { line: 2, character: 4 },
        incomingDepth: 3,
        outgoingDepth: 2,
      },
    });
    assert.equal(snapshot?.callHierarchy?.incomingDepth, 3);
    assert.equal(snapshot?.callHierarchy?.incomingExpandedPaths, undefined);
  });

  it("keeps summary-free hierarchy exports compatible with version 1", () => {
    const roots = [
      {
        name: "Base",
        uri: "file:///workspace/type.hpp",
        states: [],
        children: [],
      },
    ];
    const metadata = {
      relation: "type" as const,
      direction: "supertypes",
      edgeDirection: "child-to-parent" as const,
    };
    const json = JSON.parse(renderHierarchyExport(roots, metadata, "json"));
    assert.equal(json.schemaVersion, 1);
    assert.equal(json.summary, undefined);
    assert.doesNotMatch(renderHierarchyExport(roots, metadata, "text"), /^#/);
  });
});
