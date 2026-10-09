import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CursorSymbolEvidence,
  hasCursorSymbolEvidence,
  shouldPreserveResultsForEmptyCursor,
} from "../../src/context/cursorSymbolEvidence";

function emptyEvidence(): CursorSymbolEvidence {
  return {
    definitions: [],
    declarations: [],
    callRoots: [],
  };
}

describe("cursor symbol evidence", () => {
  it("preserves existing results when an automatic cursor query finds no symbol", () => {
    assert.equal(
      shouldPreserveResultsForEmptyCursor(emptyEvidence()),
      true,
    );
  });

  it("recognizes every base-query source of symbol evidence", () => {
    const cases: CursorSymbolEvidence[] = [
      { ...emptyEvidence(), definitions: [{}] },
      { ...emptyEvidence(), declarations: [{}] },
      { ...emptyEvidence(), callRoots: [{}] },
      { ...emptyEvidence(), hover: "int value" },
      { ...emptyEvidence(), name: "value" },
      { ...emptyEvidence(), qualifiedName: "scope::value" },
      { ...emptyEvidence(), symbolId: "opaque-id" },
    ];

    for (const evidence of cases) {
      assert.equal(hasCursorSymbolEvidence(evidence), true);
      assert.equal(
        shouldPreserveResultsForEmptyCursor(evidence),
        false,
      );
    }
    assert.equal(hasCursorSymbolEvidence(emptyEvidence()), false);
  });

  it("allows explicit refresh and relationship commands to publish empty results", () => {
    for (const intent of [
      { manualReferences: true },
      { manualCallHierarchy: true },
      { manualCallDirection: "incoming" as const },
      { manualCallDirection: "outgoing" as const },
    ]) {
      assert.equal(
        shouldPreserveResultsForEmptyCursor(emptyEvidence(), intent),
        false,
      );
    }
  });

  it("is wired before automatic context publication", () => {
    const controller = readFileSync(
      "src/context/contextController.ts",
      "utf8",
    );
    const guard = controller.indexOf(
      "shouldPreserveResultsForEmptyCursor(base, intent)",
    );
    const publication = controller.indexOf(
      "this.views.updateContext(base, intent)",
      guard,
    );
    assert.ok(guard >= 0);
    assert.ok(publication > guard);
  });

  it("does not schedule semantic navigation directly from text edits", () => {
    const controller = readFileSync(
      "src/context/contextController.ts",
      "utf8",
    );
    const listener = controller.slice(
      controller.indexOf("vscode.workspace.onDidChangeTextDocument"),
      controller.indexOf("this.views.onDidChangeNavigationVisibility"),
    );
    assert.match(listener, /this\.documentChanged\(event\)/);
    assert.doesNotMatch(listener, /this\.schedule\(/);
    assert.match(controller, /this\.cursorRefresh\.decide\(anchor\)/);
  });
});
