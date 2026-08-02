import * as path from "node:path";
import * as vscode from "vscode";
import {
  DocumentSymbol,
  DocumentHighlight,
  SymbolInformation,
  SymbolKind,
} from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import { readConfiguration } from "../configuration/configuration";
import {
  AnalysisReliability,
  analysisReliabilityEqual,
} from "../diagnostics/analysisReliability";
import { LocationResult, LspSymbol } from "../models/types";
import {
  classifyReference,
  enhanceReferenceClassification,
  referenceClassificationExplanation,
  isMacroDefinitionLine,
  isTemplateDeclarationContext,
  ReferenceClassification,
  ReferenceKind,
  referenceClassificationLabel,
  referenceTypeGroup,
} from "./referenceModel";
import { SourceLineCache } from "./sourceLineCache";
import { MutableTreeProvider, TreeNode, viewStatusNode } from "./treeNode";
import type { ReferenceSessionState } from "../session/workspaceSession";
import { encodeExportWithinBudget } from "../utils/exportBudget";
import { runtimeDiagnostics } from "../diagnostics/runtimeDiagnostics";

type GroupMode =
  | "file"
  | "directory"
  | "function"
  | "type"
  | "confidence"
  | "evidence"
  | "flat";
type ReferenceScope = "all" | "workspace" | "directory" | "file";
type EvidenceFilter =
  | "all"
  | `confidence:${ReferenceClassification["confidence"]}`
  | `source:${ReferenceClassification["evidence"][number]["source"]}`;
type ExplorerState = "idle" | "loading" | "ready" | "cancelled" | "error";

interface ReferenceRecord {
  location: LocationResult;
  kind: ReferenceKind;
  classification: ReferenceClassification;
  source?: string;
  functionName?: string;
}

export class ReferenceExplorer implements vscode.Disposable {
  readonly provider = new MutableTreeProvider();

  private locations: LocationResult[] = [];
  private definitions: LocationResult[] = [];
  private declarations: LocationResult[] = [];
  private filtered: ReferenceRecord[] = [];
  private roots: TreeNode[] = [];
  private state: ExplorerState = "idle";
  private errorMessage?: string;
  private query = "";
  private groupMode: GroupMode = "file";
  private scope: ReferenceScope = "all";
  private evidenceFilter: EvidenceFilter = "all";
  private displayedLimit = 200;
  private restoredDisplayedLimit?: number;
  private generation = 0;
  private treeView?: vscode.TreeView<TreeNode>;
  private loadingStarted?: number;
  private lastDurationMs?: number;
  private macroSymbol = false;
  private macroOrigin?: string;
  private templateSymbol = false;
  private templateOrigin?: string;
  private callableSymbol = false;
  private queriedSymbolName?: string;
  private readonly highlightRequests = new Map<
    string,
    Promise<DocumentHighlight[]>
  >();
  private readonly parameterRequests = new Map<string, Promise<string | undefined>>();
  private pinned = false;
  private pinnedSymbol?: string;
  private pinnedStale = false;

  get isPinned(): boolean {
    return this.pinned;
  }
  private resultsStaleReason?: string;
  private displayLimitReportedGeneration = -1;
  private reliability: AnalysisReliability = {
    level: "reliable",
    issues: [],
  };

  constructor(
    private readonly analysis: AnalysisService,
    private readonly sourceLines: SourceLineCache,
  ) {
    this.groupMode = vscode.workspace
      .getConfiguration("cInsight.references")
      .get<GroupMode>("groupBy", "file");
    this.provider.setRoots([
      viewStatusNode(vscode.l10n.t("Place the cursor on a C/C++ symbol"), "idle", {
        description: vscode.l10n.t("open References or run Find All References to query"),
      }),
    ]);
  }

  attachTreeView(treeView: vscode.TreeView<TreeNode>): void {
    this.treeView = treeView;
  }

  update(
    locations: LocationResult[],
    definitions: LocationResult[] = [],
    declarations: LocationResult[] = [],
    callableSymbol = false,
    symbolName?: string,
  ): void {
    this.locations = locations;
    this.definitions = definitions;
    this.declarations = declarations;
    this.callableSymbol = callableSymbol;
    this.queriedSymbolName = symbolName;
    this.resultsStaleReason = undefined;
    if (this.pinned) {
      this.pinnedSymbol = symbolName ?? this.pinnedSymbol;
      this.pinnedStale = false;
    }
    this.highlightRequests.clear();
    this.parameterRequests.clear();
    this.state = "ready";
    this.errorMessage = undefined;
    if (this.loadingStarted !== undefined) {
      this.lastDurationMs = performance.now() - this.loadingStarted;
      this.loadingStarted = undefined;
    }
    this.displayedLimit =
      this.restoredDisplayedLimit ?? this.pageSize();
    this.restoredDisplayedLimit = undefined;
    const generation = ++this.generation;
    void this.detectSymbolOrigins().then((origins) => {
      if (generation === this.generation) {
        this.macroSymbol = origins.macro;
        this.macroOrigin = origins.macroOrigin;
        this.templateSymbol = origins.template;
        this.templateOrigin = origins.templateOrigin;
        void this.rebuild();
      }
    });
  }

