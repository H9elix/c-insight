/**
 * srcdoc frames do not receive VS Code's native webview defaults. Supply the
 * baseline used by our renderers through public theme variables. Keep it below
 * renderer CSS, especially the source-line reset and fixed preview palettes.
 */
export const EMBEDDED_THEME_CSS = `
@layer c-insight-embedded-default {
  html { scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background); }
  body {
    overscroll-behavior-x: none;
    background-color: transparent;
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-weight: var(--vscode-font-weight);
    font-size: var(--vscode-font-size);
    margin: 0;
    padding: 0 20px;
  }
  body.vscode-dark, body.vscode-high-contrast:not(.vscode-high-contrast-light) { color-scheme: dark; }
  body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }
  a, a code { color: var(--vscode-textLink-foreground); }
  a:hover { color: var(--vscode-textLink-activeForeground); }
  a:focus, input:focus, select:focus, textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  code { font-family: var(--vscode-editor-font-family, monospace); }
  ::selection { background: var(--vscode-editor-selectionBackground); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-corner { background-color: var(--vscode-editor-background); }
  ::-webkit-scrollbar-thumb { background-color: var(--vscode-scrollbarSlider-background); }
  ::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground); }
  ::-webkit-scrollbar-thumb:active { background-color: var(--vscode-scrollbarSlider-activeBackground); }
}`;
