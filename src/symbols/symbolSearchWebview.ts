export interface SymbolSearchWebviewOptions {
  cspSource: string;
  nonce: string;
  placeholder: string;
  clearTitle: string;
  resultsLabel: string;
}

export type SymbolSearchWebviewMessage =
  | { type: "query"; query: string }
  | { type: "activate"; id: string }
  | { type: "clear" }
  | { type: "ready" };

export function parseSymbolSearchWebviewMessage(
  value: unknown,
): SymbolSearchWebviewMessage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "clear" || candidate.type === "ready") {
    return { type: candidate.type };
  }
  if (
    candidate.type === "query" &&
    typeof candidate.query === "string" &&
    candidate.query.length <= 2_048
  ) {
    return { type: "query", query: candidate.query };
  }
  if (
    candidate.type === "activate" &&
    typeof candidate.id === "string" &&
    candidate.id.length <= 8_192
  ) {
    return { type: "activate", id: candidate.id };
  }
  return undefined;
}

export function renderSymbolSearchWebview(
  options: SymbolSearchWebviewOptions,
): string {
  const nonce = escapeAttribute(options.nonce);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeAttribute(options.cspSource)} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; display: flex; flex-direction: column; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: var(--vscode-font-size) var(--vscode-font-family); }
    .search-bar { flex: 0 0 auto; position: sticky; top: 0; z-index: 2; display: flex; gap: 4px; padding: 6px 8px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); }
    #query { min-width: 0; flex: 1; height: 24px; padding: 2px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); outline: none; }
    #query:focus { border-color: var(--vscode-focusBorder); }
    #clear { flex: 0 0 24px; height: 24px; padding: 0; color: var(--vscode-icon-foreground); background: transparent; border: 0; cursor: pointer; font-size: 17px; }
    #clear:hover { background: var(--vscode-toolbar-hoverBackground); }
    #status { flex: 0 0 auto; min-height: 24px; padding: 5px 9px; color: var(--vscode-descriptionForeground); }
    #results { flex: 1 1 auto; min-height: 0; overflow: auto; padding-bottom: 8px; }
    details > summary { cursor: pointer; padding: 3px 8px; color: var(--vscode-sideBarSectionHeader-foreground); user-select: none; }
    .count { margin-left: 5px; color: var(--vscode-descriptionForeground); }
    .symbol-row { width: 100%; display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 3px; padding: 3px 8px 3px 16px; color: inherit; background: transparent; border: 0; text-align: left; cursor: pointer; font: inherit; }
    .symbol-row:hover { background: var(--vscode-list-hoverBackground); }
    .symbol-row:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; background: var(--vscode-list-focusBackground); color: var(--vscode-list-focusForeground); }
    .symbol-icon { text-align: center; color: var(--vscode-symbolIcon-functionForeground, var(--vscode-descriptionForeground)); }
    .kind-type { color: var(--vscode-symbolIcon-classForeground, #ee9d28); }
    .kind-value { color: var(--vscode-symbolIcon-variableForeground, #75beff); }
    .kind-namespace { color: var(--vscode-symbolIcon-namespaceForeground, #c586c0); }
    .symbol-main, .symbol-meta { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .symbol-meta { margin-top: 1px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .flat { padding-top: 1px; }
  </style>
</head>
<body>
  <div class="search-bar">
    <input id="query" type="search" spellcheck="false" autocomplete="off" placeholder="${escapeAttribute(options.placeholder)}" aria-label="${escapeAttribute(options.placeholder)}">
    <button id="clear" type="button" title="${escapeAttribute(options.clearTitle)}" aria-label="${escapeAttribute(options.clearTitle)}">×</button>
  </div>
  <div id="status" role="status"></div>
  <div id="results" role="tree" aria-label="${escapeAttribute(options.resultsLabel)}"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const query = document.getElementById('query');
    const clear = document.getElementById('clear');
    const status = document.getElementById('status');
    const results = document.getElementById('results');

    query.addEventListener('input', () => {
      vscode.postMessage({ type: 'query', query: query.value });
    });
    clear.addEventListener('click', () => {
      query.value = '';
      vscode.postMessage({ type: 'clear' });
      query.focus();
    });
    results.addEventListener('click', (event) => {
      const row = event.target instanceof Element ? event.target.closest('.symbol-row') : undefined;
      if (row) vscode.postMessage({ type: 'activate', id: row.dataset.id });
    });
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type === 'focus') {
        query.focus();
        query.select();
        return;
      }
      if (message?.type !== 'state') return;
      if (document.activeElement !== query && query.value !== message.query) {
        query.value = message.query;
      }
      status.textContent = message.status;
      results.replaceChildren();
      for (const group of message.groups) {
        const parent = message.flat ? document.createElement('div') : document.createElement('details');
        if (!message.flat) {
          parent.open = true;
          const summary = document.createElement('summary');
          summary.append(document.createTextNode(group.label));
          const count = document.createElement('span');
          count.className = 'count';
          count.textContent = String(group.symbols.length);
          summary.append(count);
          parent.append(summary);
        } else {
          parent.className = 'flat';
        }
        for (const symbol of group.symbols) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'symbol-row';
          row.dataset.id = symbol.id;
          row.title = symbol.tooltip;
          row.setAttribute('role', 'treeitem');
          const icon = document.createElement('span');
          icon.className = 'symbol-icon ' + symbol.iconClass;
          icon.textContent = symbol.icon;
          const text = document.createElement('span');
          const name = document.createElement('span');
          name.className = 'symbol-main';
          name.textContent = symbol.name;
          const meta = document.createElement('span');
          meta.className = 'symbol-meta';
          meta.textContent = symbol.description;
          text.append(name, meta);
          row.append(icon, text);
          parent.append(row);
        }
        results.append(parent);
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