  loading(): void {
    this.generation += 1;
    this.state = "loading";
    this.loadingStarted = performance.now();
    this.provider.setRoots(
      this.withPinnedBanner([
        viewStatusNode(vscode.l10n.t("Querying references…"), "loading"),
      ]),
    );
  }

  cancelled(): void {
    this.generation += 1;
    this.state = "cancelled";
    this.loadingStarted = undefined;
    this.provider.setRoots(
      this.withPinnedBanner([
        viewStatusNode(vscode.l10n.t("References query cancelled"), "cancelled", {
          description: vscode.l10n.t("previous results were replaced"),
        }),
      ]),
    );
  }

  failed(error: unknown): void {
    this.generation += 1;
    this.state = "error";
    this.loadingStarted = undefined;
    this.errorMessage = String(error);
    this.provider.setRoots(
      this.withPinnedBanner([
        viewStatusNode(vscode.l10n.t("References query failed"), "error", {
          description: this.errorMessage,
          tooltip: this.errorMessage,
        }),
      ]),
    );
  }

  clear(): void {
    this.generation += 1;
    this.locations = [];
    this.filtered = [];
    this.roots = [];
    this.state = "idle";
    this.provider.setRoots([
      viewStatusNode(vscode.l10n.t("Place the cursor on a C/C++ symbol"), "idle", {
        description: vscode.l10n.t("open References or run Find All References to query"),
      }),
    ]);
  }

  setPinned(pinned: boolean, symbolName?: string): void {
    this.pinned = pinned;
    if (pinned) {
      this.pinnedSymbol = symbolName ?? this.pinnedSymbol;
    } else {
      this.pinnedSymbol = undefined;
      this.pinnedStale = false;
    }
    if (this.state === "ready") {
      void this.publish();
    }
  }

  markPinnedStale(): void {
    if (!this.pinned) {
      return;
    }
    this.pinnedStale = true;
    if (this.state === "ready") {
      void this.publish();
    }
  }

  setReliability(reliability: AnalysisReliability): void {
    if (analysisReliabilityEqual(this.reliability, reliability)) {
      return;
    }
    this.reliability = reliability;
    // Reliability changes only alter the empty-result explanation. Existing
    // reference trees must not be republished, especially while pinned.
    if (this.state === "ready" && this.locations.length === 0) {
      void this.publish();
    }
  }

  markResultsStale(reason: string): void {
    this.resultsStaleReason = reason;
    if (this.state === "ready") {
      void this.publish();
    }
  }

  async promptSearch(): Promise<void> {
    const query = await vscode.window.showInputBox({
      title: vscode.l10n.t("C Insight: Filter References"),
      prompt: vscode.l10n.t("Match source text, file name, or path"),
      value: this.query,
    });
    if (query === undefined) {
      return;
    }
    this.query = query.trim();
    this.displayedLimit = this.pageSize();
    await this.rebuild();
  }

  async clearSearch(): Promise<void> {
    this.query = "";
    this.displayedLimit = this.pageSize();
    await this.rebuild();
  }

  async chooseGrouping(): Promise<void> {
    const options: Array<{
      label: string;
      description: string;
      value: GroupMode;
    }> = [
      { label: vscode.l10n.t("File"), description: vscode.l10n.t("Group references by file"), value: "file" },
      {
        label: vscode.l10n.t("Directory"),
        description: vscode.l10n.t("Group references by directory and file"),
        value: "directory",
      },
      {
        label: vscode.l10n.t("Function"),
        description: vscode.l10n.t("Group references by enclosing function"),
        value: "function",
      },
      {
        label: vscode.l10n.t("Reference Type"),
        description: vscode.l10n.t("Group by definition, call, access, or other reference"),
        value: "type",
      },
      {
        label: vscode.l10n.t("Confidence"),
        description: vscode.l10n.t("Group by semantic, syntax, inferred, or unknown confidence"),
        value: "confidence",
      },
      {
        label: vscode.l10n.t("Evidence Source"),
        description: vscode.l10n.t("Group by the primary classification evidence source"),
        value: "evidence",
      },
      { label: vscode.l10n.t("Flat"), description: vscode.l10n.t("Show one flat result list"), value: "flat" },
    ];
    const picked = await vscode.window.showQuickPick(options, {
      title: vscode.l10n.t("C Insight: Reference Grouping"),
      placeHolder: vscode.l10n.t("Current: {value}", { value: this.groupMode }),
    });
    if (!picked) {
      return;
    }
    this.groupMode = picked.value;
    await vscode.workspace
      .getConfiguration("cInsight.references")
      .update("groupBy", picked.value, vscode.ConfigurationTarget.Workspace);
    this.displayedLimit = this.pageSize();
    await this.rebuild();
  }

