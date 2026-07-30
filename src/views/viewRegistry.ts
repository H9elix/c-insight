import * as vscode from "vscode";
import {
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  DocumentSymbol,
  SymbolInformation,
} from "vscode-languageclient/node";
import {
  AnalysisService,
  UnsupportedClangdFeatureError,
} from "../analysis/analysisService";
import { AnalysisReliability } from "../diagnostics/analysisReliability";
import { BookmarkExplorer } from "../bookmarks/bookmarkExplorer";
import { CallHierarchyRepository } from "../callHierarchy/callHierarchyRepository";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import type {
  CallHierarchySessionState,
  ReferenceSessionState,
} from "../session/workspaceSession";
import { SymbolSearchExplorer } from "../symbols/symbolSearchExplorer";
import { TypeHierarchyExplorer } from "../typeHierarchy/typeHierarchyExplorer";
import type { NavigationVisibility } from "../context/navigationDemand";
import { IncludeHierarchyExplorer } from "../includeHierarchy/includeHierarchyExplorer";
import {
  CallNode,
  LocationResult,
  LspSymbol,
  SymbolContext,
  ViewUpdateIntent,
} from "../models/types";
import {
  looksLikeExplicitIndirectCall,
  recursionKind,
} from "../utils/callHierarchy";
import { findCallPaths } from "../utils/callPath";
import {
  hierarchyExpansionMessage,
  hierarchyExpansionStopReason,
} from "../utils/hierarchyExpansion";
import { HierarchyTreeState } from "../utils/hierarchyTreeState";
import {
  HierarchyExportNode,
  hierarchyNodeStates,
  renderHierarchyExport,
} from "../utils/hierarchyExport";
import { shouldUpdatePinnedView } from "../utils/viewPin";
import { CodePreviewProvider, PreviewMode } from "./codePreviewProvider";
import { ReferenceExplorer } from "./referenceExplorer";
import { SourceLineCache } from "./sourceLineCache";
import { MutableTreeProvider, TreeNode } from "./treeNode";

export class ViewRegistry implements vscode.Disposable {
  readonly context = new MutableTreeProvider();
  readonly references: MutableTreeProvider;
  readonly referenceExplorer: ReferenceExplorer;
  readonly callers = new MutableTreeProvider();
  readonly callees = new MutableTreeProvider();
  readonly symbols = new MutableTreeProvider();
  readonly status = new MutableTreeProvider();
  readonly preview: CodePreviewProvider;
  private readonly visibilityEmitter = new vscode.EventEmitter<string>();
  readonly onDidChangeNavigationVisibility = this.visibilityEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly sourceLines = new SourceLineCache();
  private readonly treeViews = new Map<string, vscode.TreeView<TreeNode>>();
  private readonly callTreeState = {
    incoming: new HierarchyTreeState(),
    outgoing: new HierarchyTreeState(),
  };
  private callRootSignature = "";
  private callExpansion?: vscode.CancellationTokenSource;
  private referencesPinned = false;
  private callHierarchyPinned = false;
  private callHierarchyPinnedSymbol?: string;
  private callHierarchyPinnedStale = false;
  private currentSymbolName?: string;
  private reliability: AnalysisReliability = {
    level: "reliable",
    issues: [],
  };
  private callResultsStaleReason?: string;
  private readonly expandedCallPaths = {
    incoming: new Set<string>(),
    outgoing: new Set<string>(),
  };

  get navigationVisible(): boolean {
    return Object.values(this.navigationVisibility).some(Boolean);
  }

  get navigationVisibility(): NavigationVisibility {
    return {
      context: this.isViewVisible("cInsight.context"),
      preview: this.preview.visible,
      references: this.isViewVisible("cInsight.references"),
      callers: this.isViewVisible("cInsight.callers"),
      callees: this.isViewVisible("cInsight.callees"),
    };
  }

  isViewVisible(id: string): boolean {
    return this.treeViews.get(id)?.visible ?? false;
  }

