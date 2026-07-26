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

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