  async chooseEvidenceFilter(): Promise<void> {
    const values: EvidenceFilter[] = [
      "all",
      "confidence:semantic",
      "confidence:syntax",
      "confidence:inferred",
      "confidence:unknown",
      "source:clangd-result",
      "source:clangd-highlight",
      "source:clangd-signature",
      "source:source-syntax",
      "source:symbol-metadata",
      "source:fallback",
    ];
    const picked = await vscode.window.showQuickPick(
      values.map((value) => ({
        label:
          value === "all"
            ? vscode.l10n.t("All classifications")
            : value.replace(":", ": "),
        description:
          value === this.evidenceFilter ? vscode.l10n.t("Current filter") : undefined,
        value,
      })),
      {
        title: vscode.l10n.t("C Insight: Reference Evidence Filter"),
        placeHolder: vscode.l10n.t("Current: {value}", { value: this.evidenceFilter }),
      },
    );
    if (!picked) {
      return;
    }
    this.evidenceFilter = picked.value;
    this.displayedLimit = this.pageSize();
    await this.rebuild();
  }

  async chooseScope(): Promise<void> {
    const options: Array<{
      label: string;
      description: string;
      value: ReferenceScope;
    }> = [
      { label: vscode.l10n.t("All"), description: vscode.l10n.t("All non-excluded results"), value: "all" },
      {
        label: vscode.l10n.t("Workspace"),
        description: vscode.l10n.t("Only files inside the current workspace"),
        value: "workspace",
      },
      {
        label: vscode.l10n.t("Current Directory"),
        description: vscode.l10n.t("Only files beside the active source file"),
        value: "directory",
      },
      {
        label: vscode.l10n.t("Current File"),
        description: vscode.l10n.t("Only the active source file"),
        value: "file",
      },
    ];
    const picked = await vscode.window.showQuickPick(options, {
      title: vscode.l10n.t("C Insight: Reference Scope"),
      placeHolder: vscode.l10n.t("Current: {value}", { value: this.scope }),
    });
    if (!picked) {
      return;
    }
    this.scope = picked.value;
    this.displayedLimit = this.pageSize();
    await this.rebuild();
  }

  async loadMore(): Promise<void> {
    this.displayedLimit = Math.min(
      this.maximumDisplayedResults(),
      this.displayedLimit + this.pageSize(),
    );
    await this.publish();
  }

  async showAll(): Promise<void> {
    this.displayedLimit = this.maximumDisplayedResults();
    await this.publish();
  }

  sessionState(): ReferenceSessionState {
    return {
      query: this.query,
      scope: this.scope,
      displayedLimit: this.displayedLimit,
    };
  }

  async restoreSession(
    state: ReferenceSessionState | undefined,
  ): Promise<void> {
    if (!state) {
      return;
    }
    this.query = state.query;
    this.scope = state.scope;
    this.restoredDisplayedLimit = Math.max(
      this.pageSize(),
      Math.min(this.maximumDisplayedResults(), state.displayedLimit),
    );
    if (this.state === "ready") {
      this.displayedLimit = this.restoredDisplayedLimit;
      this.restoredDisplayedLimit = undefined;
      await this.rebuild();
    }
  }

  async copyReference(value: unknown): Promise<void> {
    const node = value as TreeNode | undefined;
    if (!node?.location) {
      return;
    }
    const record = this.filtered.find((candidate) =>
      sameLocation(candidate.location, node.location!),
    );
    if (record) {
      await vscode.env.clipboard.writeText(await this.renderRecord(record));
    }
  }

  async copyAll(): Promise<void> {
    const records = this.filtered.slice(0, this.maximumExportResults());
    const omitted = this.filtered.length - records.length;
    const text = await this.renderText(records, omitted);
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage(
      omitted > 0
        ? vscode.l10n.t("C Insight: Copied {count} references; omitted {omitted} due to cInsight.export.maximumResults.", { count: records.length, omitted })
        : vscode.l10n.t("C Insight: Copied {count} references.", { count: records.length }),
    );
  }

