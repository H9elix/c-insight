export function highlightCppLine(line: string): string {
  const tokenPattern =
    /(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:alignas|alignof|auto|bool|break|case|catch|char|class|const|constexpr|continue|default|delete|do|double|else|enum|explicit|extern|false|float|for|friend|if|inline|int|long|namespace|new|nullptr|operator|override|private|protected|public|return|short|signed|sizeof|static|struct|switch|template|this|throw|true|try|typedef|typename|union|unsigned|using|virtual|void|volatile|while)\b|\b\d+(?:\.\d+)?\b)/g;
  let output = "";
  let cursor = 0;
  for (const match of line.matchAll(tokenPattern)) {
    const index = match.index;
    output += escapeHtml(line.slice(cursor, index));
    const token = match[0];
    const className = token.startsWith("//")
      ? "comment"
      : token.startsWith('"') || token.startsWith("'")
        ? "str"
        : /^\d/.test(token)
          ? "num"
          : "kw";
    output += `<span class="${className}">${escapeHtml(token)}</span>`;
    cursor = index + token.length;
    if (className === "comment") {
      break;
    }
  }
  output += escapeHtml(line.slice(cursor));
  return output || " ";
}

export function highlightTarget(
  source: string,
  start: number,
  end: number,
): string {
  const safeStart = Math.max(0, Math.min(start, source.length));
  const safeEnd = Math.max(safeStart, Math.min(end, source.length));
  if (safeStart === safeEnd) {
    return highlightCppLine(source);
  }
  const before = source.slice(0, safeStart);
  const target = source.slice(safeStart, safeEnd);
  const after = source.slice(safeEnd);
  return (
    (before ? highlightCppLine(before) : "") +
    `<mark class="target-symbol">${highlightCppLine(target)}</mark>` +
    (after ? highlightCppLine(after) : "")
  );
}

export interface SemanticTokenLegendLike {
  tokenTypes: readonly string[];
  tokenModifiers: readonly string[];
}

export interface SemanticTokenSpan {
  line: number;
  start: number;
  length: number;
  type: string;
  modifiers: readonly string[];
}

export interface PreviewTargetRangeLike {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/**
 * Returns an inline highlight only when the provider identified a target on a
 * single source line. Multi-line ranges often describe a declaration body or
 * another navigation container and must not visually mark every line in it.
 */
export function previewTargetSpan(
  range: PreviewTargetRangeLike,
  line: number,
  sourceLength: number,
): { start: number; end: number } | undefined {
  if (
    range.start.line !== range.end.line ||
    line !== range.start.line
  ) {
    return undefined;
  }
  const start = Math.max(0, Math.min(range.start.character, sourceLength));
  const end = Math.max(start, Math.min(range.end.character, sourceLength));
  return { start, end };
}

export function decodeSemanticTokens(
  data: Uint32Array,
  legend: SemanticTokenLegendLike,
  startLine: number,
  endLine: number,
): Map<number, SemanticTokenSpan[]> {
  const result = new Map<number, SemanticTokenSpan[]>();
  let line = 0;
  let start = 0;
  for (let index = 0; index + 4 < data.length; index += 5) {
    const deltaLine = data[index];
    line += deltaLine;
    start = deltaLine === 0 ? start + data[index + 1] : data[index + 1];
    if (line < startLine || line > endLine) {
      continue;
    }
    const type = legend.tokenTypes[data[index + 3]];
    if (!type) {
      continue;
    }
    const modifierBits = data[index + 4];
    const modifiers = legend.tokenModifiers.filter(
      (_modifier, bit) => bit < 32 && (modifierBits & (1 << bit)) !== 0,
    );
    const span: SemanticTokenSpan = {
      line,
      start,
      length: data[index + 2],
      type,
      modifiers,
    };
    const lineTokens = result.get(line);
    if (lineTokens) {
      lineTokens.push(span);
    } else {
      result.set(line, [span]);
    }
  }
  return result;
}

export function highlightSemanticLine(
  source: string,
  tokens: readonly SemanticTokenSpan[],
  target?: { start: number; end: number },
): string {
  const normalized = tokens
    .map((token) => ({
      ...token,
      start: Math.max(0, Math.min(token.start, source.length)),
      length: Math.max(
        0,
        Math.min(token.start + token.length, source.length) -
          Math.max(0, token.start),
      ),
    }))
    .filter((token) => token.length > 0)
    .sort((left, right) => left.start - right.start);
  const targetStart = target
    ? Math.max(0, Math.min(target.start, source.length))
    : -1;
  const targetEnd = target
    ? Math.max(targetStart, Math.min(target.end, source.length))
    : -1;
  const boundaries = new Set<number>([0, source.length]);
  for (const token of normalized) {
    boundaries.add(token.start);
    boundaries.add(token.start + token.length);
  }
  if (targetStart !== targetEnd) {
    boundaries.add(targetStart);
    boundaries.add(targetEnd);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  let output = "";
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (start === end) {
      continue;
    }
    const token = normalized.find(
      (candidate) =>
        candidate.start <= start &&
        candidate.start + candidate.length >= end,
    );
    const text = source.slice(start, end);
    let segment = token
      ? `<span class="${semanticTokenClasses(token)}">${escapeHtml(text)}</span>`
      : highlightCppLine(text);
    if (targetStart <= start && targetEnd >= end) {
      segment = `<mark class="target-symbol">${segment}</mark>`;
    }
    output += segment;
  }
  return output || " ";
}

function semanticTokenClasses(token: SemanticTokenSpan): string {
  const classes = ["sem", `sem-${cssIdentifier(token.type)}`];
  if (NAVIGABLE_SEMANTIC_TOKEN_TYPES.has(token.type)) {
    classes.push("sem-navigable");
  }
  for (const modifier of token.modifiers) {
    classes.push(`sem-mod-${cssIdentifier(modifier)}`);
  }
  return classes.join(" ");
}

const NAVIGABLE_SEMANTIC_TOKEN_TYPES = new Set([
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "label",
  "decorator",
]);

function cssIdentifier(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "-");
  return safe || "unknown";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
