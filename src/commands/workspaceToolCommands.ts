import * as vscode from "vscode";
import { BookmarkExplorer } from "../bookmarks/bookmarkExplorer";
import { NavigationHistoryExplorer } from "../history/navigationHistoryExplorer";
import { NavigationHistoryEntry } from "../history/navigationHistoryModel";
import { COMMANDS, INTERNAL_COMMANDS } from "../ids";
import { WorkspaceSessionManager } from "../session/workspaceSession";
import { SymbolSearchExplorer } from "../symbols/symbolSearchExplorer";
import { ViewRegistry } from "../views/viewRegistry";
import { RegisterCommand } from "./commandRegistrar";

interface WorkspaceToolDependencies {
  history: NavigationHistoryExplorer;
  bookmarks: BookmarkExplorer;
  symbolSearch: SymbolSearchExplorer;
  workspaceSession: WorkspaceSessionManager;
  views: ViewRegistry;
  restoreWorkspaceSession: () => Promise<boolean>;
}

export function registerWorkspaceToolCommands(
  register: RegisterCommand,
  dependencies: WorkspaceToolDependencies,
): void {
  const { history, bookmarks, symbolSearch, workspaceSession, views, restoreWorkspaceSession } = dependencies;
  register(INTERNAL_COMMANDS.HISTORY_PREVIEW, async (value: unknown) => {
    const selected = history.select((value as NavigationHistoryEntry).id);
    if (selected) {
      await views.preview.showLocation(
        history.entryLocation(selected), selected.mode, selected.title, "history",
      );
    }
  });
  register(COMMANDS.HISTORY_FILTER, () => history.chooseFilter());
  register(COMMANDS.HISTORY_CLEAR, () => history.clear());
  register(COMMANDS.BOOKMARKS_ADD_CURRENT, () => bookmarks.addCurrent());
  register(COMMANDS.BOOKMARKS_ADD, (value: unknown) => bookmarks.addNode(value));
  register(COMMANDS.BOOKMARKS_RENAME, (value: unknown) => bookmarks.rename(value));
  register(COMMANDS.BOOKMARKS_CHANGE_GROUP, (value: unknown) => bookmarks.changeGroup(value));
  register(COMMANDS.BOOKMARKS_DELETE, (value: unknown) => bookmarks.remove(value));
  register(COMMANDS.BOOKMARKS_REFRESH, () => bookmarks.refresh());
  register(COMMANDS.BOOKMARKS_SEARCH, () => bookmarks.search());
  register(COMMANDS.BOOKMARKS_CLEAR_SEARCH, () => bookmarks.clearSearch());
  register(COMMANDS.BOOKMARKS_SORT, () => bookmarks.chooseSort());
  register(COMMANDS.BOOKMARKS_IMPORT, () => bookmarks.importBookmarks());
  register(COMMANDS.BOOKMARKS_EXPORT, (value: unknown) => bookmarks.exportBookmarks(value));
  register(COMMANDS.BOOKMARKS_RENAME_GROUP, (value: unknown) => bookmarks.renameGroup(value));
  register(COMMANDS.BOOKMARKS_DELETE_GROUP, (value: unknown) => bookmarks.deleteGroup(value));
  register(COMMANDS.SESSION_RESTORE, async () => {
    if (!(await restoreWorkspaceSession())) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("C Insight: No saved workspace session is available."),
      );
    }
  });
  register(COMMANDS.SESSION_CLEAR, async () => {
    await workspaceSession.clear();
    void vscode.window.showInformationMessage(
      vscode.l10n.t("C Insight: Saved workspace session cleared. Autosave is paused until this window closes."),
    );
  });
  register(COMMANDS.SEARCH_SYMBOLS, () => symbolSearch.openSearch());
  register(COMMANDS.SYMBOL_SEARCH_REFRESH, () => symbolSearch.refresh());
  register(COMMANDS.SYMBOL_SEARCH_CLEAR, () => symbolSearch.clear());
  register(COMMANDS.SYMBOL_SEARCH_GROUP_BY, () => symbolSearch.chooseGrouping());
  register(COMMANDS.SYMBOL_SEARCH_FILTER_KINDS, () => symbolSearch.chooseKinds());
}
