import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { writeExportWithinBudget } from "../utils/exportWriter";
import {
  DocumentSymbol,
  SymbolKind,
  SymbolInformation,
  TypeHierarchyItem,
} from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import { BookmarkExplorer } from "../bookmarks/bookmarkExplorer";
import {
  CallDirection,
  CallHierarchyRepository,
} from "../callHierarchy/callHierarchyRepository";
import { CallNode, LspSymbol } from "../models/types";
import type { RelationshipGraphSessionState } from "../session/workspaceSession";
import {
  IncludeHierarchyDirection,
  IncludeHierarchyRepository,
} from "../includeHierarchy/includeHierarchyRepository";
import type { IncludeTargetKind } from "../includeHierarchy/includeResolver";
import {
  TypeHierarchyDirection,
  TypeHierarchyRepository,
} from "../typeHierarchy/typeHierarchyRepository";
import {
  GraphNode,
  RelationshipGraphModel,
  graphEdgeId,
  graphNodeId,
  renderGraphJson,
  renderGraphMermaid,
  renderGraphText,
} from "./graphModel";
import { sessionAfterPanelDispose } from "./graphSessionLifecycle";

type GraphMessage =
  | { type: "ready" }
  | { type: "selectNode"; nodeId: string }
  | { type: "openNode"; nodeId: string }
  | { type: "nodeContext"; nodeId: string }
  | { type: "expandToDepth"; nodeId: string }
  | { type: "search" }
  | { type: "export" }
  | {
      type: "slowRender";
      duration: number;
      nodes: number;
      edges: number;
    }
  | {
      type: "canvasState";
      selectedId?: string;
      enabledRelations: string[];
      collapsedIds: string[];
      viewport: { scale: number; tx: number; ty: number };
    }
  | {
      type: "expandCall";
      nodeId: string;
      direction: CallDirection;
    }
  | {
      type: "expandType";
      nodeId: string;
      direction: TypeHierarchyDirection;
    }
  | {
      type: "expandInclude";
      nodeId: string;
      direction: IncludeHierarchyDirection;
    }
  | { type: "stopExpansion" };

