import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { NavigationMode } from "../history/navigationHistoryModel";
import { LocationResult } from "../models/types";
import { MutableTreeProvider, TreeNode } from "../views/treeNode";
import {
  Bookmark,
  BookmarkExport,
  BookmarkSort,
  BookmarkStore,
  closestSymbolOffset,
  filterBookmarks,
  parseBookmarkExport,
  sortBookmarks,
} from "./bookmarkModel";

const STORAGE_KEY = "cInsight.bookmarks";

export class BookmarkExplorer implements vscode.Disposable {
  readonly provider = new MutableTreeProvider();
  private readonly store: BookmarkStore;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private filterQuery = "";

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
    const location = node.includeFileUri
      ? {
          uri: node.includeFileUri,
          range: new vscode.Range(0, 0, 0, 0),
        }
      : node.location;
    await this.addLocation(
      location,
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
      title: vscode.l10n.t("Rename C Insight Bookmark"),
      value: bookmark.label,
      validateInput: (input) =>
        input.trim() ? undefined : vscode.l10n.t("Bookmark name cannot be empty"),
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
        { label: vscode.l10n.t("$(add) New Group…"), value: "" },
      ],
      {
        title: vscode.l10n.t("Move C Insight Bookmark to Group"),
        placeHolder: vscode.l10n.t("Current: {value}", { value: bookmark.group }),
      },
    );
    if (!picked) {
      return;
    }
    const group =
      picked.value ||
      (await vscode.window.showInputBox({
        title: vscode.l10n.t("New Bookmark Group"),
        validateInput: (input) =>
          input.trim() ? undefined : vscode.l10n.t("Group name cannot be empty"),
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
    const deleteAction = vscode.l10n.t("Delete");
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t("Delete bookmark “{label}”?", { label: bookmark.label }),
      { modal: true },
      deleteAction,
    );
    if (action === deleteAction && this.store.remove(bookmark.id)) {
      await this.persistAndPublish();
    }
  }

  async search(): Promise<void> {
    const query = await vscode.window.showInputBox({
      title: vscode.l10n.t("Filter C Insight Bookmarks"),
      prompt: vscode.l10n.t("Match bookmark name, group, file path, or symbol"),
      value: this.filterQuery,
    });
    if (query !== undefined) {
      this.filterQuery = query.trim();
      this.publish();
    }
  }

  clearSearch(): void {
    this.filterQuery = "";
    this.publish();
  }

  async chooseSort(): Promise<void> {
    const current = this.sortMode;
    const selected = await vscode.window.showQuickPick(
      [
        { label: vscode.l10n.t("Name"), value: "name" },
        { label: vscode.l10n.t("File Path"), value: "path" },
        { label: vscode.l10n.t("Source Position"), value: "position" },
        { label: vscode.l10n.t("Creation Time"), value: "created" },
        { label: vscode.l10n.t("Last Updated"), value: "updated" },
      ].map((item) => ({
        ...item,
        description: item.value === current ? vscode.l10n.t("Current") : undefined,
      })),
      { title: vscode.l10n.t("Sort C Insight Bookmarks By") },
    );
    if (selected) {
      await vscode.workspace
        .getConfiguration("cInsight.bookmarks")
        .update("sortBy", selected.value, vscode.ConfigurationTarget.Workspace);
      this.publish();
    }
  }

  async exportBookmarks(value?: unknown): Promise<void> {
    const group = (value as TreeNode | undefined)?.bookmarkGroup;
    const bookmarks = this.store.all.filter(
      (bookmark) => !group || bookmark.group === group,
    );
    if (bookmarks.length === 0) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("C Insight: There are no bookmarks to export."),
      );
      return;
    }
    const target = await vscode.window.showSaveDialog({
      title: group
        ? vscode.l10n.t("Export Bookmark Group “{group}”", { group })
        : vscode.l10n.t("Export C Insight Bookmarks"),
      defaultUri: vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ??
          vscode.Uri.file(process.cwd()),
        group ? `${safeFileName(group)}-bookmarks.json` : "c-insight-bookmarks.json",
      ),
      filters: { JSON: ["json"] },
    });
    if (!target) {
      return;
    }
    const exported: BookmarkExport = {
      format: "c-insight-bookmarks",
      version: 1,
      exportedAt: new Date().toISOString(),
      bookmarks: [...bookmarks],
    };
    await vscode.workspace.fs.writeFile(
      target,
      Buffer.from(`${JSON.stringify(exported, undefined, 2)}\n`, "utf8"),
    );
    void vscode.window.showInformationMessage(
      vscode.l10n.t("C Insight: Exported {count} bookmark(s).", { count: bookmarks.length }),
    );
  }

  async importBookmarks(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      title: vscode.l10n.t("Import C Insight Bookmarks"),
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { JSON: ["json"] },
    });
    if (!selected?.[0]) {
      return;
    }
    try {
      const content = await vscode.workspace.fs.readFile(selected[0]);
      const parsed = parseBookmarkExport(
        JSON.parse(Buffer.from(content).toString("utf8")) as unknown,
      );
      const mode = await vscode.window.showQuickPick(
        [
          {
            label: vscode.l10n.t("Append and Update"),
            value: "append" as const,
            description: vscode.l10n.t("Keep current bookmarks and merge duplicate positions"),
          },
          {
            label: vscode.l10n.t("Replace All"),
            value: "replace" as const,
            description: vscode.l10n.t("Delete current bookmarks before importing"),
          },
        ],
        { title: vscode.l10n.t("Import C Insight Bookmarks") },
      );
      if (!mode) {
        return;
      }
      if (
        mode.value === "replace" &&
        (await vscode.window.showWarningMessage(
          vscode.l10n.t("Replace all current C Insight bookmarks?"),
          { modal: true },
          vscode.l10n.t("Replace"),
        )) !== vscode.l10n.t("Replace")
      ) {
        return;
      }
      const unique = new Map<string, Bookmark>();
      let skipped = 0;
      for (const bookmark of parsed) {
        const key = bookmarkPositionKey(bookmark);
        if (unique.has(key)) {
          skipped += 1;
        }
        unique.set(key, { ...bookmark, id: randomUUID() });
      }
      const imported = [...unique.values()];
      const result = this.store.import(imported, mode.value);
      let missing = 0;
      for (const bookmark of imported) {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.parse(bookmark.uri));
        } catch {
          bookmark.stale = true;
          const stored = this.store.all.find(
            (item) => bookmarkPositionKey(item) === bookmarkPositionKey(bookmark),
          );
          if (stored) {
            stored.stale = true;
          }
          missing += 1;
        }
      }
      await this.persistAndPublish();
      void vscode.window.showInformationMessage(
        vscode.l10n.t("C Insight import: {added} added, {updated} updated, {skipped} duplicate(s) skipped, {missing} missing-file location(s) marked stale.", { added: result.added, updated: result.updated, skipped, missing }),
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t("C Insight could not import bookmarks: {error}", { error: String(error) }),
      );
    }
  }

  async renameGroup(value: unknown): Promise<void> {
    const group = this.groupFrom(value);
    if (!group) {
      return;
    }
    const target = await vscode.window.showInputBox({
      title: vscode.l10n.t("Rename or Merge Bookmark Group"),
      value: group,
      prompt: vscode.l10n.t("An existing name merges both groups"),
      validateInput: (input) =>
        input.trim() ? undefined : vscode.l10n.t("Group name cannot be empty"),
    });
    if (target && this.store.renameGroup(group, target) > 0) {
      await this.persistAndPublish();
    }
  }

  async deleteGroup(value: unknown): Promise<void> {
    const group = this.groupFrom(value);
    if (!group) {
      return;
    }
    const count = this.store.all.filter(
      (bookmark) => bookmark.group === group,
    ).length;
    const deleteGroupAction = vscode.l10n.t("Delete Group");
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t("Delete group “{group}” and its {count} bookmark(s)?", { group, count }),
      { modal: true },
      deleteGroupAction,
    );
    if (action === deleteGroupAction && this.store.removeGroup(group) > 0) {
      await this.persistAndPublish();
    }
  }

  configurationChanged(): void {
    this.publish();
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
        ? vscode.l10n.t("C Insight: Added bookmark “{label}”.", { label: result.bookmark.label })
        : vscode.l10n.t("C Insight: Updated existing bookmark “{label}”.", { label: result.bookmark.label }),
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

  private groupFrom(value: unknown): string | undefined {
    return (value as TreeNode | undefined)?.bookmarkGroup;
  }

  private async persistAndPublish(): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEY, this.store.all);
    this.publish();
  }

  private publish(): void {
    if (this.store.all.length === 0) {
      this.provider.setRoots([
        {
          label: vscode.l10n.t("No bookmarks"),
          icon: new vscode.ThemeIcon("info"),
        },
      ]);
      return;
    }
    const visible = filterBookmarks(this.store.all, this.filterQuery);
    if (visible.length === 0) {
      this.provider.setRoots([
        {
          label: vscode.l10n.t("No bookmarks match “{query}”", { query: this.filterQuery }),
          icon: new vscode.ThemeIcon("info"),
        },
      ]);
      return;
    }
    const groups = new Map<string, Bookmark[]>();
    for (const bookmark of visible) {
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
          contextValue: "bookmarkGroup",
          bookmarkGroup: group,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          children: sortBookmarks(bookmarks, this.sortMode)
            .map((bookmark) => this.bookmarkNode(bookmark)),
        })),
    );
  }

  private bookmarkNode(bookmark: Bookmark): TreeNode {
    const location = bookmarkLocation(bookmark);
    return {
      id: `bookmark:${bookmark.id}`,
      label: bookmark.label,
      description: `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}${bookmark.stale ? vscode.l10n.t(" · stale") : ""}`,
      tooltip:
        `${location.uri.fsPath}:${location.range.start.line + 1}:${location.range.start.character + 1}` +
        (bookmark.stale
          ? vscode.l10n.t("\nLocation may be outdated; run Refresh Bookmarks to relocate it.")
          : ""),
      icon: new vscode.ThemeIcon(bookmark.stale ? "warning" : "bookmark"),
      location,
      previewMode: bookmark.mode,
      previewTitle: bookmark.label,
      contextValue: "bookmarkLocation",
      bookmarkId: bookmark.id,
    };
  }

  private get sortMode(): BookmarkSort {
    return vscode.workspace
      .getConfiguration("cInsight.bookmarks")
      .get<BookmarkSort>("sortBy", "updated");
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

function bookmarkPositionKey(bookmark: Bookmark): string {
  return `${bookmark.uri}:${bookmark.range.start.line}:${bookmark.range.start.character}`;
}

function safeFileName(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "group";
}
