import { createHash } from "node:crypto";

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  multiline: boolean;
}
export interface TextMatch {
  start: number;
  end: number;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  snippet: string;
  highlightStart: number;
  highlightEnd: number;
  value: string;
  captures: (string | undefined)[];
  groups?: Record<string, string | undefined>;
}
export interface MatchResult { matches: TextMatch[]; truncated: boolean }
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  query: "", caseSensitive: false, wholeWord: false, regex: false, multiline: false,
};
export function searchExpression(options: SearchOptions): RegExp {
  if (!options.query) throw new Error("Enter search text.");
  const pattern = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(pattern, `gu${options.caseSensitive ? "" : "i"}${options.multiline ? "ms" : "m"}`);
}
export function contentHash(text: string): string { return createHash("sha256").update(text).digest("hex"); }
const word = (text: string): boolean => /[\p{L}\p{N}_]/u.test(text);
function before(text: string, offset: number): string {
  return offset > 0 ? String.fromCodePoint(text.codePointAt(offset - (offset > 1 && /[\uDC00-\uDFFF]/.test(text[offset - 1]) ? 2 : 1))!) : "";
}

/** Runs only in a terminable worker for user expressions. Offsets are UTF-16, as in VS Code. */
export function findMatches(text: string, options: SearchOptions, maximum: number, positions?: readonly number[]): MatchResult {
  const base = searchExpression(options);
  const expression = positions ? new RegExp(base.source, base.flags + "y") : base;
  let indexed = false;
  const starts = [0];
  const position = (offset: number): [number, number] => {
    if (!indexed) {
      for (let index = 0; index < text.length; index++) if (text[index] === "\n") starts.push(index + 1);
      indexed = true;
    }
    let low = 0, high = starts.length;
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle; else high = middle; }
    return [low, offset - starts[low]];
  };
  const matches: TextMatch[] = [];
  let payload = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;
  while (true) {
    if (positions) {
      if (cursor >= positions.length) break;
      expression.lastIndex = positions[cursor++];
    }
    match = expression.exec(text);
    if (!match) { if (positions) continue; else break; }
    if (positions && match.index !== positions[cursor - 1]) continue;
    const start = match.index, end = start + match[0].length;
    const next = text.codePointAt(end);
    if (!options.wholeWord || (!word(before(text, start)) && !word(next === undefined ? "" : String.fromCodePoint(next)))) {
      if (matches.length >= maximum) return {matches, truncated: true};
      payload += match.reduce((sum, value) => sum + (value?.length ?? 0), 0);
      if (payload > 1024 * 1024) throw new Error("Match payload limit.");
      const [line, character] = position(start), [endLine, endCharacter] = position(end);
      const snippetStart = Math.max(starts[line], start - 120);
      const lineEnd = text.indexOf("\n", start);
      const snippetEnd = Math.min(lineEnd < 0 ? text.length : lineEnd, start + 300);
      matches.push({start, end, line, character, endLine, endCharacter,
        snippet: text.slice(snippetStart, snippetEnd).replace(/\r$/, ""),
        highlightStart: start - snippetStart, highlightEnd: Math.min(end, snippetEnd) - snippetStart,
        value: match[0], captures: match.slice(1), groups: match.groups});
    }
    if (!match[0].length) {
      const point = text.codePointAt(expression.lastIndex);
      expression.lastIndex += point !== undefined && point > 0xffff ? 2 : 1;
    }
  }
  return {matches, truncated: false};
}

export function replacementText(text: string, match: TextMatch, replacement: string, regex: boolean, preserveCase: boolean): string {
  const expand = (whole: string, key: string): string => {
    if (key === "$") return "$";
    if (key === "&") return match.value;
    if (key === "`") return text.slice(0, match.start);
    if (key === "'") return text.slice(match.end);
    if (key.startsWith("<")) return match.groups ? match.groups[key.slice(1, -1)] ?? "" : whole;
    const index = Number(key);
    if (index > 0 && index <= match.captures.length) return match.captures[index - 1] ?? "";
    const first = Number(key[0]);
    return key.length === 2 && first > 0 && first <= match.captures.length ? (match.captures[first - 1] ?? "") + key[1] : whole;
  };
  let result = replacement;
  if (regex) {
    const pieces: string[] = []; let offset = 0, length = 0;
    for (const token of replacement.matchAll(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g)) {
      const prefix = replacement.slice(offset, token.index), value = expand(token[0], token[1]);
      length += prefix.length + value.length;
      if (length > 32 * 1024 * 1024) throw new Error("Replacement text limit.");
      pieces.push(prefix, value); offset = token.index + token[0].length;
    }
    pieces.push(replacement.slice(offset)); result = pieces.join("");
  }
  if (preserveCase && match.value.toLowerCase() !== match.value.toUpperCase()) {
    if (match.value === match.value.toUpperCase()) result = result.toUpperCase();
    else if (match.value === match.value.toLowerCase()) result = result.toLowerCase();
    else if (match.value[0] === match.value[0].toUpperCase() && match.value.slice(1) === match.value.slice(1).toLowerCase()) {
      result = (result[0]?.toUpperCase() ?? "") + result.slice(1).toLowerCase();
    }
  }
  return result;
}

export function applyMatches(text: string, matches: TextMatch[], replacement: string, regex: boolean, preserveCase: boolean): string {
  const pieces: string[] = []; let offset = 0, length = 0;
  for (const match of [...matches].sort((a, b) => a.start - b.start)) {
    if (match.start < offset || match.end < match.start || match.end > text.length) throw new Error("Invalid replacement range.");
    const prefix = text.slice(offset, match.start), value = replacementText(text, match, replacement, regex, preserveCase);
    length += prefix.length + value.length;
    if (length > 32 * 1024 * 1024) throw new Error("Replacement text limit.");
    pieces.push(prefix, value); offset = match.end;
  }
  if (length + text.length - offset > 32 * 1024 * 1024) throw new Error("Replacement text limit.");
  pieces.push(text.slice(offset)); return pieces.join("");
}
