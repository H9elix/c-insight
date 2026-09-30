import type { Position, Range } from "vscode-languageclient/node";

export type MemberAccessOperator = "." | "->";

export interface MemberAccessPathSegment {
  name: string;
  start: number;
  end: number;
  operator: MemberAccessOperator;
}

export interface MemberAccessChain {
  rootName: string;
  rootStart: number;
  rootEnd: number;
  segments: MemberAccessPathSegment[];
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
    path?: Array<Pick<MemberAccessPathSegment, "name" | "operator">>;
  };
}

export type MemberCallerOccurrenceScope =
  | "same-variable"
  | "other-variable"
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
    anchor?.path?.map((segment) => `${segment.operator}${segment.name}`).join("") ??
      `${anchor?.operator ?? ""}${scope.memberName}`,
  ].join(":");
}

export function locationKey(
  uri: string,
  position: Position,
): string {
  return `${uri}:${position.line}:${position.character}`;
}

/**
 * Finds a member-access chain rooted at a simple named variable. Calls,
 * subscripts, casts, dereferences, and other runtime-selected roots remain
 * unresolved instead of being guessed.
 */
export function parseMemberAccessChain(
  source: string,
  memberStart: number,
): MemberAccessChain | undefined {
  if (memberStart <= 0 || memberStart > source.length) {
    return undefined;
  }
  const masked = maskCommentsAndStrings(source);
  const memberEnd = identifierEnd(masked, memberStart);
  if (!isIdentifier(masked.slice(memberStart, memberEnd))) {
    return undefined;
  }
  let current = {
    name: source.slice(memberStart, memberEnd),
    start: memberStart,
    end: memberEnd,
    expressionStart: memberStart,
  };
  const reversed: MemberAccessPathSegment[] = [];
  while (true) {
    const access = accessOperatorBefore(masked, current.expressionStart);
    if (!access) {
      break;
    }
    const left = simpleOperandBefore(masked, source, access.start - 1);
    if (!left) {
      return undefined;
    }
    reversed.push({
      name: current.name,
      start: current.start,
      end: current.end,
      operator: access.operator,
    });
    current = left;
    if (left.parenthesized) {
      break;
    }
  }
  if (reversed.length === 0 || current.name === "this") {
    return undefined;
  }
  return {
    rootName: current.name,
    rootStart: current.start,
    rootEnd: current.end,
    segments: reversed.reverse(),
  };
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

export function offsetAtPosition(source: string, position: Position): number {
  let offset = 0;
  for (let line = 0; line < position.line && offset < source.length; line += 1) {
    const newline = source.indexOf("\n", offset);
    offset = newline < 0 ? source.length : newline + 1;
  }
  return Math.min(source.length, offset + position.character);
}

export function positionAtOffset(source: string, requestedOffset: number): Position {
  const offset = Math.max(0, Math.min(source.length, requestedOffset));
  let line = 0;
  let lineStart = 0;
  for (let cursor = 0; cursor < offset; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) {
      line += 1;
      lineStart = cursor + 1;
    }
  }
  return { line, character: offset - lineStart };
}

function accessOperatorBefore(
  source: string,
  expressionStart: number,
): { operator: MemberAccessOperator; start: number } | undefined {
  const cursor = skipWhitespaceBackward(source, expressionStart - 1);
  if (source[cursor] === ".") {
    return { operator: ".", start: cursor };
  }
  return source[cursor] === ">" && source[cursor - 1] === "-"
    ? { operator: "->", start: cursor - 1 }
    : undefined;
}

function simpleOperandBefore(
  masked: string,
  source: string,
  from: number,
): {
  name: string;
  start: number;
  end: number;
  expressionStart: number;
  parenthesized?: boolean;
} | undefined {
  let cursor = skipWhitespaceBackward(masked, from);
  if (masked[cursor] === ")") {
    const close = cursor;
    const open = matchingOpenParenthesis(masked, close);
    if (open < 0) {
      return undefined;
    }
    const start = skipWhitespaceForward(masked, open + 1);
    const end = skipWhitespaceBackward(masked, close - 1) + 1;
    const before = skipWhitespaceBackward(masked, open - 1);
    if (
      !isIdentifier(masked.slice(start, end)) ||
      (before >= 0 &&
        (isIdentifierPart(masked[before]) ||
          masked[before] === ")" ||
          masked[before] === "]"))
    ) {
      return undefined;
    }
    return {
      name: source.slice(start, end),
      start,
      end,
      expressionStart: open,
      parenthesized: true,
    };
  }
  const end = cursor + 1;
  while (cursor >= 0 && isIdentifierPart(masked[cursor])) {
    cursor -= 1;
  }
  const start = cursor + 1;
  if (!isIdentifier(masked.slice(start, end))) {
    return undefined;
  }
  return {
    name: source.slice(start, end),
    start,
    end,
    expressionStart: start,
  };
}

function identifierEnd(source: string, start: number): number {
  let end = start;
  while (end < source.length && isIdentifierPart(source[end])) {
    end += 1;
  }
  return end;
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