  constructor(
    private readonly analysis: AnalysisService,
    history: NavigationHistoryExplorer,
    bookmarks: BookmarkExplorer,
    symbolSearch: SymbolSearchExplorer,
    typeHierarchy: TypeHierarchyExplorer,
    includeHierarchy: IncludeHierarchyExplorer,
    private readonly callRepository: CallHierarchyRepository,
  ) {
    this.preview = new CodePreviewProvider(analysis, history);
    this.referenceExplorer = new ReferenceExplorer(
      analysis,
      this.sourceLines,
    );
    this.references = this.referenceExplorer.provider;
    const providers: Array<[string, MutableTreeProvider]> = [
      ["cInsight.context", this.context],
      ["cInsight.references", this.references],
      ["cInsight.callers", this.callers],
      ["cInsight.callees", this.callees],
      ["cInsight.history", history.provider],
      ["cInsight.bookmarks", bookmarks.provider],
      ["cInsight.workspaceSymbols", symbolSearch.provider],
      ["cInsight.supertypes", typeHierarchy.supertypes],
      ["cInsight.subtypes", typeHierarchy.subtypes],
      ["cInsight.includes", includeHierarchy.includes],
      ["cInsight.includedBy", includeHierarchy.includedBy],
      ["cInsight.symbols", this.symbols],
      ["cInsight.status", this.status],
    ];
    for (const [id, provider] of providers) {
      const treeView = vscode.window.createTreeView(id, {
        treeDataProvider: provider,
        showCollapseAll: true,
      });
      this.treeViews.set(id, treeView);
      const callDirection =
        id === "cInsight.callers"
          ? "incoming"
          : id === "cInsight.callees"
            ? "outgoing"
            : undefined;
      if (callDirection) {
        this.disposables.push(
          treeView.onDidExpandElement(({ element }) => {
            if (element.callPath) {
              this.expandedCallPaths[callDirection].add(element.callPath);
            }
          }),
          treeView.onDidCollapseElement(({ element }) => {
            if (!element.callPath) {
              return;
            }
            const prefix = `${element.callPath}\u0000`;
            for (const path of this.expandedCallPaths[callDirection]) {
              if (path === element.callPath || path.startsWith(prefix)) {
                this.expandedCallPaths[callDirection].delete(path);
              }
            }
          }),
        );
      }
      if (id === "cInsight.references") {
        this.referenceExplorer.attachTreeView(treeView);
      }
      if (id === "cInsight.supertypes") {
        typeHierarchy.attachTreeView("supertypes", treeView);
      }
      if (id === "cInsight.subtypes") {
        typeHierarchy.attachTreeView("subtypes", treeView);
      }
      if (id === "cInsight.includes") {
        includeHierarchy.attachTreeView("includes", treeView);
      }
      if (id === "cInsight.includedBy") {
        includeHierarchy.attachTreeView("includedBy", treeView);
      }
      this.disposables.push(
        treeView,
        treeView.onDidChangeVisibility(() => {
          if (
            [
              "cInsight.context",
              "cInsight.references",
              "cInsight.callers",
              "cInsight.callees",
              "cInsight.symbols",
            ].includes(id)
          ) {
            this.visibilityEmitter.fire(id);
          }
        }),
      );
      if (
        id !== "cInsight.history" &&
        id !== "cInsight.bookmarks" &&
        id !== "cInsight.workspaceSymbols" &&
        id !== "cInsight.supertypes" &&
        id !== "cInsight.subtypes" &&
        id !== "cInsight.includes" &&
        id !== "cInsight.includedBy"
      ) {
        this.disposables.push(provider);
      }
    }
    this.disposables.push(
      vscode.window.registerWebviewViewProvider("cInsight.preview", this.preview),
      this.preview,
      this.preview.onDidChangeVisibility(() =>
        this.visibilityEmitter.fire("cInsight.preview"),
      ),
      this.sourceLines,
      this.referenceExplorer,
      this.visibilityEmitter,
    );
  }

  updateContext(
    context: SymbolContext,
    intent: ViewUpdateIntent = {},
  ): void {
    const primary = context.callRoots[0];
    this.currentSymbolName =
      context.qualifiedName ?? context.name ?? primary?.raw.name;
    const hover = context.hover?.replace(/```[\w+-]*|```/g, "").trim();
    const roots: TreeNode[] = [
      {
        label: context.name ?? primary?.raw.name ?? "Symbol",
        description: primary?.raw.detail,
        tooltip: hover,
        icon: new vscode.ThemeIcon(
          primary ? "symbol-function" : "symbol-variable",
        ),
      },
    ];
    if (context.qualifiedName && context.qualifiedName !== context.name) {
      roots.push({
        label: context.qualifiedName,
        description: "Qualified name",
        tooltip: context.symbolId,
        icon: new vscode.ThemeIcon("symbol-namespace"),
      });
    }
    if (hover) {
      const signature = hover.split(/\r?\n/).find((line) => line.trim());
      if (signature) {
        roots.push({
          label: signature.trim(),
          description: "Type / signature",
          tooltip: hover,
          icon: new vscode.ThemeIcon("symbol-key"),
        });
      }
    }
    context.definitions.forEach((location, index) => {
      roots.push({
        ...this.locationNode(
          location,
          index === 0 ? "Definition" : `Definition ${index + 1}`,
          "definition",
        ),
        description: `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}`,
      });
    });
    context.declarations
      .filter(
        (declaration) =>
          !context.definitions.some(
            (definition) =>
              definition.uri.toString() === declaration.uri.toString() &&
              definition.range.isEqual(declaration.range),
          ),
      )
      .forEach((location, index) => {
        roots.push({
          ...this.locationNode(
            location,
            index === 0 ? "Declaration" : `Declaration ${index + 1}`,
            "declaration",
          ),
          description: `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}`,
        });
      });
    roots.push(
      {
        label: !context.referencesRequested
          ? "References not queried"
          : context.detailsPending
            ? "References loading…"
            : `${context.references.length} references`,
        description: !context.referencesRequested
          ? "open References to query"
          : undefined,
        icon: new vscode.ThemeIcon("references"),
      },
      {
        label:
          !context.incomingRequested
            ? "Callers not queried"
            : context.detailsPending
            ? "Callers loading…"
            : context.incomingCount === undefined
            ? "Callers unavailable"
            : `${context.incomingCount} callers`,
        description: !context.incomingRequested
          ? "open Callers to query"
          : undefined,
        icon: new vscode.ThemeIcon("call-incoming"),
      },
      {
        label:
          !context.outgoingRequested
            ? "Callees not queried"
            : context.detailsPending
            ? "Callees loading…"
            : context.outgoingCount === undefined
            ? "Callees unavailable"
            : `${context.outgoingCount} callees`,
        description: !context.outgoingRequested
          ? "open Callees to query"
          : undefined,
        icon: new vscode.ThemeIcon("call-outgoing"),
      },
      {
        label: vscode.workspace.asRelativePath(context.uri),
        description: `Line ${context.position.line + 1}`,
        icon: new vscode.ThemeIcon("file-code"),
      },
    );
    this.context.setRoots(roots);

    const preferred = context.definitions[0] ?? context.declarations[0];
    if (preferred && this.preview.visible) {
      void this.preview.showLocation(
        preferred,
        context.definitions.length > 0 ? "definition" : "declaration",
        context.qualifiedName ?? context.name ?? "Symbol",
        "context",
      );
    } else if (this.preview.visible) {
      this.preview.clear();
    }
    if (
      (this.isViewVisible("cInsight.references") ||
        intent.manualReferences) &&
      shouldUpdatePinnedView(
        this.referencesPinned,
        intent.manualReferences,
      )
    ) {
      if (context.detailsPending) {
        this.referenceExplorer.loading();
      } else {
        this.updateReferences(
          context.references,
          context.definitions,
          context.declarations,
          context.callRoots.length > 0,
          this.currentSymbolName,
          intent.manualReferences,
        );
      }
    }
    const allowCallUpdate = shouldUpdatePinnedView(
      this.callHierarchyPinned,
      intent.manualCallHierarchy,
    ) && (
      this.isViewVisible("cInsight.callers") ||
      this.isViewVisible("cInsight.callees") ||
      Boolean(intent.manualCallHierarchy)
    );
    const callRootSignature = context.callRoots.map((root) => root.key).join("|");
    if (
      allowCallUpdate &&
      (callRootSignature !== this.callRootSignature ||
        intent.manualCallHierarchy)
    ) {
      this.callRootSignature = callRootSignature;
      if (this.callHierarchyPinned && intent.manualCallHierarchy) {
        this.callHierarchyPinnedSymbol = this.currentSymbolName;
        this.callHierarchyPinnedStale = false;
      }
      this.callTreeState.incoming.reset();
      this.callTreeState.outgoing.reset();
      this.expandedCallPaths.incoming.clear();
      this.expandedCallPaths.outgoing.clear();
      const callerRoots = context.callRoots.map((root) =>
        this.callTreeNode(root, "incoming", [], 0),
      );
      const calleeRoots = context.callRoots.map((root) =>
        this.callTreeNode(root, "outgoing", [], 0),
      );
      this.callResultsStaleReason = undefined;
      this.callers.setRoots(this.withCallPinBanner(callerRoots));
      this.callees.setRoots(this.withCallPinBanner(calleeRoots));
      void this.expandDefaultDepth();
    }
  }

