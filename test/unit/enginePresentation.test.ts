import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analysisEngineDisplayName,
  compilationDatabaseChangePresentation,
} from "../../src/analysis/enginePresentation";

describe("analysis engine presentation", () => {
  it("uses the official Microsoft extension name with its process identity", () => {
    assert.equal(
      analysisEngineDisplayName("microsoft"),
      "Microsoft C/C++ language service (cpptools)",
    );
    assert.equal(analysisEngineDisplayName("clangd"), "clangd");
  });

  it("does not offer a clangd restart in Microsoft mode", () => {
    const microsoft = compilationDatabaseChangePresentation(
      "microsoft",
      "changed",
    );
    assert.equal(microsoft.primaryAction, "Reload Window");
    assert.doesNotMatch(microsoft.message, /clangd/i);

    const clangd = compilationDatabaseChangePresentation("clangd", "changed");
    assert.equal(clangd.primaryAction, "Restart clangd");
    assert.match(clangd.message, /Restart clangd/);
  });
});
