import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("atomic editor navigation wiring", () => {
  it("includes a collapsed target selection in the initial editor-open options", () => {
    const helper = readFileSync("src/utils/editorNavigation.ts", "utf8");
    assert.match(helper, /showTextDocument\(document, \{[\s\S]*?selection: new vscode\.Range\(range\.start, range\.start\)/);
    assert.doesNotMatch(helper, /editor\.selection\s*=/);
    assert.match(helper, /preview: options\.preview \?\? true/);
    assert.match(helper, /preserveFocus: false/);
    assert.match(helper, /editor\.revealRange\(range, options\.revealType/);
    assert.doesNotMatch(helper, /executeCommand|clearEditorHistory/);
  });

  it("shares the atomic opening path across result commands, Code Preview, and graphs", () => {
    for (const file of [
      "src/commands/navigationCommands.ts",
      "src/views/codePreviewProvider.ts",
      "src/relationshipGraph/relationshipGraphPanel.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /import \{ showEditorLocation \} from "\.\.\/utils\/editorNavigation"/, file);
      assert.match(source, /await showEditorLocation\(/, file);
      assert.doesNotMatch(source, /showTextDocument|editor\.selection\s*=/, file);
    }
  });

  it("preserves the graph's pinned-tab and conditional-centering policy", () => {
    const graph = readFileSync("src/relationshipGraph/relationshipGraphPanel.ts", "utf8");
    assert.match(graph, /showEditorLocation\(document, location\.range, \{\s*preview: false,\s*revealType: vscode\.TextEditorRevealType\.InCenterIfOutsideViewport/);
  });
});
