import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeProviderConflicts,
  LLVM_CLANGD_EXTENSION_ID,
  MICROSOFT_CPP_EXTENSION_ID,
} from "../../src/analysis/providerConflictModel";

describe("provider conflict detection", () => {
  it("ignores extensions whose language service is disabled", () => {
    assert.deepEqual(activeProviderConflicts({
      engine: "clangd",
      llvmClangdActive: true,
      llvmClangdEnabled: false,
      microsoftCppActive: true,
      microsoftIntelliSenseEngine: "disabled",
    }), []);
  });

  it("reports only effective competing providers", () => {
    assert.deepEqual(activeProviderConflicts({
      engine: "clangd",
      llvmClangdActive: true,
      llvmClangdEnabled: true,
      microsoftCppActive: true,
      microsoftIntelliSenseEngine: "default",
    }), [LLVM_CLANGD_EXTENSION_ID, MICROSOFT_CPP_EXTENSION_ID]);
  });

  it("does not treat the selected Microsoft service as its own conflict", () => {
    assert.deepEqual(activeProviderConflicts({
      engine: "microsoft",
      llvmClangdActive: false,
      llvmClangdEnabled: true,
      microsoftCppActive: true,
      microsoftIntelliSenseEngine: "default",
    }), []);
  });
});
