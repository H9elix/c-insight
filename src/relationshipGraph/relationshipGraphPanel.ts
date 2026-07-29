import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  GraphNode,
  RelationshipGraphModel,
  graphNodeId,
} from "./graphModel";

type GraphMessage =
  | { type: "ready" }
  | { type: "selectNode"; nodeId: string }
  | { type: "openNode"; nodeId: string };

export class RelationshipGraphPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private model = this.createModel();
  private readonly disposables: vscode.Disposable[] = [];

  showFile(uri: vscode.Uri): void {
    const root = fileNode(uri);
    this.model = this.createModel();
    this.model.replaceRoot(root);
    this.ensurePanel();
    this.panel!.title = `Relationship Graph — ${root.name}`;
    this.panel!.reveal(vscode.ViewColumn.Beside, true);
    void this.publish();
  }

  markStale(reason: string): void {
    if (!this.panel) {
      return;
    }
    this.model.markStale(reason);
    void this.publish();
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((item) => item.dispose());
  }

  private createModel(): RelationshipGraphModel {
    const configuration = vscode.workspace.getConfiguration(
      "cInsight.relationshipGraph",
    );
    return new RelationshipGraphModel(
      configuration.get<number>("maximumNodes", 500),
      configuration.get<number>("maximumEdges", 1_000),
    );
  }

  private ensurePanel(): void {
    if (this.panel) {
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "cInsight.relationshipGraph",
      "Relationship Graph",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        enableFindWidget: true,
        retainContextWhenHidden: true,
      },
    );
    this.panel = panel;
    panel.webview.html = graphHtml();
    panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables,
    );
    panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.handleMessage(message),
      undefined,
      this.disposables,
    );
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isGraphMessage(message)) {
      return;
    }
    if (message.type === "ready") {
      await this.publish();
      return;
    }
    const node = this.model.node(message.nodeId);
    if (!node?.uri) {
      return;
    }
    const uri = vscode.Uri.parse(node.uri);
    const line = Math.max(0, (node.line ?? 1) - 1);
    const location = {
      uri,
      range: new vscode.Range(line, 0, line, 0),
    };
    if (message.type === "selectNode") {
      await vscode.commands.executeCommand(
        "cInsight.previewLocation",
        location,
        node.kind === "source" || node.kind === "header"
          ? "reference"
          : "definition",
        node.name,
      );
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
    editor.selection = new vscode.Selection(line, 0, line, 0);
    editor.revealRange(
      new vscode.Range(line, 0, line, 0),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }

  private async publish(): Promise<void> {
    await this.panel?.webview.postMessage({
      type: "graphSnapshot",
      graph: this.model.snapshot(),
    });
  }
}

function fileNode(uri: vscode.Uri): GraphNode {
  const extension = path.extname(uri.fsPath).toLowerCase();
  const kind = [".h", ".hh", ".hpp", ".hxx"].includes(extension)
    ? "header"
    : "source";
  const name = path.basename(uri.fsPath);
  return {
    id: graphNodeId(kind, uri.toString(), 1, name),
    kind,
    name,
    detail: vscode.workspace.asRelativePath(uri),
    uri: uri.toString(),
    line: 1,
    states: [],
    capabilities: ["includes"],
  };
}

function isGraphMessage(value: unknown): value is GraphMessage {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }
  const type = (value as { type: unknown }).type;
  if (type === "ready") {
    return true;
  }
  return (
    (type === "selectNode" || type === "openNode") &&
    "nodeId" in value &&
    typeof (value as { nodeId: unknown }).nodeId === "string"
  );
}

