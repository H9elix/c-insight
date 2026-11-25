import * as vscode from "vscode";

export function textSearchLabels() {
  return {
    search: vscode.l10n.t("Search"), replace: vscode.l10n.t("Replace"), cancel: vscode.l10n.t("Cancel"),
    query: vscode.l10n.t("Text to find (Enter to search)"), replacement: vscode.l10n.t("Replacement text"),
    scope: vscode.l10n.t("Search scope"), file: vscode.l10n.t("Current file"), open: vscode.l10n.t("Open text files"),
    folder: vscode.l10n.t("Folder…"), workspace: vscode.l10n.t("Entire workspace"),
    include: vscode.l10n.t("Files to include (comma-separated globs)"), exclude: vscode.l10n.t("Files to exclude (comma-separated globs)"),
    caseSensitive: vscode.l10n.t("Match case"), wholeWord: vscode.l10n.t("Whole word"), regex: vscode.l10n.t("Regular expression"),
    useIgnores: vscode.l10n.t("Respect .gitignore and file/search exclusions"),
    preserveCase: vscode.l10n.t("Preserve case"), current: vscode.l10n.t("Preview current replacement"),
    checked: vscode.l10n.t("Preview checked replacements"), all: vscode.l10n.t("Preview all replacements"),
    inFile: vscode.l10n.t("Preview replacements in this file"), diff: vscode.l10n.t("Open diff"),
    apply: vscode.l10n.t("Confirm replacement…"), previous: vscode.l10n.t("Previous match"), next: vscode.l10n.t("Next match"),
    clear: vscode.l10n.t("Clear search text"), searching: vscode.l10n.t("Searching…"), stale: vscode.l10n.t("Results changed; search again."),
    partial: vscode.l10n.t("Partial results (cancelled, skipped files or limit reached)."),
    idle: vscode.l10n.t("Enter text and press Enter to search. Single-click previews; double-click or Enter opens the editor."),
    summary: vscode.l10n.t("Matches / scanned / skipped / timed out"), selectAll: vscode.l10n.t("Select all matches"),
    openResults: vscode.l10n.t("Open results window"), snapshot: vscode.l10n.t("Search snapshot"), frozen: vscode.l10n.t("Snapshot complete; new searches do not replace these results."),
    shown: vscode.l10n.t("Displayed / total matches"), hiddenChecked: vscode.l10n.t("Checked matches outside this list"),
  };
}
