import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  PREVIEW_CONTENT_SETTINGS,
  PREVIEW_TOKEN_TYPES,
  previewColorStyle,
} from "../../src/views/previewColors";

describe("Code Preview fixed color palettes", () => {
  it("keeps the existing theme mapping as the default and invalid-scheme fallback", () => {
    const theme = previewColorStyle(undefined, {});
    assert.equal(theme.scheme, "theme");
    assert.match(theme.css, /--ci-preview-background: transparent;/);
    assert.match(theme.css, /--vscode-symbolIcon-methodForeground/);
    assert.match(theme.css, /--ci-preview-comment: var\(--vscode-editorLineNumber-foreground\)/);
    assert.equal(previewColorStyle("invalid", {}).css, theme.css);
  });

  it("makes fixed dark and light palettes independent of editor theme variables", () => {
    for (const scheme of ["fixed-dark", "fixed-light"]) {
      const result = previewColorStyle(scheme, {});
      assert.equal(result.scheme, scheme);
      assert.equal(result.invalidTokens.length, 0);
      assert.doesNotMatch(result.css, /--vscode-/);
      for (const token of PREVIEW_TOKEN_TYPES) {
        assert.match(result.css, new RegExp(`--ci-preview-${token}: #[0-9A-F]{6};`));
        assert(result.css.includes(`.sem-${token}`));
      }
    }
    assert.match(previewColorStyle("fixed-dark", {}).css, /--ci-preview-background: #1E1E1E;/);
    assert.match(previewColorStyle("fixed-light", {}).css, /--ci-preview-background: #FFFFFF;/);
    assert.notEqual(previewColorStyle("fixed-dark", {}).css, previewColorStyle("fixed-light", {}).css);
  });

  it("applies each category independently and preserves unspecified defaults", () => {
    const result = previewColorStyle("fixed-dark", {
      function: "#abcdef", property: "#112233", comment: "#445566",
    });
    assert.match(result.css, /--ci-preview-function: #ABCDEF;/);
    assert.match(result.css, /--ci-preview-method: #DCDCAA;/);
    assert.match(result.css, /--ci-preview-property: #112233;/);
    assert.match(result.css, /--ci-preview-variable: #9CDCFE;/);
    assert.match(result.css, /--ci-preview-comment: #445566;/);
    assert.match(previewColorStyle("theme", { function: "#123456" }).css,
      /--ci-preview-function: #123456;/);
  });

  it("rejects arbitrary CSS, alpha, shorthand, non-strings, and unknown keys", () => {
    const result = previewColorStyle("fixed-dark", {
      function: "red; } </style><script>bad</script>", property: "#fff",
      variable: "#12345678", parameter: 123, unknown: "#123456", comment: "#123456",
    });
    assert.deepEqual(result.invalidTokens, ["function", "property", "variable", "parameter", "unknown token"]);
    assert.match(result.css, /--ci-preview-function: #DCDCAA;/);
    assert.match(result.css, /--ci-preview-comment: #123456;/);
    assert.doesNotMatch(result.css, /script|unknown|red;/);
    for (const invalid of [null, [], "#112233", 3, false]) {
      assert.deepEqual(previewColorStyle("theme", invalid).invalidTokens, ["tokenColors"]);
    }
    assert.equal(previewColorStyle("theme", undefined).invalidTokens.length, 0);
  });

  it("does not mutate defaults or accept prototype keys", () => {
    previewColorStyle("fixed-dark", { function: "#000000" });
    assert.match(previewColorStyle("fixed-dark", {}).css, /--ci-preview-function: #DCDCAA;/);
    const result = previewColorStyle("fixed-dark", JSON.parse('{"__proto__":{"function":"#000000"}}'));
    assert.deepEqual(result.invalidTokens, ["unknown token"]);
    assert.match(result.css, /--ci-preview-function: #DCDCAA;/);
  });

  it("uses the same token color for semantic and lexical fallback classes", () => {
    const css = previewColorStyle("fixed-light", {}).css;
    for (const [type, lexical] of [["keyword", "kw"], ["string", "str"], ["comment", "comment"], ["number", "num"]]) {
      assert.match(css, new RegExp(`\\.sem-${type}[^\\n]*\\.${lexical}[^\\n]*\\{ color: var\\(--ci-preview-${type}\\); \\}`));
    }
  });
});

describe("Code Preview color configuration and Webview wiring", () => {
  const provider = readFileSync("src/views/codePreviewProvider.ts", "utf8");
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const properties = manifest.contributes.configuration.properties;

  it("declares compatible defaults, strict colors, and every content-setting invalidator", () => {
    assert.equal(properties["cInsight.codePreview.colorScheme"].default, "theme");
    assert.deepEqual(properties["cInsight.codePreview.colorScheme"].enum, ["theme", "fixed-dark", "fixed-light"]);
    const colors = properties["cInsight.codePreview.tokenColors"];
    assert.deepEqual(colors.default, {});
    assert.equal(colors.additionalProperties, false);
    assert.deepEqual(Object.keys(colors.properties).sort(), [...PREVIEW_TOKEN_TYPES].sort());
    for (const entry of Object.values(colors.properties) as Array<{ pattern: string }>) {
      const pattern = new RegExp(entry.pattern);
      assert(pattern.test("#A1b2C3"));
      assert(!pattern.test("red;display:none"));
    }
    const contentKeys = Object.keys(properties)
      .filter(key => key.startsWith("cInsight.codePreview."))
      .map(key => key.slice("cInsight.codePreview.".length))
      .filter(key => !["colorScheme", "tokenColors"].includes(key));
    assert.deepEqual(contentKeys.sort(), [...PREVIEW_CONTENT_SETTINGS].sort());
  });

  it("routes color-only changes without rendering, clearing caches, or semantic work", () => {
    const refresh = provider.slice(provider.indexOf("  refreshColors():"), provider.indexOf("  private colorStyle():"));
    assert.match(refresh, /if \(!this\.visible \|\| !this\.view\) return/);
    assert.match(refresh, /type: "previewColors"/);
    assert.doesNotMatch(refresh, /render\(|semanticTokens|scrollStates|analysis\./);
    const themeListener = provider.slice(provider.indexOf("vscode.window.onDidChangeActiveColorTheme"), provider.indexOf("resolveWebviewView"));
    assert.match(themeListener, /this\.refreshColors\(\)/);
    assert.doesNotMatch(themeListener, /this\.render\(/);
    const extension = readFileSync("src/extension.ts", "utf8");
    assert.match(extension, /views\.preview\.configurationChanged\(event\)/);
    assert.match(provider, /case "previewReady":\s*this\.refreshColors\(\)/);
    assert.match(provider, /view\.onDidChangeVisibility\(\(\) => \{\s*this\.refreshColors\(\);\s*this\.visibilityEmitter\.fire\(\)/);
  });

  it("executes the style message without changing code DOM, scroll, or selection", () => {
    const handler = provider.match(/if \(message\.type === 'previewColors'\) \{([\s\S]*?)\n      \}/)?.[1];
    assert(handler);
    let styleText = "old";
    const style = { get textContent() { return styleText; }, set textContent(value: string) { styleText = value; } };
    const document = { getElementById: (id: string) => { assert.equal(id, "preview-colors"); return style; } };
    const execute = (css: unknown) => runInNewContext(`(function () { ${handler} })()`, { message: { css }, document });
    execute(".code { color: #123456; }");
    assert.equal(styleText, ".code { color: #123456; }");
    execute(42);
    assert.equal(styleText, ".code { color: #123456; }");
    assert.doesNotMatch(handler, /scroll|innerHTML|selection|replaceChildren|postMessage/);
  });

  it("keeps the source-row reset and ties source foreground/highlights to the palette", () => {
    assert.match(provider, /\.code \.line > code \{[\s\S]*?color: var\(--ci-preview-foreground\); background: transparent;/);
    assert.match(provider, /background: var\(--ci-preview-lineHighlight\)/);
    assert.match(provider, /<style id="preview-colors">\$\{colorStyle\}<\/style>/);
  });
});
