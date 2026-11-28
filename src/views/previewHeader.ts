/** Plain display data shared by initial rendering and metadata-only updates. */
export interface PreviewHeader {
  kind: string;
  symbol: string;
  fileName: string;
  line: string;
  tooltip: string;
}

export function previewHeader(kind: string, title: string, relativePath = "", fullPath = "", targetLine?: number): PreviewHeader {
  const normalize = (value: string) => value.replaceAll("\\", "/");
  const fileName = normalize(relativePath || fullPath).split("/").at(-1) ?? "";
  const line = targetLine === undefined ? "" : `:${targetLine + 1}`;
  const candidate = title.trim();
  const paths = [relativePath, fullPath, fileName].filter(Boolean).map(normalize);
  const duplicate = candidate === kind || paths.includes(normalize(candidate).replace(/:\d+(?::\d+)?$/, ""));
  const symbol = duplicate ? "" : candidate;
  const tooltip = [...new Set([
    [kind, symbol].filter(Boolean).join(" · "),
    relativePath ? relativePath + line : "",
    fullPath ? fullPath + line : "",
  ].filter(Boolean))].join("\n");
  return {kind, symbol, fileName, line, tooltip};
}
