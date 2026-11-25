import { RegExpParser, visitRegExpAST, type AST } from "@eslint-community/regexpp";
import type { SearchOptions } from "./searchModel";
import { globList } from "./fileRules";

/** Compatibility with VS Code's workspace QueryBuilder/ripgrep argument conventions (MIT, Microsoft). */
export function nativeQuery(options: SearchOptions): {pattern: string; fixed: boolean; multiline: boolean} {
  if (!options.query) throw new Error("Enter search text.");
  const query = options.query.replace(/\r\n/g, "\n");
  if (options.regex) new RegExp(query, "u"); // Validate syntax only; user expressions never execute on the host.
  let multiline = query.includes("\n");
  if (options.regex) for (let i = 0; i < query.length; i++) if (query[i] === "\\" && /[nrW]/.test(query[++i] ?? "")) {multiline = true; break;}
  const fixed = !options.regex && !options.wholeWord && !multiline;
  let pattern = options.regex ? query : query.replace(/[\\{}*+?|^$.[\]()]/g, "\\$&");
  if (options.wholeWord) {
    if (/\w/.test(query[0])) pattern = "\\b" + pattern;
    if (/\w/.test(query.at(-1)!)) pattern += "\\b";
  } else if (options.regex) pattern = fixRegexNewlines(pattern);
  pattern = pattern.replace(/\n/g, "\\r?\\n");
  const unicode = /((?:[^\\]|^)(?:\\\\)*)\\u(?:\{([\da-f]{1,6})\}|([\da-f]{4}))/gi;
  let previous: string;
  do {previous = pattern; pattern = pattern.replace(unicode, (_all, prefix: string, brace: string, plain: string) => `${prefix}\\x{${brace ?? plain}}`);} while (pattern !== previous);
  return {pattern: fixed ? query : pattern, fixed, multiline};
}

function fixRegexNewlines(pattern: string): string {
  const ast = new RegExpParser().parsePattern(pattern, 0, pattern.length, {unicode: true});
  const edits = new Map<number, {end: number; text: string}>();
  visitRegExpAST(ast, {onCharacterEnter(character) {
    if (character.raw !== "\\n") return;
    let parent: AST.Node | null = character.parent;
    while (parent) {
      if (parent.type === "Assertion" && parent.kind === "lookbehind") return;
      parent = "parent" in parent ? parent.parent : null;
    }
    const owner = character.parent;
    if (owner.type === "CharacterClass") {
      const other = owner.elements.filter(element => element.type !== "Character" || element.raw !== "\\n").map(element => element.raw).join("");
      const text = owner.negate ? owner.parent.type === "Quantifier" ? other ? `[^${other}]` : "." : `(?!\\r?\\n${other ? `|[${other}]` : ""})`
        : other ? `(?:[${other}]|\\r?\\n)` : "\\r?\\n";
      edits.set(owner.start, {end: owner.end, text});
    } else if (owner.type === "Quantifier" || owner.type === "Alternative") edits.set(character.start, {end: character.end, text: owner.type === "Quantifier" ? "(?:\\r?\\n)" : "\\r?\\n"});
  }});
  let result = "", start = 0;
  for (const [index, edit] of [...edits].sort(([a], [b]) => a - b)) {
    if (index < start) continue;
    result += pattern.slice(start, index) + edit.text; start = edit.end;
  }
  return result + pattern.slice(start);
}

export function nativeEncoding(value: string): string {
  const aliases: Record<string, string> = {utf8: "utf-8", utf8bom: "utf-8", utf16le: "utf-16le", utf16be: "utf-16be", shiftjis: "shift_jis"};
  return aliases[value.toLowerCase()] ?? value.replace(/^windows(\d+)$/, "windows-$1");
}

/** Native Search-box shorthand: bare names match at any depth; ./ anchors at the chosen root. */
export function searchGlobs(value: string): string[] {
  return globList(value).flatMap(raw => {
    let pattern = raw.replaceAll("\\", "/").replace(/\/+$/, "");
    const anchored = pattern.startsWith("./"); if (anchored) pattern = pattern.slice(2);
    if (!anchored && pattern.startsWith(".")) pattern = "*" + pattern;
    if (!anchored && !pattern.startsWith("**/")) pattern = "**/" + pattern;
    return [pattern, `${pattern}/**`];
  });
}

export interface NativeFileFilters {
  includes?: readonly string[]; excludes?: readonly string[]; exceptions?: readonly string[];
  useIgnores?: boolean; useParentIgnores?: boolean; useGlobalIgnores?: boolean; followSymlinks?: boolean;
  ignoreGlobCase?: boolean; encoding?: string; threads?: number; maximumFileBytes?: number;
}
export function nativeArgs(options: SearchOptions, filters: NativeFileFilters = {}, replacement?: string): string[] {
  const query = nativeQuery(options);
  const args = ["--no-config", "--hidden", "--no-require-git", "--json", "--color", "never", "--crlf",
    options.caseSensitive ? "--case-sensitive" : "--ignore-case"];
  if (query.fixed) args.push("--fixed-strings"); else args.push("--engine", "auto");
  if (query.multiline) args.push("--multiline");
  if (filters.useIgnores === false) args.push("--no-ignore");
  else {
    if (!filters.useParentIgnores) args.push("--no-ignore-parent");
    if (!filters.useGlobalIgnores) args.push("--no-ignore-global");
  }
  if (filters.followSymlinks) args.push("--follow");
  if (filters.ignoreGlobCase) args.push("--glob-case-insensitive", "--ignore-file-case-insensitive");
  if (filters.encoding) args.push("--encoding", nativeEncoding(filters.encoding));
  if (filters.maximumFileBytes && Number.isFinite(filters.maximumFileBytes)) args.push("--max-filesize", String(filters.maximumFileBytes));
  if (filters.threads && filters.threads > 0) args.push("--threads", String(Math.floor(filters.threads)));
  const includes = filters.exceptions ?? filters.includes ?? [];
  if (includes.some(pattern => !pattern.startsWith("**"))) args.push("--glob", "!*");
  for (const pattern of includes) {
    const pieces = pattern.split("/");
    if (!pattern.startsWith("**")) for (let i = 1; i < pieces.length; i++) {
      const parent = pieces.slice(0, i).join("/"); args.push("--glob", `/${parent}/`);
    }
    args.push("--glob", pattern.startsWith("**") ? pattern : `/${pattern}`);
  }
  for (const pattern of filters.excludes ?? []) args.push("--glob", `!${pattern.startsWith("**") ? pattern : `/${pattern}`}`);
  if (replacement !== undefined) args.push("--replace", replacement);
  args.push("--regexp", query.pattern);
  return args;
}