export class RelationshipGraphPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private model = this.createModel();
  private readonly callNodes = new Map<string, CallNode>();
  private readonly nodeDepth = new Map<string, number>();
  private readonly expandedCalls = new Set<string>();
  private readonly typeNodes = new Map<string, TypeHierarchyItem>();
  private readonly expandedTypes = new Set<string>();
  private readonly includeFiles = new Map<string, vscode.Uri>();
  private readonly expandedIncludes = new Set<string>();
  private expansion?: vscode.CancellationTokenSource;
  private operationStatus?: {
    kind: "info" | "warning" | "error";
    message: string;
  };
  private canvasState: Omit<
    RelationshipGraphSessionState,
    "schemaVersion" | "graph"
  > = defaultCanvasState();
  private pendingCanvasRestore?: typeof this.canvasState;
  private retainedSession?: RelationshipGraphSessionState;
  private extensionDisposing = false;
  private generation = 0;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly closeEmitter = new vscode.EventEmitter<void>();
  readonly onDidClose = this.closeEmitter.event;

  constructor(
    private readonly analysis: AnalysisService,
    private readonly callRepository: CallHierarchyRepository,
    private readonly typeRepository: TypeHierarchyRepository,
    private readonly includeRepository: IncludeHierarchyRepository,
    private readonly bookmarks: BookmarkExplorer,
    private readonly output: vscode.OutputChannel,
  ) {}

  async showAt(uri: vscode.Uri, position: vscode.Position): Promise<void> {
    this.retainedSession = undefined;
    this.canvasState = defaultCanvasState();
    this.stopExpansion();
    const generation = ++this.generation;
    const cancellation = new vscode.CancellationTokenSource();
    let callRoots: CallNode[];
    let typeRoots: TypeHierarchyItem[] = [];
    try {
      callRoots = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "C Insight: Preparing Relationship Graph root",
          cancellable: true,
        },
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            cancellation.cancel(),
          );
          try {
            return await this.callRepository.prepare(
              uri,
              position,
              cancellation.token,
            );
          } finally {
            subscription.dispose();
          }
        },
      );
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        void vscode.window.showErrorMessage(
          `C Insight: Failed to prepare Call Graph: ${String(error)}`,
        );
      }
      return;
    } finally {
      cancellation.dispose();
    }
    if (generation !== this.generation) {
      return;
    }
    if (callRoots.length === 0) {
      try {
        typeRoots = await this.typeRepository.prepare(uri, position);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `C Insight: Failed to prepare Type Graph: ${String(error)}`,
        );
        return;
      }
    }
    if (callRoots.length === 0 && typeRoots.length === 0) {
      this.showFile(uri);
      void vscode.window.showInformationMessage(
        "C Insight: No callable symbol or type at the cursor; the graph uses the active file as its root.",
      );
      return;
    }
    this.model = this.createModel();
    this.callNodes.clear();
    this.typeNodes.clear();
    this.includeFiles.clear();
    this.nodeDepth.clear();
    this.expandedCalls.clear();
    this.expandedTypes.clear();
    this.expandedIncludes.clear();
    this.operationStatus = undefined;
    const root =
      callRoots.length > 0
        ? this.callGraphNode(callRoots[0])
        : this.typeGraphNode(typeRoots[0]);
    this.model.replaceRoot(root);
    if (callRoots.length > 0) {
      this.callNodes.set(root.id, callRoots[0]);
    } else {
      this.typeNodes.set(root.id, typeRoots[0]);
    }
    this.nodeDepth.set(root.id, 0);
    this.ensurePanel();
    this.panel!.title = `Relationship Graph — ${root.name}`;
    this.panel!.reveal(vscode.ViewColumn.Beside, true);
    await this.publish();
    if (this.defaultDepth > 0) {
      if (callRoots.length > 0) {
        const completed = await this.expandCall(root.id, "incoming");
        if (completed) {
          await this.expandCall(root.id, "outgoing");
        }
      } else {
        const completed = await this.expandType(root.id, "supertypes");
        if (completed) {
          await this.expandType(root.id, "subtypes");
        }
      }
    }
  }

  showFile(uri: vscode.Uri): void {
    this.retainedSession = undefined;
    this.canvasState = defaultCanvasState();
    this.stopExpansion();
    this.generation += 1;
    const root = fileNode(uri);
    this.model = this.createModel();
    this.callNodes.clear();
    this.typeNodes.clear();
    this.includeFiles.clear();
    this.nodeDepth.clear();
    this.expandedCalls.clear();
    this.expandedTypes.clear();
    this.expandedIncludes.clear();
    this.operationStatus = undefined;
    this.model.replaceRoot(root);
    this.includeFiles.set(root.id, uri);
    this.nodeDepth.set(root.id, 0);
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

  sessionState(): RelationshipGraphSessionState | undefined {
    const snapshot = this.model.snapshot();
    if (!snapshot.rootId || snapshot.nodes.length === 0) {
      return this.retainedSession;
    }
    const maximum = vscode.workspace
      .getConfiguration("cInsight.session")
      .get<number>("relationshipGraphMaximumSnapshotNodes", 1_000);
    const graph =
      snapshot.nodes.length <= maximum &&
      snapshot.edges.length <= 5_000
        ? snapshot
        : {
            ...snapshot,
            limitedBy: "maximumNodes" as const,
            nodes: snapshot.nodes.filter(
              (node) => node.id === snapshot.rootId,
            ),
            edges: [],
          };
    return {
      schemaVersion: 1,
      graph,
      selectedId: graph.nodes.some(
        (node) => node.id === this.canvasState.selectedId,
      )
        ? this.canvasState.selectedId
        : graph.rootId,
      enabledRelations: [...this.canvasState.enabledRelations],
      collapsedIds: this.canvasState.collapsedIds.filter((id) =>
        graph.nodes.some((node) => node.id === id),
      ),
      viewport: { ...this.canvasState.viewport },
    };
  }

  async restoreSession(
    state: RelationshipGraphSessionState | undefined,
  ): Promise<boolean> {
    if (!state?.graph.rootId) {
      return false;
    }
    const root = state.graph.nodes.find(
      (node) => node.id === state.graph.rootId,
    );
    if (!root) {
      return false;
    }
    if (root.uri) {
      try {
        const uri = vscode.Uri.parse(root.uri);
        if (uri.scheme !== "untitled") {
          await vscode.workspace.fs.stat(uri);
        }
      } catch {
        this.output.appendLine(
          `Relationship Graph restore skipped: root file is unavailable (${root.uri}).`,
        );
        return false;
      }
    }
    this.stopExpansion();
    this.generation += 1;
    this.model = this.createModel();
    this.model.restore(state.graph);
    this.callNodes.clear();
    this.typeNodes.clear();
    this.includeFiles.clear();
    this.expandedCalls.clear();
    this.expandedTypes.clear();
    this.expandedIncludes.clear();
    this.rebuildRestoredDepths();
    for (const node of this.model.snapshot().nodes) {
      if (
        (node.kind === "source" || node.kind === "header") &&
        node.uri
      ) {
        this.includeFiles.set(node.id, vscode.Uri.parse(node.uri));
      }
    }
    this.canvasState = {
      selectedId: state.selectedId,
      enabledRelations: [...state.enabledRelations],
      collapsedIds: [...state.collapsedIds],
      viewport: { ...state.viewport },
    };
    this.pendingCanvasRestore = this.canvasState;
    this.retainedSession = undefined;
    this.operationStatus = {
      kind: "info",
      message:
        "Restored static graph snapshot; semantic nodes revalidate when expanded.",
    };
    this.ensurePanel();
    this.panel!.title = `Relationship Graph — ${root.name}`;
    this.panel!.reveal(vscode.ViewColumn.Beside, true);
    await this.publish();
    return true;
  }

  dispose(): void {
    this.extensionDisposing = true;
    this.stopExpansion();
    this.panel?.dispose();
    this.disposables.forEach((item) => item.dispose());
    this.closeEmitter.dispose();
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
        this.stopExpansion();
        const retainedSession = sessionAfterPanelDispose(
          this.sessionState(),
          this.extensionDisposing,
        );
        this.generation += 1;
        this.model = this.createModel();
        this.callNodes.clear();
        this.typeNodes.clear();
        this.includeFiles.clear();
        this.nodeDepth.clear();
        this.expandedCalls.clear();
        this.expandedTypes.clear();
        this.expandedIncludes.clear();
        this.operationStatus = undefined;
        this.pendingCanvasRestore = undefined;
        this.panel = undefined;
        this.retainedSession = retainedSession;
        if (!this.extensionDisposing) {
          this.closeEmitter.fire();
        }
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
    if (message.type === "slowRender") {
      this.output.appendLine(
        `Slow Relationship Graph render: ${message.duration.toFixed(1)} ms (${message.nodes} nodes, ${message.edges} edges)`,
      );
      return;
    }
    if (message.type === "canvasState") {
      const nodeIds = new Set(
        this.model.snapshot().nodes.map((node) => node.id),
      );
      this.canvasState = {
        selectedId:
          message.selectedId && nodeIds.has(message.selectedId)
            ? message.selectedId
            : this.model.snapshot().rootId,
        enabledRelations: message.enabledRelations.filter(
          isGraphRelation,
        ),
        collapsedIds: message.collapsedIds.filter((id) =>
          nodeIds.has(id),
        ),
        viewport: { ...message.viewport },
      };
      return;
    }
    if (message.type === "stopExpansion") {
      this.stopExpansion();
      this.operationStatus = {
        kind: "warning",
        message: "Expansion cancelled; loaded nodes remain available.",
      };
      await this.publish();
      return;
    }
    if (message.type === "search") {
      await this.searchLoadedNodes();
      return;
    }
    if (message.type === "export") {
      await this.chooseExport();
      return;
    }
    if (message.type === "nodeContext") {
      await this.showNodeActions(message.nodeId);
      return;
    }
    if (message.type === "expandToDepth") {
      await this.expandToDepth(message.nodeId);
      return;
    }
    if (message.type === "expandCall") {
      await this.expandCall(message.nodeId, message.direction);
      return;
    }
    if (message.type === "expandType") {
      await this.expandType(message.nodeId, message.direction);
      return;
    }
    if (message.type === "expandInclude") {
      await this.expandInclude(message.nodeId, message.direction);
      return;
    }
    if (message.type === "selectNode") {
      await this.previewNode(message.nodeId);
      return;
    }
    await this.openNode(message.nodeId);
  }

  private async previewNode(nodeId: string): Promise<void> {
    const node = this.model.node(nodeId);
    const location = nodeLocation(node);
    if (!node || !location) {
      return;
    }
    if (!(await this.locationAvailable(node.id, location.uri))) {
      return;
    }
    await vscode.commands.executeCommand(
      "cInsight.previewLocation",
      location,
      node.kind === "source" || node.kind === "header"
        ? "reference"
        : "definition",
      node.name,
    );
  }

  private async openNode(nodeId: string): Promise<void> {
    const node = this.model.node(nodeId);
    const location = nodeLocation(node);
    if (!location) {
      return;
    }
    if (!(await this.locationAvailable(nodeId, location.uri))) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(location.uri);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
    editor.selection = new vscode.Selection(
      location.range.start,
      location.range.start,
    );
    editor.revealRange(
      location.range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }

  private async locationAvailable(
    nodeId: string,
    uri: vscode.Uri,
  ): Promise<boolean> {
    if (uri.scheme !== "file") {
      return true;
    }
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      this.model.addNodeState(nodeId, "missing");
      this.operationStatus = {
        kind: "warning",
        message: `Graph location is no longer available: ${uri.fsPath}`,
      };
      await this.publish();
      return false;
    }
  }

  private async expandCall(
    nodeId: string,
    direction: CallDirection,
  ): Promise<boolean> {
    const callNode = await this.ensureCallNode(nodeId);
    if (!callNode) {
      return false;
    }
    if (this.model.snapshot().staleReason) {
      void vscode.window.showInformationMessage(
        "C Insight: The Relationship Graph is stale. Run Show Relationship Graph again before expanding it.",
      );
      return false;
    }
    const depth = this.nodeDepth.get(nodeId) ?? 0;
    if (depth >= this.maximumDepth) {
      void vscode.window.showInformationMessage(
        `C Insight: Relationship Graph maximum depth ${this.maximumDepth} reached.`,
      );
      return false;
    }
    this.stopExpansion();
    const generation = this.generation;
    const cancellation = new vscode.CancellationTokenSource();
    this.expansion = cancellation;
    let completed = false;
    this.operationStatus = {
      kind: "info",
      message: `Loading ${direction === "incoming" ? "callers" : "callees"} for ${callNode.raw.name}…`,
    };
    await this.publish();
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `C Insight: Loading ${direction === "incoming" ? "Callers" : "Callees"} for ${callNode.raw.name}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            cancellation.cancel(),
          );
          try {
            await this.loadCallNeighbors(
              nodeId,
              direction,
              cancellation.token,
            );
          } finally {
            subscription.dispose();
          }
        },
      );
      if (
        generation === this.generation &&
        !cancellation.token.isCancellationRequested
      ) {
        this.operationStatus = this.limitStatus() ?? {
          kind: "info",
          message: "Expansion complete.",
        };
        await this.publish();
        completed = true;
      } else if (cancellation.token.isCancellationRequested) {
        this.operationStatus = {
          kind: "warning",
          message: "Expansion cancelled; loaded nodes remain available.",
        };
        await this.publish();
      }
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        this.operationStatus = {
          kind: "error",
          message: `Expansion failed: ${String(error)}`,
        };
        await this.publish();
        void vscode.window.showErrorMessage(
          `C Insight: Call Graph expansion failed: ${String(error)}`,
        );
      }
    } finally {
      if (this.expansion === cancellation) {
        this.expansion = undefined;
      }
      cancellation.dispose();
    }
    return completed;
  }

  private async loadCallNeighbors(
    nodeId: string,
    direction: CallDirection,
    token: vscode.CancellationToken,
  ): Promise<string[]> {
    const callNode = await this.ensureCallNode(nodeId);
    if (!callNode || token.isCancellationRequested) {
      return [];
    }
    const key = `${nodeId}:${direction}`;
    if (this.expandedCalls.has(key)) {
      return this.model
        .snapshot()
        .edges.filter(
          (edge) =>
            edge.relation === "calls" &&
            (direction === "incoming"
              ? edge.to === nodeId
              : edge.from === nodeId),
        )
        .map((edge) =>
          direction === "incoming" ? edge.from : edge.to,
        );
    }
    const neighbors: string[] = [];
    if (direction === "incoming") {
      const calls = await this.callRepository.incoming(callNode, token);
      for (const call of calls) {
        if (token.isCancellationRequested) {
          break;
        }
        const caller = this.analysis.callNode(call.from);
        const neighbor = this.addCallRelation(
          caller,
          callNode,
          call.from.uri,
          call.fromRanges[0]?.start.line,
          nodeId,
        );
        if (neighbor) {
          neighbors.push(neighbor);
        }
      }
    } else {
      const calls = await this.callRepository.outgoing(callNode, token);
      for (const call of calls) {
        if (token.isCancellationRequested) {
          break;
        }
        const callee = this.analysis.callNode(call.to);
        const neighbor = this.addCallRelation(
          callNode,
          callee,
          callNode.raw.uri,
          call.fromRanges[0]?.start.line,
          nodeId,
        );
        if (neighbor) {
          neighbors.push(neighbor);
        }
      }
    }
    if (!token.isCancellationRequested) {
      this.expandedCalls.add(key);
      this.model.addNodeState(nodeId, `expanded-${direction}`);
    }
    return neighbors;
  }

  private async expandType(
    nodeId: string,
    direction: TypeHierarchyDirection,
  ): Promise<boolean> {
    const item = await this.ensureTypeNode(nodeId);
    if (!item || !this.canExpand(nodeId)) {
      return false;
    }
    this.stopExpansion();
    const generation = this.generation;
    const cancellation = new vscode.CancellationTokenSource();
    this.expansion = cancellation;
    this.operationStatus = {
      kind: "info",
      message: `Loading ${direction} for ${item.name}…`,
    };
    await this.publish();
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `C Insight: Loading ${direction === "supertypes" ? "Supertypes" : "Subtypes"} for ${item.name}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            cancellation.cancel(),
          );
          try {
            await this.loadTypeNeighbors(
              nodeId,
              direction,
              cancellation.token,
            );
          } finally {
            subscription.dispose();
          }
        },
      );
      if (
        generation === this.generation &&
        !cancellation.token.isCancellationRequested
      ) {
        this.operationStatus = this.limitStatus() ?? {
          kind: "info",
          message: "Expansion complete.",
        };
        await this.publish();
        return true;
      }
      this.operationStatus = {
        kind: "warning",
        message: "Expansion cancelled; loaded nodes remain available.",
      };
      await this.publish();
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        this.operationStatus = {
          kind: "error",
          message: `Type Graph expansion failed: ${String(error)}`,
        };
        await this.publish();
      }
    } finally {
      if (this.expansion === cancellation) {
        this.expansion = undefined;
      }
      cancellation.dispose();
    }
    return false;
  }

  private async loadTypeNeighbors(
    nodeId: string,
    direction: TypeHierarchyDirection,
    token: vscode.CancellationToken,
  ): Promise<string[]> {
    const item = await this.ensureTypeNode(nodeId);
    if (!item || token.isCancellationRequested) {
      return [];
    }
    const key = `${nodeId}:${direction}`;
    if (this.expandedTypes.has(key)) {
      return this.model
        .snapshot()
        .edges.filter(
          (edge) =>
            edge.relation === "inherits" &&
            (direction === "supertypes"
              ? edge.to === nodeId
              : edge.from === nodeId),
        )
        .map((edge) =>
          direction === "supertypes" ? edge.from : edge.to,
        );
    }
    const related = await this.typeRepository.related(
      item,
      direction,
      token,
    );
    const neighbors: string[] = [];
    for (const relation of related) {
      if (token.isCancellationRequested) {
        break;
      }
      const neighbor = this.addTypeRelation(
        direction === "supertypes" ? relation : item,
        direction === "supertypes" ? item : relation,
        nodeId,
      );
      if (neighbor) {
        neighbors.push(neighbor);
      }
    }
    if (!token.isCancellationRequested) {
      this.expandedTypes.add(key);
      this.model.addNodeState(nodeId, `expanded-${direction}`);
    }
    return neighbors;
  }

  private async expandInclude(
    nodeId: string,
    direction: IncludeHierarchyDirection,
  ): Promise<boolean> {
    const uri = this.includeFiles.get(nodeId);
    if (!uri || !this.canExpand(nodeId)) {
      return false;
    }
    this.stopExpansion();
    const generation = this.generation;
    const cancellation = new vscode.CancellationTokenSource();
    this.expansion = cancellation;
    const buildingIndex =
      direction === "includedBy" &&
      !this.includeRepository.isReverseBuilt;
    this.operationStatus = {
      kind: "info",
      message: buildingIndex
        ? "Building Included By workspace index…"
        : `Loading ${direction === "includes" ? "includes" : "included by"} for ${path.basename(uri.fsPath)}…`,
    };
    await this.publish();
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: buildingIndex
            ? "C Insight: Building Included By index"
            : `C Insight: Loading ${direction === "includes" ? "Includes" : "Included By"}`,
          cancellable: true,
        },
        async (progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            cancellation.cancel(),
          );
          try {
            await this.loadIncludeNeighbors(
              nodeId,
              direction,
              cancellation.token,
              (completed, total) =>
                progress.report({
                  message: `${completed}/${total} files`,
                }),
            );
          } finally {
            subscription.dispose();
          }
        },
      );
      if (
        generation === this.generation &&
        !cancellation.token.isCancellationRequested
      ) {
        this.operationStatus = this.limitStatus() ?? {
          kind:
            this.includeRepository.wasReverseTruncated &&
            direction === "includedBy"
              ? "warning"
              : "info",
          message:
            this.includeRepository.wasReverseTruncated &&
            direction === "includedBy"
              ? "Included By index reached workspaceFileLimit; results may be incomplete."
              : "Expansion complete.",
        };
        await this.publish();
        return true;
      }
      this.operationStatus = {
        kind: "warning",
        message: "Expansion cancelled; loaded nodes remain available.",
      };
      await this.publish();
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        this.operationStatus = {
          kind: "error",
          message: `Include Graph expansion failed: ${String(error)}`,
        };
        await this.publish();
      }
    } finally {
      if (this.expansion === cancellation) {
        this.expansion = undefined;
      }
      cancellation.dispose();
    }
    return false;
  }

  private async loadIncludeNeighbors(
    nodeId: string,
    direction: IncludeHierarchyDirection,
    token: vscode.CancellationToken,
    progress?: (completed: number, total: number) => void,
  ): Promise<string[]> {
    const uri = this.includeFiles.get(nodeId);
    if (!uri || token.isCancellationRequested) {
      return [];
    }
    const key = `${nodeId}:${direction}`;
    if (this.expandedIncludes.has(key)) {
      return this.model
        .snapshot()
        .edges.filter(
          (edge) =>
            edge.relation === "includes" &&
            (direction === "includes"
              ? edge.from === nodeId
              : edge.to === nodeId),
        )
        .map((edge) =>
          direction === "includes" ? edge.to : edge.from,
        );
    }
    const neighbors: string[] = [];
    if (direction === "includes") {
      const includes = await this.includeRepository.forward(uri);
      for (const include of includes) {
        if (token.isCancellationRequested) {
          break;
        }
        if (
          include.kind === "system" &&
          !this.includeSystemHeaders
        ) {
          continue;
        }
        const neighbor = include.uri
          ? this.addIncludeRelation(
              uri,
              include.uri,
              include.directive.line,
              include.kind,
              nodeId,
            )
          : this.addUnresolvedInclude(
              uri,
              include.directive.target,
              include.directive.line,
              nodeId,
            );
        if (neighbor) {
          neighbors.push(neighbor);
        }
      }
    } else {
      const incoming = await this.includeRepository.incoming(
        uri,
        token,
        progress,
      );
      for (const edge of incoming) {
        if (token.isCancellationRequested) {
          break;
        }
        if (edge.kind === "system" && !this.includeSystemHeaders) {
          continue;
        }
        const neighbor = this.addIncludeRelation(
          edge.source,
          uri,
          edge.directive.line,
          edge.kind,
          nodeId,
        );
        if (neighbor) {
          neighbors.push(neighbor);
        }
      }
    }
    if (!token.isCancellationRequested) {
      this.expandedIncludes.add(key);
      this.model.addNodeState(nodeId, `expanded-${direction}`);
    }
    return neighbors;
  }

  private async expandToDepth(nodeId: string): Promise<void> {
    const capabilities = this.model.node(nodeId)?.capabilities ?? [];
    const isCall = capabilities.includes("calls");
    const isType = capabilities.includes("inherits");
    const isInclude = capabilities.includes("includes");
    if (!isCall && !isType && !isInclude) {
      return;
    }
    const value = await vscode.window.showInputBox({
      title: `Expand ${isCall ? "Call" : isType ? "Type" : "Include"} Graph to Depth`,
      prompt: `Load ${isCall ? "callers and callees" : isType ? "supertypes and subtypes" : "includes and included by"} from the selected node (maximum ${this.maximumDepth})`,
      value: String(Math.min(2, this.maximumDepth)),
      validateInput: (input) => {
        const depth = Number(input);
        return Number.isInteger(depth) &&
          depth >= 1 &&
          depth <= this.maximumDepth
          ? undefined
          : `Enter an integer from 1 to ${this.maximumDepth}`;
      },
    });
    if (!value) {
      return;
    }
    const requestedDepth = Number(value);
    this.stopExpansion();
    const cancellation = new vscode.CancellationTokenSource();
    this.expansion = cancellation;
    this.operationStatus = {
      kind: "info",
      message: `Expanding ${isCall ? "callers and callees" : isType ? "supertypes and subtypes" : "includes and included by"} to depth ${requestedDepth}…`,
    };
    await this.publish();
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `C Insight: Expanding ${isCall ? "Call" : isType ? "Type" : "Include"} Graph to depth ${requestedDepth}`,
          cancellable: true,
        },
        async (progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            cancellation.cancel(),
          );
          const queue = [{ id: nodeId, depth: 0 }];
          const visited = new Set<string>();
          try {
            while (
              queue.length > 0 &&
              !cancellation.token.isCancellationRequested
            ) {
              const current = queue.shift()!;
              if (
                current.depth >= requestedDepth ||
                visited.has(current.id) ||
                (this.nodeDepth.get(current.id) ?? 0) >= this.maximumDepth
              ) {
                continue;
              }
              visited.add(current.id);
              progress.report({
                message: `${visited.size} nodes processed`,
              });
              const incoming = isCall
                ? await this.loadCallNeighbors(
                    current.id,
                    "incoming",
                    cancellation.token,
                  )
                : isType
                  ? await this.loadTypeNeighbors(
                      current.id,
                      "supertypes",
                      cancellation.token,
                    )
                  : await this.loadIncludeNeighbors(
                      current.id,
                      "includedBy",
                      cancellation.token,
                    );
              const outgoing = isCall
                ? await this.loadCallNeighbors(
                    current.id,
                    "outgoing",
                    cancellation.token,
                  )
                : isType
                  ? await this.loadTypeNeighbors(
                      current.id,
                      "subtypes",
                      cancellation.token,
                    )
                  : await this.loadIncludeNeighbors(
                      current.id,
                      "includes",
                      cancellation.token,
                    );
              for (const id of [...incoming, ...outgoing]) {
                if (!visited.has(id)) {
                  queue.push({ id, depth: current.depth + 1 });
                }
              }
              if (this.model.snapshot().limitedBy) {
                break;
              }
            }
          } finally {
            subscription.dispose();
          }
        },
      );
      this.operationStatus = cancellation.token.isCancellationRequested
        ? {
            kind: "warning",
            message: "Expansion cancelled; loaded nodes remain available.",
          }
        : (this.limitStatus() ?? {
            kind: "info",
            message: `Depth ${requestedDepth} expansion complete.`,
          });
    } catch (error) {
      this.operationStatus = {
        kind: "error",
        message: `Expansion failed: ${String(error)}`,
      };
    } finally {
      if (this.expansion === cancellation) {
        this.expansion = undefined;
      }
      cancellation.dispose();
      await this.publish();
    }
  }

  private addCallRelation(
    from: CallNode,
    to: CallNode,
    sourceUri: string,
    zeroBasedLine: number | undefined,
    expandedNodeId: string,
  ): string | undefined {
    const fromGraph = this.callGraphNode(from);
    const toGraph = this.callGraphNode(to);
    const fromExists = this.model.node(fromGraph.id) !== undefined;
    const toExists = this.model.node(toGraph.id) !== undefined;
    if (fromExists) {
      fromGraph.states.push("duplicate");
    }
    if (toExists) {
      toGraph.states.push("duplicate");
    }
    if (!this.model.addNode(fromGraph) || !this.model.addNode(toGraph)) {
      return undefined;
    }
    this.callNodes.set(fromGraph.id, from);
    this.callNodes.set(toGraph.id, to);
    const expandedDepth = this.nodeDepth.get(expandedNodeId) ?? 0;
    const neighborId =
      fromGraph.id === expandedNodeId ? toGraph.id : fromGraph.id;
    const existingDepth = this.nodeDepth.get(neighborId);
    this.nodeDepth.set(
      neighborId,
      existingDepth === undefined
        ? expandedDepth + 1
        : Math.min(existingDepth, expandedDepth + 1),
    );
    const line = zeroBasedLine === undefined ? undefined : zeroBasedLine + 1;
    const cycle = this.model.hasPath(toGraph.id, fromGraph.id);
    const direct = fromGraph.id === toGraph.id;
    if (direct || cycle) {
      this.model.addNodeState(
        neighborId,
        direct ? "direct-recursion" : "indirect-recursion",
      );
    }
    this.model.addEdge({
      id: graphEdgeId(
        "calls",
        fromGraph.id,
        toGraph.id,
        sourceUri,
        line,
      ),
      from: fromGraph.id,
      to: toGraph.id,
      relation: "calls",
      sourceUri,
      line,
      states: direct
        ? ["direct-recursion"]
        : cycle
          ? ["indirect-recursion"]
          : [],
    });
    return neighborId;
  }

  private addTypeRelation(
    supertype: TypeHierarchyItem,
    subtype: TypeHierarchyItem,
    expandedNodeId: string,
  ): string | undefined {
    const superGraph = this.typeGraphNode(supertype);
    const subGraph = this.typeGraphNode(subtype);
    if (this.model.node(superGraph.id)) {
      superGraph.states.push("duplicate");
    }
    if (this.model.node(subGraph.id)) {
      subGraph.states.push("duplicate");
    }
    if (!this.model.addNode(superGraph) || !this.model.addNode(subGraph)) {
      return undefined;
    }
    this.typeNodes.set(superGraph.id, supertype);
    this.typeNodes.set(subGraph.id, subtype);
    const expandedDepth = this.nodeDepth.get(expandedNodeId) ?? 0;
    const neighborId =
      superGraph.id === expandedNodeId ? subGraph.id : superGraph.id;
    const existingDepth = this.nodeDepth.get(neighborId);
    this.nodeDepth.set(
      neighborId,
      existingDepth === undefined
        ? expandedDepth + 1
        : Math.min(existingDepth, expandedDepth + 1),
    );
    const cycle = this.model.hasPath(subGraph.id, superGraph.id);
    const direct = superGraph.id === subGraph.id;
    if (direct || cycle) {
      this.model.addNodeState(
        neighborId,
        direct ? "direct-recursion" : "indirect-recursion",
      );
    }
    this.model.addEdge({
      id: graphEdgeId("inherits", superGraph.id, subGraph.id),
      from: superGraph.id,
      to: subGraph.id,
      relation: "inherits",
      states: direct
        ? ["direct-recursion"]
        : cycle
          ? ["indirect-recursion"]
          : [],
    });
    return neighborId;
  }

  private addIncludeRelation(
    source: vscode.Uri,
    target: vscode.Uri,
    zeroBasedLine: number,
    kind: IncludeTargetKind,
    expandedNodeId: string,
  ): string | undefined {
    const sourceGraph = fileNode(source);
    const targetGraph = fileNode(target);
    sourceGraph.states.push(kind);
    targetGraph.states.push(kind);
    if (this.model.node(sourceGraph.id)) {
      sourceGraph.states.push("duplicate");
    }
    if (this.model.node(targetGraph.id)) {
      targetGraph.states.push("duplicate");
    }
    if (!this.model.addNode(sourceGraph) || !this.model.addNode(targetGraph)) {
      return undefined;
    }
    this.includeFiles.set(sourceGraph.id, source);
    this.includeFiles.set(targetGraph.id, target);
    const neighborId =
      sourceGraph.id === expandedNodeId ? targetGraph.id : sourceGraph.id;
    this.recordNeighborDepth(expandedNodeId, neighborId);
    const line = zeroBasedLine + 1;
    const cycle = this.model.hasPath(targetGraph.id, sourceGraph.id);
    const direct = sourceGraph.id === targetGraph.id;
    if (direct || cycle) {
      this.model.addNodeState(
        neighborId,
        direct ? "direct-cycle" : "indirect-cycle",
      );
    }
    this.model.addEdge({
      id: graphEdgeId(
        "includes",
        sourceGraph.id,
        targetGraph.id,
        source.toString(),
        line,
      ),
      from: sourceGraph.id,
      to: targetGraph.id,
      relation: "includes",
      sourceUri: source.toString(),
      line,
      states: direct
        ? ["direct-cycle"]
        : cycle
          ? ["indirect-cycle"]
          : [],
    });
    return neighborId;
  }

  private addUnresolvedInclude(
    source: vscode.Uri,
    target: string,
    zeroBasedLine: number,
    expandedNodeId: string,
  ): string | undefined {
    const sourceGraph = fileNode(source);
    const line = zeroBasedLine + 1;
    const unresolved: GraphNode = {
      id: graphNodeId(
        "unresolved",
        source.toString(),
        line,
        target,
      ),
      kind: "unresolved",
      name: target,
      detail: "unresolved include",
      uri: source.toString(),
      line,
      character: 0,
      states: ["unresolved"],
      capabilities: [],
    };
    if (!this.model.addNode(sourceGraph) || !this.model.addNode(unresolved)) {
      return undefined;
    }
    this.model.addEdge({
      id: graphEdgeId(
        "includes",
        sourceGraph.id,
        unresolved.id,
        source.toString(),
        line,
      ),
      from: sourceGraph.id,
      to: unresolved.id,
      relation: "includes",
      sourceUri: source.toString(),
      line,
      states: ["unresolved"],
    });
    this.recordNeighborDepth(expandedNodeId, unresolved.id);
    return unresolved.id;
  }

  private recordNeighborDepth(
    expandedNodeId: string,
    neighborId: string,
  ): void {
    const depth = (this.nodeDepth.get(expandedNodeId) ?? 0) + 1;
    const existing = this.nodeDepth.get(neighborId);
    this.nodeDepth.set(
      neighborId,
      existing === undefined ? depth : Math.min(existing, depth),
    );
  }

  private addDefiningFile(nodeId: string): void {
    const node = this.model.node(nodeId);
    if (!node?.uri || !this.canExpand(nodeId)) {
      return;
    }
    const uri = vscode.Uri.parse(node.uri);
    if (uri.scheme !== "file") {
      return;
    }
    const file = fileNode(uri);
    if (!this.model.addNode(file)) {
      this.operationStatus = this.limitStatus();
      return;
    }
    this.includeFiles.set(file.id, uri);
    this.recordNeighborDepth(nodeId, file.id);
    this.addDefinitionRelation(file.id, nodeId, uri, node.line);
    this.model.addNodeState(nodeId, "linked-file");
    this.operationStatus = this.limitStatus() ?? {
      kind: "info",
      message: `Added defining file for ${node.name}.`,
    };
  }

  private async addTypeMembers(nodeId: string): Promise<void> {
    const type = await this.ensureTypeNode(nodeId);
    if (!type || !this.canExpand(nodeId)) {
      return;
    }
    if (this.model.node(nodeId)?.states.includes("expanded-members")) {
      this.operationStatus = {
        kind: "info",
        message: `Members for ${type.name} are already loaded.`,
      };
      await this.publish();
      return;
    }
    this.stopExpansion();
    const cancellation = new vscode.CancellationTokenSource();
    this.expansion = cancellation;
    const uri = vscode.Uri.parse(type.uri);
    this.operationStatus = {
      kind: "info",
      message: `Loading members for ${type.name}…`,
    };
    await this.publish();
    try {
      const symbols = await this.analysis.documentSymbols(uri);
      const members = findTypeMembers(
        symbols,
        type.name,
        type.selectionRange.start.line,
      );
      let added = 0;
      for (const member of members) {
        if (
          cancellation.token.isCancellationRequested ||
          this.model.snapshot().limitedBy
        ) {
          break;
        }
        const roots = await this.callRepository.prepare(
          uri,
          new vscode.Position(
            member.position.line,
            member.position.character,
          ),
          cancellation.token,
        );
        const callNode = roots[0];
        if (!callNode) {
          continue;
        }
        const graphNode = this.callGraphNode(callNode);
        if (!this.model.addNode(graphNode)) {
          break;
        }
        this.callNodes.set(graphNode.id, callNode);
        this.recordNeighborDepth(nodeId, graphNode.id);
        this.addDefinitionRelation(
          nodeId,
          graphNode.id,
          uri,
          member.position.line + 1,
        );
        added += 1;
      }
      if (cancellation.token.isCancellationRequested) {
        this.operationStatus = {
          kind: "warning",
          message: "Member loading cancelled; loaded nodes remain available.",
        };
      } else {
        this.model.addNodeState(nodeId, "expanded-members");
        this.operationStatus = this.limitStatus() ?? {
          kind: "info",
          message:
            added > 0
              ? `Added ${added} callable members for ${type.name}.`
              : `No callable members were found for ${type.name}.`,
        };
      }
    } catch (error) {
      this.operationStatus = {
        kind: "error",
        message: `Loading type members failed: ${String(error)}`,
      };
    }
    if (this.expansion === cancellation) {
      this.expansion = undefined;
    }
    cancellation.dispose();
    await this.publish();
  }

  private async addContainingType(nodeId: string): Promise<void> {
    const call = await this.ensureCallNode(nodeId);
    if (!call || !this.canExpand(nodeId)) {
      return;
    }
    if (
      this.model
        .snapshot()
        .edges.some(
          (edge) =>
            edge.relation === "defines" &&
            edge.to === nodeId &&
            this.typeNodes.has(edge.from),
        )
    ) {
      this.operationStatus = {
        kind: "info",
        message: `The containing type for ${call.raw.name} is already loaded.`,
      };
      await this.publish();
      return;
    }
    const uri = vscode.Uri.parse(call.raw.uri);
    try {
      const symbols = await this.analysis.documentSymbols(uri);
      const typeSymbol = findContainingType(
        symbols,
        call.raw.selectionRange.start.line,
      );
      const typePosition =
        typeSymbol?.position ??
        (await this.containingTypePositionFromSource(uri, call));
      if (!typePosition) {
        this.operationStatus = {
          kind: "info",
          message: `No containing type was found for ${call.raw.name}.`,
        };
        await this.publish();
        return;
      }
      const roots = await this.typeRepository.prepare(
        uri,
        new vscode.Position(
          typePosition.line,
          typePosition.character,
        ),
      );
      const type = roots[0];
      if (!type) {
        this.operationStatus = {
          kind: "info",
          message: `clangd did not provide a containing type for ${call.raw.name}.`,
        };
        await this.publish();
        return;
      }
      const graphNode = this.typeGraphNode(type);
      if (this.model.addNode(graphNode)) {
        this.typeNodes.set(graphNode.id, type);
        this.recordNeighborDepth(nodeId, graphNode.id);
        this.addDefinitionRelation(
          graphNode.id,
          nodeId,
          uri,
          call.raw.selectionRange.start.line + 1,
        );
      }
      this.operationStatus = this.limitStatus() ?? {
        kind: "info",
        message: `Added containing type ${type.name}.`,
      };
    } catch (error) {
      this.operationStatus = {
        kind: "error",
        message: `Loading containing type failed: ${String(error)}`,
      };
    }
    await this.publish();
  }

  private async containingTypePositionFromSource(
    uri: vscode.Uri,
    call: CallNode,
  ): Promise<{ line: number; character: number } | undefined> {
    const document = await vscode.workspace.openTextDocument(uri);
    const first = Math.max(0, call.raw.range.start.line);
    const last = Math.min(
      document.lineCount - 1,
      call.raw.selectionRange.start.line,
    );
    for (let line = first; line <= last; line += 1) {
      const text = document.lineAt(line).text;
      const matches = [...text.matchAll(/([A-Za-z_]\w*)::/g)];
      const match = matches.at(-1);
      if (match?.index !== undefined) {
        return { line, character: match.index };
      }
    }
    return undefined;
  }

  private addDefinitionRelation(
    containerId: string,
    symbolId: string,
    source: vscode.Uri,
    line = 1,
  ): void {
    this.model.addEdge({
      id: graphEdgeId(
        "defines",
        containerId,
        symbolId,
        source.toString(),
        line,
      ),
      from: containerId,
      to: symbolId,
      relation: "defines",
      sourceUri: source.toString(),
      line,
      states: [],
    });
  }

  private async searchLoadedNodes(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      this.model.snapshot().nodes.map((node) => ({
        label: node.name,
        description: node.detail ?? node.kind,
        detail: node.uri
          ? `${vscode.workspace.asRelativePath(vscode.Uri.parse(node.uri))}:${node.line ?? 1}`
          : undefined,
        nodeId: node.id,
      })),
      {
        title: "Search Loaded Relationship Graph Nodes",
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (picked) {
      await this.panel?.webview.postMessage({
        type: "focusNode",
        nodeId: picked.nodeId,
      });
      await this.previewNode(picked.nodeId);
    }
  }

  private async showNodeActions(nodeId: string): Promise<void> {
    const node = this.model.node(nodeId);
    if (!node) {
      return;
    }
    const typeNode =
      this.typeNodes.has(nodeId) || node.kind === "type";
    const includeNode = this.includeFiles.has(nodeId);
    const callNode =
      this.callNodes.has(nodeId) ||
      node.kind === "function" ||
      node.kind === "method";
    const expandable = typeNode || includeNode || callNode;
    const action = await vscode.window.showQuickPick(
      [
        ...(expandable
          ? [
              {
                label: typeNode
                  ? "$(type-hierarchy-super) Expand Supertypes"
                  : includeNode
                    ? "$(references) Expand Included By"
                    : "$(references) Expand Callers",
                value: "incoming",
              },
              {
                label: typeNode
                  ? "$(type-hierarchy-sub) Expand Subtypes"
                  : includeNode
                    ? "$(files) Expand Includes"
                    : "$(references) Expand Callees",
                value: "outgoing",
              },
              {
                label: "$(layers) Expand to Depth…",
                value: "depth",
              },
            ]
          : []),
        ...(!includeNode && node.kind !== "unresolved"
          ? [
              {
                label: "$(file-code) Add Defining File",
                value: "definingFile",
              },
            ]
          : []),
        ...(typeNode
          ? [
              {
                label: "$(symbol-method) Add Type Members",
                value: "members",
              },
            ]
          : []),
        ...(callNode
          ? [
              {
                label: "$(symbol-class) Add Containing Type",
                value: "containingType",
              },
            ]
          : []),
        { label: "$(bookmark) Add Bookmark", value: "bookmark" },
        { label: "$(go-to-file) Open Location", value: "open" },
        { label: "$(target) Focus Node", value: "focus" },
      ],
      { title: node.name },
    );
    if (!action) {
      return;
    }
    if (action.value === "incoming" || action.value === "outgoing") {
      if (typeNode) {
        await this.expandType(
          nodeId,
          action.value === "incoming" ? "supertypes" : "subtypes",
        );
      } else if (includeNode) {
        await this.expandInclude(
          nodeId,
          action.value === "incoming" ? "includedBy" : "includes",
        );
      } else {
        await this.expandCall(nodeId, action.value);
      }
    } else if (action.value === "depth") {
      await this.expandToDepth(nodeId);
    } else if (action.value === "definingFile") {
      this.addDefiningFile(nodeId);
      await this.publish();
    } else if (action.value === "members") {
      await this.addTypeMembers(nodeId);
    } else if (action.value === "containingType") {
      await this.addContainingType(nodeId);
    } else if (action.value === "bookmark") {
      const location = nodeLocation(node);
      if (location) {
        await this.bookmarks.addNode({
          label: node.name,
          location,
          previewTitle: node.name,
          previewMode: "definition",
        });
      }
    } else if (action.value === "open") {
      await this.openNode(nodeId);
    } else {
      await this.panel?.webview.postMessage({
        type: "focusNode",
        nodeId,
      });
    }
  }

  private async chooseExport(): Promise<void> {
    const format = await vscode.window.showQuickPick(
      [
        { label: "Text", value: "text" as const },
        { label: "JSON", value: "json" as const },
        { label: "Mermaid", value: "mermaid" as const },
      ],
      { title: "Export Loaded Relationship Graph" },
    );
    if (format) {
      await this.exportGraph(format.value);
    }
  }

  async exportGraph(format: "text" | "json" | "mermaid"): Promise<void> {
    if (!this.panel) {
      void vscode.window.showInformationMessage(
        "C Insight: Open a Relationship Graph before exporting.",
      );
      return;
    }
    const extension =
      format === "json" ? "json" : format === "mermaid" ? "md" : "txt";
    const uri = await vscode.window.showSaveDialog({
      title: `Export Relationship Graph as ${format}`,
      filters: { [format]: [extension] },
      defaultUri: vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ??
          vscode.Uri.file(process.cwd()),
        `relationship-graph.${extension}`,
      ),
    });
    if (!uri) {
      return;
    }
    const snapshot = this.model.snapshot();
    const content =
      format === "json"
        ? renderGraphJson(snapshot)
        : format === "mermaid"
          ? `\`\`\`mermaid\n${renderGraphMermaid(snapshot)}\n\`\`\`\n`
          : renderGraphText(snapshot);
    await writeExportWithinBudget(uri, content);
    void vscode.window.showInformationMessage(
      `C Insight: Relationship Graph exported to ${uri.fsPath}`,
    );
  }

  private limitStatus():
    | { kind: "warning"; message: string }
    | undefined {
    const limitedBy = this.model.snapshot().limitedBy;
    return limitedBy
      ? {
          kind: "warning",
          message: `Graph limit reached: ${limitedBy}. Loaded nodes remain available.`,
        }
      : undefined;
  }

  private async ensureCallNode(
    nodeId: string,
  ): Promise<CallNode | undefined> {
    const existing = this.callNodes.get(nodeId);
    if (existing) {
      return existing;
    }
    const node = this.model.node(nodeId);
    if (
      !node?.uri ||
      (node.kind !== "function" && node.kind !== "method")
    ) {
      return undefined;
    }
    const uri = vscode.Uri.parse(node.uri);
    const position = await this.restoredNodePosition(node);
    let roots: CallNode[];
    try {
      roots = await this.callRepository.prepare(uri, position);
    } catch (error) {
      this.operationStatus = {
        kind: "error",
        message: `Call node revalidation failed: ${String(error)}`,
      };
      await this.publish();
      return undefined;
    }
    const matched =
      roots.find(
        (candidate) =>
          candidate.raw.name === node.name ||
          candidate.raw.name.endsWith(`::${node.name}`),
      ) ?? roots[0];
    if (matched) {
      this.callNodes.set(nodeId, matched);
      this.model.addNodeState(nodeId, "revalidated");
    }
    return matched;
  }

  private async ensureTypeNode(
    nodeId: string,
  ): Promise<TypeHierarchyItem | undefined> {
    const existing = this.typeNodes.get(nodeId);
    if (existing) {
      return existing;
    }
    const node = this.model.node(nodeId);
    if (!node?.uri || node.kind !== "type") {
      return undefined;
    }
    const uri = vscode.Uri.parse(node.uri);
    const position = await this.restoredNodePosition(node);
    let roots: TypeHierarchyItem[];
    try {
      roots = await this.typeRepository.prepare(uri, position);
    } catch (error) {
      this.operationStatus = {
        kind: "error",
        message: `Type node revalidation failed: ${String(error)}`,
      };
      await this.publish();
      return undefined;
    }
    const matched =
      roots.find((candidate) => candidate.name === node.name) ?? roots[0];
    if (matched) {
      this.typeNodes.set(nodeId, matched);
      this.model.addNodeState(nodeId, "revalidated");
    }
    return matched;
  }

  private async restoredNodePosition(
    node: GraphNode,
  ): Promise<vscode.Position> {
    const line = Math.max(0, (node.line ?? 1) - 1);
    if (node.character !== undefined) {
      return new vscode.Position(line, node.character);
    }
    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.parse(node.uri!),
      );
      const text = document.lineAt(
        Math.min(line, document.lineCount - 1),
      ).text;
      const name = node.name.split("::").at(-1) ?? node.name;
      return new vscode.Position(line, Math.max(0, text.indexOf(name)));
    } catch {
      return new vscode.Position(line, 0);
    }
  }

  private callGraphNode(node: CallNode): GraphNode {
    const raw = node.raw;
    const line = raw.selectionRange.start.line + 1;
    const kind =
      raw.kind === SymbolKind.Method ||
      raw.kind === SymbolKind.Constructor
        ? "method"
        : "function";
    return {
      id: graphNodeId(kind, raw.uri, line, raw.name),
      kind,
      name: raw.name,
      detail: raw.detail,
      uri: raw.uri,
      line,
      character: raw.selectionRange.start.character,
      states: [],
      capabilities: ["calls"],
    };
  }

  private typeGraphNode(item: TypeHierarchyItem): GraphNode {
    const line = item.selectionRange.start.line + 1;
    return {
      id: graphNodeId("type", item.uri, line, item.name),
      kind: "type",
      name: item.name,
      detail: item.detail,
      uri: item.uri,
      line,
      character: item.selectionRange.start.character,
      states: [],
      capabilities: ["inherits"],
    };
  }

  private canExpand(nodeId: string): boolean {
    if (this.model.snapshot().staleReason) {
      void vscode.window.showInformationMessage(
        "C Insight: The Relationship Graph is stale. Run Show Relationship Graph again before expanding it.",
      );
      return false;
    }
    if ((this.nodeDepth.get(nodeId) ?? 0) >= this.maximumDepth) {
      void vscode.window.showInformationMessage(
        `C Insight: Relationship Graph maximum depth ${this.maximumDepth} reached.`,
      );
      return false;
    }
    return true;
  }

  private rebuildRestoredDepths(): void {
    this.nodeDepth.clear();
    const snapshot = this.model.snapshot();
    if (!snapshot.rootId) {
      return;
    }
    this.nodeDepth.set(snapshot.rootId, 0);
    const adjacency = new Map<string, string[]>();
    for (const edge of snapshot.edges) {
      const from = adjacency.get(edge.from) ?? [];
      from.push(edge.to);
      adjacency.set(edge.from, from);
      const to = adjacency.get(edge.to) ?? [];
      to.push(edge.from);
      adjacency.set(edge.to, to);
    }
    const queue = [snapshot.rootId];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const depth = this.nodeDepth.get(current) ?? 0;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!this.nodeDepth.has(neighbor)) {
          this.nodeDepth.set(neighbor, depth + 1);
          queue.push(neighbor);
        }
      }
    }
  }

  private stopExpansion(): void {
    this.expansion?.cancel();
    this.expansion?.dispose();
    this.expansion = undefined;
  }

  private get defaultDepth(): number {
    return vscode.workspace
      .getConfiguration("cInsight.relationshipGraph")
      .get<number>("defaultDepth", 1);
  }

  private get maximumDepth(): number {
    return vscode.workspace
      .getConfiguration("cInsight.relationshipGraph")
      .get<number>("maximumDepth", 10);
  }

  private get includeSystemHeaders(): boolean {
    return vscode.workspace
      .getConfiguration("cInsight.relationshipGraph")
      .get<boolean>("includeSystemHeaders", false);
  }

  private async publish(): Promise<void> {
    const posted = await this.panel?.webview.postMessage({
      type: "graphSnapshot",
      graph: this.model.snapshot(),
      operationStatus: this.operationStatus,
      canvasState: this.pendingCanvasRestore,
    });
    if (posted && this.pendingCanvasRestore) {
      this.pendingCanvasRestore = undefined;
    }
  }
}

