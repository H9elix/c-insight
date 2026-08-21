import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { SymbolInformation, SymbolKind } from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import { VIEWS } from "../ids";
import type { SymbolSearchSessionState } from "../session/workspaceSession";
import { TreeNode } from "../views/treeNode";
import {
  filterWorkspaceSymbols,
  groupWorkspaceSymbols,
  SymbolGrouping,
  WorkspaceSymbolRecord,
} from "./symbolSearchModel";
import {
  parseSymbolSearchWebviewMessage,
  renderSymbolSearchWebview,
} from "./symbolSearchWebview";

interface SymbolSearchViewSymbol {
  id: string;
  name: string;
  description: string;
  tooltip: string;
  icon: string;
  iconClass: string;
}

interface SymbolSearchViewGroup {
  label: string;
  symbols: SymbolSearchViewSymbol[];
}

interface SymbolSearchViewState {
  type: "state";
  query: string;
  status: string;
  flat: boolean;
  groups: SymbolSearchViewGroup[];
}

export class SymbolSearchExplorer
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private query = "";
  private results: WorkspaceSymbolRecord[] = [];
  private selectedKinds = new Set<number>();
  private generation = 0;
  private loading = false;
  private error?: string;
  private timer?: NodeJS.Timeout;
  private view?: vscode.WebviewView;
  private readonly viewDisposables: vscode.Disposable[] = [];

  constructor(private readonly analysis: AnalysisService) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewListeners();
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = renderSymbolSearchWebview({
      cspSource: webviewView.webview.cspSource,
      nonce: randomBytes(16).toString("hex"),
      placeholder: vscode.l10n.t("Type a function, variable, type, or macro name"),
      clearTitle: vscode.l10n.t("Clear Workspace Symbol Search"),
      resultsLabel: vscode.l10n.t("Workspace Symbol Results"),
    });
    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((value: unknown) => {
        const message = parseSymbolSearchWebviewMessage(value);
        if (!message) {
          return;
        }
        if (message.type === "query") {
          this.scheduleSearch(message.query);
        } else if (message.type === "clear") {
          this.clear();
        } else if (message.type === "ready") {
          this.publish();
        } else if (message.type === "activate") {
          void this.activate(message.id);
        } else {
          void this.showContextActions(message.id);
        }
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.publish();
        }
      }),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) {
          this.view = undefined;
        }
        this.disposeViewListeners();
      }),
    );
    this.publish();
  }

  async openSearch(): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.WORKSPACE_SYMBOLS}.focus`);
    this.view?.show(false);
    await this.view?.webview.postMessage({ type: "focus" });
  }

  async refresh(): Promise<void> {
    if (this.query.trim()) {
      await this.searchNow(this.query);
    } else {
      this.publish();
    }
  }

  clear(): void {
    this.cancelTimer();
    this.generation += 1;
    this.query = "";
    this.results = [];
    this.loading = false;
    this.error = undefined;
    this.publish();
    void this.view?.webview.postMessage({ type: "focus" });
  }

  async chooseGrouping(): Promise<void> {
    const current = this.grouping;
    const selected = await vscode.window.showQuickPick(
      [
        { label: vscode.l10n.t("Symbol Type"), value: "type" },
        { label: vscode.l10n.t("File"), value: "file" },
        { label: vscode.l10n.t("Directory"), value: "directory" },
        { label: vscode.l10n.t("No Grouping"), value: "flat" },
      ].map((item) => ({
        ...item,
        description: item.value === current ? vscode.l10n.t("Current") : undefined,
      })),
      { title: vscode.l10n.t("Group Workspace Symbols By") },
    );
    if (selected) {
      await vscode.workspace
        .getConfiguration("cInsight.symbolSearch")
        .update("groupBy", selected.value, vscode.ConfigurationTarget.Workspace);
      this.publish();
    }
  }

  async chooseKinds(): Promise<void> {
    const kinds = distinctKinds(this.results);
    const selected = await vscode.window.showQuickPick(
      kinds.map(([kind, label]) => ({
        label,
        kind,
        picked: this.selectedKinds.size === 0 || this.selectedKinds.has(kind),
      })),
      {
        title: vscode.l10n.t("Filter Workspace Symbols by Type"),
        canPickMany: true,
        placeHolder: vscode.l10n.t("No selection means all symbol types"),
      },
    );
    if (selected) {
      this.selectedKinds = new Set(selected.map((item) => item.kind));
      if (this.selectedKinds.size === kinds.length) {
        this.selectedKinds.clear();
      }
      this.publish();
    }
  }

  configurationChanged(): void {
    this.publish();
  }

  sessionState(): SymbolSearchSessionState {
    return {
      query: this.query,
      selectedKinds: [...this.selectedKinds],
    };
  }

  async restoreSession(
    state: SymbolSearchSessionState | undefined,
  ): Promise<void> {
    if (!state) {
      return;
    }
    this.selectedKinds = new Set(
      state.selectedKinds.filter((kind) => Number.isInteger(kind)),
    );
    if (state.query.trim()) {
      await this.searchNow(state.query);
    } else {
      this.query = state.query;
      this.publish();
    }
  }

  interactionState(): {
    query: string;
    results: number;
    visibleResults: number;
    viewResolved: boolean;
    loading: boolean;
  } {
    return {
      query: this.query,
      results: this.results.length,
      visibleResults: this.visibleResults.length,
      viewResolved: this.view !== undefined,
      loading: this.loading,
    };
  }

  searchForTest(query: string): Promise<void> {
    return this.searchNow(query);
  }

  dispose(): void {
    this.cancelTimer();
    this.generation += 1;
    this.disposeViewListeners();
    this.view = undefined;
  }

  private scheduleSearch(query: string): void {
    this.cancelTimer();
    this.query = query;
    this.error = undefined;
    const generation = ++this.generation;
    if (!query.trim()) {
      this.results = [];
      this.loading = false;
      this.publish();
      return;
    }
    this.loading = true;
    this.publish();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.executeSearch(query, generation);
    }, this.debounce);
  }

  private async searchNow(query: string): Promise<void> {
    this.cancelTimer();
    this.query = query;
    this.error = undefined;
    const generation = ++this.generation;
    if (!query.trim()) {
      this.results = [];
      this.loading = false;
      this.publish();
      return;
    }
    this.loading = true;
    this.publish();
    await this.executeSearch(query, generation);
  }

  private async executeSearch(query: string, generation: number): Promise<void> {
    try {
      const raw = await this.analysis.workspaceSymbols(query.trim());
      if (generation !== this.generation) {
        return;
      }
      this.results = raw.map(toRecord);
      this.error = undefined;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.results = [];
      this.error = vscode.l10n.t("Symbol search failed: {error}", {
        error: String(error),
      });
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.publish();
      }
    }
  }

  private async activate(id: string): Promise<void> {
    const symbol = this.visibleResults.find(
      (candidate) => symbolSearchId(candidate) === id,
    );
    if (!symbol) {
      return;
    }
    await vscode.commands.executeCommand(
      "cInsight.activateTreeLocation",
      this.node(symbol),
      VIEWS.WORKSPACE_SYMBOLS,
    );
  }

  private async showContextActions(id: string): Promise<void> {
    const symbol = this.visibleResults.find(
      (candidate) => symbolSearchId(candidate) === id,
    );
    if (!symbol) {
      return;
    }
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: vscode.l10n.t("$(go-to-file) Open Location"),
          command: "cInsight.openLocation",
        },
        {
          label: vscode.l10n.t("$(bookmark) Add Bookmark"),
          command: "cInsight.bookmarks.add",
        },
      ],
      { title: symbol.name },
    );
    if (selected) {
      await vscode.commands.executeCommand(selected.command, this.node(symbol));
    }
  }

  private publish(): void {
    void this.view?.webview.postMessage(this.viewState());
  }

  private viewState(): SymbolSearchViewState {
    const visible = this.loading ? [] : this.visibleResults;
    const groups = visible.length > 0
      ? groupWorkspaceSymbols(visible, this.grouping)
      : [];
    return {
      type: "state",
      query: this.query,
      status: this.error ??
        (this.loading
          ? vscode.l10n.t("Searching workspace symbols…")
          : !this.query.trim()
            ? vscode.l10n.t("Type a function, variable, type, or macro name")
            : visible.length === 0
              ? vscode.l10n.t("No symbols found for “{query}”", {
                  query: this.query.trim(),
                })
              : vscode.l10n.t("{count} workspace symbols", {
                  count: visible.length,
                })),
      flat: this.grouping === "flat",
      groups: groups.map((group) => ({
        label: group.label,
        symbols: group.symbols.map((symbol) => this.viewSymbol(symbol)),
      })),
    };
  }

  private viewSymbol(symbol: WorkspaceSymbolRecord): SymbolSearchViewSymbol {
    const uri = vscode.Uri.parse(symbol.uri);
    const location = `${vscode.workspace.asRelativePath(uri)}:${symbol.line + 1}`;
    const icon = symbolWebviewIcon(symbol.kind);
    return {
      id: symbolSearchId(symbol),
      name: symbol.name,
      description: [symbol.containerName, location].filter(Boolean).join(" · "),
      tooltip: `${symbol.kindLabel}\n${uri.fsPath}:${symbol.line + 1}:${symbol.character + 1}`,
      ...icon,
    };
  }

  private node(symbol: WorkspaceSymbolRecord): TreeNode {
    const uri = vscode.Uri.parse(symbol.uri);
    return {
      id: `workspace-symbol:${symbolSearchId(symbol)}`,
      label: symbol.name,
      location: {
        uri,
        range: new vscode.Range(
          symbol.line,
          symbol.character,
          symbol.line,
          symbol.character + symbol.name.length,
        ),
      },
      previewMode: "definition",
      previewTitle: symbol.name,
      contextValue: "workspaceSymbolLocation",
    };
  }

  private get visibleResults(): WorkspaceSymbolRecord[] {
    return filterWorkspaceSymbols(
      this.results,
      this.selectedKinds,
      this.maximumResults,
    );
  }

  private get grouping(): SymbolGrouping {
    return vscode.workspace
      .getConfiguration("cInsight.symbolSearch")
      .get<SymbolGrouping>("groupBy", "type");
  }

  private get maximumResults(): number {
    return vscode.workspace
      .getConfiguration("cInsight.symbolSearch")
      .get<number>("maximumResults", 500);
  }

  private get debounce(): number {
    return vscode.workspace
      .getConfiguration("cInsight.symbolSearch")
      .get<number>("debounce", 250);
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private disposeViewListeners(): void {
    while (this.viewDisposables.length > 0) {
      this.viewDisposables.pop()?.dispose();
    }
  }
}

function symbolSearchId(symbol: WorkspaceSymbolRecord): string {
  return JSON.stringify([
    symbol.uri,
    symbol.line,
    symbol.character,
    symbol.kind,
    symbol.name,
  ]);
}

function toRecord(symbol: SymbolInformation): WorkspaceSymbolRecord {
  return {
    name: symbol.name,
    kind: symbol.kind,
    kindLabel: symbolKindLabel(symbol.kind),
    containerName: symbol.containerName,
    uri: symbol.location.uri,
    line: symbol.location.range.start.line,
    character: symbol.location.range.start.character,
  };
}

function distinctKinds(
  symbols: WorkspaceSymbolRecord[],
): Array<[number, string]> {
  return [
    ...new Map(symbols.map((symbol) => [symbol.kind, symbol.kindLabel])).entries(),
  ].sort((left, right) => left[1].localeCompare(right[1]));
}

function symbolWebviewIcon(kind: number): { icon: string; iconClass: string } {
  if (
    kind === SymbolKind.Class ||
    kind === SymbolKind.Struct ||
    kind === SymbolKind.Interface ||
    kind === SymbolKind.Enum ||
    kind === SymbolKind.TypeParameter
  ) {
    return { icon: "T", iconClass: "kind-type" };
  }
  if (
    kind === SymbolKind.Variable ||
    kind === SymbolKind.Constant ||
    kind === SymbolKind.Field ||
    kind === SymbolKind.Property ||
    kind === SymbolKind.EnumMember
  ) {
    return { icon: "◆", iconClass: "kind-value" };
  }
  if (
    kind === SymbolKind.Namespace ||
    kind === SymbolKind.Module ||
    kind === SymbolKind.Package
  ) {
    return { icon: "N", iconClass: "kind-namespace" };
  }
  return { icon: "ƒ", iconClass: "kind-function" };
}

function symbolKindLabel(kind: number): string {
  const labels: Partial<Record<number, string>> = {
    [SymbolKind.File]: "File",
    [SymbolKind.Module]: "Module",
    [SymbolKind.Namespace]: "Namespace",
    [SymbolKind.Package]: "Package",
    [SymbolKind.Class]: "Class",
    [SymbolKind.Method]: "Method",
    [SymbolKind.Property]: "Property",
    [SymbolKind.Field]: "Field",
    [SymbolKind.Constructor]: "Constructor",
    [SymbolKind.Enum]: "Enum",
    [SymbolKind.Interface]: "Interface",
    [SymbolKind.Function]: "Function",
    [SymbolKind.Variable]: "Variable",
    [SymbolKind.Constant]: "Constant",
    [SymbolKind.String]: "String",
    [SymbolKind.Number]: "Number",
    [SymbolKind.Boolean]: "Boolean",
    [SymbolKind.Array]: "Array",
    [SymbolKind.Object]: "Object",
    [SymbolKind.Key]: "Key",
    [SymbolKind.Null]: "Null",
    [SymbolKind.EnumMember]: "Enum Member",
    [SymbolKind.Struct]: "Struct",
    [SymbolKind.Event]: "Event",
    [SymbolKind.Operator]: "Operator",
    [SymbolKind.TypeParameter]: "Type Parameter",
  };
  return labels[kind] ?? `Kind ${kind}`;
}
