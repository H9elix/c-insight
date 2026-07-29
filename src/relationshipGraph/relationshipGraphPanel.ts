import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  SymbolKind,
  TypeHierarchyItem,
} from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import { BookmarkExplorer } from "../bookmarks/bookmarkExplorer";
import {
  CallDirection,
  CallHierarchyRepository,
} from "../callHierarchy/callHierarchyRepository";
import { CallNode } from "../models/types";
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

type GraphMessage =
  | { type: "ready" }
  | { type: "selectNode"; nodeId: string }
  | { type: "openNode"; nodeId: string }
  | { type: "nodeContext"; nodeId: string }
  | { type: "expandToDepth"; nodeId: string }
  | { type: "search" }
  | { type: "export" }
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
  private generation = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly analysis: AnalysisService,
    private readonly callRepository: CallHierarchyRepository,
    private readonly typeRepository: TypeHierarchyRepository,
    private readonly includeRepository: IncludeHierarchyRepository,
    private readonly bookmarks: BookmarkExplorer,
  ) {}

  async showAt(uri: vscode.Uri, position: vscode.Position): Promise<void> {
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

  dispose(): void {
    this.stopExpansion();
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

  private async expandCall(
    nodeId: string,
    direction: CallDirection,
  ): Promise<boolean> {
    const callNode = this.callNodes.get(nodeId);
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
    const callNode = this.callNodes.get(nodeId);
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
    const item = this.typeNodes.get(nodeId);
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
    const item = this.typeNodes.get(nodeId);
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
    const isCall = this.callNodes.has(nodeId);
    const isType = this.typeNodes.has(nodeId);
    const isInclude = this.includeFiles.has(nodeId);
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
    const typeNode = this.typeNodes.has(nodeId);
    const includeNode = this.includeFiles.has(nodeId);
    const expandable = typeNode || includeNode || this.callNodes.has(nodeId);
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
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
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
    await this.panel?.webview.postMessage({
      type: "graphSnapshot",
      graph: this.model.snapshot(),
      operationStatus: this.operationStatus,
    });
  }
}

function nodeLocation(
  node: GraphNode | undefined,
): vscode.Location | undefined {
  if (!node?.uri) {
    return undefined;
  }
  const line = Math.max(0, (node.line ?? 1) - 1);
  return new vscode.Location(
    vscode.Uri.parse(node.uri),
    new vscode.Range(line, 0, line, 0),
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
  if (type === "stopExpansion") {
    return true;
  }
  if (type === "search" || type === "export") {
    return true;
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
    #canvas { width: 100%; height: calc(100% - 36px); touch-action: none; cursor: grab; }
    #canvas.dragging { cursor: grabbing; }
    .edge { stroke-width: 1.8; fill: none; marker-end: url(#arrow); }
    .edge.calls { stroke: var(--vscode-charts-blue); }
    .edge.inherits { stroke: var(--vscode-charts-purple); stroke-dasharray: 8 4; }
    .edge.includes { stroke: var(--vscode-charts-green); stroke-dasharray: 2 4; }
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
    <button id="callers">Expand Callers</button>
    <button id="callees">Expand Callees</button>
    <button id="depth">Expand to Depth</button>
    <button id="stop">Stop</button>
    <button id="search">Search</button>
    <button id="export">Export</button>
    <button id="fit">Fit</button>
    <button id="reset">Reset Layout</button>
    <button id="collapse">Collapse Branch</button>
    <button id="uncollapse">Expand Branch</button>
    <button class="relation active" data-relation="calls">Call</button>
    <button class="relation active" data-relation="inherits">Inheritance</button>
    <button class="relation active" data-relation="includes">Include</button>
    <span id="legend"><span><i class="legend-line legend-call"></i>Call</span><span><i class="legend-line legend-inherits"></i>Inheritance</span><span><i class="legend-line legend-includes"></i>Include</span></span>
    <span id="status" role="status" aria-live="polite">Waiting for graph…</span>
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
    let operationStatus;
    let scale = 1, tx = 80, ty = 80, dragging = false, lastX = 0, lastY = 0;
    let selected;
    let positions = new Map();
    let positionCache = new Map();
    let collapsed = new Set();
    let currentRoot;
    const enabled = new Set(['calls', 'inherits', 'includes']);
    const applyTransform = () => viewport.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + scale + ')');
    const element = (name, attrs = {}) => { const value = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [key, item] of Object.entries(attrs)) value.setAttribute(key, item); return value; };
    function render() {
      edgeLayer.replaceChildren(); nodeLayer.replaceChildren();
      const visible = visibleGraph();
      empty.style.display = visible.nodes.length ? 'none' : 'grid';
      positions = layeredPositions(visible);
      const visibleEdges = visible.edges.filter(edge => enabled.has(edge.relation));
      visibleEdges.forEach(edge => {
        const from = positions.get(edge.from), to = positions.get(edge.to);
        if (!from || !to) return;
        const recursive = edge.states?.some(state => state.includes('recursion') || state.includes('cycle'));
        const path = element('path', { class: 'edge ' + edge.relation + (recursive ? ' recursive' : ''), d: 'M' + (from.x + 190) + ',' + (from.y + 40) + ' L' + to.x + ',' + (to.y + 40) });
        const tooltip = element('title'); tooltip.textContent = edge.relation + (edge.states?.length ? ' · ' + edge.states.join(' · ') : ''); path.append(tooltip);
        edgeLayer.append(path);
      });
      visible.nodes.forEach(node => {
        const point = positions.get(node.id);
        const classes = ['node', node.id === graph.rootId ? 'root' : '', node.id === selected ? 'selected' : '', node.states?.includes('duplicate') ? 'duplicate' : '', node.kind === 'unresolved' ? 'unresolved' : ''].filter(Boolean).join(' ');
        const group = element('g', { class: classes, transform: 'translate(' + point.x + ' ' + point.y + ')', tabindex: '0', role: 'button', 'data-node-id': node.id, 'aria-label': node.name + ', ' + node.kind + (node.states?.length ? ', ' + node.states.join(', ') : '') });
        group.append(element('rect', { width: '190', height: '80' }));
        const title = element('text', { x: '10', y: '27' }); title.textContent = node.name; group.append(title);
        const detail = element('text', { class: 'detail', x: '10', y: '49' }); detail.textContent = node.detail || node.kind; group.append(detail);
        const state = element('text', { class: 'state', x: '10', y: '68' }); state.textContent = nodeStateLabel(node); group.append(state);
        group.addEventListener('click', event => { event.stopPropagation(); selected = node.id; render(); vscode.postMessage({ type: 'selectNode', nodeId: node.id }); });
        group.addEventListener('dblclick', event => { event.stopPropagation(); vscode.postMessage({ type: 'openNode', nodeId: node.id }); });
        group.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); selected = node.id; render(); vscode.postMessage({ type: 'nodeContext', nodeId: node.id }); });
        group.addEventListener('focus', () => { selected = node.id; });
        group.addEventListener('keydown', event => handleNodeKey(event, node.id));
        nodeLayer.append(group);
      });
      const selectedNode = graph.nodes.find(node => node.id === selected);
      const isType = selectedNode?.capabilities?.includes('inherits');
      const isInclude = selectedNode?.capabilities?.includes('includes');
      document.getElementById('callers').textContent = isType ? 'Expand Supertypes' : isInclude ? 'Expand Included By' : 'Expand Callers';
      document.getElementById('callees').textContent = isType ? 'Expand Subtypes' : isInclude ? 'Expand Includes' : 'Expand Callees';
      document.getElementById('callers').disabled = !selectedNode?.capabilities?.length;
      document.getElementById('callees').disabled = !selectedNode?.capabilities?.length;
      document.getElementById('depth').disabled = !selectedNode?.capabilities?.length;
      document.getElementById('collapse').disabled = !selected || collapsed.has(selected);
      document.getElementById('uncollapse').disabled = !selected || !collapsed.has(selected);
      const statistics = visible.nodes.length + '/' + graph.nodes.length + ' nodes · ' + visibleEdges.length + '/' + graph.edges.length + ' edges' + (collapsed.size ? ' · ' + collapsed.size + ' collapsed' : '');
      status.textContent = graph.staleReason ? 'Stale: ' + graph.staleReason : operationStatus?.message ? operationStatus.message + ' · ' + statistics : statistics + (graph.limitedBy ? ' · limited by ' + graph.limitedBy : '');
      status.style.color = operationStatus?.kind === 'error' ? 'var(--vscode-errorForeground)' : operationStatus?.kind === 'warning' ? 'var(--vscode-editorWarning-foreground)' : 'var(--vscode-descriptionForeground)';
      applyTransform();
    }
    function nodeStateLabel(node) {
      const values = [];
      if (collapsed.has(node.id)) values.push('collapsed');
      if (node.states?.some(state => state.startsWith('expanded-'))) values.push('expanded');
      if (node.states?.includes('duplicate')) values.push('duplicate');
      if (node.states?.includes('unresolved')) values.push('unresolved');
      if (node.states?.some(state => state.includes('recursion') || state.includes('cycle'))) values.push('cycle');
      if (!values.length && node.capabilities?.length) values.push('expandable');
      return values.join(' · ');
    }
    function graphRanks(value = graph) {
      const ranks = new Map();
      if (value.rootId) ranks.set(value.rootId, 0);
      let changed = true;
      for (let pass = 0; pass < value.nodes.length && changed; pass++) {
        changed = false;
        value.edges.forEach(edge => {
          if (ranks.has(edge.from) && !ranks.has(edge.to)) { ranks.set(edge.to, ranks.get(edge.from) + 1); changed = true; }
          else if (!ranks.has(edge.from) && ranks.has(edge.to)) { ranks.set(edge.from, ranks.get(edge.to) - 1); changed = true; }
        });
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
      tx = (svg.clientWidth - width * scale) / 2 - minX * scale; ty = (svg.clientHeight - height * scale) / 2 - minY * scale; applyTransform();
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
    svg.addEventListener('wheel', event => { event.preventDefault(); const next = Math.min(3, Math.max(.2, scale * (event.deltaY < 0 ? 1.1 : .9))); scale = next; applyTransform(); }, { passive: false });
    svg.addEventListener('pointerdown', event => { dragging = true; lastX = event.clientX; lastY = event.clientY; svg.classList.add('dragging'); svg.setPointerCapture(event.pointerId); });
    svg.addEventListener('pointermove', event => { if (!dragging) return; tx += event.clientX - lastX; ty += event.clientY - lastY; lastX = event.clientX; lastY = event.clientY; applyTransform(); });
    svg.addEventListener('pointerup', () => { dragging = false; svg.classList.remove('dragging'); });
    document.getElementById('fit').addEventListener('click', fit);
    document.getElementById('reset').addEventListener('click', () => { scale = 1; tx = 80; ty = 80; applyTransform(); });
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
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); scale = Math.min(3, scale * 1.1); applyTransform(); }
      else if (event.key === '-') { event.preventDefault(); scale = Math.max(.2, scale * .9); applyTransform(); }
    });
    window.addEventListener('message', event => {
      if (event.data?.type === 'graphSnapshot') {
        const rootChanged = currentRoot !== event.data.graph.rootId;
        graph = event.data.graph; operationStatus = event.data.operationStatus;
        if (rootChanged) { currentRoot = graph.rootId; selected = graph.rootId; collapsed.clear(); positionCache.clear(); }
        else if (!graph.nodes.some(node => node.id === selected)) selected = graph.rootId;
        render();
        if (rootChanged) fit();
      }
      else if (event.data?.type === 'focusNode') focusNode(event.data.nodeId);
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function randomNonce(): string {
  return randomBytes(24).toString("base64");
}