  updateReferences(
    locations: LocationResult[],
    definitions: LocationResult[] = [],
    declarations: LocationResult[] = [],
    callableSymbol = false,
    symbolName?: string,
    manual = false,
  ): void {
    if (!shouldUpdatePinnedView(this.referencesPinned, manual)) {
      return;
    }
    this.referenceExplorer.update(
      locations,
      definitions,
      declarations,
      callableSymbol,
      symbolName,
    );
  }

  referencesFailed(error: unknown, manual = false): void {
    if (!shouldUpdatePinnedView(this.referencesPinned, manual)) {
      return;
    }
    this.referenceExplorer.failed(error);
  }

  updateSymbols(uri: vscode.Uri, symbols: LspSymbol[]): void {
    this.symbols.setRoots(
      symbols.map((symbol) => this.symbolNode(uri, symbol)),
    );
  }

  updateReliability(reliability: AnalysisReliability): void {
    this.reliability = reliability;
    this.referenceExplorer.setReliability(reliability);
  }

  referenceSessionState(): ReferenceSessionState {
    return this.referenceExplorer.sessionState();
  }

  async restoreReferenceSession(
    state: ReferenceSessionState | undefined,
  ): Promise<void> {
    await this.referenceExplorer.restoreSession(state);
  }

  callHierarchySessionState(): CallHierarchySessionState | undefined {
    const roots = [
      ...this.callers.getRoots(),
      ...this.callees.getRoots(),
    ];
    const root = roots.find(
      (node) => node.callNode && node.callDepth === 0 && node.location,
    );
    if (!root?.location) {
      return undefined;
    }
    return {
      uri: root.location.uri.toString(),
      position: {
        line: root.location.range.start.line,
        character: root.location.range.start.character,
      },
      incomingDepth: maximumLoadedDepth(this.callers.getRoots()),
      outgoingDepth: maximumLoadedDepth(this.callees.getRoots()),
      incomingExpandedPaths: [...this.expandedCallPaths.incoming].slice(0, 500),
      outgoingExpandedPaths: [...this.expandedCallPaths.outgoing].slice(0, 500),
    };
  }

