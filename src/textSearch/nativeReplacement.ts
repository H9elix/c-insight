import { randomBytes } from "node:crypto";
import { RegExpParser, visitRegExpAST } from "@eslint-community/regexpp";

/** Translate editor replacement tokens, not regex syntax; captures are expanded by the same native engine as search. */
export function nativeReplacement(query: string, replacement: string, text: string) {
  let count = 0, named = false;
  visitRegExpAST(new RegExpParser().parsePattern(query, 0, query.length, {unicode: true}), {onCapturingGroupEnter(group) {count++; named ||= !!group.name;}});
  let before: string, after: string;
  do {const nonce = randomBytes(16).toString("hex"); before = `\u0001CI_BEFORE_${nonce}\u0002`; after = `\u0001CI_AFTER_${nonce}\u0002`;} while (text.includes(before) || replacement.includes(before) || text.includes(after) || replacement.includes(after));
  const literal = (value: string): string => value.replaceAll("$", () => "$$");
  let template = "", offset = 0;
  for (const token of replacement.matchAll(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g)) {
    template += literal(replacement.slice(offset, token.index)); offset = token.index + token[0].length;
    const key = token[1];
    if (key === "$") template += "$$";
    else if (key === "&") template += "${0}";
    else if (key === "`") template += before;
    else if (key === "'") template += after;
    else if (key.startsWith("<")) template += named ? "${" + key.slice(1, -1) + "}" : literal(token[0]);
    else {
      const index = Number(key), first = Number(key[0]);
      if (index > 0 && index <= count) template += "${" + index + "}";
      else if (key.length === 2 && first > 0 && first <= count) template += "${" + first + "}" + key[1];
      else template += literal(token[0]);
    }
  }
  template += literal(replacement.slice(offset));
  return {template, expand(value: string, start: number, end: number): string {
    const pieces: string[] = []; let index = 0, length = 0;
    const append = (piece: string): void => {length += piece.length; if (length > 32 * 1024 * 1024) throw new Error("Replacement text limit."); pieces.push(piece);};
    while (index < value.length) {
      const a = value.indexOf(before, index), b = value.indexOf(after, index);
      const next = a < 0 ? b : b < 0 ? a : Math.min(a, b);
      if (next < 0) {append(value.slice(index)); break;}
      append(value.slice(index, next));
      if (next === a) {append(text.slice(0, start)); index = next + before.length;}
      else {append(text.slice(end)); index = next + after.length;}
    }
    return pieces.join("");
  }};
}
