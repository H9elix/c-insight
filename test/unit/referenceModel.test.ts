import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyReference,
  enhanceReferenceClassification,
  isAddressAcquisition,
  isMacroDefinitionLine,
  isReadWriteUse,
  isSimpleWrite,
  looksLikeFunctionCall,
  referenceClassificationLabel,
  referenceClassificationExplanation,
  referenceTypeGroup,
  referenceKindLabel,
} from "../../src/views/referenceModel";

function location(uri: string, line: number, start: number, end: number) {
  return {
    uri: { toString: () => uri },
    range: {
      start: { line, character: start },
      end: { line, character: end },
    },
  };
}

describe("reference classification", () => {
  it("prioritizes exact definitions and declarations", () => {
    const definition = location("file:///source.c", 2, 4, 7);
    const declaration = location("file:///source.h", 1, 4, 7);
    assert.equal(
      classifyReference(definition, [definition], [declaration]),
      "definition",
    );
    assert.equal(
      classifyReference(declaration, [definition], [declaration]),
      "declaration",
    );
  });

  it("recognizes direct function-call syntax", () => {
    const reference = location("file:///source.c", 10, 11, 14);
    assert.equal(
      classifyReference(
        reference,
        [],
        [],
        "    return add (left, right);",
      ),
      "call",
    );
    assert.equal(looksLikeFunctionCall("value + 1", 0), false);
    assert.equal(referenceKindLabel("call"), "Function Call");
  });

  it("keeps non-call uses as ordinary references", () => {
    const reference = location("file:///source.c", 4, 16, 19);
    assert.equal(
      classifyReference(reference, [], [], "callback = add;"),
      "reference",
    );
  });

  it("uses clangd highlight kinds for semantic reads and writes", () => {
    const reference = location("file:///source.c", 4, 4, 9);
    const read = enhanceReferenceClassification(reference, "reference", {
      sourceLine: "use(value);",
      highlightKind: 2,
    });
    const write = enhanceReferenceClassification(reference, "reference", {
      sourceLine: "    value = 1;",
      highlightKind: 3,
    });
    assert.equal(referenceClassificationLabel(read), "Read");
    assert.equal(read.confidence, "semantic");
    assert.deepEqual(read.evidence.map((item) => item.rule), [
      "access.highlight-read",
    ]);
    assert.match(
      referenceClassificationExplanation(read),
      /clangd-highlight \[access\.highlight-read\]/,
    );
    assert.equal(referenceClassificationLabel(write), "Write");
  });

  it("recognizes read/write and direct write syntax", () => {
    assert.equal(isReadWriteUse("value += 2;", 0), true);
    assert.equal(isReadWriteUse("++value;", 2), true);
    assert.equal(isSimpleWrite("value = other;", 0), true);
    assert.equal(isSimpleWrite("value == other;", 0), false);
    const reference = location("file:///source.c", 1, 0, 5);
    assert.equal(
      referenceClassificationLabel(
        enhanceReferenceClassification(reference, "reference", {
          sourceLine: "value++;",
          highlightKind: 3,
        }),
      ),
      "Read/Write",
    );
  });

  it("distinguishes unary address acquisition from binary and", () => {
    assert.equal(isAddressAcquisition("&value", 1), true);
    assert.equal(isAddressAcquisition("return &value;", 8), true);
    assert.equal(isAddressAcquisition("flags & value", 8), false);
    assert.equal(isAddressAcquisition("ready && value", 9), false);
  });

  it("marks macro symbols and macro directives", () => {
    assert.equal(isMacroDefinitionLine("#define BUFFER_SIZE 1024"), true);
    const reference = location("file:///source.c", 2, 8, 19);
    const classification = enhanceReferenceClassification(
      reference,
      "reference",
      {
        sourceLine: "int n = BUFFER_SIZE;",
        highlightKind: 2,
        macroSymbol: true,
      },
    );
    assert.equal(referenceClassificationLabel(classification), "Macro · Read");
    assert.deepEqual(classification.evidence.map((item) => item.rule), [
      "macro.symbol",
      "access.highlight-read",
    ]);
  });

  it("labels non-called callable uses as inferred addresses", () => {
    const reference = location("file:///source.c", 2, 11, 18);
    const classification = enhanceReferenceClassification(
      reference,
      "reference",
      {
        sourceLine: "callback = process;",
        callableSymbol: true,
      },
    );
    assert.equal(
      referenceClassificationLabel(classification),
      "Address (inferred)",
    );
    assert.equal(classification.confidence, "inferred");
  });

  it("maps classifications into stable Reference Type groups", () => {
    assert.equal(
      referenceTypeGroup({
        role: "reference",
        access: "read",
        macro: true,
        confidence: "semantic",
        evidence: [],
      }),
      "Reads",
    );
    assert.equal(
      referenceTypeGroup({
        role: "call",
        macro: false,
        confidence: "syntax",
        evidence: [],
      }),
      "Function Calls",
    );
    assert.equal(
      referenceTypeGroup({
        role: "reference",
        macro: false,
        confidence: "unknown",
        evidence: [],
      }),
      "Other References",
    );
  });
});