  async exportResults(format: "text" | "json"): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      title: vscode.l10n.t("Export C Insight References as {format}", { format: format.toUpperCase() }),
      filters:
        format === "json"
          ? { JSON: ["json"] }
          : { Text: ["txt"] },
      saveLabel: vscode.l10n.t("Export"),
    });
    if (!uri) {
      return;
    }
    const maximumResults = this.maximumExportResults();
    const records = this.filtered.slice(0, maximumResults);
    const omitted = this.filtered.length - records.length;
    if (omitted > 0) {
      runtimeDiagnostics.increment("limits.references.bulkOutput");
      runtimeDiagnostics.increment("limits.references.omittedRecords", omitted);
    }
    try {
      const content = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t("C Insight: Preparing {format} reference export", { format: format.toUpperCase() }),
          cancellable: true,
        },
        async (progress, token) =>
          format === "json"
            ? JSON.stringify(
                await this.jsonRecords(records, omitted, token, (completed) =>
                  progress.report({
                    message: `${completed} / ${records.length}`,
                  }),
                ),
                null,
                2,
              )
            : this.renderText(records, omitted, token, (completed) =>
                progress.report({
                  message: `${completed} / ${records.length}`,
                }),
              ),
      );
      const maximumMegabytes = vscode.workspace
        .getConfiguration("cInsight.export")
        .get<number>("maximumMegabytes", 64);
      const encoded = encodeExportWithinBudget(content, maximumMegabytes);
      if (!encoded.data) {
        runtimeDiagnostics.increment("limits.export.maximumMegabytes");
        void vscode.window.showErrorMessage(
          vscode.l10n.t("C Insight: Export is {size}, exceeding the {limit} limit. Increase cInsight.export.maximumMegabytes or narrow the results.", { size: formatBytes(encoded.bytes), limit: formatBytes(encoded.maximumBytes) }),
        );
        return;
      }
      await vscode.workspace.fs.writeFile(uri, encoded.data);
      if (omitted > 0) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t("C Insight: Exported the first {count} references and omitted {omitted} due to cInsight.export.maximumResults.", { count: records.length, omitted }),
        );
      }
    } catch (error) {
      if (!(error instanceof vscode.CancellationError)) {
        throw error;
      }
    }
  }

  async openResultList(): Promise<void> {
    const records = this.filtered.slice(0, this.maximumExportResults());
    const omitted = this.filtered.length - records.length;
    const content = await this.renderText(records, omitted);
    const document = await vscode.workspace.openTextDocument({
      language: "text",
      content,
    });
    await vscode.window.showTextDocument(document, { preview: true });
    if (omitted > 0) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t("C Insight: Opened the first {count} references and omitted {omitted} due to cInsight.export.maximumResults.", { count: records.length, omitted }),
      );
    }
  }

  async expandAll(): Promise<void> {
    if (!this.treeView) {
      return;
    }
    for (const root of this.roots) {
      if (root.children) {
        await this.treeView.reveal(root, {
          expand: true,
          focus: false,
          select: false,
        });
      }
    }
  }

  async collapseAll(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.actions.treeView.cInsight.references.collapseAll",
    );
  }

  dispose(): void {
    this.generation += 1;
  }

  private async rebuild(): Promise<void> {
    const generation = ++this.generation;
    if (this.state !== "ready") {
      return;
    }
    let records: ReferenceRecord[] = this.locations
      .filter((location) => this.inScope(location))
      .map((location) => {
        const kind = classifyReference(
          location,
          this.definitions,
          this.declarations,
        );
        return {
          location,
          kind,
          classification: enhanceReferenceClassification(location, kind, {
            macroSymbol: this.macroSymbol,
            macroOrigin: this.macroOrigin,
            templateSymbol: this.templateSymbol,
            templateOrigin: this.templateOrigin,
          }),
        } satisfies ReferenceRecord;
      });

    if (this.query) {
      records = await mapLimit(records, 8, async (record) => {
        await this.enhanceRecord(record);
        return record;
      });
      const query = this.query.toLocaleLowerCase();
      records = records.filter((record) => {
        const pathText = vscode.workspace.asRelativePath(record.location.uri);
        return (
          pathText.toLocaleLowerCase().includes(query) ||
          (record.source ?? "").toLocaleLowerCase().includes(query) ||
          referenceClassificationLabel(record.classification)
            .toLocaleLowerCase()
            .includes(query)
        );
      });
    }
    if (this.groupMode === "function") {
      const symbolRequests = new Map<string, Promise<LspSymbol[]>>();
      records = await mapLimit(records, 4, async (record) => {
        record.functionName = await this.enclosingFunction(
          record.location,
          symbolRequests,
        );
        return record;
      });
    }
    if (this.groupMode === "type") {
      records = await mapLimit(records, 8, async (record) => {
        await this.enhanceRecord(record);
        return record;
      });
    }
    if (
      this.evidenceFilter !== "all" ||
      this.groupMode === "confidence" ||
      this.groupMode === "evidence"
    ) {
      records = await mapLimit(records, 8, async (record) => {
        await this.enhanceRecord(record);
        return record;
      });
    }
    records = records.filter((record) =>
      matchesEvidenceFilter(record.classification, this.evidenceFilter),
    );
    if (generation !== this.generation) {
      return;
    }
    this.filtered = records.sort(compareRecords);
    await this.publish();
  }

  private async publish(): Promise<void> {
    if (this.state !== "ready") {
      return;
    }
    if (this.filtered.length === 0) {
      const reason =
        this.locations.length === 0
          ? this.reliability.level === "reliable"
            ? vscode.l10n.t("No references found")
            : vscode.l10n.t("No references found yet — results may be incomplete")
          : vscode.l10n.t("No references match the current filters");
      this.roots = [viewStatusNode(reason, "empty")];
      this.provider.setRoots(this.withPinnedBanner(this.roots));
      return;
    }
    const maximumDisplayed = this.maximumDisplayedResults();
    const displayed = this.filtered.slice(
      0,
      Math.min(this.displayedLimit, maximumDisplayed),
    );
    this.roots = this.group(displayed);
    if (
      displayed.length < this.filtered.length &&
      displayed.length < maximumDisplayed
    ) {
      this.roots.push({
        label: vscode.l10n.t("Load more ({displayed} / {total})", { displayed: displayed.length, total: this.filtered.length }),
        description: vscode.l10n.t("{count} remaining", { count: this.filtered.length - displayed.length }),
        icon: new vscode.ThemeIcon("more"),
        command: {
          command: "cInsight.references.loadMore",
          title: vscode.l10n.t("Load More References"),
        },
      });
    } else if (displayed.length === this.filtered.length) {
      this.roots.unshift({
        label: vscode.l10n.t("{count} references", { count: this.filtered.length }),
        description: this.summary(),
        icon: new vscode.ThemeIcon("references"),
      });
    } else {
      if (this.displayLimitReportedGeneration !== this.generation) {
        this.displayLimitReportedGeneration = this.generation;
        runtimeDiagnostics.increment("limits.references.display");
      }
      this.roots.push(viewStatusNode(
        vscode.l10n.t("Display limit reached ({displayed} / {total})", { displayed: displayed.length, total: this.filtered.length }),
        "limited",
        {
        description: vscode.l10n.t("narrow filters or raise maximumDisplayedResults"),
        },
      ));
    }
    this.provider.setRoots(this.withPinnedBanner(this.roots));
  }

  private group(records: ReferenceRecord[]): TreeNode[] {
    if (this.groupMode === "flat") {
      return records.map((record) => this.referenceNode(record, true));
    }
    const groups = new Map<string, ReferenceRecord[]>();
    for (const record of records) {
      const relative = vscode.workspace.asRelativePath(record.location.uri);
        const key =
        this.groupMode === "directory"
          ? path.dirname(relative)
          : this.groupMode === "function"
            ? record.functionName ?? "Global scope"
            : this.groupMode === "type"
              ? referenceTypeGroup(record.classification)
            : this.groupMode === "confidence"
              ? confidenceGroup(record.classification)
            : this.groupMode === "evidence"
              ? evidenceGroup(record.classification)
            : relative;
      const values = groups.get(key) ?? [];
      values.push(record);
      groups.set(key, values);
    }
    return [...groups.entries()]
      .sort(([left], [right]) =>
        this.groupMode === "type"
          ? referenceTypeOrder(left) - referenceTypeOrder(right)
          : left.localeCompare(right),
      )
      .map(([label, values]) => ({
        label,
        description: `${values.length}`,
        icon: new vscode.ThemeIcon(
          this.groupMode === "directory"
            ? "folder"
            : this.groupMode === "function"
              ? "symbol-function"
              : this.groupMode === "type"
                ? "symbol-enum"
              : this.groupMode === "confidence"
                ? "verified"
              : this.groupMode === "evidence"
                ? "inspect"
              : "file",
        ),
        children: values.map((record) => this.referenceNode(record, false)),
      }));
  }

  private referenceNode(record: ReferenceRecord, includePath: boolean): TreeNode {
    const lineNumber = record.location.range.start.line + 1;
    const node: TreeNode = {
      label: includePath
        ? `${vscode.workspace.asRelativePath(record.location.uri)}:${lineNumber}`
        : `Line ${lineNumber}`,
      description: referenceClassificationLabel(record.classification),
      tooltip: record.location.uri.fsPath,
      location: record.location,
      previewMode:
        record.kind === "definition" ? "definition" : "reference",
      previewTitle: referenceClassificationLabel(record.classification),
      icon: referenceIcon(record.classification),
      contextValue: "referenceLocation",
    };
    node.resolveVisible = async () => {
      await this.enhanceRecord(record);
      const source = record.source;
      if (source?.trim()) {
        node.label = `${lineNumber}  ${source.trim()}`;
        node.description = referenceClassificationLabel(record.classification);
        node.previewTitle = node.description;
        node.icon = referenceIcon(record.classification);
        node.tooltip =
          `${record.location.uri.fsPath}:${lineNumber}\n${source.trim()}\n` +
          `Classification: ${node.description}\n` +
          referenceClassificationExplanation(record.classification);
      }
    };
    return node;
  }

  private inScope(location: LocationResult): boolean {
    const config = readConfiguration();
    const normalized = location.uri.fsPath.replaceAll("\\", "/");
    if (config.exclude.some((fragment) => normalized.includes(fragment))) {
      return false;
    }
    if (
      !config.includeSystemReferences &&
      (normalized.startsWith("/usr/include/") ||
        normalized.startsWith("/usr/local/include/"))
    ) {
      return false;
    }
    const editorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
    switch (this.scope) {
      case "all":
        return true;
      case "workspace":
        return vscode.workspace.getWorkspaceFolder(location.uri) !== undefined;
      case "directory":
        return Boolean(editorPath) && path.dirname(location.uri.fsPath) === path.dirname(editorPath!);
      case "file":
        return Boolean(editorPath) && location.uri.fsPath === editorPath;
    }
  }

  private async enclosingFunction(
    location: LocationResult,
    symbolRequests: Map<string, Promise<LspSymbol[]>>,
  ): Promise<string> {
    try {
      const key = location.uri.toString();
      let request = symbolRequests.get(key);
      if (!request) {
        request = this.analysis.documentSymbols(location.uri);
        symbolRequests.set(key, request);
      }
      const symbols = await request;
      return findEnclosingFunction(symbols, location.range.start) ?? "Global scope";
    } catch {
      return "Unknown scope";
    }
  }

  private async renderRecord(record: ReferenceRecord): Promise<string> {
    await this.enhanceRecord(record);
    const evidence = record.classification.evidence
      .map(
        (item) =>
          `${item.source}:${item.rule}` +
          (item.origin ? `@${item.origin}` : ""),
      )
      .join(", ");
    return `${record.location.uri.fsPath}:${record.location.range.start.line + 1}:${record.location.range.start.character + 1} [${referenceClassificationLabel(record.classification)}; confidence=${record.classification.confidence}; evidence=${evidence}] ${record.source?.trim() ?? ""}`;
  }

  private async renderText(
    records: ReferenceRecord[],
    omitted = 0,
    token?: vscode.CancellationToken,
    report?: (completed: number) => void,
  ): Promise<string> {
    const lines = await mapLimit(
      records,
      8,
      (record) => this.renderRecord(record),
      token,
      report,
    );
    return [
      `# C Insight References · ${records.length} results · omitted=${omitted} · group=${this.groupMode} · scope=${this.scope} · evidenceFilter=${this.evidenceFilter}`,
      ...lines,
    ].join("\n");
  }

  private async jsonRecords(
    records: ReferenceRecord[],
    omitted = 0,
    token?: vscode.CancellationToken,
    report?: (completed: number) => void,
  ): Promise<unknown> {
    await mapLimit(
      records,
      8,
      async (record) => {
        await this.enhanceRecord(record);
      },
      token,
      report,
    );
    return {
      schema: "c-insight.references",
      version: 1,
      generatedAt: new Date().toISOString(),
      filters: {
        query: this.query,
        scope: this.scope,
        evidence: this.evidenceFilter,
        grouping: this.groupMode,
      },
      count: records.length,
      omitted,
      references: records.map((record) => ({
        uri: record.location.uri.toString(),
        path: record.location.uri.fsPath,
        line: record.location.range.start.line + 1,
        character: record.location.range.start.character + 1,
        kind: record.kind,
        classification: record.classification,
        source: record.source?.trim() ?? "",
      })),
    };
  }

  private summary(): string {
    const filters = [
      this.lastDurationMs === undefined
        ? undefined
        : `${Math.round(this.lastDurationMs)} ms`,
      this.groupMode,
      this.scope !== "all" ? this.scope : undefined,
      this.query ? `“${this.query}”` : undefined,
      this.evidenceFilter !== "all" ? this.evidenceFilter : undefined,
    ].filter(Boolean);
    return filters.join(" · ");
  }

  private pageSize(): number {
    return vscode.workspace
      .getConfiguration("cInsight.references")
      .get<number>("pageSize", 200);
  }

  private maximumDisplayedResults(): number {
    return vscode.workspace
      .getConfiguration("cInsight.references")
      .get<number>("maximumDisplayedResults", 10_000);
  }

  private detailRequestCacheSize(): number {
    return vscode.workspace
      .getConfiguration("cInsight.references")
      .get<number>("detailRequestCacheSize", 2_000);
  }

  private maximumExportResults(): number {
    return vscode.workspace
      .getConfiguration("cInsight.export")
      .get<number>("maximumResults", 50_000);
  }

  private withPinnedBanner(roots: TreeNode[]): TreeNode[] {
    const banners: TreeNode[] = [];
    if (this.pinned) {
      banners.push({
        label: vscode.l10n.t("Pinned: {symbol}", { symbol: this.pinnedSymbol ?? vscode.l10n.t("References") }),
        description: this.pinnedStale ? vscode.l10n.t("stale") : undefined,
        icon: new vscode.ThemeIcon(
          this.pinnedStale ? "warning" : "pinned",
        ),
        contextValue: "referencesPinStatus",
      });
    }
    if (this.resultsStaleReason) {
      banners.push(staleNode(this.resultsStaleReason));
    }
    return [...banners, ...roots];
  }

  private async enhanceRecord(record: ReferenceRecord): Promise<void> {
    record.source =
      record.source ??
      (await this.sourceLines.line(
        record.location.uri,
        record.location.range.start.line,
      ));
    record.kind = classifyReference(
      record.location,
      this.definitions,
      this.declarations,
      record.source,
    );
    let highlightKind: number | undefined;
    let parameterLabel: string | undefined;
    if (record.kind === "reference") {
      const [highlights, activeParameter] = await Promise.all([
        this.highlightsFor(record.location),
        this.parameterFor(record.location),
      ]);
      highlightKind = highlights.find((highlight) =>
        rangeContains(
          this.analysis.toVsRange(highlight.range),
          record.location.range.start,
        ),
      )?.kind;
      parameterLabel = activeParameter;
    }
    record.classification = enhanceReferenceClassification(
      record.location,
      record.kind,
      {
        sourceLine: record.source,
        highlightKind,
        macroSymbol: this.macroSymbol,
        macroOrigin: this.macroOrigin,
        templateSymbol: this.templateSymbol,
        templateOrigin: this.templateOrigin,
        callableSymbol: this.callableSymbol,
        parameterLabel,
        queriedSymbolName: this.queriedSymbolName,
      },
    );
  }

  private async highlightsFor(
    location: LocationResult,
  ): Promise<DocumentHighlight[]> {
    const key = location.uri.toString();
    let request = this.highlightRequests.get(key);
    if (!request) {
      request = this.analysis
        .documentHighlights(location.uri, location.range.start)
        .catch(() => []);
      this.highlightRequests.set(key, request);
      runtimeDiagnostics.increment(
        "cache.references.highlightEvictions",
        trimMap(this.highlightRequests, this.detailRequestCacheSize()),
      );
      runtimeDiagnostics.setGauge(
        "cache.references.highlights",
        this.highlightRequests.size,
      );
    } else {
      this.highlightRequests.delete(key);
      this.highlightRequests.set(key, request);
    }
    return request;
  }

  private async parameterFor(
    location: LocationResult,
  ): Promise<string | undefined> {
    const key =
      `${location.uri.toString()}:${location.range.start.line}:` +
      `${location.range.start.character}`;
    let request = this.parameterRequests.get(key);
    if (!request) {
      request = this.analysis
        .activeParameterLabel(location.uri, location.range.start)
        .catch(() => undefined);
      this.parameterRequests.set(key, request);
      runtimeDiagnostics.increment(
        "cache.references.parameterEvictions",
        trimMap(this.parameterRequests, this.detailRequestCacheSize()),
      );
      runtimeDiagnostics.setGauge(
        "cache.references.parameters",
        this.parameterRequests.size,
      );
    } else {
      this.parameterRequests.delete(key);
      this.parameterRequests.set(key, request);
    }
    return request;
  }

  private async detectSymbolOrigins(): Promise<{
    macro: boolean;
    macroOrigin?: string;
    template: boolean;
    templateOrigin?: string;
  }> {
    const candidates = [...this.definitions, ...this.declarations].slice(0, 8);
    const inspected = await mapLimit(candidates, 4, async (location) => {
      const lines = await Promise.all(
        [3, 2, 1, 0].map((offset) =>
          this.sourceLines.line(
            location.uri,
            location.range.start.line - offset,
          ),
        ),
      );
      const origin =
        `${location.uri.toString()}:${location.range.start.line + 1}:` +
        `${location.range.start.character + 1}`;
      return {
        macro: Boolean(lines.at(-1) && isMacroDefinitionLine(lines.at(-1)!)),
        template: isTemplateDeclarationContext(
          lines.filter((line): line is string => line !== undefined),
        ),
        origin,
      };
    });
    const macro = inspected.find((item) => item.macro);
    const template = inspected.find((item) => item.template);
    return {
      macro: Boolean(macro),
      macroOrigin: macro?.origin,
      template: Boolean(template),
      templateOrigin: template?.origin,
    };
  }
}

