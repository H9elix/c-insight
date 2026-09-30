import type { Position, Range } from "vscode-languageclient/node";

export type MemberAccessOperator = "." | "->";

export interface DirectMemberAccess {
  baseName: string;
  baseStart: number;
  baseEnd: number;
  operator: MemberAccessOperator;
}

export interface MemberCallerScope {
  queryUri: string;
  queryPosition: Position;
  memberName: string;
  memberRange: Range;
  anchor?: {
    name: string;
    range: Range;
    operator: MemberAccessOperator;
  };
}

export type MemberCallerOccurrenceScope =
  | "same-variable"
  | "unresolved-variable";

export function memberCallerScopeKey(scope: MemberCallerScope): string {
  const anchor = scope.anchor;
  return [
    scope.queryUri,
    scope.memberRange.start.line,
    scope.memberRange.start.character,
    scope.memberName,
    anchor?.name ?? "unanchored",
    anchor?.range.start.line ?? -1,
    anchor?.range.start.character ?? -1,
  ].join(":");
}

export function locationKey(
  uri: string,
  position: Position,
): string {
  return `${uri}:${position.line}:${position.character}`;
}

/**
 * Finds only a simple, directly named base expression. More complex
 * expressions intentionally remain unresolved instead of being guessed.
 */
export function parseDirectMemberAccess(
  source: string,
  memberStart: number,
): DirectMemberAccess | undefined {
  if (memberStart <= 0 || memberStart > source.length) {
    return undefined;
  }
  const masked = maskCommentsAndStrings(source);
  let cursor = skipWhitespaceBackward(masked, memberStart - 1);
  const operator = memberAccessOperator(masked, memberStart);
  if (!operator) {
    return undefined;
  }
  cursor -= operator === "->" ? 2 : 1;
  cursor = skipWhitespaceBackward(masked, cursor);

  let baseStart: number;
  let baseEnd: number;
  if (masked[cursor] === ")") {
    const close = cursor;
    const open = matchingOpenParenthesis(masked, close);
    if (open < 0) {
      return undefined;
    }
    const innerStart = skipWhitespaceForward(masked, open + 1);
    const innerEnd = skipWhitespaceBackward(masked, close - 1) + 1;
    if (
      innerEnd <= innerStart ||
      !isIdentifier(masked.slice(innerStart, innerEnd))
    ) {
      return undefined;
    }
    const beforeParenthesis = skipWhitespaceBackward(masked, open - 1);
    if (beforeParenthesis >= 0 && isIdentifierPart(masked[beforeParenthesis])) {
      return undefined;
    }
    baseStart = innerStart;
    baseEnd = innerEnd;
  } else {
    baseEnd = cursor + 1;
    while (cursor >= 0 && isIdentifierPart(masked[cursor])) {
      cursor -= 1;
    }
    baseStart = cursor + 1;
    if (!isIdentifier(masked.slice(baseStart, baseEnd))) {
      return undefined;
    }
    const beforeBase = skipWhitespaceBackward(masked, baseStart - 1);
    if (
      beforeBase >= 0 &&
      (masked[beforeBase] === "." ||
        masked[beforeBase] === ">" ||
        masked[beforeBase] === "]" ||
        masked[beforeBase] === ")")
    ) {
      return undefined;
    }
  }

  const baseName = source.slice(baseStart, baseEnd);
  if (baseName === "this") {
    return undefined;
  }
  return { baseName, baseStart, baseEnd, operator };
}

export function memberAccessOperator(
  source: string,
  memberStart: number,
): MemberAccessOperator | undefined {
  const masked = maskCommentsAndStrings(source);
  const cursor = skipWhitespaceBackward(masked, memberStart - 1);
  if (masked[cursor] === ".") {
    return ".";
  }
  return masked[cursor] === ">" && masked[cursor - 1] === "-"
    ? "->"
    : undefined;
}

function matchingOpenParenthesis(source: string, close: number): number {
  let depth = 0;
  for (let cursor = close; cursor >= 0; cursor -= 1) {
    if (source[cursor] === ")") {
      depth += 1;
    } else if (source[cursor] === "(") {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
  }
  return -1;
}

function skipWhitespaceBackward(source: string, from: number): number {
  let cursor = from;
  while (cursor >= 0 && /\s/.test(source[cursor])) {
    cursor -= 1;
  }
  return cursor;
}

function skipWhitespaceForward(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isIdentifierPart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function maskCommentsAndStrings(source: string): string {
  const output = [...source];
  let state: "code" | "line-comment" | "block-comment" | "single" | "double" = "code";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (current === "\n") {
        state = "code";
      } else {
        output[index] = " ";
      }
      continue;
    }
    if (state === "block-comment") {
      output[index] = current === "\n" ? "\n" : " ";
      if (current === "*" && next === "/") {
        output[index + 1] = " ";
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "single" || state === "double") {
      output[index] = current === "\n" ? "\n" : " ";
      if (current === "\\") {
        if (index + 1 < output.length) {
          output[index + 1] = source[index + 1] === "\n" ? "\n" : " ";
          index += 1;
        }
      } else if (
        (state === "single" && current === "'") ||
        (state === "double" && current === '"')
      ) {
        state = "code";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      output[index] = output[index + 1] = " ";
      state = "line-comment";
      index += 1;
    } else if (current === "/" && next === "*") {
      output[index] = output[index + 1] = " ";
      state = "block-comment";
      index += 1;
    } else if (current === "'") {
      output[index] = " ";
      state = "single";
    } else if (current === '"') {
      output[index] = " ";
      state = "double";
    }
  }
  return output.join("");
}
