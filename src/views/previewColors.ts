export type PreviewColorScheme = "theme" | "fixed-dark" | "fixed-light";

/** Keys are shared by semantic spans and the lexical fallback. No CSS input. */
export const PREVIEW_TOKEN_TYPES = [
  "namespace", "type", "class", "struct", "interface", "enum", "typeParameter",
  "function", "method", "variable", "parameter", "property", "enumMember",
  "event", "macro", "label", "decorator", "keyword", "string", "comment",
  "number", "operator",
] as const;

type TokenType = typeof PREVIEW_TOKEN_TYPES[number];

/** A guard test requires this to cover every non-color preview setting. */
export const PREVIEW_CONTENT_SETTINGS = [
  "linesBefore", "linesAfter", "semanticHighlighting", "semanticTokenTimeout",
  "semanticTokenCacheSize", "semanticTokenCacheMaximumMegabytes",
  "incrementalLoading", "loadBatchLines", "maximumLoadedLines",
  "restoreScrollPositions", "maximumScrollPositions",
] as const;

interface SurfaceColors {
  background: string;
  foreground: string;
  lineNumber: string;
  lineHighlight: string;
  focusBorder: string;
  matchBackground: string;
  matchBorder: string;
}

export interface PreviewColorStyle {
  scheme: PreviewColorScheme;
  css: string;
  invalidTokens: string[];
}

const keyword = "var(--vscode-symbolIcon-keywordForeground, #c586c0)";
const variable = "var(--vscode-symbolIcon-variableForeground, #9cdcfe)";
const type = "var(--vscode-symbolIcon-classForeground, #4ec9b0)";
const method = "var(--vscode-symbolIcon-methodForeground, #dcdcaa)";

const THEME_TOKENS: Record<TokenType, string> = {
  namespace: "var(--vscode-symbolIcon-namespaceForeground, #4ec9b0)",
  type, class: type, struct: type, interface: type, enum: type, typeParameter: type,
  function: method, method, variable, parameter: variable, property: variable,
  enumMember: variable, event: variable,
  macro: "var(--vscode-symbolIcon-constantForeground, #c586c0)",
  label: "var(--vscode-symbolIcon-keyForeground, #c8c8c8)",
  decorator: "var(--vscode-editor-foreground)",
  keyword,
  string: "var(--vscode-symbolIcon-stringForeground, #ce9178)",
  comment: "var(--vscode-editorLineNumber-foreground)",
  number: "var(--vscode-symbolIcon-numberForeground, #b5cea8)",
  operator: "var(--vscode-symbolIcon-operatorForeground, var(--vscode-editor-foreground))",
};

const DARK_TOKENS: Record<TokenType, string> = {
  namespace: "#4EC9B0", type: "#4EC9B0", class: "#4EC9B0", struct: "#4EC9B0",
  interface: "#4EC9B0", enum: "#4EC9B0", typeParameter: "#4EC9B0",
  function: "#DCDCAA", method: "#DCDCAA", variable: "#9CDCFE",
  parameter: "#9CDCFE", property: "#9CDCFE", enumMember: "#B5CEA8",
  event: "#9CDCFE", macro: "#C586C0", label: "#C8C8C8", decorator: "#DCDCAA",
  keyword: "#C586C0", string: "#CE9178", comment: "#6A9955",
  number: "#B5CEA8", operator: "#D4D4D4",
};

const LIGHT_TOKENS: Record<TokenType, string> = {
  namespace: "#267F99", type: "#267F99", class: "#267F99", struct: "#267F99",
  interface: "#267F99", enum: "#267F99", typeParameter: "#267F99",
  function: "#795E26", method: "#795E26", variable: "#001080",
  parameter: "#001080", property: "#001080", enumMember: "#098658",
  event: "#001080", macro: "#AF00DB", label: "#000000", decorator: "#795E26",
  keyword: "#0000FF", string: "#A31515", comment: "#008000",
  number: "#098658", operator: "#000000",
};

const SURFACES: Record<PreviewColorScheme, SurfaceColors> = {
  theme: {
    background: "transparent", foreground: "var(--vscode-editor-foreground)",
    lineNumber: "var(--vscode-editorLineNumber-foreground)",
    lineHighlight: "var(--vscode-editor-selectionBackground)",
    focusBorder: "var(--vscode-focusBorder)",
    matchBackground: "var(--vscode-editor-findMatchHighlightBackground)",
    matchBorder: "var(--vscode-editor-findMatchHighlightBorder, var(--vscode-focusBorder))",
  },
  "fixed-dark": {
    background: "#1E1E1E", foreground: "#D4D4D4", lineNumber: "#858585",
    lineHighlight: "#264F78", focusBorder: "#007ACC",
    matchBackground: "#5B4B18", matchBorder: "#D7BA7D",
  },
  "fixed-light": {
    background: "#FFFFFF", foreground: "#000000", lineNumber: "#6E7681",
    lineHighlight: "#DCEBFA", focusBorder: "#007ACC",
    matchBackground: "#FFF2B2", matchBorder: "#B89500",
  },
};

export function previewColorStyle(scheme: unknown, overrides: unknown): PreviewColorStyle {
  const selected: PreviewColorScheme = scheme === "fixed-dark" || scheme === "fixed-light"
    ? scheme : "theme";
  const tokens = { ...(selected === "fixed-dark" ? DARK_TOKENS
    : selected === "fixed-light" ? LIGHT_TOKENS : THEME_TOKENS) };
  const invalidTokens: string[] = [];
  if (overrides !== undefined) {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      invalidTokens.push("tokenColors");
    } else {
      for (const [key, value] of Object.entries(overrides)) {
        if (!(PREVIEW_TOKEN_TYPES as readonly string[]).includes(key)) {
          if (!invalidTokens.includes("unknown token")) invalidTokens.push("unknown token");
        } else if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
          invalidTokens.push(key);
        } else {
          tokens[key as TokenType] = value.toUpperCase();
        }
      }
    }
  }
  const surfaces = Object.entries(SURFACES[selected])
    .map(([key, value]) => `--ci-preview-${key}: ${value};`);
  const colors = PREVIEW_TOKEN_TYPES.map(key => `--ci-preview-${key}: ${tokens[key]};`);
  const selectors: Partial<Record<TokenType, string[]>> = {
    keyword: [".kw", ".sem-modification"], string: [".str"],
    comment: [".comment"], number: [".num"],
  };
  const rules = PREVIEW_TOKEN_TYPES.map(key => {
    const names = [`.sem-${key}`, ...(selectors[key] ?? [])];
    return `${names.join(", ")} { color: var(--ci-preview-${key}); }`;
  });
  return {
    scheme: selected,
    css: `.code {\n${[...surfaces, ...colors].join("\n")}\n}\n${rules.join("\n")}`,
    invalidTokens,
  };
}
