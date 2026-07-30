export type ReferenceKind =
  | "definition"
  | "declaration"
  | "call"
  | "reference";

export type ReferenceAccess = "read" | "write" | "readwrite" | "address";
export type ReferenceConfidence = "semantic" | "syntax" | "inferred" | "unknown";
export type ReferenceEvidenceSource =
  | "clangd-result"
  | "clangd-highlight"
  | "clangd-signature"
  | "source-syntax"
  | "symbol-metadata"
  | "fallback";

export interface ReferenceClassificationEvidence {
  source: ReferenceEvidenceSource;
  rule: string;
  summary: string;
}

export interface ReferenceClassification {
  role: ReferenceKind;
  access?: ReferenceAccess;
  macro: boolean;
  confidence: ReferenceConfidence;
  effect?: "pointee-write" | "reference-write";
  evidence: ReferenceClassificationEvidence[];
}

export interface ReferenceEvidence {
  sourceLine?: string;
  highlightKind?: number;
  macroSymbol?: boolean;
  callableSymbol?: boolean;
  parameterLabel?: string;
}

export interface ComparableLocation {
  uri: { toString(): string };
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export function classifyReference(
  location: ComparableLocation,
  definitions: ComparableLocation[],
  declarations: ComparableLocation[],
  sourceLine?: string,
): ReferenceKind {
  if (definitions.some((candidate) => sameLocation(location, candidate))) {
    return "definition";
  }
  if (declarations.some((candidate) => sameLocation(location, candidate))) {
    return "declaration";
  }
  if (sourceLine && looksLikeFunctionCall(sourceLine, location.range.start.character)) {
    return "call";
  }
  return "reference";
}

export function looksLikeFunctionCall(
  sourceLine: string,
  character: number,
): boolean {
  const start = Math.max(0, Math.min(character, sourceLine.length));
  const tail = sourceLine.slice(start);
  const identifier = tail.match(/^[A-Za-z_~][A-Za-z0-9_]*/)?.[0];
  if (!identifier) {
    return false;
  }
  return /^\s*\(/.test(tail.slice(identifier.length));
}

export function referenceKindLabel(kind: ReferenceKind): string {
  switch (kind) {
    case "definition":
      return "Definition";
    case "declaration":
      return "Declaration";
    case "call":
      return "Function Call";
    case "reference":
      return "Reference";
  }
}

export function enhanceReferenceClassification(
  location: ComparableLocation,
  role: ReferenceKind,
  evidence: ReferenceEvidence,
): ReferenceClassification {
  const source = evidence.sourceLine;
  const character = location.range.start.character;
  const classificationEvidence: ReferenceClassificationEvidence[] = [];
  if (evidence.macroSymbol) {
    classificationEvidence.push({
      source: "symbol-metadata",
      rule: "macro.symbol",
      summary: "The queried symbol is defined as a preprocessor macro.",
    });
  }
  if (source && isMacroDirectiveReference(source, character)) {
    classificationEvidence.push({
      source: "source-syntax",
      rule: "macro.directive",
      summary: "The reference appears in a preprocessor directive.",
    });
  }
  const macro = classificationEvidence.length > 0;

  if (role === "definition" || role === "declaration" || role === "call") {
    const primary: ReferenceClassificationEvidence =
      role === "call"
        ? {
            source: "source-syntax",
            rule: "role.call",
            summary: "The identifier is followed by a function-call argument list.",
          }
        : {
            source: "clangd-result",
            rule: `role.${role}`,
            summary: `The location matches a clangd ${role} result.`,
          };
    return classified(
      role,
      macro,
      role === "call" ? "syntax" : "semantic",
      classificationEvidence,
      primary,
    );
  }
  if (source && isAddressAcquisition(source, character)) {
    return classified(role, macro, "syntax", classificationEvidence, {
      source: "source-syntax",
      rule: "access.address-of",
      summary: "A unary address-of operator is applied to the identifier.",
    }, "address");
  }
  if (source && isReadWriteUse(source, character)) {
    return classified(role, macro, "syntax", classificationEvidence, {
      source: "source-syntax",
      rule: "access.readwrite-operator",
      summary: "An increment, decrement, or compound-assignment operator reads and writes the identifier.",
    }, "readwrite");
  }
  if (source && isIndirectWrite(source, character)) {
    return classified(role, macro, "syntax", classificationEvidence, {
      source: "source-syntax",
      rule: "effect.pointee-write",
      summary: "An assignment writes through this pointer to the pointed-to object.",
    }, "read", "pointee-write");
  }
  const parameterEffect = evidence.parameterLabel
    ? classifyParameterEffect(evidence.parameterLabel)
    : undefined;
  if (parameterEffect === "reference-write") {
    return classified(role, macro, "inferred", classificationEvidence, {
      source: "clangd-signature",
      rule: "effect.mutable-reference-argument",
      summary: `clangd maps the argument to mutable reference parameter “${evidence.parameterLabel}”.`,
    }, "readwrite", "reference-write");
  }
  if (parameterEffect === "pointee-write") {
    return classified(role, macro, "inferred", classificationEvidence, {
      source: "clangd-signature",
      rule: "effect.mutable-pointer-argument",
      summary: `clangd maps the argument to pointer parameter “${evidence.parameterLabel}”, which permits writing the pointed-to object.`,
    }, "read", "pointee-write");
  }
  // LSP DocumentHighlightKind.Read = 2, Write = 3.
  if (evidence.highlightKind === 2) {
    return classified(role, macro, "semantic", classificationEvidence, {
      source: "clangd-highlight",
      rule: "access.highlight-read",
      summary: "clangd Document Highlight classifies the occurrence as a read.",
    }, "read");
  }
  if (evidence.highlightKind === 3) {
    return classified(role, macro, "semantic", classificationEvidence, {
      source: "clangd-highlight",
      rule: "access.highlight-write",
      summary: "clangd Document Highlight classifies the occurrence as a write.",
    }, "write");
  }
  if (source && isSimpleWrite(source, character)) {
    return classified(role, macro, "syntax", classificationEvidence, {
      source: "source-syntax",
      rule: "access.simple-assignment",
      summary: "A simple assignment operator follows the identifier.",
    }, "write");
  }
  if (evidence.callableSymbol && source) {
    const tail = source.slice(identifierEnd(source, character));
    if (!/^\s*\(/.test(tail)) {
      return classified(role, macro, "inferred", classificationEvidence, {
        source: "symbol-metadata",
        rule: "access.callable-non-call",
        summary: "A callable symbol is used without a call argument list, so its address is likely used.",
      }, "address");
    }
  }
  return classified(role, macro, "unknown", classificationEvidence, {
    source: "fallback",
    rule: "reference.unclassified",
    summary: "No supported semantic or syntax rule classified this occurrence.",
  });
}

export function referenceClassificationExplanation(
  classification: ReferenceClassification,
): string {
  const evidence = classification.evidence
    .map((item) => `${item.source} [${item.rule}]: ${item.summary}`)
    .join("\n");
  return `Confidence: ${confidenceLabel(classification.confidence)}\nEvidence:\n${evidence}`;
}

function classified(
  role: ReferenceKind,
  macro: boolean,
  confidence: ReferenceConfidence,
  existingEvidence: ReferenceClassificationEvidence[],
  primaryEvidence: ReferenceClassificationEvidence,
  access?: ReferenceAccess,
  effect?: ReferenceClassification["effect"],
): ReferenceClassification {
  return {
    role,
    access,
    macro,
    confidence,
    effect,
    evidence: [...existingEvidence, primaryEvidence],
  };
}

function confidenceLabel(confidence: ReferenceConfidence): string {
  return confidence[0].toUpperCase() + confidence.slice(1);
}

export function referenceClassificationLabel(
  classification: ReferenceClassification,
): string {
  const labels: string[] = [];
  if (classification.macro) {
    labels.push("Macro");
  }
  if (classification.access) {
    labels.push(accessLabel(classification.access));
  } else {
    labels.push(referenceKindLabel(classification.role));
  }
  if (classification.effect === "pointee-write") {
    labels.push("Pointee Write");
  } else if (classification.effect === "reference-write") {
    labels.push("Reference Write");
  }
  const label = labels.join(" · ");
  return classification.confidence === "inferred"
    ? `${label} (inferred)`
    : label;
}

export function referenceTypeGroup(
  classification: ReferenceClassification,
): string {
  switch (classification.access) {
    case "read":
      return "Reads";
    case "write":
      return "Writes";
    case "readwrite":
      return "Read/Writes";
    case "address":
      return "Addresses";
  }
  switch (classification.role) {
    case "definition":
      return "Definitions";
    case "declaration":
      return "Declarations";
    case "call":
      return "Function Calls";
    case "reference":
      return "Other References";
  }
}

export function isReadWriteUse(
  sourceLine: string,
  character: number,
): boolean {
  const start = clampCharacter(sourceLine, character);
  const end = identifierEnd(sourceLine, start);
  const before = sourceLine.slice(0, start);
  const after = sourceLine.slice(end);
  return (
    /(?:\+\+|--)\s*$/.test(before) ||
    /^\s*(?:\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=)/.test(
      after,
    )
  );
}

export function isSimpleWrite(
  sourceLine: string,
  character: number,
): boolean {
  const end = identifierEnd(sourceLine, clampCharacter(sourceLine, character));
  return /^\s*=(?!=)/.test(sourceLine.slice(end));
}

export function isAddressAcquisition(
  sourceLine: string,
  character: number,
): boolean {
  const before = sourceLine
    .slice(0, clampCharacter(sourceLine, character))
    .replace(/\s+$/, "");
  if (!before.endsWith("&")) {
    return false;
  }
  if (before.endsWith("&&")) {
    return false;
  }
  const prefix = before.slice(0, -1).replace(/\s+$/, "");
  return (
    prefix.length === 0 ||
    /(?:^|[({[,=!:?;+\-*/%|^~<>])$/.test(prefix) ||
    /\b(?:return|case|sizeof|alignof)\s*$/.test(prefix)
  );
}

export function isIndirectWrite(
  sourceLine: string,
  character: number,
): boolean {
  const start = clampCharacter(sourceLine, character);
  const end = identifierEnd(sourceLine, start);
  const before = sourceLine.slice(0, start).replace(/\s+$/, "");
  const after = sourceLine.slice(end);
  if (
    before.endsWith("*") &&
    !/[A-Za-z0-9_)\]]\s*\*$/.test(before) &&
    /^\s*=(?!=)/.test(after)
  ) {
    return true;
  }
  return /^\s*->[^;=]*=(?!=)/.test(after);
}

export function classifyParameterEffect(
  parameterLabel: string,
): ReferenceClassification["effect"] | undefined {
  const normalized = parameterLabel.replace(/\s+/g, " ").trim();
  if (/&&/.test(normalized)) {
    return undefined;
  }
  const reference = normalized.indexOf("&");
  if (reference >= 0) {
    return /\bconst\b/.test(normalized.slice(0, reference))
      ? undefined
      : "reference-write";
  }
  const pointer = normalized.indexOf("*");
  if (pointer >= 0) {
    return /\bconst\b/.test(normalized.slice(0, pointer))
      ? undefined
      : "pointee-write";
  }
  return undefined;
}

export function isMacroDirectiveReference(
  sourceLine: string,
  character: number,
): boolean {
  const before = sourceLine.slice(0, clampCharacter(sourceLine, character));
  return /^\s*#\s*(?:define|undef|ifdef|ifndef|if|elif)\b/.test(before);
}

export function isMacroDefinitionLine(sourceLine: string): boolean {
  return /^\s*#\s*define\b/.test(sourceLine);
}

function accessLabel(access: ReferenceAccess): string {
  switch (access) {
    case "read":
      return "Read";
    case "write":
      return "Write";
    case "readwrite":
      return "Read/Write";
    case "address":
      return "Address";
  }
}

function clampCharacter(source: string, character: number): number {
  return Math.max(0, Math.min(character, source.length));
}

function identifierEnd(source: string, character: number): number {
  const start = clampCharacter(source, character);
  return start + (source.slice(start).match(/^[A-Za-z_~][A-Za-z0-9_]*/)?.[0].length ?? 0);
}

function sameLocation(
  left: ComparableLocation,
  right: ComparableLocation,
): boolean {
  return (
    left.uri.toString() === right.uri.toString() &&
    left.range.start.line === right.range.start.line &&
    left.range.start.character === right.range.start.character &&
    left.range.end.line === right.range.end.line &&
    left.range.end.character === right.range.end.character
  );
}
