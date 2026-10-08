import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const extension = readFileSync("src/extension.ts", "utf8");
const registry = readFileSync("src/views/viewRegistry.ts", "utf8");
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  contributes: {
    configuration: {
      properties: Record<string, { default?: unknown }>;
    };
  };
};

describe("document symbol viewport focus wiring", () => {
  it("defaults viewport-center following on and updates without an analysis query", () => {
    assert.equal(
      manifest.contributes.configuration.properties[
        "cInsight.documentSymbols.followEditorCenter"
      ]?.default,
      true,
    );
    assert.match(extension, /onDidChangeTextEditorVisibleRanges/);
    assert.match(extension, /scheduleDocumentSymbolViewport\(event\.textEditor\)/);
  });

  it("highlights and reveals without selecting or focusing the tree", () => {
    assert.match(registry, /labelHighlights = \[\[0, next\.label\.length\]\]/);
    assert.match(registry, /new vscode\.ThemeColor\("list\.highlightForeground"\)/);
    assert.match(registry, /select: false/);
    assert.match(registry, /focus: false/);
  });
});
