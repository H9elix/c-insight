import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentSymbol, SymbolInformation } from "vscode-languageclient/node";
import {
  enclosingCaller,
  microsoftEmptyCallersMessage,
} from "../../src/callHierarchy/microsoftCallerFallbackModel";

const range = (startLine: number, endLine: number) => ({
  start: { line: startLine, character: 0 },
  end: { line: endLine, character: 80 },
});

describe("Microsoft reference-based Callers", () => {
  it("selects the innermost callable containing a reference", () => {
    const nested: DocumentSymbol = {
      name: "outer",
      kind: 12,
      range: range(1, 30),
      selectionRange: range(1, 1),
      children: [{
        name: "inner",
        kind: 12,
        range: range(10, 20),
        selectionRange: range(10, 10),
        children: [],
      }],
    };
    assert.equal(
      enclosingCaller("file:///caller.c", { line: 15, character: 4 }, [nested])?.name,
      "inner",
    );
  });

  it("ignores non-callable containers and out-of-range symbols", () => {
    const variable: DocumentSymbol = {
      name: "global",
      kind: 13,
      range: range(1, 2),
      selectionRange: range(1, 1),
      children: [],
    };
    assert.equal(
      enclosingCaller("file:///caller.c", { line: 5, character: 0 }, [variable]),
      undefined,
    );
  });

  it("recognizes cpptools flat C functions reported as Interface", () => {
    const functionSymbol: SymbolInformation = {
      name: "decode_read(DecodeContext *, int)",
      kind: 11,
      location: { uri: "file:///caller.c", range: range(35, 63) },
    };
    assert.equal(
      enclosingCaller("file:///caller.c", { line: 42, character: 8 }, [functionSymbol])?.name,
      functionSymbol.name,
    );
  });

  it("does not treat a real Interface symbol as a caller", () => {
    const interfaceSymbol: SymbolInformation = {
      name: "DecoderInterface",
      kind: 11,
      location: { uri: "file:///caller.cpp", range: range(1, 20) },
    };
    assert.equal(
      enclosingCaller("file:///caller.cpp", { line: 10, character: 0 }, [interfaceSymbol]),
      undefined,
    );
  });

  it("distinguishes no references from references that cannot be mapped", () => {
    assert.match(
      microsoftEmptyCallersMessage({
        references: 0,
        mappedReferences: 0,
        unmappedReferences: 0,
        callerFunctions: 0,
      }),
      /results may be incomplete/,
    );
    assert.equal(
      microsoftEmptyCallersMessage({
        references: 2,
        mappedReferences: 0,
        unmappedReferences: 2,
        callerFunctions: 0,
      }),
      "2 references found, but enclosing caller functions could not be identified",
    );
  });
});