function staleNode(reason: string): TreeNode {
  return viewStatusNode(vscode.l10n.t("Results are stale"), "stale", {
    description: reason,
    tooltip: vscode.l10n.t("These results predate: {reason}. Run the query again to refresh them.", { reason }),
    contextValue: "analysisStaleStatus",
  });
}

function referenceIcon(
  classification: ReferenceClassification,
): vscode.ThemeIcon {
  if (classification.macro) {
    return new vscode.ThemeIcon("symbol-constant");
  }
  if (classification.template) {
    return new vscode.ThemeIcon("symbol-type-parameter");
  }
  if (classification.effect) {
    return new vscode.ThemeIcon("warning");
  }
  switch (classification.access) {
    case "read":
      return new vscode.ThemeIcon("eye");
    case "write":
      return new vscode.ThemeIcon("edit");
    case "readwrite":
      return new vscode.ThemeIcon("replace-all");
    case "address":
      return new vscode.ThemeIcon("symbol-pointer");
  }
  switch (classification.role) {
    case "definition":
      return new vscode.ThemeIcon("symbol-method");
    case "declaration":
      return new vscode.ThemeIcon("symbol-interface");
    case "call":
      return new vscode.ThemeIcon("call-outgoing");
    case "reference":
      return new vscode.ThemeIcon("references");
  }
}

