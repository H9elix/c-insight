import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const treeNode = readFileSync("src/views/treeNode.ts", "utf8");
const registry = readFileSync("src/views/viewRegistry.ts", "utf8");
const history = readFileSync("src/history/navigationHistoryExplorer.ts", "utf8");
const diagnostics = readFileSync("src/diagnostics/projectDiagnostics.ts", "utf8");
const navigationCommands = readFileSync(
  "src/commands/navigationCommands.ts",
  "utf8",
);
const manifest = readFileSync("package.json", "utf8");

describe("tree location interaction wiring", () => {
  it("routes ordinary location nodes through the shared activation command", () => {
    assert.match(treeNode, /command: "cInsight\.activateTreeLocation"/);
    assert.match(treeNode, /arguments: \[node, this\.interactionScope\]/);
    assert.match(registry, /provider\.setInteractionScope\(id\)/);
  });

  it("migrates document symbols, history, and diagnostics from direct-open commands", () => {
    assert.doesNotMatch(registry, /openDocumentSymbolCommand/);
    assert.match(registry, /contextValue: "documentSymbolLocation"/);
    assert.doesNotMatch(history, /cInsight\.history\.preview/);
    assert.match(history, /historyEntryId: entry\.id/);
    assert.match(diagnostics, /contextValue: "diagnosticLocation"/);
    assert.doesNotMatch(diagnostics, /title: "Open Diagnostic"/);
  });

  it("keeps explicit right-click editor navigation available", () => {
    assert.match(manifest, /viewItem == documentSymbolLocation/);
    assert.match(manifest, /viewItem == diagnosticLocation/);
  });

  it("defers cursor-follow refresh only for tree double-click navigation", () => {
    assert.match(
      navigationCommands,
      /controller\.beginProgrammaticNavigation\(location\)/,
    );
    assert.match(
      navigationCommands,
      /controller\.completeProgrammaticNavigation\(navigation\)/,
    );
    assert.match(
      navigationCommands,
      /controller\.cancelProgrammaticNavigation\(navigation\)/,
    );
  });
});
