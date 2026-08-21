import * as vscode from "vscode";
import {
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
import {
  CallHierarchyRepository,
  CallSymbolLocations,
} from "../callHierarchy/callHierarchyRepository";
import {
  CallOccurrence,
  projectCallOccurrences,
} from "../callHierarchy/callOccurrenceModel";
import { microsoftEmptyCallersMessage } from "../callHierarchy/microsoftCallerFallbackModel";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import type {
  CallHierarchySessionState,
  ReferenceSessionState,
} from "../session/workspaceSession";
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
  findExplicitIndirectCalls,
  looksLikeExplicitIndirectCall,
  recursionKind,
} from "../utils/callHierarchy";
import { findCallPaths } from "../utils/callPath";
import {
  defaultCallExpansionDirections,
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
import { MutableTreeProvider, TreeNode, viewStatusNode } from "./treeNode";
import { writeExportWithinBudget } from "../utils/exportWriter";
import { CONTEXT_KEYS, VIEWS, type ViewId } from "../ids";
import { ViewLifecycle } from "./viewLifecycle";
import { CallHierarchyViewState } from "./callHierarchyViewState";
import { symbolKindIconId } from "../symbols/symbolPresentation";
import {
  functionLocationSignature,
  independentDeclarationLocations,
  preferredFunctionLocation,
  PreferredFunctionLocation,
} from "../utils/definitionLocation";

export class ViewRegistry implements vscode.Disposable {
  readonly context = new MutableTreeProvider();
  readonly references: MutableTreeProvider;
  readonly referenceExplorer: ReferenceExplorer;
  readonly callers = new MutableTreeProvider();
  readonly callees = new MutableTreeProvider();
  readonly symbols = new MutableTreeProvider();
  readonly status = new MutableTreeProvider();
  readonly preview: CodePreviewProvider;
  private readonly lifecycle = new ViewLifecycle<TreeNode>();
  readonly onDidChangeNavigationVisibility = this.lifecycle.onDidChangeVisibility;
  private readonly sourceLines = new SourceLineCache();
  private readonly callTreeState = {
    incoming: new HierarchyTreeState(),
    outgoing: new HierarchyTreeState(),
  };
  private callRootSignature = "";
  private callRootDisplaySignature = "";
  private callExpansion?: vscode.CancellationTokenSource;
  private readonly callViewState = new CallHierarchyViewState();
  private currentSymbolName?: string;
  private currentPreferredLocation?: PreferredFunctionLocation<LocationResult>;
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
      context: this.isViewVisible(VIEWS.CONTEXT),
      preview: this.preview.visible,
      references: this.isViewVisible(VIEWS.REFERENCES),
      callers: this.isViewVisible(VIEWS.CALLERS),
      callees: this.isViewVisible(VIEWS.CALLEES),
    };
  }

  isViewVisible(id: ViewId): boolean {
    return this.lifecycle.isVisible(id);
  }

  constructor(
    private readonly analysis: AnalysisService,
    history: NavigationHistoryExplorer,
    bookmarks: BookmarkExplorer,
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
    this.context.setRoots([
      viewStatusNode(vscode.l10n.t("Place the cursor on a C/C++ symbol"), "idle"),
    ]);
    this.callers.setRoots([
      viewStatusNode(vscode.l10n.t("Place the cursor on a callable symbol"), "idle", {
        description: vscode.l10n.t("open Callers or run Show Incoming Calls to query"),
      }),
    ]);
    this.callees.setRoots([
      viewStatusNode(vscode.l10n.t("Place the cursor on a callable symbol"), "idle", {
        description: vscode.l10n.t("open Callees or run Show Outgoing Calls to query"),
      }),
    ]);
    const providers: Array<[ViewId, MutableTreeProvider]> = [
      [VIEWS.CONTEXT, this.context],
      [VIEWS.REFERENCES, this.references],
      [VIEWS.CALLERS, this.callers],
      [VIEWS.CALLEES, this.callees],
      [VIEWS.HISTORY, history.provider],
      [VIEWS.BOOKMARKS, bookmarks.provider],
      [VIEWS.SUPERTYPES, typeHierarchy.supertypes],
      [VIEWS.SUBTYPES, typeHierarchy.subtypes],
      [VIEWS.INCLUDES, includeHierarchy.includes],
      [VIEWS.INCLUDED_BY, includeHierarchy.includedBy],
      [VIEWS.SYMBOLS, this.symbols],
      [VIEWS.STATUS, this.status],
    ];
    for (const [id, provider] of providers) {
      provider.setInteractionScope(id);
      const tracksNavigation = new Set<ViewId>([
        VIEWS.CONTEXT, VIEWS.REFERENCES, VIEWS.CALLERS, VIEWS.CALLEES, VIEWS.SYMBOLS,
      ]).has(id);
      const treeView = this.lifecycle.createTreeView(id, provider, tracksNavigation);
      const callDirection =
        id === VIEWS.CALLERS
          ? "incoming"
          : id === VIEWS.CALLEES
            ? "outgoing"
            : undefined;
      if (callDirection) {
        this.lifecycle.track(
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
      if (id === VIEWS.REFERENCES) {
        this.referenceExplorer.attachTreeView(treeView);
      }
      if (id === VIEWS.SUPERTYPES) {
        typeHierarchy.attachTreeView("supertypes", treeView);
      }
      if (id === VIEWS.SUBTYPES) {
        typeHierarchy.attachTreeView("subtypes", treeView);
      }
      if (id === VIEWS.INCLUDES) {
        includeHierarchy.attachTreeView("includes", treeView);
      }
      if (id === VIEWS.INCLUDED_BY) {
        includeHierarchy.attachTreeView("includedBy", treeView);
      }
      if (
        id !== VIEWS.HISTORY &&
        id !== VIEWS.BOOKMARKS &&
        id !== VIEWS.WORKSPACE_SYMBOLS &&
        id !== VIEWS.SUPERTYPES &&
        id !== VIEWS.SUBTYPES &&
        id !== VIEWS.INCLUDES &&
        id !== VIEWS.INCLUDED_BY
      ) {
        this.lifecycle.track(provider);
      }
    }
    this.lifecycle.registerWebview(this.preview, this.preview.onDidChangeVisibility);
    this.lifecycle.track(this.sourceLines, this.referenceExplorer);
  }

  updateContext(
    context: SymbolContext,
    intent: ViewUpdateIntent = {},
  ): void {
    const primary = context.callRoots[0];
    this.currentSymbolName =
      context.qualifiedName ?? context.name ?? primary?.raw.name;
    const preferredLocation = this.preferredLocation(
      context.definitions,
      context.declarations,
      primary,
    );
    this.currentPreferredLocation = preferredLocation;
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
        description: vscode.l10n.t("Qualified name"),
        tooltip: context.symbolId,
        icon: new vscode.ThemeIcon("symbol-namespace"),
      });
    }
    if (hover) {
      const signature = hover.split(/\r?\n/).find((line) => line.trim());
      if (signature) {
        roots.push({
          label: signature.trim(),
          description: vscode.l10n.t("Type / signature"),
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
          ? vscode.l10n.t("References not queried")
          : context.detailsPending
            ? vscode.l10n.t("References loading…")
            : vscode.l10n.t("{count} references", { count: context.references.length }),
        description: !context.referencesRequested
          ? vscode.l10n.t("open References to query")
          : undefined,
        icon: new vscode.ThemeIcon("references"),
      },
      {
        label:
          !context.incomingRequested
            ? vscode.l10n.t("Callers not queried")
            : context.detailsPending
            ? vscode.l10n.t("Callers loading…")
            : context.incomingCount === undefined
            ? vscode.l10n.t("Callers unavailable")
            : vscode.l10n.t("{count} callers", { count: context.incomingCount }),
        description: !context.incomingRequested
          ? vscode.l10n.t("open Callers to query")
          : undefined,
        icon: new vscode.ThemeIcon("call-incoming"),
      },
      {
        label:
          !context.outgoingRequested
            ? vscode.l10n.t("Callees not queried")
            : context.detailsPending
            ? vscode.l10n.t("Callees loading…")
            : context.outgoingCount === undefined
            ? vscode.l10n.t("Callees unavailable")
            : vscode.l10n.t("{count} callees", { count: context.outgoingCount }),
        description: !context.outgoingRequested
          ? vscode.l10n.t("open Callees to query")
          : undefined,
        icon: new vscode.ThemeIcon("call-outgoing"),
      },
      {
        label: vscode.workspace.asRelativePath(context.uri),
        description: vscode.l10n.t("Line {line}", { line: context.position.line + 1 }),
        icon: new vscode.ThemeIcon("file-code"),
      },
    );
    this.context.setRoots(roots);

    if (preferredLocation && this.preview.visible) {
      void this.preview.showLocation(
        preferredLocation.location,
        preferredLocation.kind === "definition" ? "definition" : "declaration",
        context.qualifiedName ?? context.name ?? "Symbol",
        "context",
      );
    } else if (this.preview.visible) {
      this.preview.clear();
    }
    if (
      (this.isViewVisible(VIEWS.REFERENCES) ||
        intent.manualReferences) &&
      (context.referencesRequested || intent.manualReferences) &&
      shouldUpdatePinnedView(
        this.referenceExplorer.isPinned,
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
      this.callViewState.pinned,
      intent.manualCallHierarchy,
    ) && (
      this.isViewVisible(VIEWS.CALLERS) ||
      this.isViewVisible(VIEWS.CALLEES) ||
      Boolean(intent.manualCallHierarchy)
    );
    const callRootSignature = context.callRoots.map((root) => root.key).join("|");
    const callRootDisplaySignature = functionLocationSignature(preferredLocation);
    if (
      allowCallUpdate &&
      (callRootSignature !== this.callRootSignature ||
        intent.manualCallHierarchy)
    ) {
      this.callRootSignature = callRootSignature;
      this.callRootDisplaySignature = callRootDisplaySignature;
      if (this.callViewState.pinned && intent.manualCallHierarchy) {
        this.callViewState.replacePinnedSymbol(this.currentSymbolName);
      }
      this.callTreeState.incoming.reset();
      this.callTreeState.outgoing.reset();
      this.expandedCallPaths.incoming.clear();
      this.expandedCallPaths.outgoing.clear();
      const callerRoots = context.callRoots.map((root, index) =>
        this.callTreeNode(
          root,
          "incoming",
          [],
          0,
          index === 0 ? preferredLocation : undefined,
          index === 0
            ? {
                definitions: context.definitions,
                declarations: context.declarations,
              }
            : undefined,
        ),
      );
      const calleeRoots = context.callRoots.map((root, index) =>
        this.callTreeNode(
          root,
          "outgoing",
          [],
          0,
          index === 0 ? preferredLocation : undefined,
        ),
      );
      this.callResultsStaleReason = undefined;
      this.callers.setRoots(this.withCallPinBanner(callerRoots, "incoming"));
      this.callees.setRoots(this.withCallPinBanner(calleeRoots, "outgoing"));
      void this.expandDefaultDepth(intent.manualCallDirection);
    } else if (
      allowCallUpdate &&
      callRootSignature === this.callRootSignature &&
      callRootDisplaySignature !== this.callRootDisplaySignature
    ) {
      this.callRootDisplaySignature = callRootDisplaySignature;
      this.updateCallerRootSymbolLocations(
        context.definitions,
        context.declarations,
      );
      this.updateCallRootPresentation(preferredLocation);
    } else if (allowCallUpdate && callRootSignature === this.callRootSignature) {
      this.updateCallerRootSymbolLocations(
        context.definitions,
        context.declarations,
      );
    }
  }

  async updatePreferredDefinitionLocations(
    definitions: LocationResult[],
    declarations: LocationResult[],
  ): Promise<boolean> {
    const callerRoot = this.callDataRoots(this.callers)
      .find((node) => node.callNode && node.callDepth === 0);
    const root = callerRoot?.callNode ??
      this.callDataRoots(this.callees)
        .find((node) => node.callNode && node.callDepth === 0)
        ?.callNode;
    const preferred = this.preferredLocation(definitions, declarations, root);
    this.currentPreferredLocation = preferred;
    if (!preferred) {
      return false;
    }
    if (!this.callViewState.pinned && callerRoot) {
      callerRoot.callSymbolLocations = { definitions, declarations };
      this.refreshCallerDeclarationChildren(callerRoot);
      this.callers.refresh(callerRoot);
    }
    if (this.preview.visible) {
      await this.preview.showLocation(
        preferred.location,
        preferred.kind === "definition" ? "definition" : "declaration",
        this.currentSymbolName ?? "Symbol",
        "context",
      );
    }
    const signature = functionLocationSignature(preferred);
    if (
      !this.callViewState.pinned &&
      signature !== this.callRootDisplaySignature &&
      (this.isViewVisible(VIEWS.CALLERS) || this.isViewVisible(VIEWS.CALLEES))
    ) {
      this.callRootDisplaySignature = signature;
      this.updateCallRootPresentation(preferred);
    }
    return preferred.kind === "definition";
  }

  get preferredDefinitionNeedsUpgrade(): boolean {
    return this.currentPreferredLocation?.kind === "declaration-fallback" &&
      ((this.preview.visible && !this.preview.isLocked) ||
        (!this.callViewState.pinned &&
          (this.isViewVisible(VIEWS.CALLERS) ||
            this.isViewVisible(VIEWS.CALLEES))));
  }

  updateReferences(
    locations: LocationResult[],
    definitions: LocationResult[] = [],
    declarations: LocationResult[] = [],
    callableSymbol = false,
    symbolName?: string,
    manual = false,
  ): void {
    if (!shouldUpdatePinnedView(this.referenceExplorer.isPinned, manual)) {
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
    if (!shouldUpdatePinnedView(this.referenceExplorer.isPinned, manual)) {
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

  callHierarchyInteractionState(): {
    pinned: boolean;
    pinnedSymbol?: string;
    pinnedStale: boolean;
    incomingRoots: string[];
    outgoingRoots: string[];
    incomingRootLocations: CallLocationSnapshot[];
    outgoingRootLocations: CallLocationSnapshot[];
    incomingLabels: string[];
    outgoingLabels: string[];
    incomingOccurrences: CallOccurrenceSnapshot[];
    outgoingOccurrences: CallOccurrenceSnapshot[];
    incomingDeclarations: CallLocationSnapshot[];
    incomingNavigationLabels: string[];
    loadedIncoming: number;
    loadedOutgoing: number;
    incomingCache: { hits: number; misses: number };
    outgoingCache: { hits: number; misses: number };
    callerEvidence: ReturnType<CallHierarchyRepository["microsoftCallerEvidenceStats"]>;
    calleeEvidence: ReturnType<CallHierarchyRepository["microsoftCalleeEvidenceStats"]>;
    session?: CallHierarchySessionState;
  } {
    return {
      pinned: this.callViewState.pinned,
      pinnedSymbol: this.callViewState.pinnedSymbol,
      pinnedStale: this.callViewState.pinnedStale,
      incomingRoots: this.callers.getRoots()
        .filter((node) => node.callNode && node.callDepth === 0)
        .map((node) => node.label),
      outgoingRoots: this.callees.getRoots()
        .filter((node) => node.callNode && node.callDepth === 0)
        .map((node) => node.label),
      incomingRootLocations: callRootSnapshots(this.callers.getRoots()),
      outgoingRootLocations: callRootSnapshots(this.callees.getRoots()),
      incomingLabels: this.callers.getRoots().map((node) => node.label),
      outgoingLabels: this.callees.getRoots().map((node) => node.label),
      incomingOccurrences: callOccurrenceSnapshots(this.callers.getRoots()),
      outgoingOccurrences: callOccurrenceSnapshots(this.callees.getRoots()),
      incomingDeclarations: callerDeclarationSnapshots(this.callers.getRoots()),
      incomingNavigationLabels: flattenLoadedCallNavigationNodes(
        this.callers.getRoots(),
      ).map((node) => node.label),
      loadedIncoming: flattenLoadedCallNodes(this.callers.getRoots()).length,
      loadedOutgoing: flattenLoadedCallNodes(this.callees.getRoots()).length,
      incomingCache: this.callRepository.stats("incoming"),
      outgoingCache: this.callRepository.stats("outgoing"),
      callerEvidence: this.callRepository.microsoftCallerEvidenceStats(),
      calleeEvidence: this.callRepository.microsoftCalleeEvidenceStats(),
      session: this.callHierarchySessionState(),
    };
  }

  async activateCallOccurrenceForTest(
    direction: "incoming" | "outgoing",
    label: string,
    ordinal: number,
  ): Promise<boolean> {
    const provider = direction === "incoming" ? this.callers : this.callees;
    const occurrence = flattenLoadedCallNodes(provider.getRoots())
      .filter((node) => (node.callDepth ?? 0) > 0 && node.label === label)
      .sort(compareTreeNodeLocations)[ordinal - 1];
    if (!occurrence?.location) {
      return false;
    }
    await vscode.commands.executeCommand(
      "cInsight.activateTreeLocation",
      occurrence,
      direction === "incoming" ? VIEWS.CALLERS : VIEWS.CALLEES,
    );
    return true;
  }

  async activateCallerDeclarationForTest(label: string): Promise<boolean> {
    const declaration = flattenLoadedCallNavigationNodes(this.callers.getRoots())
      .find(
        (node) =>
          node.callSupplement === "call-declaration" &&
          node.label.startsWith(`${label} ·`),
      );
    if (!declaration?.location) {
      return false;
    }
    await vscode.commands.executeCommand(
      "cInsight.activateTreeLocation",
      declaration,
      VIEWS.CALLERS,
    );
    return true;
  }

  expandCallHierarchyToDepth(
    direction: "incoming" | "outgoing",
    depth: number,
  ): Promise<void> {
    return this.expandCallHierarchy(direction, depth, false);
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
    this.currentPreferredLocation = undefined;
    this.context.setRoots([
      viewStatusNode(vscode.l10n.t("Place the cursor on a C/C++ symbol"), "idle"),
    ]);
    this.preview.clear();
    if (!this.referenceExplorer.isPinned) {
      this.referenceExplorer.clear();
    }
    if (!this.callViewState.pinned) {
      this.callers.setRoots([
        viewStatusNode(vscode.l10n.t("Place the cursor on a callable symbol"), "idle", {
          description: vscode.l10n.t("open Callers or run Show Incoming Calls to query"),
        }),
      ]);
      this.callees.setRoots([
        viewStatusNode(vscode.l10n.t("Place the cursor on a callable symbol"), "idle", {
          description: vscode.l10n.t("open Callees or run Show Outgoing Calls to query"),
        }),
      ]);
      this.callRootSignature = "";
      this.callRootDisplaySignature = "";
    }
  }

  pinReferences(): void {
    this.referenceExplorer.setPinned(true, this.currentSymbolName);
    void vscode.commands.executeCommand(
      "setContext",
      CONTEXT_KEYS.REFERENCES_PINNED,
      true,
    );
  }

  unpinReferences(): void {
    this.referenceExplorer.setPinned(false);
    void vscode.commands.executeCommand(
      "setContext",
      CONTEXT_KEYS.REFERENCES_PINNED,
      false,
    );
  }

  pinCallHierarchy(): void {
    this.callViewState.pin(this.currentSymbolName);
    this.refreshCallPinBanners();
    void vscode.commands.executeCommand(
      "setContext",
      CONTEXT_KEYS.CALL_HIERARCHY_PINNED,
      true,
    );
  }

  unpinCallHierarchy(): void {
    this.callViewState.unpin();
    this.refreshCallPinBanners();
    void vscode.commands.executeCommand(
      "setContext",
      CONTEXT_KEYS.CALL_HIERARCHY_PINNED,
      false,
    );
  }

  markPinnedViewsStale(): void {
    this.referenceExplorer.markPinnedStale();
    this.markResultsStale("the active source file changed");
    if (this.callViewState.pinned) {
      this.callViewState.markStale();
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
    this.callRootDisplaySignature = "";
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
          ? vscode.l10n.t("Expand Callers to Depth")
          : vscode.l10n.t("Expand Callees to Depth"),
      value: String(
        Math.max(1, configuration.get<number>("defaultDepth", 1)),
      ),
      prompt: vscode.l10n.t("Enter a depth from 1 to {maximum}", { maximum: maximumDepth }),
      validateInput: (input) => {
        const depth = Number(input);
        return Number.isInteger(depth) && depth >= 1 && depth <= maximumDepth
          ? undefined
          : vscode.l10n.t("Enter an integer from 1 to {maximum}", { maximum: maximumDepth });
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
    const nodes = flattenLoadedCallNavigationNodes(provider.getRoots());
    if (nodes.length === 0) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("C Insight: No loaded call hierarchy nodes to search."),
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
            ? vscode.l10n.t("Search Loaded Callers")
            : vscode.l10n.t("Search Loaded Callees"),
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!picked) {
      return;
    }
    const view = this.lifecycle.get(
      direction === "incoming"
        ? VIEWS.CALLERS
        : VIEWS.CALLEES,
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
          ? vscode.l10n.t("Find a Caller Path")
          : vscode.l10n.t("Find a Callee Path"),
      prompt: vscode.l10n.t("Enter a target function name or qualified-name fragment"),
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
        vscode.l10n.t("C Insight: No call hierarchy root is available."),
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
          title: vscode.l10n.t("C Insight: Searching {direction} paths to {target}", {
            direction: direction === "incoming" ? vscode.l10n.t("caller") : vscode.l10n.t("callee"),
            target: target.trim(),
          }),
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
          vscode.l10n.t("C Insight: No path to “{target}” was found within {count} visited nodes.", { target: target.trim(), count: result.visitedNodes }),
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        result.paths.map((path) => {
          const destination = path[path.length - 1];
          return {
            label: path.map((node) => node.raw.name).join(" → "),
            description: vscode.l10n.t("{count} edges", { count: path.length - 1 }),
            detail: `${vscode.workspace.asRelativePath(vscode.Uri.parse(destination.raw.uri))}:${destination.raw.selectionRange.start.line + 1}`,
            destination,
          };
        }),
        {
          title: vscode.l10n.t("{count} call path(s){limited}", {
            count: result.paths.length,
            limited: result.truncated ? vscode.l10n.t(" (limited)") : "",
          }),
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
      title: vscode.l10n.t("Export {direction} as {format}", {
        direction: direction === "incoming" ? vscode.l10n.t("Callers") : vscode.l10n.t("Callees"),
        format: format.toUpperCase(),
      }),
      filters:
        format === "json"
          ? { JSON: ["json"] }
          : format === "mermaid"
            ? { Markdown: ["md"], Mermaid: ["mmd"] }
            : { Text: ["txt"] },
      saveLabel: vscode.l10n.t("Export"),
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
    await writeExportWithinBudget(uri, content);
  }

  dispose(): void {
    this.stopCallExpansion();
    this.lifecycle.dispose();
  }

  private async expandDefaultDepth(
    manualDirection?: "incoming" | "outgoing",
  ): Promise<void> {
    const depth = vscode.workspace
      .getConfiguration("cInsight.callHierarchy")
      .get<number>("defaultDepth", 1);
    if (depth <= 0 || this.callRootSignature.length === 0) {
      return;
    }
    const directions = defaultCallExpansionDirections(
      {
        callers: this.isViewVisible(VIEWS.CALLERS),
        callees: this.isViewVisible(VIEWS.CALLEES),
      },
      manualDirection,
    );
    if (directions.length === 0) {
      return;
    }
    this.stopCallExpansion();
    const cancellation = new vscode.CancellationTokenSource();
    this.callExpansion = cancellation;
    try {
      for (const direction of directions) {
        await this.expandDirection(direction, depth, cancellation.token);
      }
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
          title: vscode.l10n.t("C Insight: Expanding {direction} to depth {depth}", {
            direction: direction === "incoming" ? vscode.l10n.t("Callers") : vscode.l10n.t("Callees"),
            depth,
          }),
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
          vscode.l10n.t("C Insight: Loaded {count} {direction} nodes; cache {hits} hits / {misses} misses.", {
            count: this.callTreeState[direction].loadedNodes,
            direction: direction === "incoming" ? vscode.l10n.t("caller") : vscode.l10n.t("callee"),
            hits: cache.hits,
            misses: cache.misses,
          }),
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
      viewStatusNode(
        message.label,
        reason === "cancelled" ? "cancelled" : "limited",
        {
          description: message.description,
        contextValue: "hierarchyExpansionStatus",
        },
      ),
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
    const view = this.lifecycle.get(
      direction === "incoming"
        ? VIEWS.CALLERS
        : VIEWS.CALLEES,
    );
    const queue = [...provider.getRoots()];
    while (queue.length > 0 && !token.isCancellationRequested) {
      const node = queue.shift()!;
      if (
        node.callPath === undefined ||
        (node.loadChildren === undefined && node.children === undefined) ||
        (node.callDepth ?? 0) >= depth ||
        this.callTreeState[direction].atLimit(this.maximumCallNodes())
      ) {
        continue;
      }
      const children = await provider.getChildren(node);
      if (node.callPath) {
        this.expandedCallPaths[direction].add(node.callPath);
      }
      try {
        await view?.reveal(node, {
          expand: true,
          focus: false,
          select: false,
        });
      } catch {
        // A concurrent root refresh can make VS Code temporarily unable to
        // resolve an otherwise successfully loaded node. Keep the data and
        // exact expansion path; reveal is presentation-only.
      }
      queue.push(...children.filter((child) => child.callPath !== undefined));
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
    const view = this.lifecycle.get(
      direction === "incoming"
        ? VIEWS.CALLERS
        : VIEWS.CALLEES,
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

  private withCallPinBanner(
    roots: TreeNode[],
    direction: "incoming" | "outgoing",
  ): TreeNode[] {
    const banners: TreeNode[] = [];
    if (
      direction === "incoming" &&
      this.analysis.analysisEngine === "microsoft"
    ) {
      const mode = this.callRepository.incomingMode();
      banners.push({
        label: mode === "references"
          ? vscode.l10n.t("Microsoft Callers: References-based")
          : mode === "native"
            ? vscode.l10n.t("Microsoft Callers: Native Provider")
            : vscode.l10n.t("Microsoft Callers: Disabled"),
        description: mode === "references"
          ? vscode.l10n.t("approximate · avoids native Incoming Calls")
          : mode === "native"
            ? vscode.l10n.t("cpptools may be unstable for cross-file symbols")
            : undefined,
        icon: new vscode.ThemeIcon(
          mode === "references" ? "shield" : mode === "native" ? "warning" : "circle-slash",
        ),
        contextValue: "microsoftCallersModeStatus",
      });
    }
    if (this.callViewState.pinned) {
      banners.push({
        label: vscode.l10n.t("Pinned: {symbol}", { symbol: this.callViewState.pinnedSymbol ?? vscode.l10n.t("Call Hierarchy") }),
        description: this.callViewState.pinnedStale ? vscode.l10n.t("stale") : undefined,
        icon: new vscode.ThemeIcon(
          this.callViewState.pinnedStale ? "warning" : "pinned",
        ),
        contextValue: "callHierarchyPinStatus",
      });
    }
    if (this.callResultsStaleReason) {
      banners.push(viewStatusNode(vscode.l10n.t("Results are stale"), "stale", {
        description: this.callResultsStaleReason,
        tooltip: vscode.l10n.t("These results predate: {reason}. Run the query again to refresh them.", { reason: this.callResultsStaleReason }),
        contextValue: "analysisStaleStatus",
      }));
    }
    return [...banners, ...roots];
  }

  private refreshCallPinBanners(): void {
    const callerRoots = this.callDataRoots(this.callers);
    const calleeRoots = this.callDataRoots(this.callees);
    this.callers.setRoots(this.withCallPinBanner(callerRoots, "incoming"));
    this.callees.setRoots(this.withCallPinBanner(calleeRoots, "outgoing"));
  }

  private callDataRoots(provider: MutableTreeProvider): TreeNode[] {
    return provider
      .getRoots()
      .filter(
        (node) =>
          node.contextValue !== "callHierarchyPinStatus" &&
          node.contextValue !== "microsoftCallersModeStatus" &&
          node.contextValue !== "analysisStaleStatus" &&
          node.contextValue !== "hierarchyExpansionStatus",
      );
  }

  private preferredLocation(
    definitions: LocationResult[],
    declarations: LocationResult[],
    root?: CallNode,
  ): PreferredFunctionLocation<LocationResult> | undefined {
    const fallback = root
      ? {
          uri: vscode.Uri.parse(root.raw.uri),
          range: this.analysis.toVsRange(root.raw.selectionRange),
        }
      : undefined;
    return preferredFunctionLocation(definitions, declarations, fallback);
  }

  private updateCallRootPresentation(
    presentation: PreferredFunctionLocation<LocationResult> | undefined,
  ): void {
    if (!presentation) {
      return;
    }
    for (const provider of [this.callers, this.callees]) {
      const root = this.callDataRoots(provider)
        .find((node) => node.callNode && node.callDepth === 0);
      if (root) {
        this.applyCallRootPresentation(root, presentation);
        if (provider === this.callers) {
          this.refreshCallerDeclarationChildren(root);
        }
        provider.refresh(root);
      }
    }
  }

  private updateCallerRootSymbolLocations(
    definitions: LocationResult[],
    declarations: LocationResult[],
  ): void {
    const root = this.callDataRoots(this.callers)
      .find((node) => node.callNode && node.callDepth === 0);
    if (!root) {
      return;
    }
    root.callSymbolLocations = { definitions, declarations };
    this.refreshCallerDeclarationChildren(root);
    this.callers.refresh(root);
  }

  private refreshCallerDeclarationChildren(owner: TreeNode): void {
    if (!owner.children || !owner.callNode || !owner.callSymbolLocations) {
      return;
    }
    const semanticChildren = owner.children.filter(
      (child) => child.callSupplement !== "call-declaration",
    );
    owner.children = [
      ...this.callerDeclarationNodes(
        owner,
        owner.callNode,
        owner.callSymbolLocations,
      ),
      ...semanticChildren,
    ];
  }

  private applyCallRootPresentation(
    node: TreeNode,
    presentation: PreferredFunctionLocation<LocationResult>,
  ): void {
    const { location, kind } = presentation;
    const target = `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}`;
    node.location = location;
    node.previewMode = kind === "definition" ? "definition" : "declaration";
    node.previewTitle = node.label;
    node.description = kind === "definition"
      ? vscode.l10n.t("Definition · {location}", { location: target })
      : vscode.l10n.t("Declaration fallback · {location}", { location: target });
    node.tooltip = kind === "definition"
      ? `${location.uri.fsPath}:${location.range.start.line + 1}`
      : vscode.l10n.t("A function definition is not available yet. Using the provider declaration at {location}.", { location: `${location.uri.fsPath}:${location.range.start.line + 1}` });
  }

  private noCallsNode(
    direction: "incoming" | "outgoing",
    node?: CallNode,
  ): TreeNode {
    const noun = direction === "incoming" ? "callers" : "callees";
    const referencesBasedMicrosoftCallers =
      direction === "incoming" &&
      this.analysis.analysisEngine === "microsoft" &&
      this.callRepository.incomingMode() === "references";
    return viewStatusNode(
        referencesBasedMicrosoftCallers
          ? microsoftEmptyCallersMessage(
              node ? this.callRepository.incomingEvidence(node) : undefined,
            )
          : this.reliability.level === "reliable"
          ? vscode.l10n.t("No {direction} found", { direction: noun === "callers" ? vscode.l10n.t("callers") : vscode.l10n.t("callees") })
          : vscode.l10n.t("No {direction} found yet — results may be incomplete", { direction: noun === "callers" ? vscode.l10n.t("callers") : vscode.l10n.t("callees") }),
      "empty",
    );
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
    presentation?: PreferredFunctionLocation<LocationResult>,
    symbolLocations?: CallSymbolLocations,
  ): TreeNode {
    const providerLocation: LocationResult = {
      uri: vscode.Uri.parse(node.raw.uri),
      range: this.analysis.toVsRange(node.raw.selectionRange),
    };
    const location = presentation?.location ?? providerLocation;
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
    const root: TreeNode = {
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
      callSymbolLocations:
        direction === "incoming" ? symbolLocations : undefined,
      icon: new vscode.ThemeIcon(recursive ? "debug-restart" : "symbol-method"),
      collapsibleState: recursive
        ? vscode.TreeItemCollapsibleState.None
        : atDepthLimit
          ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed,
    };
    if (!recursive && !atDepthLimit) {
      root.loadChildren = () => this.loadCallChildren(
        root,
        node,
        direction,
        [...ancestors, node.key],
        depth + 1,
      );
    }
    if (depth === 0 && presentation) {
      this.applyCallRootPresentation(root, presentation);
    }
    return root;
  }

  private async loadCallChildren(
    owner: TreeNode,
    node: CallNode,
    direction: "incoming" | "outgoing",
    ancestors: string[],
    depth: number,
  ): Promise<TreeNode[]> {
    const atNodeLimit = this.callTreeState[direction].atLimit(
      this.maximumCallNodes(),
    );
    if (direction === "outgoing" && atNodeLimit) {
      return [limitNode(vscode.l10n.t("Call hierarchy node limit reached"))];
    }
    if (direction === "incoming") {
      const [callsResult, symbolLocations] = await Promise.all([
        atNodeLimit
          ? Promise.resolve({ limited: true } as const)
          : this.callRepository.incoming(
              node,
              this.callExpansion?.token,
            ).then(
              (calls) => ({ calls } as const),
              (error: unknown) => ({ error } as const),
            ),
        this.loadCallerSymbolLocations(owner, node),
      ]);
      const declarationNodes = symbolLocations
        ? this.callerDeclarationNodes(owner, node, symbolLocations)
        : [];
      if ("limited" in callsResult) {
        return [
          ...declarationNodes,
          limitNode(vscode.l10n.t("Call hierarchy node limit reached")),
        ];
      }
      if ("error" in callsResult) {
        return [
          ...declarationNodes,
          this.callQueryError("Callers", callsResult.error),
        ];
      }
      const occurrences = projectCallOccurrences(
        callsResult.calls.map((call) => {
          const caller = this.analysis.callNode(call.from);
          return {
            semanticKey: caller.key,
            callSiteUri: call.from.uri,
            ranges: call.fromRanges,
            fallbackUri: caller.raw.uri,
            fallbackRange: caller.raw.selectionRange,
            value: caller,
          };
        }),
      );
      const children = this.materializeCallOccurrences(
        occurrences,
        direction,
        ancestors,
        depth,
        [],
      );
      return [
        ...declarationNodes,
        ...(children.length > 0
          ? children
          : [this.noCallsNode("incoming", node)]),
      ];
    }
    try {
      const calls = await this.callRepository.outgoing(
        node,
        this.callExpansion?.token,
      );
      const occurrences = projectCallOccurrences(
        calls.map((call) => {
          const callee = this.analysis.callNode(call.to);
          return {
            semanticKey: callee.key,
            callSiteUri: node.raw.uri,
            ranges: call.fromRanges,
            fallbackUri: callee.raw.uri,
            fallbackRange: callee.raw.selectionRange,
            value: callee,
          };
        }),
      );
      const unresolved = await this.unresolvedIndirectCallNodes(
        node,
        calls.flatMap((call) => call.fromRanges),
      );
      const children = this.materializeCallOccurrences(
        occurrences,
        direction,
        ancestors,
        depth,
        unresolved,
      );
      return children.length > 0
        ? children
        : [this.noCallsNode("outgoing")];
    } catch (error) {
      return [this.callQueryError("Callees", error)];
    }
  }

  private async loadCallerSymbolLocations(
    owner: TreeNode,
    node: CallNode,
  ): Promise<CallSymbolLocations | undefined> {
    if (owner.callSymbolLocations) {
      return owner.callSymbolLocations;
    }
    try {
      const locations = await this.callRepository.symbolLocations(
        node,
        this.callExpansion?.token,
      );
      owner.callSymbolLocations = locations;
      return locations;
    } catch {
      return undefined;
    }
  }

  private callerDeclarationNodes(
    owner: TreeNode,
    node: CallNode,
    locations: CallSymbolLocations,
  ): TreeNode[] {
    const providerLocation: LocationResult = {
      uri: vscode.Uri.parse(node.raw.uri),
      range: this.analysis.toVsRange(node.raw.selectionRange),
    };
    const declarations = independentDeclarationLocations(
      locations.definitions,
      locations.declarations,
      owner.location,
      providerLocation,
    );
    return declarations.map((location, index) => {
      const target = `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}`;
      const ordinal = index + 1;
      const label = declarations.length === 1
        ? vscode.l10n.t("{name} · Declaration", { name: node.raw.name })
        : vscode.l10n.t("{name} · Declaration {ordinal}/{total}", {
            name: node.raw.name,
            ordinal,
            total: declarations.length,
          });
      return {
        id: [
          "incoming",
          "declaration",
          owner.callPath ?? owner.id ?? node.key,
          location.uri.toString(),
          location.range.start.line,
          location.range.start.character,
        ].join(":"),
        label,
        description: target,
        tooltip: vscode.l10n.t("Declaration of {name} at {location}", {
          name: node.raw.name,
          location: `${location.uri.fsPath}:${location.range.start.line + 1}`,
        }),
        location,
        previewMode: "declaration",
        previewTitle: node.raw.name,
        callSupplement: "call-declaration",
        icon: new vscode.ThemeIcon("go-to-file"),
      };
    });
  }

  private materializeCallOccurrences(
    occurrences: CallOccurrence<CallNode>[],
    direction: "incoming" | "outgoing",
    ancestors: string[],
    depth: number,
    additionalNodes: TreeNode[],
  ): TreeNode[] {
    const candidates: CallChildCandidate[] = [
      ...occurrences.map((occurrence): CallChildCandidate => ({
        kind: "occurrence",
        occurrence,
      })),
      ...additionalNodes.map((node): CallChildCandidate => ({
        kind: "additional",
        node,
      })),
    ].sort(compareCallChildCandidates);
    const remaining = this.callTreeState[direction].remaining(
      this.maximumCallNodes(),
    );
    const visible = candidates.slice(0, remaining);
    const states = new Map<string, CallOccurrenceGroupState>();
    for (const candidate of visible) {
      if (candidate.kind !== "occurrence") {
        continue;
      }
      const { semanticKey } = candidate.occurrence;
      if (states.has(semanticKey)) {
        continue;
      }
      const recursion = recursionKind(semanticKey, ancestors);
      states.set(semanticKey, {
        recursion,
        duplicate: this.callTreeState[direction].observe(
          semanticKey,
          recursion !== undefined,
        ),
      });
    }
    this.callTreeState[direction].consume(visible.length);
    const children = visible.map((candidate) =>
      candidate.kind === "additional"
        ? candidate.node
        : this.callOccurrenceNode(
            candidate.occurrence,
            direction,
            ancestors,
            depth,
            states.get(candidate.occurrence.semanticKey)!,
          ),
    );
    if (visible.length < candidates.length) {
      children.push(limitNode(vscode.l10n.t("Call hierarchy node limit reached")));
    }
    return children;
  }

  private callOccurrenceNode(
    occurrence: CallOccurrence<CallNode>,
    direction: "incoming" | "outgoing",
    ancestors: string[],
    depth: number,
    state: CallOccurrenceGroupState,
  ): TreeNode {
    const uri = vscode.Uri.parse(occurrence.uri);
    const location: LocationResult = {
      uri,
      range: this.analysis.toVsRange(occurrence.range),
    };
    const maximumDepth = vscode.workspace
      .getConfiguration("cInsight.callHierarchy")
      .get<number>("maximumDepth", 10);
    const atDepthLimit = depth >= maximumDepth;
    const recursive = state.recursion !== undefined;
    const expandable = occurrence.canonical && !recursive && !atDepthLimit;
    const status = recursive
      ? state.recursion === "direct"
        ? "direct recursion"
        : "indirect recursion"
      : occurrence.canonical && state.duplicate
        ? "duplicate"
        : undefined;
    const description = occurrence.fallback
      ? [
          vscode.l10n.t("call location unavailable"),
          `${vscode.workspace.asRelativePath(uri)}:${location.range.start.line + 1}`,
          status,
          atDepthLimit ? "max depth" : undefined,
        ]
      : [
          `${vscode.workspace.asRelativePath(uri)}:${location.range.start.line + 1}`,
          vscode.l10n.t("call {ordinal}/{total}", {
            ordinal: occurrence.ordinal,
            total: occurrence.total,
          }),
          status,
          atDepthLimit ? "max depth" : undefined,
        ];
    const node: TreeNode = {
      id: `${direction}:occurrence:${ancestors.join(">")}:${occurrence.id}`,
      label: occurrence.value.raw.name,
      description: description.filter(Boolean).join(" · "),
      tooltip: occurrence.fallback
        ? vscode.l10n.t("The analysis engine returned this relationship without a call-site range. The definition location is shown instead.")
        : `${uri.fsPath}:${location.range.start.line + 1}`,
      location,
      previewMode:
        occurrence.fallback && direction === "outgoing"
          ? "callee-definition"
          : direction === "incoming"
            ? "caller"
            : "callee-call-site",
      previewTitle: occurrence.value.raw.name,
      callKey: occurrence.semanticKey,
      callDepth: depth,
      callNode: occurrence.canonical ? occurrence.value : undefined,
      callPath: expandable
        ? [...ancestors, occurrence.semanticKey].join("\u0000")
        : undefined,
      icon: new vscode.ThemeIcon(recursive ? "debug-restart" : "symbol-method"),
      collapsibleState: expandable
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    };
    if (expandable) {
      node.loadChildren = () => this.loadCallChildren(
        node,
        occurrence.value,
        direction,
        [...ancestors, occurrence.semanticKey],
        depth + 1,
      );
    }
    if (!occurrence.fallback) {
      node.resolveVisible = () => this.enrichCallOccurrenceNode(node);
    }
    return node;
  }

  private callQueryError(noun: "Callers" | "Callees", error: unknown): TreeNode {
    const unsupported = error instanceof UnsupportedClangdFeatureError;
    return viewStatusNode(
      unsupported ? error.message : vscode.l10n.t("{direction} query failed", { direction: noun === "Callers" ? vscode.l10n.t("Callers") : vscode.l10n.t("Callees") }),
      "error",
      {
        description: unsupported ? vscode.l10n.t("clangd 20 or newer is required") : String(error),
        tooltip: unsupported
          ? vscode.l10n.t("Set cInsight.clangd.path to a clangd 20+ executable and restart clangd.")
          : String(error),
      },
    );
  }

  private async unresolvedIndirectCallNodes(
    caller: CallNode,
    resolvedRanges: CallHierarchyOutgoingCall["fromRanges"],
  ): Promise<TreeNode[]> {
    const uri = vscode.Uri.parse(caller.raw.uri);
    const firstLine = caller.raw.range.start.line;
    const finalLine = Math.min(caller.raw.range.end.line, firstLine + 1_999);
    const lines = await Promise.all(
      Array.from(
        { length: Math.max(0, finalLine - firstLine + 1) },
        (_, offset) => this.sourceLines.line(uri, firstLine + offset),
      ),
    );
    return findExplicitIndirectCalls(
      lines.map((line) => line ?? ""),
      firstLine,
    )
      .filter(
        (call) =>
          !resolvedRanges.some(
            (range) =>
              call.line >= range.start.line &&
              call.line <= range.end.line &&
              (call.line !== range.start.line ||
                call.character >= range.start.character) &&
              (call.line !== range.end.line ||
                call.character <= range.end.character),
          ),
      )
      .map((call) => ({
        label: `Unresolved indirect call · Line ${call.line + 1}`,
        description:
          `${call.kind.replaceAll("-", " ")} · syntax evidence`,
        tooltip:
          `${uri.fsPath}:${call.line + 1}\n${call.expression}\n` +
          "Target unresolved: clangd returned no matching outgoing-call target. C Insight does not guess runtime targets.",
        location: {
          uri,
          range: new vscode.Range(
            call.line,
            call.character,
            call.line,
            call.character + Math.max(1, call.expression.length),
          ),
        },
        previewMode: "callee-call-site",
        previewTitle: "Unresolved indirect call",
        icon: new vscode.ThemeIcon("question"),
        contextValue: "unresolvedIndirectCall",
      }));
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
      const location = this.analysis.toVsLocation(info.location);
      return {
        label: info.name,
        description: info.containerName,
        icon: new vscode.ThemeIcon(symbolKindIconId(info.kind)),
        location,
        previewMode: "definition",
        previewTitle: info.name,
        contextValue: "documentSymbolLocation",
      };
    }
    const document = symbol as DocumentSymbol;
    const location = {
      uri,
      range: this.analysis.toVsRange(document.selectionRange),
    };
    return {
      label: document.name,
      description: document.detail,
      icon: new vscode.ThemeIcon(symbolKindIconId(document.kind)),
      location,
      previewMode: "definition",
      previewTitle: document.name,
      contextValue: "documentSymbolLocation",
      children: document.children?.map((child) => this.symbolNode(uri, child)),
    };
  }

  private async enrichCallOccurrenceNode(node: TreeNode): Promise<void> {
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
        node.tooltip = `${node.location.uri.fsPath}:${node.location.range.start.line + 1}\n${line}`;
      }
    } catch {
      // Keep the location-only label when a virtual or missing file cannot load.
    }
  }

}

interface CallOccurrenceSnapshot {
  label: string;
  uri: string;
  line: number;
  character: number;
  depth: number;
  canonical: boolean;
  expandable: boolean;
  previewMode?: PreviewMode;
}

interface CallLocationSnapshot {
  label: string;
  uri: string;
  line: number;
  character: number;
}

interface CallOccurrenceGroupState {
  recursion?: "direct" | "indirect";
  duplicate: boolean;
}

type CallChildCandidate =
  | { kind: "occurrence"; occurrence: CallOccurrence<CallNode> }
  | { kind: "additional"; node: TreeNode };

function compareCallChildCandidates(
  left: CallChildCandidate,
  right: CallChildCandidate,
): number {
  const leftLocation = callChildLocation(left);
  const rightLocation = callChildLocation(right);
  return (
    leftLocation.uri.localeCompare(rightLocation.uri) ||
    leftLocation.line - rightLocation.line ||
    leftLocation.character - rightLocation.character ||
    (left.kind === "occurrence" ? left.occurrence.semanticKey : left.node.id ?? "")
      .localeCompare(
        right.kind === "occurrence"
          ? right.occurrence.semanticKey
          : right.node.id ?? "",
      )
  );
}

function callChildLocation(candidate: CallChildCandidate): {
  uri: string;
  line: number;
  character: number;
} {
  if (candidate.kind === "occurrence") {
    return {
      uri: candidate.occurrence.uri,
      line: candidate.occurrence.range.start.line,
      character: candidate.occurrence.range.start.character,
    };
  }
  return {
    uri: candidate.node.location?.uri.toString() ?? "",
    line: candidate.node.location?.range.start.line ?? 0,
    character: candidate.node.location?.range.start.character ?? 0,
  };
}

function compareTreeNodeLocations(left: TreeNode, right: TreeNode): number {
  return (
    (left.location?.uri.toString() ?? "").localeCompare(
      right.location?.uri.toString() ?? "",
    ) ||
    (left.location?.range.start.line ?? 0) -
      (right.location?.range.start.line ?? 0) ||
    (left.location?.range.start.character ?? 0) -
      (right.location?.range.start.character ?? 0)
  );
}

function callOccurrenceSnapshots(roots: TreeNode[]): CallOccurrenceSnapshot[] {
  return flattenLoadedCallNodes(roots)
    .filter((node) => (node.callDepth ?? 0) > 0 && node.location)
    .map((node) => ({
      label: node.label,
      uri: node.location!.uri.toString(),
      line: node.location!.range.start.line,
      character: node.location!.range.start.character,
      depth: node.callDepth ?? 0,
      canonical: node.callPath !== undefined,
      expandable: node.loadChildren !== undefined || node.children !== undefined,
      previewMode: node.previewMode,
    }));
}

function callerDeclarationSnapshots(roots: TreeNode[]): CallLocationSnapshot[] {
  return flattenLoadedCallNavigationNodes(roots)
    .filter(
      (node) =>
        node.callSupplement === "call-declaration" && node.location,
    )
    .map((node) => ({
      label: node.label,
      uri: node.location!.uri.toString(),
      line: node.location!.range.start.line,
      character: node.location!.range.start.character,
    }));
}

function callRootSnapshots(roots: TreeNode[]): CallLocationSnapshot[] {
  return roots
    .filter(
      (node) => node.callNode && node.callDepth === 0 && node.location,
    )
    .map((node) => ({
      label: node.label,
      uri: node.location!.uri.toString(),
      line: node.location!.range.start.line,
      character: node.location!.range.start.character,
    }));
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
  return viewStatusNode(label, "limited", {
    tooltip:
      "Adjust cInsight.callHierarchy.maximumDepth or maximumNodes if needed.",
  });
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

function flattenLoadedCallNavigationNodes(roots: TreeNode[]): TreeNode[] {
  const output: TreeNode[] = [];
  const visit = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.callKey || node.callSupplement === "call-declaration") {
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
    children: node.children
      ?.filter((child) => child.callSupplement !== "call-declaration")
      .map(callExportNode) ?? [],
  };
}