function rangeContains(
  range: vscode.Range,
  position: vscode.Position,
): boolean {
  return range.contains(position);
}

function referenceTypeOrder(label: string): number {
  const order = [
    "Definitions",
    "Declarations",
    "Function Calls",
    "Reads",
    "Writes",
    "Read/Writes",
    "Addresses",
    "Other References",
  ];
  const index = order.indexOf(label);
  return index < 0 ? order.length : index;
}

export function matchesEvidenceFilter(
  classification: ReferenceClassification,
  filter: EvidenceFilter,
): boolean {
  if (filter === "all") {
    return true;
  }
  const [kind, value] = filter.split(":", 2);
  return kind === "confidence"
    ? classification.confidence === value
    : classification.evidence.some((item) => item.source === value);
}

function confidenceGroup(classification: ReferenceClassification): string {
  return `Confidence: ${classification.confidence}`;
}

function evidenceGroup(classification: ReferenceClassification): string {
  const primary = classification.evidence.at(-1);
  return primary
    ? `Evidence: ${primary.source}`
    : "Evidence: unavailable";
}

function sameLocation(left: LocationResult, right: LocationResult): boolean {
  return (
    left.uri.toString() === right.uri.toString() &&
    left.range.isEqual(right.range)
  );
}

function compareRecords(left: ReferenceRecord, right: ReferenceRecord): number {
  return (
    left.location.uri.fsPath.localeCompare(right.location.uri.fsPath) ||
    left.location.range.start.line - right.location.range.start.line ||
    left.location.range.start.character - right.location.range.start.character
  );
}

