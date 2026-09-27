import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/views/referenceExplorer.ts", "utf8");
const groupMethod = source.slice(
  source.indexOf("  private group("),
  source.indexOf("  private referenceNode(", source.indexOf("  private group(")),
);

describe("References tree grouping wiring", () => {
  it("keeps flat results as leaves and initially expands every grouped mode", () => {
    assert.match(groupMethod, /this\.groupMode === "flat"/);
    assert.match(
      groupMethod,
      /collapsibleState: vscode\.TreeItemCollapsibleState\.Expanded/,
    );
  });
});
