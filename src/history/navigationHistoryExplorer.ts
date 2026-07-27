import * as vscode from "vscode";
import { LocationResult } from "../models/types";
import { MutableTreeProvider, TreeNode } from "../views/treeNode";
import {
  NavigationHistoryEntry,
  NavigationHistoryStore,
  NavigationMode,
  NavigationOrigin,
  NavigationSource,
  navigationOrigin,
} from "./navigationHistoryModel";

type HistoryFilter = "all" | NavigationOrigin;

export class NavigationHistoryExplorer implements vscode.Disposable {
  readonly provider = new MutableTreeProvider();
  private readonly store: NavigationHistoryStore;
  private filter: HistoryFilter = "all";

  constructor() {
    const config = vscode.workspace.getConfiguration("cInsight.history");
    this.store = new NavigationHistoryStore(
      config.get<number>("maximumEntries", 200),
      config.get<boolean>("mergeConsecutiveDuplicates", true),
    );
    this.publish();
  }

  get canBack(): boolean {
    return this.store.canBack;
  }

  get canForward(): boolean {
    return this.store.canForward;
  }

  record(
    location: LocationResult,
    mode: NavigationMode,
    title: string,
    source: NavigationSource,
  ): void {
    if (source === "context" || source === "history") {
      return;
    }
    this.store.add({
      uri: location.uri.toString(),
      range: serializeRange(location.range),
      mode,
      origin: navigationOrigin(mode, source),
      title,
    });
    this.publish();
  }

  back(): NavigationHistoryEntry | undefined {
    const entry = this.store.back();
    this.publish();
    return entry;
  }

  forward(): NavigationHistoryEntry | undefined {
    const entry = this.store.forward();
    this.publish();
    return entry;
  }

  select(id: number): NavigationHistoryEntry | undefined {
    const entry = this.store.select(id);
    this.publish();
    return entry;
  }

  clear(): void {
    this.store.clear();
    this.publish();
  }

  async chooseFilter(): Promise<void> {
    const options: Array<{
      label: string;
      value: HistoryFilter;
      description: string;
    }> = [
      { label: "All", value: "all", description: "All navigation entries" },
      {
        label: "Definitions",
        value: "definition",
        description: "Definition navigation",
      },
      {
        label: "Declarations",
        value: "declaration",
        description: "Declaration navigation",
      },
      {
        label: "References",
        value: "reference",
        description: "Reference navigation",
      },
      { label: "Callers", value: "caller", description: "Caller navigation" },
      { label: "Callees", value: "callee", description: "Callee navigation" },
      {
        label: "Code Preview",
        value: "code-preview",
        description: "Definitions followed inside Code Preview",
      },
    ];
    const picked = await vscode.window.showQuickPick(options, {
      title: "C Insight: Navigation History Filter",
      placeHolder: `Current: ${this.filter}`,
    });
    if (picked) {
      this.filter = picked.value;
      this.publish();
    }
  }

  configurationChanged(): void {
    const config = vscode.workspace.getConfiguration("cInsight.history");
    this.store.configure(
      config.get<number>("maximumEntries", 200),
      config.get<boolean>("mergeConsecutiveDuplicates", true),
    );
    this.publish();
  }

  entryLocation(entry: NavigationHistoryEntry): LocationResult {
    return {
      uri: vscode.Uri.parse(entry.uri),
      range: new vscode.Range(
        entry.range.start.line,
        entry.range.start.character,
        entry.range.end.line,
        entry.range.end.character,
      ),
    };
  }

  dispose(): void {
    this.provider.dispose();
  }

  private publish(): void {
    const currentId = this.store.current?.id;
    const entries = [...this.store.all]
      .filter((entry) => this.filter === "all" || entry.origin === this.filter)
      .reverse();
    if (entries.length === 0) {
      this.provider.setRoots([
        {
          label:
            this.store.all.length === 0
              ? "No navigation history"
              : "No history matches the current filter",
          icon: new vscode.ThemeIcon("info"),
        },
      ]);
      return;
    }
    this.provider.setRoots(
      entries.map((entry) => this.treeNode(entry, entry.id === currentId)),
    );
  }

  private treeNode(
    entry: NavigationHistoryEntry,
    current: boolean,
  ): TreeNode {
    const location = this.entryLocation(entry);
    const relative = vscode.workspace.asRelativePath(location.uri);
    return {
      id: `history:${entry.id}`,
      label: entry.title,
      description: `${historyOriginLabel(entry.origin)} · ${relative}:${location.range.start.line + 1}${current ? " · current" : ""}`,
      tooltip:
        `${location.uri.fsPath}:${location.range.start.line + 1}:${location.range.start.character + 1}\n` +
        `${historyOriginLabel(entry.origin)} · ${new Date(entry.timestamp).toLocaleString()}`,
      icon: new vscode.ThemeIcon(historyOriginIcon(entry.origin)),
      location,
      contextValue: "historyLocation",
      command: {
        command: "cInsight.history.preview",
        title: "Preview Navigation History",
        arguments: [entry],
      },
    };
  }
}

function serializeRange(range: vscode.Range): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: {
      line: range.start.line,
      character: range.start.character,
    },
    end: {
      line: range.end.line,
      character: range.end.character,
    },
  };
}

function historyOriginLabel(origin: NavigationOrigin): string {
  switch (origin) {
    case "definition":
      return "Definition";
    case "declaration":
      return "Declaration";
    case "reference":
      return "Reference";
    case "caller":
      return "Caller";
    case "callee":
      return "Callee";
    case "code-preview":
      return "Code Preview";
  }
}

function historyOriginIcon(origin: NavigationOrigin): string {
  switch (origin) {
    case "definition":
      return "symbol-function";
    case "declaration":
      return "symbol-interface";
    case "reference":
      return "references";
    case "caller":
      return "call-incoming";
    case "callee":
      return "call-outgoing";
    case "code-preview":
      return "preview";
  }
}