function findEnclosingFunction(
  symbols: LspSymbol[],
  position: vscode.Position,
): string | undefined {
  let best: { name: string; span: number } | undefined;
  const visit = (items: LspSymbol[], prefix = ""): void => {
    for (const symbol of items) {
      if ("location" in symbol) {
        const info = symbol as SymbolInformation;
        if (
          isFunctionKind(info.kind) &&
          info.location.range.start.line <= position.line &&
          info.location.range.end.line >= position.line
        ) {
          const span =
            info.location.range.end.line - info.location.range.start.line;
          if (!best || span < best.span) {
            best = {
              name: info.containerName
                ? `${info.containerName}::${info.name}`
                : info.name,
              span,
            };
          }
        }
        continue;
      }
      const document = symbol as DocumentSymbol;
      const name = prefix ? `${prefix}::${document.name}` : document.name;
      if (
        document.range.start.line <= position.line &&
        document.range.end.line >= position.line
      ) {
        if (isFunctionKind(document.kind)) {
          const span = document.range.end.line - document.range.start.line;
          if (!best || span < best.span) {
            best = { name, span };
          }
        }
        if (document.children) {
          visit(document.children, name);
        }
      }
    }
  };
  visit(symbols);
  return best?.name;
}

function isFunctionKind(kind: SymbolKind): boolean {
  const functionKinds: SymbolKind[] = [
    SymbolKind.Function,
    SymbolKind.Method,
    SymbolKind.Constructor,
  ];
  return functionKinds.includes(kind);
}

async function mapLimit<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
  token?: vscode.CancellationToken,
  report?: (completed: number) => void,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  let completed = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length) {
        if (token?.isCancellationRequested) {
          throw new vscode.CancellationError();
        }
        const index = next;
        next += 1;
        results[index] = await mapper(values[index]);
        completed += 1;
        if (completed === values.length || completed % 100 === 0) {
          report?.(completed);
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function formatBytes(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MiB`;
}

function trimMap<K, V>(values: Map<K, V>, maximumEntries: number): number {
  let evicted = 0;
  while (values.size > maximumEntries) {
    const oldest = values.keys().next().value as K | undefined;
    if (oldest === undefined) {
      return evicted;
    }
    values.delete(oldest);
    evicted += 1;
  }
  return evicted;
}
