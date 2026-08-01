import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveMicrosoftProviderStatus } from "../../src/analysis/microsoftProviderStatusModel";

describe("Microsoft Provider status", () => {
  it("rejects a disabled Microsoft language service", () => {
    const status = deriveMicrosoftProviderStatus({
      extensionInstalled: true,
      extensionActive: true,
      extensionVersion: "1.32.2",
      intelliSenseEngine: "disabled",
      conflicts: [],
    });
    assert.equal(status.state, "disabled");
  });

  it("reports known active providers as ambiguous", () => {
    const status = deriveMicrosoftProviderStatus({
      extensionInstalled: true,
      extensionActive: true,
      intelliSenseEngine: "default",
      conflicts: ["llvm-vs-code-extensions.vscode-clangd"],
    });
    assert.equal(status.state, "ambiguous");
  });

  it("verifies the supported conflict-free configuration", () => {
    const status = deriveMicrosoftProviderStatus({
      extensionInstalled: true,
      extensionActive: true,
      intelliSenseEngine: "default",
      conflicts: [],
    });
    assert.equal(status.state, "verified");
  });
});
