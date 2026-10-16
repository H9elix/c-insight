export type ResultTreeMessage =
  | { type: "ready" | "collapseAll" | "focus" }
  | { type: "activate"; id: string; intent: "preview" | "open" }
  | { type: "expand"; id: string; expanded: boolean }
  | { type: "resolve"; ids: string[] }
  | { type: "action"; id: string; command: string };

export function parseResultTreeMessage(value: unknown): ResultTreeMessage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (item.type === "ready" || item.type === "collapseAll" || item.type === "focus") {
    return { type: item.type };
  }
  if (item.type === "resolve" && Array.isArray(item.ids) && item.ids.length <= 400 &&
    item.ids.every((id) => typeof id === "string" && id.length <= 16_384)) {
    return { type: "resolve", ids: item.ids as string[] };
  }
  if (typeof item.id !== "string" || item.id.length > 16_384) return undefined;
  if (item.type === "activate" && (item.intent === "preview" || item.intent === "open")) {
    return { type: "activate", id: item.id, intent: item.intent };
  }
  if (item.type === "expand" && typeof item.expanded === "boolean") {
    return { type: "expand", id: item.id, expanded: item.expanded };
  }
  if (item.type === "action" && typeof item.command === "string" && item.command.length < 128) {
    return { type: "action", id: item.id, command: item.command };
  }
  return undefined;
}

interface ResultTreeWebviewOptions {
  nonce: string;
  cspSource: string;
  iconsUri: string;
  label: string;
  collapseTitle: string;
  filterTitle: string;
  expandTitle: string;
  collapseNodeTitle: string;
}

