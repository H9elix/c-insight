import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const repository = readFileSync("src/callHierarchy/callHierarchyRepository.ts", "utf8");
const controller = readFileSync("src/context/contextController.ts", "utf8");

describe("macro caller repository wiring", () => {
  it("detects macro uses even when the provider has no callable root", () => {
    assert.doesNotMatch(repository, /if \(detectMacroCallers && roots\.length > 0\)/);
    assert.match(repository, /roots\.length > 0 &&\s*roots\.every/);
    assert.match(repository, /this\.syntheticMacroNode\(macroScope\)/);
  });

  it("shares the cursor Definition promise instead of querying every scalar twice", () => {
    assert.match(controller, /definitions: definitionsRequest/);
    assert.match(repository, /definitionRequest \?\? this\.analysis\.definition/);
  });

  it("shares a lazy Hover and limits source-less macro recognition to clangd evidence", () => {
    assert.match(controller, /hover: queryHover/);
    assert.match(controller, /hoverRequest \?\?= this\.analysis\.hover/);
    assert.match(repository, /if \(this\.analysis\.analysisEngine !== "clangd"\) return undefined/);
    assert.match(repository, /hoverDefinesMacro\(hover, selectedName\)/);
    assert.match(repository, /const definition = macroCallerAnchor\(scope\)/);
  });

  it("never bulk-opens macro reference files merely to obtain caller labels", () => {
    const mapping = repository.slice(repository.indexOf("private async referenceBasedIncoming"));
    assert.doesNotMatch(mapping, /openTextDocument/);
    assert.match(mapping, /vscode\.workspace\.textDocuments\.some/);
    assert.match(mapping, /if \(!node\.macroCallerScope\) throw error/);
    assert.match(mapping, /unmappedMacroReferences\.push\(reference\)/);
  });

  it("keeps expanded-target document syncing behind the explicit bounded action", () => {
    const explicit = repository.slice(repository.indexOf("resolveExpandedMacroTarget("),
      repository.indexOf("  symbolLocations("));
    assert.match(explicit, /\.slice\(0, 16\)/);
    assert.match(explicit, /await vscode\.workspace\.openTextDocument\(candidate\.uri\)/);
    assert.match(explicit, /expandedMacroTarget: true/);
  });
});