interface SymbolPosition {
  position: { line: number; character: number };
}

function findTypeMembers(
  symbols: LspSymbol[],
  typeName: string,
  typeLine: number,
): SymbolPosition[] {
  const members: SymbolPosition[] = [];
  const visit = (items: LspSymbol[]): void => {
    for (const symbol of items) {
      if ("location" in symbol) {
        const info = symbol as SymbolInformation;
        if (
          isCallableSymbolKind(info.kind) &&
          info.containerName?.split("::").at(-1) === typeName
        ) {
          members.push({ position: info.location.range.start });
        }
        continue;
      }
      const document = symbol as DocumentSymbol;
      if (
        isTypeSymbolKind(document.kind) &&
        document.name === typeName &&
        document.range.start.line <= typeLine &&
        document.range.end.line >= typeLine
      ) {
        for (const child of document.children ?? []) {
          if (isCallableSymbolKind(child.kind)) {
            members.push({ position: child.selectionRange.start });
          }
        }
      } else if (document.children) {
        visit(document.children);
      }
    }
  };
  visit(symbols);
  return uniqueSymbolPositions(members);
}

function findContainingType(
  symbols: LspSymbol[],
  line: number,
): SymbolPosition | undefined {
  let best: { position: SymbolPosition["position"]; span: number } | undefined;
  const visit = (items: LspSymbol[]): void => {
    for (const symbol of items) {
      const range =
        "location" in symbol
          ? (symbol as SymbolInformation).location.range
          : (symbol as DocumentSymbol).range;
      if (
        isTypeSymbolKind(symbol.kind) &&
        range.start.line <= line &&
        range.end.line >= line
      ) {
        const span = range.end.line - range.start.line;
        if (!best || span < best.span) {
          best = {
            position:
              "location" in symbol
                ? (symbol as SymbolInformation).location.range.start
                : (symbol as DocumentSymbol).selectionRange.start,
            span,
          };
        }
      }
      if (!("location" in symbol) && symbol.children) {
        visit(symbol.children);
      }
    }
  };
  visit(symbols);
  return best ? { position: best.position } : undefined;
}

