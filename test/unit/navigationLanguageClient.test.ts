import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldRegisterLanguageClientFeature } from "../../src/clangd/languageClientFeatureFilter";

describe("navigation language client feature filtering", () => {
  it("rejects the global execute-command feature", () => {
    assert.equal(
      shouldRegisterLanguageClientFeature({
        registrationType: { method: "workspace/executeCommand" },
      }),
      false,
    );
  });

  it("retains navigation and document synchronization features", () => {
    for (const method of [
      "textDocument/didOpen",
      "textDocument/didChange",
      "textDocument/definition",
      "textDocument/references",
      "textDocument/prepareCallHierarchy",
    ]) {
      assert.equal(
        shouldRegisterLanguageClientFeature({
          registrationType: { method },
        }),
        true,
      );
    }
  });

  it("retains static features without a registration type", () => {
    assert.equal(shouldRegisterLanguageClientFeature({}), true);
  });
});
