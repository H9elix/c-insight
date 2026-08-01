import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeProviderConflicts,
  LLVM_CLANGD_EXTENSION_ID,
  MICROSOFT_CPP_EXTENSION_ID,
} from "../../src/analysis/providerConflictModel";

describe("clangd-only provider conflict detection", () => {
  it("ignores available extensions whose language service is disabled", () => {
    assert.deepEqual(activeProviderConflicts({
      llvmClangdAvailable: true,
      llvmClangdEnabled: false,
      microsoftCppAvailable: true,
      microsoftIntelliSenseEngine: "disabled",
    }), []);
  });

  it("reports enabled competing providers without waiting for activation", () => {
    assert.deepEqual(activeProviderConflicts({
      llvmClangdAvailable: true,
      llvmClangdEnabled: true,
      microsoftCppAvailable: true,
      microsoftIntelliSenseEngine: "default",
    }), [LLVM_CLANGD_EXTENSION_ID, MICROSOFT_CPP_EXTENSION_ID]);
  });
});