function uniqueSymbolPositions(
  values: SymbolPosition[],
): SymbolPosition[] {
  const seen = new Set<string>();
  return values.filter(({ position }) => {
    const key = `${position.line}:${position.character}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isCallableSymbolKind(kind: number): boolean {
  return ([
    SymbolKind.Function,
    SymbolKind.Method,
    SymbolKind.Constructor,
  ] as number[]).includes(kind);
}

function isTypeSymbolKind(kind: number): boolean {
  return ([
    SymbolKind.Class,
    SymbolKind.Struct,
    SymbolKind.Interface,
  ] as number[]).includes(kind);
}

function nodeLocation(
  node: GraphNode | undefined,
): vscode.Location | undefined {
  if (!node?.uri) {
    return undefined;
  }
  const line = Math.max(0, (node.line ?? 1) - 1);
  const character = Math.max(0, node.character ?? 0);
  return new vscode.Location(
    vscode.Uri.parse(node.uri),
    new vscode.Range(line, character, line, character),
  );
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
    character: 0,
    states: [],
    capabilities: ["includes"],
  };
}

function defaultCanvasState(): Omit<
  RelationshipGraphSessionState,
  "schemaVersion" | "graph"
> {
  return {
    enabledRelations: ["calls", "inherits", "includes", "defines"],
    collapsedIds: [],
    viewport: { scale: 1, tx: 80, ty: 80 },
  };
}

function isGraphRelation(value: string): value is GraphNode["capabilities"][number] {
  return ["calls", "inherits", "includes", "defines"].includes(value);
}

function isGraphMessage(value: unknown): value is GraphMessage {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }
  const type = (value as { type: unknown }).type;
  if (type === "ready") {
    return true;
  }
  if (type === "stopExpansion") {
    return true;
  }
  if (type === "search" || type === "export") {
    return true;
  }
  if (type === "slowRender") {
    return (
      "duration" in value &&
      typeof (value as { duration: unknown }).duration === "number" &&
      "nodes" in value &&
      typeof (value as { nodes: unknown }).nodes === "number" &&
      "edges" in value &&
      typeof (value as { edges: unknown }).edges === "number"
    );
  }
  if (type === "canvasState") {
    return (
      (!("selectedId" in value) ||
        typeof (value as { selectedId?: unknown }).selectedId ===
          "string") &&
      "enabledRelations" in value &&
      Array.isArray(
        (value as { enabledRelations: unknown }).enabledRelations,
      ) &&
      (value as { enabledRelations: unknown[] }).enabledRelations.every(
        (relation) =>
          typeof relation === "string" && isGraphRelation(relation),
      ) &&
      "collapsedIds" in value &&
      Array.isArray((value as { collapsedIds: unknown }).collapsedIds) &&
      (value as { collapsedIds: unknown[] }).collapsedIds.every(
        (id) => typeof id === "string",
      ) &&
      "viewport" in value &&
      isCanvasViewport((value as { viewport: unknown }).viewport)
    );
  }
  if (type === "expandCall") {
    return (
      "nodeId" in value &&
      typeof (value as { nodeId: unknown }).nodeId === "string" &&
      "direction" in value &&
      ((value as { direction: unknown }).direction === "incoming" ||
        (value as { direction: unknown }).direction === "outgoing")
    );
  }
  if (type === "expandType") {
    return (
      "nodeId" in value &&
      typeof (value as { nodeId: unknown }).nodeId === "string" &&
      "direction" in value &&
      ((value as { direction: unknown }).direction === "supertypes" ||
        (value as { direction: unknown }).direction === "subtypes")
    );
  }
  if (type === "expandInclude") {
    return (
      "nodeId" in value &&
      typeof (value as { nodeId: unknown }).nodeId === "string" &&
      "direction" in value &&
      ((value as { direction: unknown }).direction === "includes" ||
        (value as { direction: unknown }).direction === "includedBy")
    );
  }
  return (
    (type === "selectNode" ||
      type === "openNode" ||
      type === "nodeContext" ||
      type === "expandToDepth") &&
    "nodeId" in value &&
    typeof (value as { nodeId: unknown }).nodeId === "string"
  );
}

function isCanvasViewport(
  value: unknown,
): value is { scale: number; tx: number; ty: number } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const viewport = value as Record<string, unknown>;
  return (
    typeof viewport.scale === "number" &&
    viewport.scale >= 0.1 &&
    viewport.scale <= 5 &&
    typeof viewport.tx === "number" &&
    Number.isFinite(viewport.tx) &&
    typeof viewport.ty === "number" &&
    Number.isFinite(viewport.ty)
  );
}

function graphHtml(): string {
  const nonce = randomNonce();
  const labels = {
    expandCallers: vscode.l10n.t("Expand Callers"),
    expandCallees: vscode.l10n.t("Expand Callees"),
    expandSupertypes: vscode.l10n.t("Expand Supertypes"),
    expandSubtypes: vscode.l10n.t("Expand Subtypes"),
    expandIncludedBy: vscode.l10n.t("Expand Included By"),
    expandIncludes: vscode.l10n.t("Expand Includes"),
    expandDepth: vscode.l10n.t("Expand to Depth"),
    stop: vscode.l10n.t("Stop"),
    search: vscode.l10n.t("Search"),
    export: vscode.l10n.t("Export"),
    fit: vscode.l10n.t("Fit"),
    reset: vscode.l10n.t("Reset Layout"),
    collapse: vscode.l10n.t("Collapse Branch"),
    expandBranch: vscode.l10n.t("Expand Branch"),
    call: vscode.l10n.t("Call"),
    inheritance: vscode.l10n.t("Inheritance"),
    include: vscode.l10n.t("Include"),
    definition: vscode.l10n.t("Definition"),
    waiting: vscode.l10n.t("Waiting for graph…"),
    aria: vscode.l10n.t("C Insight Relationship Graph"),
    empty: vscode.l10n.t("Run C Insight: Show Relationship Graph from a local C/C++ file."),
  };
  const scriptLabels = JSON.stringify(labels).replaceAll("<", "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    #toolbar { min-height: 36px; box-sizing: border-box; display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); overflow-x: auto; }
    #toolbar button { white-space: nowrap; }
    button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; padding: 4px 9px; cursor: pointer; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:disabled { opacity: .45; cursor: default; }
    .relation { opacity: .65; }
    .relation.active { opacity: 1; outline: 1px solid var(--vscode-focusBorder); }
    #status { margin-left: auto; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #legend { display: flex; gap: 8px; align-items: center; white-space: nowrap; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .legend-line { display: inline-block; width: 22px; border-top: 2px solid; margin-right: 3px; vertical-align: middle; }
    .legend-call { color: var(--vscode-charts-blue); }
    .legend-inherits { color: var(--vscode-charts-purple); border-top-style: dashed; }
    .legend-includes { color: var(--vscode-charts-green); border-top-style: dotted; }
    .legend-defines { color: var(--vscode-charts-orange); border-top-style: double; }
    #canvas { width: 100%; height: calc(100% - 36px); touch-action: none; cursor: grab; }
    #canvas.dragging { cursor: grabbing; }
    .edge { stroke-width: 1.8; fill: none; marker-end: url(#arrow); }
    .edge.calls { stroke: var(--vscode-charts-blue); }
    .edge.inherits { stroke: var(--vscode-charts-purple); stroke-dasharray: 8 4; }
    .edge.includes { stroke: var(--vscode-charts-green); stroke-dasharray: 2 4; }
    .edge.defines { stroke: var(--vscode-charts-orange); stroke-dasharray: 10 3 2 3; }
    .edge.recursive { stroke: var(--vscode-errorForeground); stroke-width: 2.6; }
    .node rect { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-focusBorder); stroke-width: 1.5; rx: 6; }
    .node.root rect { stroke-width: 2.5; }
    .node.selected rect { fill: var(--vscode-list-activeSelectionBackground); }
    .node text { fill: var(--vscode-editorWidget-foreground); pointer-events: none; font-size: 13px; }
    .node .detail { fill: var(--vscode-descriptionForeground); font-size: 11px; }
    .node .state { fill: var(--vscode-charts-yellow); font-size: 10px; }
    .node.unresolved rect { stroke: var(--vscode-errorForeground); stroke-dasharray: 4 3; }
    .node.duplicate rect { stroke-dasharray: 5 3; }
    #empty { position: absolute; inset: 36px 0 0 0; display: grid; place-items: center; color: var(--vscode-descriptionForeground); pointer-events: none; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="callers">${labels.expandCallers}</button>
    <button id="callees">${labels.expandCallees}</button>
    <button id="depth">${labels.expandDepth}</button>
    <button id="stop">${labels.stop}</button>
    <button id="search">${labels.search}</button>
    <button id="export">${labels.export}</button>
    <button id="fit">${labels.fit}</button>
    <button id="reset">${labels.reset}</button>
    <button id="collapse">${labels.collapse}</button>
    <button id="uncollapse">${labels.expandBranch}</button>
    <button class="relation active" data-relation="calls">${labels.call}</button>
    <button class="relation active" data-relation="inherits">${labels.inheritance}</button>
    <button class="relation active" data-relation="includes">${labels.include}</button>
    <button class="relation active" data-relation="defines">${labels.definition}</button>
    <span id="legend"><span><i class="legend-line legend-call"></i>${labels.call}</span><span><i class="legend-line legend-inherits"></i>${labels.inheritance}</span><span><i class="legend-line legend-includes"></i>${labels.include}</span><span><i class="legend-line legend-defines"></i>${labels.definition}</span></span>
    <span id="status" role="status" aria-live="polite">${labels.waiting}</span>
  </div>
  <svg id="canvas" role="application" aria-label="${labels.aria}">
    <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="context-stroke"/></marker></defs>
    <g id="viewport"><g id="edges"></g><g id="nodes"></g></g>
  </svg>
  <div id="empty">${labels.empty}</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const labels = ${scriptLabels};
    const svg = document.getElementById('canvas');
    const viewport = document.getElementById('viewport');
    const edgeLayer = document.getElementById('edges');
    const nodeLayer = document.getElementById('nodes');
    const empty = document.getElementById('empty');
    const status = document.getElementById('status');
    let graph = { nodes: [], edges: [] };
    let operationStatus;
    let scale = 1, tx = 80, ty = 80, dragging = false, lastX = 0, lastY = 0;
    let selected;
    let positions = new Map();
    let positionCache = new Map();
    let collapsed = new Set();
    let currentRoot;
    let renderFrame;
    let pendingFit = false;
    let lastSlowRender = 0;
    let canvasStateTimer;
    const nodeElements = new Map();
    const edgeElements = new Map();
    const enabled = new Set(['calls', 'inherits', 'includes', 'defines']);
    const resizeObserver = new ResizeObserver(() => render());
    resizeObserver.observe(svg);
    const applyTransform = () => viewport.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + scale + ')');
    const element = (name, attrs = {}) => { const value = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [key, item] of Object.entries(attrs)) value.setAttribute(key, item); return value; };
    function render(fitAfter = false) {
      pendingFit ||= fitAfter;
      if (renderFrame) return;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = undefined;
        renderNow();
      });
    }
    function renderNow() {
      const started = performance.now();
      const visible = visibleGraph();
      empty.style.display = visible.nodes.length ? 'none' : 'grid';
      positions = layeredPositions(visible);
      const visibleEdges = visible.edges.filter(edge => enabled.has(edge.relation));
      const viewportBounds = graphViewportBounds(420);
      const renderedNodes = visible.nodes.filter(node => {
        const point = positions.get(node.id);
        return node.id === selected || node.id === graph.rootId || !point || (point.x + 190 >= viewportBounds.left && point.x <= viewportBounds.right && point.y + 80 >= viewportBounds.top && point.y <= viewportBounds.bottom);
      });
      const renderedIds = new Set(renderedNodes.map(node => node.id));
      const renderedEdges = visibleEdges.filter(edge => renderedIds.has(edge.from) && renderedIds.has(edge.to));
      reconcile(edgeElements, renderedEdges, edgeLayer, edge => edge.id, (path, edge) => {
        const from = positions.get(edge.from), to = positions.get(edge.to);
        if (!from || !to) return;
        const recursive = edge.states?.some(state => state.includes('recursion') || state.includes('cycle'));
        path.setAttribute('class', 'edge ' + edge.relation + (recursive ? ' recursive' : ''));
        path.setAttribute('d', 'M' + (from.x + 190) + ',' + (from.y + 40) + ' L' + to.x + ',' + (to.y + 40));
        let tooltip = path.querySelector('title');
        if (!tooltip) { tooltip = element('title'); path.append(tooltip); }
        tooltip.textContent = edge.relation + (edge.states?.length ? ' · ' + edge.states.join(' · ') : '');
      });
      reconcile(nodeElements, renderedNodes, nodeLayer, node => node.id, (group, node, created) => {
        const point = positions.get(node.id);
        const classes = ['node', node.id === graph.rootId ? 'root' : '', node.id === selected ? 'selected' : '', node.states?.includes('duplicate') ? 'duplicate' : '', node.kind === 'unresolved' ? 'unresolved' : ''].filter(Boolean).join(' ');
        group.setAttribute('class', classes);
        group.setAttribute('transform', 'translate(' + point.x + ' ' + point.y + ')');
        group.setAttribute('aria-label', node.name + ', ' + node.kind + (node.states?.length ? ', ' + node.states.join(', ') : ''));
        group.querySelector('.title').textContent = node.name;
        group.querySelector('.detail').textContent = node.detail || node.kind;
        group.querySelector('.state').textContent = nodeStateLabel(node);
        if (created) {
          group.addEventListener('click', event => { event.stopPropagation(); const id = group.dataset.nodeId; selected = id; render(); vscode.postMessage({ type: 'selectNode', nodeId: id }); });
          group.addEventListener('dblclick', event => { event.stopPropagation(); vscode.postMessage({ type: 'openNode', nodeId: group.dataset.nodeId }); });
          group.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); const id = group.dataset.nodeId; selected = id; render(); vscode.postMessage({ type: 'nodeContext', nodeId: id }); });
          group.addEventListener('focus', () => { selected = group.dataset.nodeId; });
          group.addEventListener('keydown', event => handleNodeKey(event, group.dataset.nodeId));
        }
      });
      const selectedNode = graph.nodes.find(node => node.id === selected);
      const isType = selectedNode?.capabilities?.includes('inherits');
      const isInclude = selectedNode?.capabilities?.includes('includes');
      document.getElementById('callers').textContent = isType ? labels.expandSupertypes : isInclude ? labels.expandIncludedBy : labels.expandCallers;
      document.getElementById('callees').textContent = isType ? labels.expandSubtypes : isInclude ? labels.expandIncludes : labels.expandCallees;
      document.getElementById('callers').disabled = !selectedNode?.capabilities?.length;
      document.getElementById('callees').disabled = !selectedNode?.capabilities?.length;
      document.getElementById('depth').disabled = !selectedNode?.capabilities?.length;
      document.getElementById('collapse').disabled = !selected || collapsed.has(selected);
      document.getElementById('uncollapse').disabled = !selected || !collapsed.has(selected);
      const statistics = visible.nodes.length + '/' + graph.nodes.length + ' nodes · ' + visibleEdges.length + '/' + graph.edges.length + ' edges' + (collapsed.size ? ' · ' + collapsed.size + ' collapsed' : '');
      status.textContent = graph.staleReason ? 'Stale: ' + graph.staleReason : operationStatus?.message ? operationStatus.message + ' · ' + statistics : statistics + (graph.limitedBy ? ' · limited by ' + graph.limitedBy : '');
      status.style.color = operationStatus?.kind === 'error' ? 'var(--vscode-errorForeground)' : operationStatus?.kind === 'warning' ? 'var(--vscode-editorWarning-foreground)' : 'var(--vscode-descriptionForeground)';
      applyTransform();
      const duration = performance.now() - started;
      status.title = 'Last render: ' + duration.toFixed(1) + ' ms · rendered ' + renderedNodes.length + ' viewport nodes';
      if (duration >= 50 && performance.now() - lastSlowRender >= 5000) {
        lastSlowRender = performance.now();
        vscode.postMessage({ type: 'slowRender', duration, nodes: visible.nodes.length, edges: visibleEdges.length });
      }
      scheduleCanvasState();
      if (pendingFit) {
        pendingFit = false;
        fit();
      }
    }
    function scheduleCanvasState(immediate = false) {
      if (canvasStateTimer) clearTimeout(canvasStateTimer);
      const send = () => {
        canvasStateTimer = undefined;
        vscode.postMessage({
          type: 'canvasState',
          selectedId: selected,
          enabledRelations: [...enabled],
          collapsedIds: [...collapsed],
          viewport: { scale, tx, ty },
        });
      };
      if (immediate) send();
      else canvasStateTimer = setTimeout(send, 200);
    }
    function reconcile(cache, values, layer, keyOf, update) {
      const retained = new Set();
      values.forEach(value => {
        const key = keyOf(value);
        retained.add(key);
        let item = cache.get(key);
        let created = false;
        if (!item) {
          created = true;
          if (layer === nodeLayer) {
            item = element('g', { tabindex: '0', role: 'button', 'data-node-id': key });
            item.append(element('rect', { width: '190', height: '80' }));
            item.append(element('text', { class: 'title', x: '10', y: '27' }));
            item.append(element('text', { class: 'detail', x: '10', y: '49' }));
            item.append(element('text', { class: 'state', x: '10', y: '68' }));
          } else {
            item = element('path');
          }
          cache.set(key, item);
          layer.append(item);
        }
        update(item, value, created);
      });
      for (const [key, item] of cache) {
        if (!retained.has(key)) { item.remove(); cache.delete(key); }
      }
    }
    function graphViewportBounds(margin = 0) {
      return {
        left: -tx / scale - margin,
        top: -ty / scale - margin,
        right: (svg.clientWidth - tx) / scale + margin,
        bottom: (svg.clientHeight - ty) / scale + margin,
      };
    }
    function nodeStateLabel(node) {
      const values = [];
      if (collapsed.has(node.id)) values.push('collapsed');
      if (node.states?.some(state => state.startsWith('expanded-'))) values.push('expanded');
      if (node.states?.includes('duplicate')) values.push('duplicate');
      if (node.states?.includes('unresolved')) values.push('unresolved');
      if (node.states?.includes('missing')) values.push('missing');
      if (node.states?.some(state => state.includes('recursion') || state.includes('cycle'))) values.push('cycle');
      if (!values.length && node.capabilities?.length) values.push('expandable');
      return values.join(' · ');
    }
    function graphRanks(value = graph) {
      const ranks = new Map();
      const adjacency = new Map();
      value.nodes.forEach(node => adjacency.set(node.id, []));
      value.edges.forEach(edge => {
        adjacency.get(edge.from)?.push({ id: edge.to, delta: 1 });
        adjacency.get(edge.to)?.push({ id: edge.from, delta: -1 });
      });
      const roots = [
        ...(value.rootId ? [value.rootId] : []),
        ...value.nodes
          .map(node => node.id)
          .filter(id => id !== value.rootId),
      ];
      for (const root of roots) {
        if (ranks.has(root)) continue;
        ranks.set(root, root === value.rootId ? 0 : 0);
        const queue = [root];
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index];
          for (const neighbor of adjacency.get(current) ?? []) {
            if (!ranks.has(neighbor.id)) {
              ranks.set(neighbor.id, (ranks.get(current) ?? 0) + neighbor.delta);
              queue.push(neighbor.id);
            }
          }
        }
      }
      return ranks;
    }
    function visibleGraph() {
      const hidden = new Set();
      const ranks = graphRanks();
      for (const start of collapsed) {
        const startRank = ranks.get(start) ?? 0;
        const queue = [start];
        const visited = new Set([start]);
        while (queue.length) {
          const current = queue.shift();
          const currentRank = ranks.get(current) ?? 0;
          for (const edge of graph.edges) {
            let next;
            if (startRank >= 0 && edge.from === current && (ranks.get(edge.to) ?? 0) > currentRank) next = edge.to;
            if (startRank <= 0 && edge.to === current && (ranks.get(edge.from) ?? 0) < currentRank) next = edge.from;
            if (next && !visited.has(next)) { visited.add(next); hidden.add(next); queue.push(next); }
          }
        }
      }
      return { ...graph, nodes: graph.nodes.filter(node => !hidden.has(node.id)), edges: graph.edges.filter(edge => !hidden.has(edge.from) && !hidden.has(edge.to)) };
    }
    function layeredPositions(value) {
      const ranks = graphRanks(value);
      const columns = new Map();
      value.nodes.forEach(node => { const rank = ranks.get(node.id) ?? 0; const list = columns.get(rank) || []; list.push(node); columns.set(rank, list); });
      const result = new Map();
      [...columns.entries()].sort((a, b) => a[0] - b[0]).forEach(([rank, nodes]) => {
        const occupied = new Set([...positionCache.values()].filter(point => point.rank === rank).map(point => point.y));
        nodes.forEach((node, index) => {
          let point = positionCache.get(node.id);
          if (!point) {
            let y = (index - (nodes.length - 1) / 2) * 120;
            while (occupied.has(y)) y += 120;
            point = { x: rank * 280, y, rank }; positionCache.set(node.id, point); occupied.add(y);
          }
          result.set(node.id, point);
        });
      });
      return result;
    }
    function fit() {
      if (!graph.nodes.length) return;
      const points = [...positions.values()];
      const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
      const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
      const width = maxX - minX + 190, height = maxY - minY + 80;
      scale = Math.min(1.5, Math.max(.2, Math.min(svg.clientWidth / (width + 120), svg.clientHeight / (height + 120))));
      tx = (svg.clientWidth - width * scale) / 2 - minX * scale; ty = (svg.clientHeight - height * scale) / 2 - minY * scale; applyTransform(); render();
    }
    function focusNode(nodeId) {
      const point = positions.get(nodeId);
      if (!point) return;
      selected = nodeId;
      tx = svg.clientWidth / 2 - (point.x + 95) * scale;
      ty = svg.clientHeight / 2 - (point.y + 40) * scale;
      render();
    }
    function focusRendered(nodeId) {
      const target = [...nodeLayer.querySelectorAll('.node')].find(node => node.dataset.nodeId === nodeId);
      target?.focus();
    }
    function handleNodeKey(event, nodeId) {
      if (event.key === 'Enter') {
        event.preventDefault();
        vscode.postMessage({ type: event.shiftKey ? 'openNode' : 'selectNode', nodeId });
        return;
      }
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        collapsed.has(nodeId) ? collapsed.delete(nodeId) : collapsed.add(nodeId);
        render(); focusRendered(nodeId); return;
      }
      if (event.key === 'F10' && event.shiftKey) {
        event.preventDefault(); vscode.postMessage({ type: 'nodeContext', nodeId }); return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const current = positions.get(nodeId);
      if (!current) return;
      const candidates = [...positions.entries()].filter(([id, point]) => id !== nodeId &&
        (event.key === 'ArrowLeft' ? point.x < current.x : event.key === 'ArrowRight' ? point.x > current.x : event.key === 'ArrowUp' ? point.y < current.y : point.y > current.y));
      candidates.sort((a, b) => {
        const da = Math.abs(a[1].x - current.x) + Math.abs(a[1].y - current.y);
        const db = Math.abs(b[1].x - current.x) + Math.abs(b[1].y - current.y);
        return da - db;
      });
      if (candidates[0]) { selected = candidates[0][0]; render(); focusRendered(selected); }
    }
    svg.addEventListener('wheel', event => { event.preventDefault(); const next = Math.min(3, Math.max(.2, scale * (event.deltaY < 0 ? 1.1 : .9))); scale = next; applyTransform(); render(); }, { passive: false });
    svg.addEventListener('pointerdown', event => { dragging = true; lastX = event.clientX; lastY = event.clientY; svg.classList.add('dragging'); svg.setPointerCapture(event.pointerId); });
    svg.addEventListener('pointermove', event => { if (!dragging) return; tx += event.clientX - lastX; ty += event.clientY - lastY; lastX = event.clientX; lastY = event.clientY; applyTransform(); render(); });
    svg.addEventListener('pointerup', () => { dragging = false; svg.classList.remove('dragging'); });
    document.getElementById('fit').addEventListener('click', fit);
    document.getElementById('reset').addEventListener('click', () => { scale = 1; tx = 80; ty = 80; applyTransform(); render(); });
    document.getElementById('collapse').addEventListener('click', () => { if (selected) { collapsed.add(selected); render(); } });
    document.getElementById('uncollapse').addEventListener('click', () => { if (selected) { collapsed.delete(selected); render(); } });
    function expandSelected(incoming) {
      const node = graph.nodes.find(item => item.id === selected);
      if (!node) return;
      if (node.capabilities?.includes('inherits')) vscode.postMessage({ type: 'expandType', nodeId: selected, direction: incoming ? 'supertypes' : 'subtypes' });
      else if (node.capabilities?.includes('includes')) vscode.postMessage({ type: 'expandInclude', nodeId: selected, direction: incoming ? 'includedBy' : 'includes' });
      else if (node.capabilities?.includes('calls')) vscode.postMessage({ type: 'expandCall', nodeId: selected, direction: incoming ? 'incoming' : 'outgoing' });
    }
    document.getElementById('callers').addEventListener('click', () => expandSelected(true));
    document.getElementById('callees').addEventListener('click', () => expandSelected(false));
    document.getElementById('depth').addEventListener('click', () => { if (selected) vscode.postMessage({ type: 'expandToDepth', nodeId: selected }); });
    document.getElementById('stop').addEventListener('click', () => vscode.postMessage({ type: 'stopExpansion' }));
    document.getElementById('search').addEventListener('click', () => vscode.postMessage({ type: 'search' }));
    document.getElementById('export').addEventListener('click', () => vscode.postMessage({ type: 'export' }));
    document.querySelectorAll('.relation').forEach(button => button.addEventListener('click', () => { const relation = button.dataset.relation; enabled.has(relation) ? enabled.delete(relation) : enabled.add(relation); button.classList.toggle('active', enabled.has(relation)); render(); }));
    svg.addEventListener('keydown', event => {
      if (event.target?.classList?.contains('node')) return;
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); scale = Math.min(3, scale * 1.1); applyTransform(); render(); }
      else if (event.key === '-') { event.preventDefault(); scale = Math.max(.2, scale * .9); applyTransform(); render(); }
    });
    window.addEventListener('message', event => {
      if (event.data?.type === 'graphSnapshot') {
        const rootChanged = currentRoot !== event.data.graph.rootId;
        graph = event.data.graph; operationStatus = event.data.operationStatus;
        if (rootChanged) { currentRoot = graph.rootId; selected = graph.rootId; collapsed.clear(); positionCache.clear(); }
        else if (!graph.nodes.some(node => node.id === selected)) selected = graph.rootId;
        const restored = event.data.canvasState;
        if (restored) {
          selected = restored.selectedId || graph.rootId;
          collapsed = new Set(restored.collapsedIds || []);
          enabled.clear();
          (restored.enabledRelations || ['calls', 'inherits', 'includes', 'defines']).forEach(relation => enabled.add(relation));
          scale = restored.viewport?.scale ?? 1;
          tx = restored.viewport?.tx ?? 80;
          ty = restored.viewport?.ty ?? 80;
          document.querySelectorAll('.relation').forEach(button => button.classList.toggle('active', enabled.has(button.dataset.relation)));
        }
        render(rootChanged && !restored);
      }
      else if (event.data?.type === 'focusNode') focusNode(event.data.nodeId);
    });
    window.addEventListener('unload', () => {
      scheduleCanvasState(true);
      resizeObserver.disconnect();
      if (renderFrame) cancelAnimationFrame(renderFrame);
      if (canvasStateTimer) clearTimeout(canvasStateTimer);
      nodeElements.clear(); edgeElements.clear(); positionCache.clear();
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function randomNonce(): string {
  return randomBytes(24).toString("base64");
}
