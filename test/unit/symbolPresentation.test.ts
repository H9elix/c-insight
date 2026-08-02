import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SymbolKind } from "vscode-languageserver-protocol";
import { symbolKindIconId } from "../../src/symbols/symbolPresentation";

describe("symbol presentation", () => {
  it("maps common C/C++ symbol kinds to VS Code theme icons", () => {
    assert.equal(symbolKindIconId(SymbolKind.Function), "symbol-function");
    assert.equal(symbolKindIconId(SymbolKind.Variable), "symbol-variable");
    assert.equal(symbolKindIconId(SymbolKind.Struct), "symbol-struct");
    assert.equal(symbolKindIconId(SymbolKind.EnumMember), "symbol-enum-member");
    assert.equal(symbolKindIconId(SymbolKind.Field), "symbol-field");
  });

  it("uses the miscellaneous icon for unknown provider values", () => {
    assert.equal(symbolKindIconId(999), "symbol-misc");
  });
});
