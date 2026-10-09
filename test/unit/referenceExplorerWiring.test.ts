import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/views/referenceExplorer.ts", "utf8");
const extension = readFileSync("src/extension.ts", "utf8");
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  contributes: {
    configuration: {
      properties: Record<string, { default?: unknown }>;
    };
  };
};
const groupMethod = source.slice(
  source.indexOf("  private group("),
  source.indexOf("  private referenceNode(", source.indexOf("  private group(")),
);

describe("References tree grouping wiring", () => {
  it("keeps flat results as leaves and applies the configurable group state", () => {
    assert.match(groupMethod, /this\.groupMode === "flat"/);
    assert.match(groupMethod, /get<boolean>\("autoExpandGroups", false\)/);
    assert.match(groupMethod, /TreeItemCollapsibleState\.Expanded/);
    assert.match(groupMethod, /TreeItemCollapsibleState\.Collapsed/);
  });

  it("defaults automatic expansion off and refreshes current results on change", () => {
    assert.equal(
      manifest.contributes.configuration.properties[
        "cInsight.references.autoExpandGroups"
      ]?.default,
      false,
    );
    assert.match(
      extension,
      /affectsConfiguration\(\s*"cInsight\.references\.autoExpandGroups"/,
    );
    assert.match(
      extension,
      /referenceExplorer\.groupExpansionConfigurationChanged\(\)/,
    );
  });

  it("coalesces pinned and result stale state for one source edit publication", () => {
    assert.match(source, /markSourceChanged\(reason: string\): void/);
    assert.match(source, /if \(changed && this\.state === "ready"\)/);
    assert.match(extension, /views\.markPinnedViewsStale\(\)/);
  });
});