export function renderResultTreeWebview(options: ResultTreeWebviewOptions): string {
  const escape = (text: string): string => text.replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${escape(options.cspSource)}; style-src ${escape(options.cspSource)} 'nonce-${escape(options.nonce)}'; script-src 'nonce-${escape(options.nonce)}';">
  <link href="${escape(options.iconsUri)}" rel="stylesheet">
  <style nonce="${escape(options.nonce)}">
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; overflow: hidden; }
    body { display: flex; flex-direction: column; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: var(--vscode-font-size) var(--vscode-font-family); }
    button, input { font: inherit; }
    #toolbar { display: flex; flex: 0 0 26px; justify-content: flex-end; align-items: center; gap: 3px; padding: 1px 5px; }
    button { color: var(--vscode-icon-foreground); border: 0; background: transparent; cursor: pointer; padding: 2px; }
    button:hover { background: var(--vscode-toolbar-hoverBackground); }
    button:focus-visible, input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    #filter { width: 100%; min-width: 0; height: 23px; padding: 2px 5px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
    #filter[hidden] { display: none; }
    #tree { flex: 1; min-height: 0; overflow: auto; position: relative; outline: none; scrollbar-gutter: stable; }
    #canvas { position: relative; min-width: 100%; }
    .row { position: absolute; height: 24px; display: flex; align-items: center; width: 100%; min-width: max-content; padding-right: 9px; user-select: none; cursor: default; }
    .row:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-list-hoverForeground); }
    .row.selected { background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-list-inactiveSelectionForeground); }
    #tree:focus .row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); outline: 1px solid var(--vscode-list-focusOutline, transparent); outline-offset: -1px; }
    .row[data-navigable="true"] .label { cursor: pointer; }
    .twistie { flex: 0 0 18px; width: 18px; height: 22px; }
    .twistie:disabled { visibility: hidden; }
    .icon { width: 19px; flex: 0 0 19px; color: var(--vscode-icon-foreground); }
    .label { white-space: pre; }
    .description { white-space: pre; color: var(--vscode-descriptionForeground); opacity: .85; margin-left: 7px; font-size: .95em; }
    .error { color: var(--vscode-errorForeground); }
    .highlight { color: var(--vscode-list-highlightForeground); font-weight: bold; }
    #menu { position: fixed; z-index: 5; padding: 4px; min-width: 165px; max-width: 95vw; background: var(--vscode-menu-background, var(--vscode-editor-background)); color: var(--vscode-menu-foreground); border: 1px solid var(--vscode-menu-border, var(--vscode-contrastBorder, transparent)); box-shadow: 0 2px 8px var(--vscode-widget-shadow); }
    #menu[hidden] { display: none; }
    #menu button { display: block; width: 100%; padding: 5px 9px; text-align: left; color: inherit; }
    #menu button:hover, #menu button:focus { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
    @media (prefers-reduced-motion: reduce) { .codicon-modifier-spin { animation: none !important; } }
  </style></head><body>
  <div id="toolbar">
    <input id="filter" hidden type="search" aria-label="${escape(options.filterTitle)}" placeholder="${escape(options.filterTitle)}">
    <button id="filter-toggle" title="${escape(options.filterTitle)}" aria-label="${escape(options.filterTitle)}"><span class="codicon codicon-filter"></span></button>
    <button id="collapse" title="${escape(options.collapseTitle)}" aria-label="${escape(options.collapseTitle)}"><span class="codicon codicon-collapse-all"></span></button>
  </div>
  <div id="tree" role="tree" tabindex="0" aria-label="${escape(options.label)}" data-expand-label="${escape(options.expandTitle)}" data-collapse-label="${escape(options.collapseNodeTitle)}"><div id="canvas"></div></div>
  <div id="menu" role="menu" hidden></div>
  <script nonce="${escape(options.nonce)}">${resultTreeClientScript}</script>
  </body></html>`;
}

// Kept as an independent script so interaction tests execute the actual browser handlers.
export const resultTreeClientScript = String.raw`
  const vscode = acquireVsCodeApi();
  const tree = document.getElementById('tree');
  const canvas = document.getElementById('canvas');
  const filter = document.getElementById('filter');
  const menu = document.getElementById('menu');
  let rows = [], visibleRows = [], selected, pendingClick, interval = 500;
  let rowHeight = 24, scheduled = false, menuRow;
  const resolved = new Set();
  const saved = vscode.getState() || {};
  selected = saved.selected;
  let restoreScroll = Number(saved.scrollTop) || 0;
  function post(message) { vscode.postMessage(message); }
  function persist() { vscode.setState({ selected, scrollTop: tree.scrollTop }); }
  function hideMenu() { menu.hidden = true; menu.replaceChildren(); menuRow = undefined; }
  function focusRow(row, preview = false) {
    if (!row) return;
    selected = row.id;
    const index = visibleRows.indexOf(row);
    if (index * rowHeight < tree.scrollTop) tree.scrollTop = index * rowHeight;
    else if ((index + 1) * rowHeight > tree.scrollTop + tree.clientHeight) tree.scrollTop = (index + 1) * rowHeight - tree.clientHeight;
    tree.focus({ preventScroll: true });
    draw(); persist();
    if (preview && (row.navigable || row.actionable)) post({ type: 'activate', id: row.id, intent: 'preview' });
  }
  function labelContents(element, text, highlights) {
    let position = 0;
    for (const pair of highlights || []) {
      const start = Math.max(position, Math.min(text.length, pair[0]));
      const end = Math.max(start, Math.min(text.length, pair[1]));
      element.append(document.createTextNode(text.slice(position, start)));
      const mark = document.createElement('span');
      mark.className = 'highlight'; mark.textContent = text.slice(start, end); element.append(mark);
      position = end;
    }
    element.append(document.createTextNode(text.slice(position)));
  }
  function draw() {
    scheduled = false;
    const needle = filter.value.toLocaleLowerCase();
    visibleRows = rows.filter(row => !needle || (row.label + ' ' + (row.description || '')).toLocaleLowerCase().includes(needle));
    canvas.style.height = (visibleRows.length * rowHeight) + 'px';
    if (restoreScroll && rows.length) { tree.scrollTop = restoreScroll; restoreScroll = 0; }
    const begin = Math.max(0, Math.floor(tree.scrollTop / rowHeight) - 10);
    const end = Math.min(visibleRows.length, begin + Math.ceil(tree.clientHeight / rowHeight) + 21);
    const fragment = document.createDocumentFragment();
    const resolveIds = [];
    for (let index = begin; index < end; index++) {
      const data = visibleRows[index];
      if (data.resolutionToken && !resolved.has(data.resolutionToken)) {
        resolved.add(data.resolutionToken); resolveIds.push(data.id);
      }
      const row = document.createElement('div');
      row.className = 'row' + (selected === data.id ? ' selected' : '');
      row.dataset.id = data.id; row.dataset.navigable = String(data.navigable);
      row.id = 'row-' + index; row.style.top = (index * rowHeight) + 'px';
      row.style.paddingLeft = (data.depth * 16 + 4) + 'px';
      row.title = [data.tooltip || data.label, data.error].filter(Boolean).join('\n');
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(data.depth + 1));
      row.setAttribute('aria-posinset', String(data.position));
      row.setAttribute('aria-setsize', String(data.siblings));
      row.setAttribute('aria-selected', String(selected === data.id));
      if (data.expandable) row.setAttribute('aria-expanded', String(data.expanded));
      if (data.loading) row.setAttribute('aria-busy', 'true');
      const twistie = document.createElement('button');
      twistie.className = 'twistie codicon codicon-' + (data.loading ? 'loading codicon-modifier-spin' : data.expanded ? 'chevron-down' : 'chevron-right');
      twistie.disabled = !data.expandable; twistie.tabIndex = -1;
      twistie.setAttribute('aria-label', data.expanded ? tree.dataset.collapseLabel : tree.dataset.expandLabel);
      const icon = document.createElement('span');
      const iconId = /^[a-z0-9-]+(~spin)?$/.test(data.icon || '') ? data.icon : 'blank';
      icon.className = 'icon codicon codicon-' + iconId.replace('~spin', ' codicon-modifier-spin');
      if (/^[a-zA-Z][a-zA-Z0-9.]*$/.test(data.iconColor || '')) icon.style.color = 'var(--vscode-' + data.iconColor.replaceAll('.', '-') + ')';
      else if (iconId.startsWith('symbol-')) {
        const symbol = iconId.slice(7).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        icon.style.color = 'var(--vscode-symbolIcon-' + symbol + 'Foreground, var(--vscode-icon-foreground))';
      }
      const label = document.createElement('span'); label.className = 'label';
      labelContents(label, data.label, data.highlights);
      const description = document.createElement('span'); description.className = 'description' + (data.error ? ' error' : '');
      description.textContent = data.error || data.description || '';
      row.append(twistie, icon, label, description); fragment.append(row);
    }
    canvas.replaceChildren(fragment);
    const selectedIndex = visibleRows.findIndex(row => row.id === selected);
    if (selectedIndex >= begin && selectedIndex < end) tree.setAttribute('aria-activedescendant', 'row-' + selectedIndex);
    else tree.removeAttribute('aria-activedescendant');
    if (resolveIds.length) post({ type: 'resolve', ids: resolveIds.slice(0, 400) });
    if (resolved.size > 100000) resolved.clear();
  }
  function scheduleDraw() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(draw); }
  }
  function rowForEvent(event) {
    const element = event.target instanceof Element ? event.target.closest('.row') : undefined;
    return element && rows.find(row => row.id === element.dataset.id);
  }
  tree.addEventListener('click', event => {
    const row = rowForEvent(event); if (!row) return;
    hideMenu();
    if (event.target.closest('.twistie')) {
      pendingClick = undefined;
      selected = row.id; tree.focus({ preventScroll: true }); persist();
      if (event.detail <= 1) post({ type: 'expand', id: row.id, expanded: !row.expanded });
      event.stopPropagation(); return;
    }
    // Selection does not alter expansion, including on the second click.
    selected = row.id; tree.focus({ preventScroll: true }); persist();
    const now = Date.now();
    const open = pendingClick?.id === row.id && now - pendingClick.time <= interval;
    pendingClick = open ? undefined : { id: row.id, time: now };
    if (row.navigable || row.actionable) post({ type: 'activate', id: row.id, intent: open ? 'open' : 'preview' });
    // Keep DOM under the pointer until the full click sequence has finished.
    for (const element of canvas.children) {
      element.classList.toggle('selected', element.dataset.id === selected);
      element.setAttribute('aria-selected', String(element.dataset.id === selected));
      if (element.dataset.id === selected) tree.setAttribute('aria-activedescendant', element.id);
    }
  });
  tree.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); });
  tree.addEventListener('focus', () => post({ type: 'focus' }));
  tree.addEventListener('blur', () => { pendingClick = undefined; });
  tree.addEventListener('scroll', () => { persist(); scheduleDraw(); });
  tree.addEventListener('keydown', event => {
    let index = visibleRows.findIndex(row => row.id === selected);
    const row = visibleRows[index];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); pendingClick = undefined;
      index = event.key === 'Home' ? 0 : event.key === 'End' ? visibleRows.length - 1 : Math.max(0, Math.min(visibleRows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      focusRow(visibleRows[index], true);
    } else if (event.key === 'ArrowRight' && row) {
      event.preventDefault(); pendingClick = undefined;
      if (row.expandable && !row.expanded) post({ type: 'expand', id: row.id, expanded: true });
      else if (visibleRows[index + 1]?.parent === row.id) focusRow(visibleRows[index + 1], true);
    } else if (event.key === 'ArrowLeft' && row) {
      event.preventDefault(); pendingClick = undefined;
      if (row.expanded) post({ type: 'expand', id: row.id, expanded: false });
      else focusRow(visibleRows.find(candidate => candidate.id === row.parent), true);
    } else if ((event.key === 'Enter' || event.key === ' ') && row) {
      event.preventDefault(); pendingClick = undefined;
      if (row.navigable || row.actionable) post({ type: 'activate', id: row.id, intent: event.key === 'Enter' ? 'open' : 'preview' });
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault(); filter.hidden = false; filter.focus();
    } else if ((event.shiftKey && event.key === 'F10') && row) {
      event.preventDefault(); showMenu(row, 8, 30);
    }
  });
  function showMenu(row, x, y) {
    hideMenu(); if (!row.actions?.length) return;
    menuRow = row.id; selected = row.id; pendingClick = undefined;
    for (const action of row.actions) {
      const button = document.createElement('button');
      button.textContent = action.label; button.dataset.command = action.command; button.setAttribute('role', 'menuitem');
      menu.append(button);
    }
    menu.hidden = false;
    menu.style.left = Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth)) + 'px';
    menu.style.top = Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight)) + 'px';
    menu.firstElementChild?.focus();
  }
  tree.addEventListener('contextmenu', event => {
    const row = rowForEvent(event); if (!row) return;
    event.preventDefault(); showMenu(row, event.clientX, event.clientY);
  });
  menu.addEventListener('click', event => {
    const command = event.target.closest('button')?.dataset.command;
    if (command && menuRow) post({ type: 'action', id: menuRow, command });
    hideMenu(); tree.focus();
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hideMenu(); tree.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); const items = Array.from(menu.children);
      const index = items.indexOf(document.activeElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) hideMenu(); });
  document.getElementById('collapse').addEventListener('click', () => { pendingClick = undefined; post({ type: 'collapseAll' }); });
  document.getElementById('filter-toggle').addEventListener('click', () => { pendingClick = undefined; filter.hidden = !filter.hidden; if (!filter.hidden) filter.focus(); else { filter.value = ''; draw(); } });
  filter.addEventListener('input', () => { tree.scrollTop = 0; pendingClick = undefined; draw(); });
  filter.addEventListener('keydown', event => {
    if (event.key === 'Escape') { filter.value = ''; filter.hidden = true; draw(); tree.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); focusRow(visibleRows[0]); }
  });
  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.type === 'state') {
      rows = message.rows; interval = message.doubleClickInterval || 500;
      if (selected && !rows.some(row => row.id === selected)) { selected = undefined; pendingClick = undefined; }
      draw();
    } else if (message?.type === 'reveal') {
      filter.value = ''; draw();
      const row = rows.find(row => row.id === message.id);
      if (!row) return;
      const index = visibleRows.indexOf(row);
      if (message.select) selected = row.id;
      tree.scrollTop = Math.max(0, index * rowHeight - tree.clientHeight / 2);
      if (message.focus) tree.focus({ preventScroll: true });
      draw(); persist();
    }
  });
  new ResizeObserver(scheduleDraw).observe(tree);
  post({ type: 'ready' });
`;
