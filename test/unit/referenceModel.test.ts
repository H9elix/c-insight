import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyReference,
  classifyParameterEffect,
  enhanceReferenceClassification,
  isAddressAcquisition,
  isIndirectWrite,
  isMacroDefinitionLine,
  isOverloadedOperatorUse,
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

  it("separates writes through pointers from writes to pointer variables", () => {
    assert.equal(isIndirectWrite("*pointer = value;", 1), true);
    assert.equal(isIndirectWrite("pointer->field = value;", 0), true);
    assert.equal(isIndirectWrite("pointer = other;", 0), false);
    assert.equal(isIndirectWrite("value * pointer;", 8), false);
    const reference = location("file:///source.c", 2, 1, 8);
    const classification = enhanceReferenceClassification(
      reference,
      "reference",
      { sourceLine: "*pointer = value;" },
    );
    assert.equal(
      referenceClassificationLabel(classification),
      "Read · Pointee Write",
    );
    assert.equal(classification.effect, "pointee-write");
    assert.equal(classification.evidence.at(-1)?.rule, "effect.pointee-write");
  });

  it("infers mutable reference and pointer argument side effects", () => {
    assert.equal(classifyParameterEffect("Widget &output"), "reference-write");
    assert.equal(classifyParameterEffect("const Widget &input"), undefined);
    assert.equal(classifyParameterEffect("Widget *output"), "pointee-write");
    assert.equal(classifyParameterEffect("const Widget *input"), undefined);
    assert.equal(classifyParameterEffect("Widget &&temporary"), undefined);
    const reference = location("file:///source.cpp", 2, 7, 12);
    const classification = enhanceReferenceClassification(
      reference,
      "reference",
      {
        sourceLine: "update(value);",
        highlightKind: 2,
        parameterLabel: "Widget &value",
      },
    );
    assert.equal(
      referenceClassificationLabel(classification),
      "Read/Write · Reference Write (inferred)",
    );
    assert.equal(classification.evidence.at(-1)?.source, "clangd-signature");
  });

  it("recognizes overloaded operator tokens as inferred calls", () => {
    assert.equal(isOverloadedOperatorUse("left + right", 5, "operator+"), true);
    assert.equal(isOverloadedOperatorUse("items[index]", 5, "operator[]"), true);
    assert.equal(isOverloadedOperatorUse("callable()", 8, "operator()"), true);
    assert.equal(isOverloadedOperatorUse("left - right", 5, "operator+"), false);
    const reference = location("file:///source.cpp", 2, 5, 6);
    const classification = enhanceReferenceClassification(
      reference,
      "reference",
      {
        sourceLine: "left + right",
        queriedSymbolName: "operator+",
      },
    );
    assert.equal(referenceClassificationLabel(classification), "Function Call (inferred)");
    assert.equal(classification.role, "call");
    assert.equal(
      classification.evidence.at(-1)?.rule,
      "role.overloaded-operator-call",
    );
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
