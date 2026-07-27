import * as vscode from "vscode";
import { SymbolInformation, SymbolKind } from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import { MutableTreeProvider, TreeNode } from "../views/treeNode";
import {
  filterWorkspaceSymbols,
  groupWorkspaceSymbols,
  SymbolGrouping,
  WorkspaceSymbolRecord,
} from "./symbolSearchModel";
import type { SymbolSearchSessionState } from "../session/workspaceSession";

interface SearchItem extends vscode.QuickPickItem {
  symbol: WorkspaceSymbolRecord;
}

export class SymbolSearchExplorer implements vscode.Disposable {
  readonly provider = new MutableTreeProvider();
  private query = "";
  private results: WorkspaceSymbolRecord[] = [];
  private selectedKinds = new Set<number>();
  private generation = 0;

  constructor(private readonly analysis: AnalysisService) {
    this.publish();
  }

  async openSearch(): Promise<void> {
    const picker = vscode.window.createQuickPick<SearchItem>();
    picker.title = "C Insight: Search Workspace Symbols";
    picker.placeholder = "Type a function, variable, type, or macro name";
    picker.matchOnDescription = true;
    picker.matchOnDetail = true;
    picker.busy = false;
    picker.value = this.query;
    let timer: NodeJS.Timeout | undefined;
    const update = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        void this.search(picker.value, picker);
      }, this.debounce);
    };
    const disposables: vscode.Disposable[] = [];
    disposables.push(
      picker.onDidChangeValue(update),
      picker.onDidAccept(() => {
        const selected = picker.selectedItems[0] ?? picker.activeItems[0];
        if (selected) {
          void vscode.commands.executeCommand(
            "cInsight.openLocation",
            this.node(selected.symbol),
          );
          picker.hide();
        }
      }),
      picker.onDidHide(() => {
        if (timer) {
          clearTimeout(timer);
        }
        while (disposables.length > 0) {
          disposables.pop()?.dispose();
        }
        picker.dispose();
      }),
    );
    picker.show();
    if (picker.value.trim()) {
      await this.search(picker.value, picker);
    }
  }

  async refresh(): Promise<void> {
    if (this.query) {
      await this.search(this.query);
    }
  }

  clear(): void {
    this.generation += 1;
    this.query = "";
    this.results = [];
    this.publish();
  }

  async chooseGrouping(): Promise<void> {
    const current = this.grouping;
    const selected = await vscode.window.showQuickPick(
      [
        { label: "Symbol Type", value: "type" },
        { label: "File", value: "file" },
        { label: "Directory", value: "directory" },
        { label: "No Grouping", value: "flat" },
      ].map((item) => ({
        ...item,
        description: item.value === current ? "Current" : undefined,
      })),
      { title: "Group Workspace Symbols By" },
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
        title: "Filter Workspace Symbols by Type",
        canPickMany: true,
        placeHolder: "No selection means all symbol types",
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
      await this.search(state.query);
    } else {
      this.publish();
    }
  }

  dispose(): void {
    this.generation += 1;
    this.provider.dispose();
  }

  private async search(
    query: string,
    picker?: vscode.QuickPick<SearchItem>,
  ): Promise<void> {
    const trimmed = query.trim();
    this.query = trimmed;
    const generation = ++this.generation;
    if (!trimmed) {
      this.results = [];
      this.publish();
      if (picker) {
        picker.items = [];
        picker.busy = false;
      }
      return;
    }
    if (picker) {
      picker.busy = true;
    }
    try {
      const raw = await this.analysis.workspaceSymbols(trimmed);
      if (generation !== this.generation) {
        return;
      }
      this.results = raw.map(toRecord);
      this.publish();
      if (picker) {
        picker.items = this.visibleResults.map((symbol) => ({
          label: symbol.name,
          description: [symbol.kindLabel, symbol.containerName]
            .filter(Boolean)
            .join(" · "),
          detail: vscode.workspace.asRelativePath(vscode.Uri.parse(symbol.uri)),
          symbol,
        }));
      }
    } catch (error) {
      if (generation === this.generation) {
        this.provider.setRoots([
          {
            label: `Symbol search failed: ${String(error)}`,
            icon: new vscode.ThemeIcon("error"),
          },
        ]);
      }
    } finally {
      if (picker && generation === this.generation) {
        picker.busy = false;
      }
    }
  }

  private publish(): void {
    if (!this.query) {
      this.provider.setRoots([
        {
          label: "Search workspace symbols",
          description: "functions, variables, types, macros",
          icon: new vscode.ThemeIcon("search"),
          command: {
            command: "cInsight.searchSymbols",
            title: "Search Workspace Symbols",
          },
        },
      ]);
      return;
    }
    const visible = this.visibleResults;
    if (visible.length === 0) {
      this.provider.setRoots([
        {
          label: `No symbols found for “${this.query}”`,
          icon: new vscode.ThemeIcon("info"),
        },
      ]);
      return;
    }
    const groups = groupWorkspaceSymbols(visible, this.grouping);
    if (this.grouping === "flat") {
      this.provider.setRoots(groups[0].symbols.map((symbol) => this.node(symbol)));
      return;
    }
    this.provider.setRoots(
      groups.map((group) => ({
        label: group.label,
        description: `${group.symbols.length}`,
        icon: new vscode.ThemeIcon(
          this.grouping === "type" ? "symbol-key" : "folder",
        ),
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        children: group.symbols.map((symbol) => this.node(symbol)),
      })),
    );
  }

  private node(symbol: WorkspaceSymbolRecord): TreeNode {
    const uri = vscode.Uri.parse(symbol.uri);
    return {
      label: symbol.name,
      description:
        symbol.containerName ??
        `${vscode.workspace.asRelativePath(uri)}:${symbol.line + 1}`,
      tooltip: `${symbol.kindLabel}\n${uri.fsPath}:${symbol.line + 1}:${symbol.character + 1}`,
      icon: new vscode.ThemeIcon(symbolIcon(symbol.kind)),
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

function symbolIcon(kind: number): string {
  const icons: Partial<Record<number, string>> = {
    [SymbolKind.File]: "file",
    [SymbolKind.Namespace]: "symbol-namespace",
    [SymbolKind.Class]: "symbol-class",
    [SymbolKind.Method]: "symbol-method",
    [SymbolKind.Property]: "symbol-property",
    [SymbolKind.Field]: "symbol-field",
    [SymbolKind.Constructor]: "symbol-constructor",
    [SymbolKind.Enum]: "symbol-enum",
    [SymbolKind.Interface]: "symbol-interface",
    [SymbolKind.Function]: "symbol-function",
    [SymbolKind.Variable]: "symbol-variable",
    [SymbolKind.Constant]: "symbol-constant",
    [SymbolKind.String]: "symbol-string",
    [SymbolKind.Struct]: "symbol-struct",
    [SymbolKind.EnumMember]: "symbol-enum-member",
    [SymbolKind.Operator]: "symbol-operator",
    [SymbolKind.TypeParameter]: "symbol-type-parameter",
  };
  return icons[kind] ?? "symbol-misc";
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