  async restoreCallHierarchyDepths(
    state: CallHierarchySessionState | undefined,
  ): Promise<void> {
    if (!state) {
      return;
    }
    this.stopCallExpansion();
    this.expandedCallPaths.incoming.clear();
    this.expandedCallPaths.outgoing.clear();
    await Promise.all([
      vscode.commands.executeCommand(
        "workbench.actions.treeView.cInsight.callers.collapseAll",
      ),
      vscode.commands.executeCommand(
        "workbench.actions.treeView.cInsight.callees.collapseAll",
      ),
    ]);
    const maximumDepth = vscode.workspace
      .getConfiguration("cInsight.callHierarchy")
      .get<number>("maximumDepth", 10);
    const incomingDepth = Math.min(maximumDepth, state.incomingDepth);
    const outgoingDepth = Math.min(maximumDepth, state.outgoingDepth);
    const hasExactState =
      state.incomingExpandedPaths !== undefined ||
      state.outgoingExpandedPaths !== undefined;
    if (state.incomingExpandedPaths) {
      await this.restoreExpandedCallPaths(
        "incoming",
        state.incomingExpandedPaths,
      );
    } else if (incomingDepth > 0 && !hasExactState) {
      await this.expandCallHierarchy("incoming", incomingDepth, false);
    }
    if (state.outgoingExpandedPaths) {
      await this.restoreExpandedCallPaths(
        "outgoing",
        state.outgoingExpandedPaths,
      );
    } else if (outgoingDepth > 0 && !hasExactState) {
      await this.expandCallHierarchy("outgoing", outgoingDepth, false);
    }
    this.markResultsStale("restored from the previous session");
  }

  updateStatus(
    state: string,
    details?: Array<{ label: string; description?: string }>,
  ): void {
    this.status.setRoots([
      {
        label: `clangd: ${state}`,
        icon: new vscode.ThemeIcon(
          state === "ready" ? "pass-filled" : state === "failed" ? "error" : "sync",
        ),
      },
      ...(details ?? []).map((detail) => ({
        ...detail,
        icon: new vscode.ThemeIcon("info"),
      })),
    ]);
  }

  clearContext(): void {
    this.context.clear();
    this.preview.clear();
    if (!this.referencesPinned) {
      this.referenceExplorer.clear();
    }
    if (!this.callHierarchyPinned) {
      this.callers.clear();
      this.callees.clear();
      this.callRootSignature = "";
    }
  }

  pinReferences(): void {
    this.referencesPinned = true;
    this.referenceExplorer.setPinned(true, this.currentSymbolName);
    void vscode.commands.executeCommand(
      "setContext",
      "cInsight.referencesPinned",
      true,
    );
  }

  unpinReferences(): void {
    this.referencesPinned = false;
    this.referenceExplorer.setPinned(false);
    void vscode.commands.executeCommand(
      "setContext",
      "cInsight.referencesPinned",
      false,
    );
  }

  pinCallHierarchy(): void {
    this.callHierarchyPinned = true;
    this.callHierarchyPinnedSymbol = this.currentSymbolName;
    this.callHierarchyPinnedStale = false;
    this.refreshCallPinBanners();
    void vscode.commands.executeCommand(
      "setContext",
      "cInsight.callHierarchyPinned",
      true,
    );
  }

  unpinCallHierarchy(): void {
    this.callHierarchyPinned = false;
    this.callHierarchyPinnedSymbol = undefined;
    this.callHierarchyPinnedStale = false;
    this.refreshCallPinBanners();
    void vscode.commands.executeCommand(
      "setContext",
      "cInsight.callHierarchyPinned",
      false,
    );
  }

  markPinnedViewsStale(): void {
    this.referenceExplorer.markPinnedStale();
    this.markResultsStale("the active source file changed");
    if (this.callHierarchyPinned) {
      this.callHierarchyPinnedStale = true;
      this.refreshCallPinBanners();
    }
  }

  markResultsStale(reason: string): void {
    this.referenceExplorer.markResultsStale(reason);
    this.callResultsStaleReason = reason;
    this.refreshCallPinBanners();
  }

  invalidateCallHierarchy(): void {
    this.stopCallExpansion();
    this.callRepository.invalidate();
    this.callRootSignature = "";
  }

