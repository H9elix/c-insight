export type ReferenceKind =
  | "definition"
  | "declaration"
  | "call"
  | "reference";

export type ReferenceAccess = "read" | "write" | "readwrite" | "address";
export type ReferenceConfidence = "semantic" | "syntax" | "inferred" | "unknown";

export interface ReferenceClassification {
  role: ReferenceKind;
  access?: ReferenceAccess;
  macro: boolean;
  confidence: ReferenceConfidence;
}

export interface ReferenceEvidence {
  sourceLine?: string;
  highlightKind?: number;
  macroSymbol?: boolean;
  callableSymbol?: boolean;
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
  const macro =
    Boolean(evidence.macroSymbol) ||
    Boolean(source && isMacroDirectiveReference(source, character));

  if (role === "definition" || role === "declaration" || role === "call") {
    return {
      role,
      macro,
      confidence: role === "call" ? "syntax" : "semantic",
    };
  }
  if (source && isAddressAcquisition(source, character)) {
    return { role, access: "address", macro, confidence: "syntax" };
  }
  if (source && isReadWriteUse(source, character)) {
    return { role, access: "readwrite", macro, confidence: "syntax" };
  }
  // LSP DocumentHighlightKind.Read = 2, Write = 3.
  if (evidence.highlightKind === 2) {
    return { role, access: "read", macro, confidence: "semantic" };
  }
  if (evidence.highlightKind === 3) {
    return { role, access: "write", macro, confidence: "semantic" };
  }
  if (source && isSimpleWrite(source, character)) {
    return { role, access: "write", macro, confidence: "syntax" };
  }
  if (evidence.callableSymbol && source) {
    const tail = source.slice(identifierEnd(source, character));
    if (!/^\s*\(/.test(tail)) {
      return { role, access: "address", macro, confidence: "inferred" };
    }
  }
  return { role, macro, confidence: "unknown" };
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
