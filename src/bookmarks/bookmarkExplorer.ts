import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { NavigationMode } from "../history/navigationHistoryModel";
import { LocationResult } from "../models/types";
import { MutableTreeProvider, TreeNode } from "../views/treeNode";
import {
  Bookmark,
  BookmarkStore,
  closestSymbolOffset,
} from "./bookmarkModel";

const STORAGE_KEY = "cInsight.bookmarks";

export class BookmarkExplorer implements vscode.Disposable {
  readonly provider = new MutableTreeProvider();
  private readonly store: BookmarkStore;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.store = new BookmarkStore(
      context.workspaceState.get<Bookmark[]>(STORAGE_KEY, []),
    );
    this.publish();
  }

  async addCurrent(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const position = editor.selection.active;
    const range =
      editor.document.getWordRangeAtPosition(position) ??
      new vscode.Range(position, position);
    await this.addLocation(
      {
        uri: editor.document.uri,
        range,
      },
      editor.document.getText(range) || "Bookmark",
      "reference",
    );
  }

  async addNode(value: unknown): Promise<void> {
    const node = value as TreeNode | undefined;
    if (!node?.location) {
      return;
    }
    await this.addLocation(
      node.location,
      node.previewTitle ?? node.label,
      node.previewMode ?? "reference",
    );
  }

  async rename(value: unknown): Promise<void> {
    const bookmark = this.bookmarkFrom(value);
    if (!bookmark) {
      return;
    }
    const label = await vscode.window.showInputBox({
      title: "Rename C Insight Bookmark",
      value: bookmark.label,
      validateInput: (input) =>
        input.trim() ? undefined : "Bookmark name cannot be empty",
    });
    if (label && this.store.rename(bookmark.id, label)) {
      await this.persistAndPublish();
    }
  }

  async changeGroup(value: unknown): Promise<void> {
    const bookmark = this.bookmarkFrom(value);
    if (!bookmark) {
      return;
    }
    const groups = [...new Set(this.store.all.map((item) => item.group))].sort();
    const picked = await vscode.window.showQuickPick(
      [
        ...groups.map((group) => ({
          label: group,
          value: group,
        })),
        { label: "$(add) New Group…", value: "" },
      ],
      {
        title: "Move C Insight Bookmark to Group",
        placeHolder: `Current: ${bookmark.group}`,
      },
    );
    if (!picked) {
      return;
    }
    const group =
      picked.value ||
      (await vscode.window.showInputBox({
        title: "New Bookmark Group",
        validateInput: (input) =>
          input.trim() ? undefined : "Group name cannot be empty",
      }));
    if (group && this.store.move(bookmark.id, group)) {
      await this.persistAndPublish();
    }
  }

  async remove(value: unknown): Promise<void> {
    const bookmark = this.bookmarkFrom(value);
    if (!bookmark) {
      return;
    }
    const action = await vscode.window.showWarningMessage(
      `Delete bookmark “${bookmark.label}”?`,
      { modal: true },
      "Delete",
    );
    if (action === "Delete" && this.store.remove(bookmark.id)) {
      await this.persistAndPublish();
    }
  }

  handleDocumentChange(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    if (!this.store.all.some((bookmark) => bookmark.uri === key)) {
      return;
    }
    if (this.store.markUriStale(key)) {
      void this.persistAndPublish();
    }
    const previous = this.timers.get(key);
    if (previous) {
      clearTimeout(previous);
    }
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.relocateDocument(document);
      }, 500),
    );
  }

  async refresh(): Promise<void> {
    for (const uri of new Set(this.store.all.map((item) => item.uri))) {
      try {
        await this.relocateDocument(
          await vscode.workspace.openTextDocument(vscode.Uri.parse(uri)),
        );
      } catch {
        for (const bookmark of this.store.all.filter(
          (item) => item.uri === uri,
        )) {
          this.store.updateLocation(bookmark.id, bookmark.range, true);
        }
      }
    }
    await this.persistAndPublish();
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.provider.dispose();
  }

  private async addLocation(
    location: LocationResult,
    fallbackLabel: string,
    mode: NavigationMode,
  ): Promise<void> {
    let symbol: string | undefined;
    try {
      const document = await vscode.workspace.openTextDocument(location.uri);
      const range = document.getWordRangeAtPosition(location.range.start);
      symbol = range ? document.getText(range) : undefined;
    } catch {
      // Keep a location-only bookmark when the document cannot be read.
    }
    const label = symbol || fallbackLabel || "Bookmark";
    const result = this.store.add(
      {
        label,
        uri: location.uri.toString(),
        range: serializeRange(location.range),
        mode,
        symbol,
      },
      randomUUID(),
    );
    await this.persistAndPublish();
    void vscode.window.showInformationMessage(
      result.created
        ? `C Insight: Added bookmark “${result.bookmark.label}”.`
        : `C Insight: Updated existing bookmark “${result.bookmark.label}”.`,
    );
  }

  private async relocateDocument(
    document: vscode.TextDocument,
  ): Promise<void> {
    const uri = document.uri.toString();
    const text = document.getText();
    for (const bookmark of this.store.all.filter((item) => item.uri === uri)) {
      if (!bookmark.symbol) {
        this.store.updateLocation(bookmark.id, bookmark.range, true);
        continue;
      }
      const preferred = document.offsetAt(
        new vscode.Position(
          Math.min(bookmark.range.start.line, document.lineCount - 1),
          bookmark.range.start.character,
        ),
      );
      const offset = closestSymbolOffset(text, bookmark.symbol, preferred);
      if (offset === undefined) {
        this.store.updateLocation(bookmark.id, bookmark.range, true);
        continue;
      }
      const start = document.positionAt(offset);
      const end = document.positionAt(offset + bookmark.symbol.length);
      this.store.updateLocation(
        bookmark.id,
        serializeRange(new vscode.Range(start, end)),
        false,
      );
    }
    await this.persistAndPublish();
  }

  private bookmarkFrom(value: unknown): Bookmark | undefined {
    const node = value as TreeNode | undefined;
    return node?.bookmarkId ? this.store.find(node.bookmarkId) : undefined;
  }

  private async persistAndPublish(): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEY, this.store.all);
    this.publish();
  }

  private publish(): void {
    if (this.store.all.length === 0) {
      this.provider.setRoots([
        {
          label: "No bookmarks",
          icon: new vscode.ThemeIcon("info"),
        },
      ]);
      return;
    }
    const groups = new Map<string, Bookmark[]>();
    for (const bookmark of this.store.all) {
      const values = groups.get(bookmark.group) ?? [];
      values.push(bookmark);
      groups.set(bookmark.group, values);
    }
    this.provider.setRoots(
      [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([group, bookmarks]) => ({
          label: group,
          description: `${bookmarks.length}`,
          icon: new vscode.ThemeIcon("folder"),
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          children: bookmarks
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map((bookmark) => this.bookmarkNode(bookmark)),
        })),
    );
  }

  private bookmarkNode(bookmark: Bookmark): TreeNode {
    const location = bookmarkLocation(bookmark);
    return {
      id: `bookmark:${bookmark.id}`,
      label: bookmark.label,
      description: `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}${bookmark.stale ? " · stale" : ""}`,
      tooltip:
        `${location.uri.fsPath}:${location.range.start.line + 1}:${location.range.start.character + 1}` +
        (bookmark.stale
          ? "\nLocation may be outdated; run Refresh Bookmarks to relocate it."
          : ""),
      icon: new vscode.ThemeIcon(bookmark.stale ? "warning" : "bookmark"),
      location,
      previewMode: bookmark.mode,
      previewTitle: bookmark.label,
      contextValue: "bookmarkLocation",
      bookmarkId: bookmark.id,
    };
  }
}

function bookmarkLocation(bookmark: Bookmark): LocationResult {
  return {
    uri: vscode.Uri.parse(bookmark.uri),
    range: new vscode.Range(
      bookmark.range.start.line,
      bookmark.range.start.character,
      bookmark.range.end.line,
      bookmark.range.end.character,
    ),
  };
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