function graphHtml(): string {
  const nonce = randomNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    #toolbar { height: 36px; box-sizing: border-box; display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; padding: 4px 9px; cursor: pointer; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .relation { opacity: .65; }
    .relation.active { opacity: 1; outline: 1px solid var(--vscode-focusBorder); }
    #status { margin-left: auto; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #canvas { width: 100%; height: calc(100% - 36px); touch-action: none; cursor: grab; }
    #canvas.dragging { cursor: grabbing; }
    .edge { stroke: var(--vscode-descriptionForeground); stroke-width: 1.5; fill: none; marker-end: url(#arrow); }
    .node rect { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-focusBorder); stroke-width: 1.5; rx: 6; }
    .node.root rect { stroke-width: 2.5; }
    .node.selected rect { fill: var(--vscode-list-activeSelectionBackground); }
    .node text { fill: var(--vscode-editorWidget-foreground); pointer-events: none; font-size: 13px; }
    .node .detail { fill: var(--vscode-descriptionForeground); font-size: 11px; }
    #empty { position: absolute; inset: 36px 0 0 0; display: grid; place-items: center; color: var(--vscode-descriptionForeground); pointer-events: none; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="fit">Fit</button>
    <button id="reset">Reset Layout</button>
    <button class="relation active" data-relation="calls">Call</button>
    <button class="relation active" data-relation="inherits">Inheritance</button>
    <button class="relation active" data-relation="includes">Include</button>
    <span id="status">Waiting for graph…</span>
  </div>
  <svg id="canvas" role="application" aria-label="C Insight Relationship Graph">
    <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="context-stroke"/></marker></defs>
    <g id="viewport"><g id="edges"></g><g id="nodes"></g></g>
  </svg>
  <div id="empty">Run C Insight: Show Relationship Graph from a local C/C++ file.</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const svg = document.getElementById('canvas');
    const viewport = document.getElementById('viewport');
    const edgeLayer = document.getElementById('edges');
    const nodeLayer = document.getElementById('nodes');
    const empty = document.getElementById('empty');
    const status = document.getElementById('status');
    let graph = { nodes: [], edges: [] };
    let scale = 1, tx = 80, ty = 80, dragging = false, lastX = 0, lastY = 0;
    let selected;
    const enabled = new Set(['calls', 'inherits', 'includes']);
    const applyTransform = () => viewport.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + scale + ')');
    const element = (name, attrs = {}) => { const value = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [key, item] of Object.entries(attrs)) value.setAttribute(key, item); return value; };
    function render() {
      edgeLayer.replaceChildren(); nodeLayer.replaceChildren();
      empty.style.display = graph.nodes.length ? 'none' : 'grid';
      const positions = new Map();
      graph.nodes.forEach((node, index) => positions.set(node.id, { x: (index % 4) * 240, y: Math.floor(index / 4) * 120 }));
      graph.edges.filter(edge => enabled.has(edge.relation)).forEach(edge => {
        const from = positions.get(edge.from), to = positions.get(edge.to);
        if (!from || !to) return;
        edgeLayer.append(element('path', { class: 'edge', d: 'M' + (from.x + 170) + ',' + (from.y + 34) + ' L' + to.x + ',' + (to.y + 34) }));
      });
      graph.nodes.forEach(node => {
        const point = positions.get(node.id);
        const group = element('g', { class: 'node' + (node.id === graph.rootId ? ' root' : '') + (node.id === selected ? ' selected' : ''), transform: 'translate(' + point.x + ' ' + point.y + ')', tabindex: '0' });
        group.append(element('rect', { width: '170', height: '68' }));
        const title = element('text', { x: '10', y: '27' }); title.textContent = node.name; group.append(title);
        const detail = element('text', { class: 'detail', x: '10', y: '49' }); detail.textContent = node.detail || node.kind; group.append(detail);
        group.addEventListener('click', event => { event.stopPropagation(); selected = node.id; render(); vscode.postMessage({ type: 'selectNode', nodeId: node.id }); });
        group.addEventListener('dblclick', event => { event.stopPropagation(); vscode.postMessage({ type: 'openNode', nodeId: node.id }); });
        nodeLayer.append(group);
      });
      status.textContent = graph.staleReason ? 'Stale: ' + graph.staleReason : graph.nodes.length + ' nodes · ' + graph.edges.length + ' edges';
      applyTransform();
    }
    function fit() {
      if (!graph.nodes.length) return;
      const columns = Math.min(4, graph.nodes.length), rows = Math.ceil(graph.nodes.length / 4);
      const width = columns * 240 - 70, height = rows * 120 - 52;
      scale = Math.min(1.5, Math.max(.2, Math.min(svg.clientWidth / (width + 120), svg.clientHeight / (height + 120))));
      tx = (svg.clientWidth - width * scale) / 2; ty = (svg.clientHeight - height * scale) / 2; applyTransform();
    }
    svg.addEventListener('wheel', event => { event.preventDefault(); const next = Math.min(3, Math.max(.2, scale * (event.deltaY < 0 ? 1.1 : .9))); scale = next; applyTransform(); }, { passive: false });
    svg.addEventListener('pointerdown', event => { dragging = true; lastX = event.clientX; lastY = event.clientY; svg.classList.add('dragging'); svg.setPointerCapture(event.pointerId); });
    svg.addEventListener('pointermove', event => { if (!dragging) return; tx += event.clientX - lastX; ty += event.clientY - lastY; lastX = event.clientX; lastY = event.clientY; applyTransform(); });
    svg.addEventListener('pointerup', () => { dragging = false; svg.classList.remove('dragging'); });
    document.getElementById('fit').addEventListener('click', fit);
    document.getElementById('reset').addEventListener('click', () => { scale = 1; tx = 80; ty = 80; applyTransform(); });
    document.querySelectorAll('.relation').forEach(button => button.addEventListener('click', () => { const relation = button.dataset.relation; enabled.has(relation) ? enabled.delete(relation) : enabled.add(relation); button.classList.toggle('active', enabled.has(relation)); render(); }));
    window.addEventListener('message', event => { if (event.data?.type === 'graphSnapshot') { graph = event.data.graph; render(); fit(); } });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function randomNonce(): string {
  return randomBytes(24).toString("base64");
}
