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
import { AnalysisReliability } from "../diagnostics/analysisReliability";
import { LocationResult, LspSymbol } from "../models/types";
import {
  classifyReference,
  enhanceReferenceClassification,
  isMacroDefinitionLine,
  ReferenceClassification,
  ReferenceKind,
  referenceClassificationLabel,
  referenceTypeGroup,
} from "./referenceModel";
import { SourceLineCache } from "./sourceLineCache";
import { MutableTreeProvider, TreeNode } from "./treeNode";

type GroupMode = "file" | "directory" | "function" | "type" | "flat";
type ReferenceScope = "all" | "workspace" | "directory" | "file";
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
  private displayedLimit = 200;
  private generation = 0;
  private treeView?: vscode.TreeView<TreeNode>;
  private loadingStarted?: number;
  private lastDurationMs?: number;
  private macroSymbol = false;
  private callableSymbol = false;
  private readonly highlightRequests = new Map<
    string,
    Promise<DocumentHighlight[]>
  >();
  private pinned = false;
  private pinnedSymbol?: string;
  private pinnedStale = false;
  private resultsStaleReason?: string;
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
    this.resultsStaleReason = undefined;
    if (this.pinned) {
      this.pinnedSymbol = symbolName ?? this.pinnedSymbol;
      this.pinnedStale = false;
    }
    this.highlightRequests.clear();
    this.state = "ready";
    this.errorMessage = undefined;
    if (this.loadingStarted !== undefined) {
      this.lastDurationMs = performance.now() - this.loadingStarted;
      this.loadingStarted = undefined;
    }
    this.displayedLimit = this.pageSize();
    const generation = ++this.generation;
    void this.detectMacroSymbol().then((macroSymbol) => {
      if (generation === this.generation) {
        this.macroSymbol = macroSymbol;
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
        statusNode("Querying references…", "loading~spin"),
      ]),
    );
  }

  cancelled(): void {
    this.generation += 1;
    this.state = "cancelled";
    this.loadingStarted = undefined;
    this.provider.setRoots(
      this.withPinnedBanner([
        statusNode("References query cancelled", "circle-slash"),
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
        statusNode(`References query failed: ${this.errorMessage}`, "error"),
      ]),
    );
  }

  clear(): void {
    this.generation += 1;
    this.locations = [];
    this.filtered = [];
    this.roots = [];
    this.state = "idle";
    this.provider.clear();
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
    this.reliability = reliability;
    if (this.state === "ready") {
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
      title: "C Insight: Filter References",
      prompt: "Match source text, file name, or path",
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
      { label: "File", description: "Group references by file", value: "file" },
      {
        label: "Directory",
        description: "Group references by directory and file",
        value: "directory",
      },
      {
        label: "Function",
        description: "Group references by enclosing function",
        value: "function",
      },
      {
        label: "Reference Type",
        description: "Group by definition, call, access, or other reference",
        value: "type",
      },
      { label: "Flat", description: "Show one flat result list", value: "flat" },
    ];
    const picked = await vscode.window.showQuickPick(options, {
      title: "C Insight: Reference Grouping",
      placeHolder: `Current: ${this.groupMode}`,
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

  async chooseScope(): Promise<void> {
    const options: Array<{
      label: string;
      description: string;
      value: ReferenceScope;
    }> = [
      { label: "All", description: "All non-excluded results", value: "all" },
      {
        label: "Workspace",
        description: "Only files inside the current workspace",
        value: "workspace",
      },
      {
        label: "Current Directory",
        description: "Only files beside the active source file",
        value: "directory",
      },
      {
        label: "Current File",
        description: "Only the active source file",
        value: "file",
      },
    ];
    const picked = await vscode.window.showQuickPick(options, {
      title: "C Insight: Reference Scope",
      placeHolder: `Current: ${this.scope}`,
    });
    if (!picked) {
      return;
    }
    this.scope = picked.value;
    this.displayedLimit = this.pageSize();
    await this.rebuild();
  }

  async loadMore(): Promise<void> {
    this.displayedLimit += this.pageSize();
    await this.publish();
  }

  async showAll(): Promise<void> {
    this.displayedLimit = Number.MAX_SAFE_INTEGER;
    await this.publish();
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
    const text = await this.renderText(this.filtered);
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage(
      `C Insight: Copied ${this.filtered.length} references.`,
    );
  }

  async exportResults(format: "text" | "json"): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      title: `Export C Insight References as ${format.toUpperCase()}`,
      filters:
        format === "json"
          ? { JSON: ["json"] }
          : { Text: ["txt"] },
      saveLabel: "Export",
    });
    if (!uri) {
      return;
    }
    const content =
      format === "json"
        ? JSON.stringify(await this.jsonRecords(this.filtered), null, 2)
        : await this.renderText(this.filtered);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  }

  async openResultList(): Promise<void> {
    const content = await this.renderText(this.filtered);
    const document = await vscode.workspace.openTextDocument({
      language: "text",
      content,
    });
    await vscode.window.showTextDocument(document, { preview: true });
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
            ? "No references found"
            : "No references found yet — results may be incomplete"
          : "No references match the current filters";
      this.roots = [statusNode(reason, "info")];
      this.provider.setRoots(this.withPinnedBanner(this.roots));
      return;
    }
    const displayed = this.filtered.slice(0, this.displayedLimit);
    this.roots = this.group(displayed);
    if (displayed.length < this.filtered.length) {
      this.roots.push({
        label: `Load more (${displayed.length} / ${this.filtered.length})`,
        description: `${this.filtered.length - displayed.length} remaining`,
        icon: new vscode.ThemeIcon("more"),
        command: {
          command: "cInsight.references.loadMore",
          title: "Load More References",
        },
      });
    } else {
      this.roots.unshift({
        label: `${this.filtered.length} references`,
        description: this.summary(),
        icon: new vscode.ThemeIcon("references"),
      });
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
          `Classification: ${node.description} · ${record.classification.confidence}`;
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
    return `${record.location.uri.fsPath}:${record.location.range.start.line + 1}:${record.location.range.start.character + 1} [${referenceClassificationLabel(record.classification)}; ${record.classification.confidence}] ${record.source?.trim() ?? ""}`;
  }

  private async renderText(records: ReferenceRecord[]): Promise<string> {
    const lines = await mapLimit(records, 8, (record) =>
      this.renderRecord(record),
    );
    return lines.join("\n");
  }

  private async jsonRecords(records: ReferenceRecord[]): Promise<unknown[]> {
    await this.renderText(records);
    return records.map((record) => ({
      uri: record.location.uri.toString(),
      path: record.location.uri.fsPath,
      line: record.location.range.start.line + 1,
      character: record.location.range.start.character + 1,
      kind: record.kind,
      classification: record.classification,
      source: record.source?.trim() ?? "",
    }));
  }

  private summary(): string {
    const filters = [
      this.lastDurationMs === undefined
        ? undefined
        : `${Math.round(this.lastDurationMs)} ms`,
      this.groupMode,
      this.scope !== "all" ? this.scope : undefined,
      this.query ? `“${this.query}”` : undefined,
    ].filter(Boolean);
    return filters.join(" · ");
  }

  private pageSize(): number {
    return vscode.workspace
      .getConfiguration("cInsight.references")
      .get<number>("pageSize", 200);
  }

  private withPinnedBanner(roots: TreeNode[]): TreeNode[] {
    const banners: TreeNode[] = [];
    if (this.pinned) {
      banners.push({
        label: `Pinned: ${this.pinnedSymbol ?? "References"}`,
        description: this.pinnedStale ? "stale" : undefined,
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
    if (record.kind === "reference") {
      const highlights = await this.highlightsFor(record.location);
      highlightKind = highlights.find((highlight) =>
        rangeContains(
          this.analysis.toVsRange(highlight.range),
          record.location.range.start,
        ),
      )?.kind;
    }
    record.classification = enhanceReferenceClassification(
      record.location,
      record.kind,
      {
        sourceLine: record.source,
        highlightKind,
        macroSymbol: this.macroSymbol,
        callableSymbol: this.callableSymbol,
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
    }
    return request;
  }

  private async detectMacroSymbol(): Promise<boolean> {
    const candidates =
      this.definitions.length > 0 ? this.definitions : this.declarations;
    return (
      await mapLimit(candidates.slice(0, 8), 4, async (location) => {
        const line = await this.sourceLines.line(
          location.uri,
          location.range.start.line,
        );
        return Boolean(line && isMacroDefinitionLine(line));
      })
    ).some(Boolean);
  }
}

function staleNode(reason: string): TreeNode {
  return {
    label: "Results are stale",
    description: reason,
    tooltip: `These results predate: ${reason}. Run the query again to refresh them.`,
    icon: new vscode.ThemeIcon("history"),
    contextValue: "analysisStaleStatus",
  };
}

function statusNode(label: string, icon: string): TreeNode {
  return { label, icon: new vscode.ThemeIcon(icon) };
}

function referenceIcon(
  classification: ReferenceClassification,
): vscode.ThemeIcon {
  if (classification.macro) {
    return new vscode.ThemeIcon("symbol-constant");
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
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        results[index] = await mapper(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