  async promptExpandCallHierarchy(
    direction: "incoming" | "outgoing",
  ): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(
      "cInsight.callHierarchy",
    );
    const maximumDepth = configuration.get<number>("maximumDepth", 10);
    const value = await vscode.window.showInputBox({
      title:
        direction === "incoming"
          ? "Expand Callers to Depth"
          : "Expand Callees to Depth",
      value: String(
        Math.max(1, configuration.get<number>("defaultDepth", 0)),
      ),
      prompt: `Enter a depth from 1 to ${maximumDepth}`,
      validateInput: (input) => {
        const depth = Number(input);
        return Number.isInteger(depth) && depth >= 1 && depth <= maximumDepth
          ? undefined
          : `Enter an integer from 1 to ${maximumDepth}`;
      },
    });
    if (value === undefined) {
      return;
    }
    await this.expandCallHierarchy(direction, Number(value), true);
  }

  stopCallExpansion(): void {
    this.callExpansion?.cancel();
    this.callExpansion?.dispose();
    this.callExpansion = undefined;
  }

  async searchCallHierarchy(
    direction: "incoming" | "outgoing",
  ): Promise<void> {
    const provider =
      direction === "incoming" ? this.callers : this.callees;
    const nodes = flattenLoadedCallNodes(provider.getRoots());
    if (nodes.length === 0) {
      void vscode.window.showInformationMessage(
        "C Insight: No loaded call hierarchy nodes to search.",
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      nodes.map((node) => ({
        label: node.label,
        description: node.description,
        detail: node.location
          ? `${vscode.workspace.asRelativePath(node.location.uri)}:${node.location.range.start.line + 1}`
          : undefined,
        node,
      })),
      {
        title:
          direction === "incoming"
            ? "Search Loaded Callers"
            : "Search Loaded Callees",
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!picked) {
      return;
    }
    const view = this.treeViews.get(
      direction === "incoming"
        ? "cInsight.callers"
        : "cInsight.callees",
    );
    await view?.reveal(picked.node, {
      focus: true,
      select: true,
      expand: true,
    });
  }

  async findCallPath(
    direction: "incoming" | "outgoing",
  ): Promise<void> {
    const target = await vscode.window.showInputBox({
      title:
        direction === "incoming"
          ? "Find a Caller Path"
          : "Find a Callee Path",
      prompt: "Enter a target function name or qualified-name fragment",
    });
    if (!target?.trim()) {
      return;
    }
    const roots = (
      direction === "incoming"
        ? this.callers.getRoots()
        : this.callees.getRoots()
    )
      .map((root) => root.callNode)
      .filter((node): node is CallNode => node !== undefined);
    if (roots.length === 0) {
      void vscode.window.showInformationMessage(
        "C Insight: No call hierarchy root is available.",
      );
      return;
    }
    this.stopCallExpansion();
    const cancellation = new vscode.CancellationTokenSource();
    this.callExpansion = cancellation;
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `C Insight: Searching ${direction === "incoming" ? "caller" : "callee"} paths to ${target.trim()}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            cancellation.cancel(),
          );
          try {
            const config = vscode.workspace.getConfiguration(
              "cInsight.callHierarchy",
            );
            return await findCallPaths({
              roots,
              key: (node) => node.key,
              label: (node) =>
                `${node.raw.name} ${node.raw.detail ?? ""}`,
              target: target.trim(),
              neighbors: (node) =>
                this.callNeighbors(
                  direction,
                  node,
                  cancellation.token,
                ),
              maximumDepth: config.get<number>("pathSearchMaximumDepth", 8),
              maximumPaths: config.get<number>("pathSearchMaximumPaths", 20),
              maximumVisitedNodes: config.get<number>(
                "pathSearchMaximumNodes",
                2_000,
              ),
              isCancelled: () =>
                cancellation.token.isCancellationRequested,
            });
          } finally {
            subscription.dispose();
          }
        },
      );
      if (cancellation.token.isCancellationRequested) {
        return;
      }
      if (result.paths.length === 0) {
        void vscode.window.showInformationMessage(
          `C Insight: No path to “${target.trim()}” was found within ${result.visitedNodes} visited nodes.`,
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        result.paths.map((path) => {
          const destination = path[path.length - 1];
          return {
            label: path.map((node) => node.raw.name).join(" → "),
            description: `${path.length - 1} edges`,
            detail: `${vscode.workspace.asRelativePath(vscode.Uri.parse(destination.raw.uri))}:${destination.raw.selectionRange.start.line + 1}`,
            destination,
          };
        }),
        {
          title: `${result.paths.length} call path${result.paths.length === 1 ? "" : "s"}${result.truncated ? " (limited)" : ""}`,
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );
      if (picked) {
        await this.preview.showLocation(
          {
            uri: vscode.Uri.parse(picked.destination.raw.uri),
            range: this.analysis.toVsRange(
              picked.destination.raw.selectionRange,
            ),
          },
          direction === "incoming" ? "caller" : "callee-definition",
          picked.destination.raw.name,
          "selection",
        );
      }
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        throw error;
      }
    } finally {
      if (this.callExpansion === cancellation) {
        this.callExpansion = undefined;
      }
      cancellation.dispose();
    }
  }

  async exportCallHierarchy(
    direction: "incoming" | "outgoing",
    format: "text" | "json" | "mermaid",
  ): Promise<void> {
    const roots =
      direction === "incoming"
        ? this.callDataRoots(this.callers)
        : this.callDataRoots(this.callees);
    const uri = await vscode.window.showSaveDialog({
      title: `Export ${direction === "incoming" ? "Callers" : "Callees"} as ${format.toUpperCase()}`,
      filters:
        format === "json"
          ? { JSON: ["json"] }
          : format === "mermaid"
            ? { Markdown: ["md"], Mermaid: ["mmd"] }
            : { Text: ["txt"] },
      saveLabel: "Export",
    });
    if (!uri) {
      return;
    }
    const rendered = renderHierarchyExport(
      roots.map(callExportNode),
      {
        relation: "call",
        direction: direction === "incoming" ? "callers" : "callees",
        edgeDirection:
          direction === "incoming" ? "child-to-parent" : "parent-to-child",
      },
      format,
    );
    const content =
      format === "mermaid" &&
      uri.path.toLocaleLowerCase().endsWith(".md")
        ? `\`\`\`mermaid\n${rendered}\n\`\`\`\n`
        : rendered;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  }

  dispose(): void {
    this.stopCallExpansion();
    this.disposables.forEach((item) => item.dispose());
  }

  private async expandDefaultDepth(): Promise<void> {
    const depth = vscode.workspace
      .getConfiguration("cInsight.callHierarchy")
      .get<number>("defaultDepth", 0);
    if (depth <= 0 || this.callRootSignature.length === 0) {
      return;
    }
    this.stopCallExpansion();
    const cancellation = new vscode.CancellationTokenSource();
    this.callExpansion = cancellation;
    try {
      await this.expandDirection("incoming", depth, cancellation.token);
      await this.expandDirection("outgoing", depth, cancellation.token);
    } catch {
      // Cursor movement and refreshes routinely cancel automatic expansion.
    } finally {
      if (this.callExpansion === cancellation) {
        this.callExpansion = undefined;
      }
      cancellation.dispose();
    }
  }

  private async expandCallHierarchy(
    direction: "incoming" | "outgoing",
    depth: number,
    announce: boolean,
  ): Promise<void> {
    this.stopCallExpansion();
    const cancellation = new vscode.CancellationTokenSource();
    this.callExpansion = cancellation;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `C Insight: Expanding ${direction === "incoming" ? "Callers" : "Callees"} to depth ${depth}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            cancellation.cancel(),
          );
          try {
            await this.expandDirection(
              direction,
              depth,
              cancellation.token,
            );
          } finally {
            subscription.dispose();
          }
        },
      );
      if (announce && !cancellation.token.isCancellationRequested) {
        const cache = this.callRepository.stats(direction);
        void vscode.window.showInformationMessage(
          `C Insight: Loaded ${this.callTreeState[direction].loadedNodes} ${direction === "incoming" ? "caller" : "callee"} nodes; cache ${cache.hits} hits / ${cache.misses} misses.`,
        );
        this.publishCallExpansionStatus(direction, depth, false);
      } else if (announce) {
        this.publishCallExpansionStatus(direction, depth, true);
      }
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        throw error;
      }
      if (announce) {
        this.publishCallExpansionStatus(direction, depth, true);
      }
    } finally {
      if (this.callExpansion === cancellation) {
        this.callExpansion = undefined;
      }
      cancellation.dispose();
    }
  }

  private publishCallExpansionStatus(
    direction: "incoming" | "outgoing",
    requestedDepth: number,
    cancelled: boolean,
  ): void {
    const configuration = vscode.workspace.getConfiguration(
      "cInsight.callHierarchy",
    );
    const maximumDepth = configuration.get<number>("maximumDepth", 10);
    const maximumNodes = this.maximumCallNodes();
    const reason = hierarchyExpansionStopReason({
      cancelled,
      loadedNodes: this.callTreeState[direction].loadedNodes,
      maximumNodes,
      requestedDepth,
      maximumDepth,
    });
    if (!reason) {
      return;
    }
    const message = hierarchyExpansionMessage(
      reason,
      maximumDepth,
      maximumNodes,
    );
    const provider =
      direction === "incoming" ? this.callers : this.callees;
    provider.setRoots([
      {
        label: message.label,
        description: message.description,
        icon: new vscode.ThemeIcon("info"),
        contextValue: "hierarchyExpansionStatus",
      },
      ...provider
        .getRoots()
        .filter((node) => node.contextValue !== "hierarchyExpansionStatus"),
    ]);
  }

  private async expandDirection(
    direction: "incoming" | "outgoing",
    depth: number,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const provider =
      direction === "incoming" ? this.callers : this.callees;
    const view = this.treeViews.get(
      direction === "incoming"
        ? "cInsight.callers"
        : "cInsight.callees",
    );
    const queue = [...provider.getRoots()];
    while (queue.length > 0 && !token.isCancellationRequested) {
      const node = queue.shift()!;
      if (
        node.callKey === undefined ||
        (node.callDepth ?? 0) >= depth ||
        this.callTreeState[direction].atLimit(this.maximumCallNodes())
      ) {
        continue;
      }
      const children = await provider.getChildren(node);
      await view?.reveal(node, {
        expand: true,
        focus: false,
        select: false,
      });
      queue.push(...children.filter((child) => child.callKey !== undefined));
    }
  }

  private async restoreExpandedCallPaths(
    direction: "incoming" | "outgoing",
    serializedPaths: string[],
  ): Promise<void> {
    const wanted = new Set(serializedPaths.slice(0, 500));
    if (wanted.size === 0) {
      return;
    }
    const provider =
      direction === "incoming" ? this.callers : this.callees;
    const view = this.treeViews.get(
      direction === "incoming"
        ? "cInsight.callers"
        : "cInsight.callees",
    );
    const queue = [...provider.getRoots()];
    while (
      queue.length > 0 &&
      !this.callTreeState[direction].atLimit(this.maximumCallNodes())
    ) {
      const node = queue.shift()!;
      if (!node.callPath || !wanted.has(node.callPath)) {
        continue;
      }
      const children = await provider.getChildren(node);
      this.expandedCallPaths[direction].add(node.callPath);
      await view?.reveal(node, {
        expand: true,
        focus: false,
        select: false,
      });
      for (const child of children) {
        if (
          child.callPath &&
          hasPathOrDescendant(wanted, child.callPath)
        ) {
          queue.push(child);
        }
      }
    }
  }

  private async callNeighbors(
    direction: "incoming" | "outgoing",
    node: CallNode,
    token: vscode.CancellationToken,
  ): Promise<CallNode[]> {
    if (direction === "incoming") {
      const calls = await this.callRepository.incoming(node, token);
      return calls.map((call) => this.analysis.callNode(call.from));
    }
    const calls = await this.callRepository.outgoing(node, token);
    return calls.map((call) => this.analysis.callNode(call.to));
  }

  private withCallPinBanner(roots: TreeNode[]): TreeNode[] {
    const banners: TreeNode[] = [];
    if (this.callHierarchyPinned) {
      banners.push({
        label: `Pinned: ${this.callHierarchyPinnedSymbol ?? "Call Hierarchy"}`,
        description: this.callHierarchyPinnedStale ? "stale" : undefined,
        icon: new vscode.ThemeIcon(
          this.callHierarchyPinnedStale ? "warning" : "pinned",
        ),
        contextValue: "callHierarchyPinStatus",
      });
    }
    if (this.callResultsStaleReason) {
      banners.push({
        label: "Results are stale",
        description: this.callResultsStaleReason,
        tooltip: `These results predate: ${this.callResultsStaleReason}. Run the query again to refresh them.`,
        icon: new vscode.ThemeIcon("history"),
        contextValue: "analysisStaleStatus",
      });
    }
    return [...banners, ...roots];
  }

  private refreshCallPinBanners(): void {
    const callerRoots = this.callDataRoots(this.callers);
    const calleeRoots = this.callDataRoots(this.callees);
    this.callers.setRoots(this.withCallPinBanner(callerRoots));
    this.callees.setRoots(this.withCallPinBanner(calleeRoots));
  }

  private callDataRoots(provider: MutableTreeProvider): TreeNode[] {
    return provider
      .getRoots()
      .filter(
        (node) =>
          node.contextValue !== "callHierarchyPinStatus" &&
          node.contextValue !== "analysisStaleStatus" &&
          node.contextValue !== "hierarchyExpansionStatus",
      );
  }

  private noCallsNode(direction: "incoming" | "outgoing"): TreeNode {
    const noun = direction === "incoming" ? "callers" : "callees";
    return {
      label:
        this.reliability.level === "reliable"
          ? `No ${noun} found`
          : `No ${noun} found yet — results may be incomplete`,
      icon: new vscode.ThemeIcon("info"),
    };
  }

  private maximumCallNodes(): number {
    return vscode.workspace
      .getConfiguration("cInsight.callHierarchy")
      .get<number>("maximumNodes", 2_000);
  }

  private callTreeNode(
    node: CallNode,
    direction: "incoming" | "outgoing",
    ancestors: string[],
    depth: number,
  ): TreeNode {
    const location: LocationResult = {
      uri: vscode.Uri.parse(node.raw.uri),
      range: this.analysis.toVsRange(node.raw.selectionRange),
    };
    const recursion = recursionKind(node.key, ancestors);
    const recursive = recursion !== undefined;
    const { duplicate } = this.callTreeState[direction].record(
      node.key,
      recursive,
    );
    const maximumDepth = vscode.workspace
      .getConfiguration("cInsight.callHierarchy")
      .get<number>("maximumDepth", 10);
    const atDepthLimit = depth >= maximumDepth;
    return {
      id: `${direction}:${ancestors.join(">")}:${node.key}`,
      label: node.raw.name,
      description: `${
        recursive
          ? recursion === "direct"
            ? "direct recursion"
            : "indirect recursion"
          : duplicate
            ? `duplicate · ${node.raw.detail || vscode.workspace.asRelativePath(location.uri)}`
            : `${node.raw.detail || vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}`
      }${atDepthLimit ? " · max depth" : ""}`,
      tooltip: node.raw.detail,
      location,
      callKey: node.key,
      callDepth: depth,
      callNode: node,
      callPath: [...ancestors, node.key].join("\u0000"),
      icon: new vscode.ThemeIcon(recursive ? "debug-restart" : "symbol-method"),
      collapsibleState: recursive
        ? vscode.TreeItemCollapsibleState.None
        : atDepthLimit
          ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed,
      loadChildren: recursive || atDepthLimit
        ? undefined
        : async () => {
            if (this.callTreeState[direction].atLimit(this.maximumCallNodes())) {
              return [limitNode("Call hierarchy node limit reached")];
            }
            const lineage = [...ancestors, node.key];
            if (direction === "incoming") {
              const calls = await this.callRepository.incoming(
                node,
                this.callExpansion?.token,
              );
              const remaining = this.callTreeState[direction].remaining(
                this.maximumCallNodes(),
              );
              const children = calls.slice(0, remaining).map((call) =>
                this.incomingNode(call, lineage, direction, depth + 1),
              );
              if (children.length < calls.length) {
                children.push(limitNode("Call hierarchy node limit reached"));
              }
              return children.length > 0
                ? children
                : [this.noCallsNode("incoming")];
            }
            try {
              const calls = await this.callRepository.outgoing(
                node,
                this.callExpansion?.token,
              );
              const remaining = this.callTreeState[direction].remaining(
                this.maximumCallNodes(),
              );
              const children = calls.slice(0, remaining).map((call) =>
                this.outgoingNode(
                  call,
                  lineage,
                  direction,
                  vscode.Uri.parse(node.raw.uri),
                  depth + 1,
                ),
              );
              if (children.length < calls.length) {
                children.push(limitNode("Call hierarchy node limit reached"));
              }
              return children.length > 0
                ? children
                : [this.noCallsNode("outgoing")];
            } catch (error) {
              return [
                {
                  label:
                    error instanceof UnsupportedClangdFeatureError
                      ? error.message
                      : `Callees query failed: ${String(error)}`,
                  icon: new vscode.ThemeIcon("warning"),
                  tooltip:
                    "Set cInsight.clangd.path to a clangd 20+ executable and restart clangd.",
                },
              ];
            }
          },
    };
  }

  private incomingNode(
    call: CallHierarchyIncomingCall,
    ancestors: string[],
    direction: "incoming",
    depth: number,
  ): TreeNode {
    const node = this.analysis.callNode(call.from);
    const treeNode = this.callTreeNode(node, direction, ancestors, depth);
    treeNode.previewMode = "caller";
    treeNode.description = `${call.fromRanges.length} call${call.fromRanges.length === 1 ? "" : "s"} · ${treeNode.description ?? ""}`;
    return this.withCallSites(
      treeNode,
      vscode.Uri.parse(call.from.uri),
      call.fromRanges,
      "caller",
    );
  }

  private outgoingNode(
    call: CallHierarchyOutgoingCall,
    ancestors: string[],
    direction: "outgoing",
    callerUri: vscode.Uri,
    depth: number,
  ): TreeNode {
    const node = this.analysis.callNode(call.to);
    const treeNode = this.callTreeNode(node, direction, ancestors, depth);
    treeNode.previewMode = "callee-definition";
    treeNode.description = `${call.fromRanges.length} call${call.fromRanges.length === 1 ? "" : "s"} · ${treeNode.description ?? ""}`;
    return this.withCallSites(
      treeNode,
      callerUri,
      call.fromRanges,
      "callee-call-site",
    );
  }

  private locationNode(
    location: LocationResult,
    label: string,
    previewMode: PreviewMode,
  ): TreeNode {
    const node: TreeNode = {
      label,
      description: `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}`,
      tooltip: location.uri.fsPath,
      location,
      previewMode,
      icon: new vscode.ThemeIcon("go-to-file"),
    };
    node.resolveVisible = () => this.enrichSourceNode(node);
    return node;
  }

  private symbolNode(uri: vscode.Uri, symbol: LspSymbol): TreeNode {
    if ("location" in symbol) {
      const info = symbol as SymbolInformation;
      return {
        label: info.name,
        description: info.containerName,
        icon: new vscode.ThemeIcon("symbol-misc"),
        location: this.analysis.toVsLocation(info.location),
      };
    }
    const document = symbol as DocumentSymbol;
    return {
      label: document.name,
      description: document.detail,
      icon: new vscode.ThemeIcon("symbol-misc"),
      location: {
        uri,
        range: this.analysis.toVsRange(document.selectionRange),
      },
      children: document.children?.map((child) => this.symbolNode(uri, child)),
    };
  }

  private withCallSites(
    node: TreeNode,
    uri: vscode.Uri,
    ranges: Array<{ start: { line: number; character: number }; end: { line: number; character: number } }>,
    mode: PreviewMode,
  ): TreeNode {
    const nested = node.loadChildren;
    node.loadChildren = async () => {
      const callSites = ranges.map((range, index) =>
        this.locationNode(
          {
            uri,
            range: this.analysis.toVsRange(range),
          },
          `Call ${index + 1} · Line ${range.start.line + 1}`,
          mode,
        ),
      );
      const descendants = nested ? await nested() : [];
      return [...callSites, ...descendants];
    };
    return node;
  }

  private async enrichSourceNode(node: TreeNode): Promise<void> {
    if (!node.location) {
      return;
    }
    try {
      const source = await this.sourceLines.line(
        node.location.uri,
        node.location.range.start.line,
      );
      const line = source?.trim();
      if (line) {
        node.label = `${node.location.range.start.line + 1}  ${line}`;
        const indirect =
          node.previewMode === "callee-call-site" &&
          looksLikeExplicitIndirectCall(
            source!,
            node.location.range.start.character,
          );
        if (indirect) {
          node.description = node.description
            ? `${node.description} · possible indirect call`
            : "possible indirect call";
        }
        node.tooltip = `${node.location.uri.fsPath}:${node.location.range.start.line + 1}\n${line}`;
        if (indirect) {
          node.tooltip +=
            "\nPossible indirect call: explicit function-pointer syntax.";
        }
      }
    } catch {
      // Keep the location-only label when a virtual or missing file cannot load.
    }
  }

}

function hasPathOrDescendant(paths: Set<string>, candidate: string): boolean {
  const prefix = `${candidate}\u0000`;
  for (const path of paths) {
    if (path === candidate || path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function limitNode(label: string): TreeNode {
  return {
    label,
    icon: new vscode.ThemeIcon("warning"),
    tooltip:
      "Adjust cInsight.callHierarchy.maximumDepth or maximumNodes if needed.",
  };
}

function flattenLoadedCallNodes(roots: TreeNode[]): TreeNode[] {
  const output: TreeNode[] = [];
  const visit = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.callKey) {
        output.push(node);
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(roots);
  return output;
}

function maximumLoadedDepth(roots: TreeNode[]): number {
  return flattenLoadedCallNodes(roots).reduce(
    (maximum, node) => Math.max(maximum, node.callDepth ?? 0),
    0,
  );
}

function callExportNode(node: TreeNode): HierarchyExportNode {
  return {
    name: node.label,
    description: node.description,
    uri: node.location?.uri.toString(),
    line: node.location ? node.location.range.start.line + 1 : undefined,
    states: hierarchyNodeStates(node.label, node.description),
    children: node.children?.map(callExportNode) ?? [],
  };
}
