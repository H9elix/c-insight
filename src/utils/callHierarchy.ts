import type { CallHierarchyItem } from "vscode-languageclient/node";

export function callHierarchyKey(item: CallHierarchyItem): string {
  return [
    item.uri,
    item.selectionRange.start.line,
    item.selectionRange.start.character,
    item.name,
  ].join(":");
}

export function isRecursiveCall(key: string, ancestors: readonly string[]): boolean {
  return ancestors.includes(key);
}

export function recursionKind(
  key: string,
  ancestors: readonly string[],
): "direct" | "indirect" | undefined {
  if (!isRecursiveCall(key, ancestors)) {
    return undefined;
  }
  return ancestors[ancestors.length - 1] === key ? "direct" : "indirect";
}

export function looksLikeExplicitIndirectCall(
  sourceLine: string,
  character: number,
): boolean {
  const before = sourceLine
    .slice(0, Math.max(0, Math.min(character, sourceLine.length)))
    .replace(/\s+$/, "");
  return (
    /\(\s*\*\s*$/.test(before) ||
    /(?:\.\*|->\*)\s*$/.test(before)
  );
}

export interface ExplicitIndirectCall {
  line: number;
  character: number;
  expression: string;
  kind: "function-pointer" | "member-function-pointer";
}

export function findExplicitIndirectCalls(
  sourceLines: readonly string[],
  startLine = 0,
): ExplicitIndirectCall[] {
  const calls: ExplicitIndirectCall[] = [];
  let inBlockComment = false;
  const patterns: Array<{
    expression: RegExp;
    kind: ExplicitIndirectCall["kind"];
  }> = [
    {
      expression: /\(\s*\*\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*\(/g,
      kind: "function-pointer",
    },
    {
      expression:
        /(?:[A-Za-z_][A-Za-z0-9_]*|\([^)]*\))\s*(?:\.\*|->\*)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*\(/g,
      kind: "member-function-pointer",
    },
  ];
  sourceLines.forEach((lineText, offset) => {
    const code = maskNonCode(lineText, inBlockComment);
    inBlockComment = code.inBlockComment;
    for (const { expression, kind } of patterns) {
      expression.lastIndex = 0;
      for (let match = expression.exec(code.text); match; match = expression.exec(code.text)) {
        const symbol = match[1];
        const withinMatch = match[0].indexOf(symbol);
        calls.push({
          line: startLine + offset,
          character: match.index + Math.max(0, withinMatch),
          expression: lineText.slice(match.index, expression.lastIndex).trim(),
          kind,
        });
      }
    }
  });
  return calls;
}

function maskNonCode(
  source: string,
  initiallyInBlockComment: boolean,
): { text: string; inBlockComment: boolean } {
  const output = [...source];
  let inBlockComment = initiallyInBlockComment;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const next = source[index + 1];
    if (inBlockComment) {
      output[index] = " ";
      if (source[index] === "*" && next === "/") {
        output[index + 1] = " ";
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      output[index] = " ";
      if (source[index] === "\\") {
        if (index + 1 < output.length) {
          output[index + 1] = " ";
          index += 1;
        }
      } else if (source[index] === quote) {
        quote = undefined;
      }
      continue;
    }
    if (source[index] === "/" && next === "/") {
      output.fill(" ", index);
      break;
    }
    if (source[index] === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (source[index] === "'" || source[index] === '"') {
      quote = source[index] as "'" | '"';
      output[index] = " ";
    }
  }
  return { text: output.join(""), inBlockComment };
}
