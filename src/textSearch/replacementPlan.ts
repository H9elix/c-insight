import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { applyMatches, contentHash, replacementText, type TextMatch } from "./searchModel";
import type { SearchFile, SearchRequest } from "./workspaceSearch";
import { minimatch } from "minimatch";

export interface PlannedFile { file: SearchFile; matches: TextMatch[]; before: string; after: string }
export interface ReplacementPlan { id: string; revision: number; files: PlannedFile[]; count: number }

/** Read-only, ephemeral snapshots. URLs identify snapshots, never source files supplied by a webview. */
export class ReplacementSnapshots implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly snapshots = new Map<string, string>();
  private readonly registration = vscode.workspace.registerTextDocumentContentProvider("c-insight-search-diff", this);
  provideTextDocumentContent(uri: vscode.Uri): string { return this.snapshots.get(uri.toString()) ?? ""; }
  clear(): void { this.snapshots.clear(); }
  async show(plan: ReplacementPlan, file: PlannedFile): Promise<void> {
    const name = file.file.label.split("/").at(-1) ?? "text";
    const before = vscode.Uri.from({scheme: "c-insight-search-diff", path: `/${plan.id}/${file.file.id}/before/${name}`});
    const after = vscode.Uri.from({scheme: "c-insight-search-diff", path: `/${plan.id}/${file.file.id}/after/${name}`});
    this.snapshots.set(before.toString(), file.before); this.snapshots.set(after.toString(), file.after);
    await vscode.commands.executeCommand("vscode.diff", before, after, vscode.l10n.t("Replacement Preview: {file}", {file: file.file.label}));
  }
  dispose(): void { this.clear(); this.registration.dispose(); }
}

export async function createReplacementPlan(files: SearchFile[], ids: ReadonlySet<string>, revision: number,
  request: SearchRequest, replacement: string, preserveCase: boolean,
  read: (uri: vscode.Uri) => Promise<{text: string; version?: number}>): Promise<ReplacementPlan> {
  const selected = files.filter(file => file.matches.some(match => ids.has(match.id)));
  if (!selected.length) throw new Error(vscode.l10n.t("Select matches to replace."));
  if (selected.length > 200) throw new Error(vscode.l10n.t("Narrow the replacement to at most 200 files."));
  const planned: PlannedFile[] = [];
  let bytes = 0;
  for (const file of selected) {
    const snapshot = await read(vscode.Uri.parse(file.uri));
    if (contentHash(snapshot.text) !== file.hash || file.version !== undefined && snapshot.version !== file.version) {
      throw new Error(vscode.l10n.t("Search results changed. Search again before replacing."));
    }
    const matches = file.matches.filter(match => ids.has(match.id));
    const after = applyMatches(snapshot.text, matches, replacement, request.regex, preserveCase);
    bytes += Buffer.byteLength(snapshot.text, "utf8") + Buffer.byteLength(after, "utf8");
    if (bytes > 64 * 1024 * 1024) throw new Error(vscode.l10n.t("Replacement preview exceeds 64 MiB. Narrow the selection."));
    planned.push({file, matches, before: snapshot.text, after});
  }
  return {id: randomBytes(16).toString("hex"), revision, files: planned, count: planned.reduce((sum, file) => sum + file.matches.length, 0)};
}

export function canReplace(): boolean { return vscode.workspace.isTrusted; }

/** Validate every target before handing a versioned edit to VS Code. Never save documents here. */
export async function applyReplacementPlan(plan: ReplacementPlan, request: SearchRequest,
  replacement: string, preserveCase: boolean, stillValid: () => boolean): Promise<void> {
  if (!canReplace() || !stillValid()) throw new Error(vscode.l10n.t("Replacement is unavailable or the preview is out of date."));
  const loaded: Array<{planned: PlannedFile; document: vscode.TextDocument; version: number}> = [];
  for (const planned of plan.files) {
    const uri = vscode.Uri.parse(planned.file.uri);
    const config = vscode.workspace.getConfiguration("files", uri);
    const matchesSetting = (key: string): boolean => Object.entries(config.get<Record<string, boolean>>(key, {}))
      .some(([pattern, enabled]) => enabled && (minimatch(uri.path, pattern, {dot: true}) || minimatch(vscode.workspace.asRelativePath(uri, false), pattern, {dot: true})));
    if ((matchesSetting("readonlyInclude") || config.get<boolean>("defaultReadonly", false)) && !matchesSetting("readonlyExclude") ||
      vscode.workspace.fs.isWritableFileSystem(uri.scheme) !== true ||
      vscode.workspace.getConfiguration("files", uri).get<boolean>("readonlyFromPermissions", false) &&
      ((await vscode.workspace.fs.stat(uri)).permissions ?? 0) & vscode.FilePermission.Readonly) {
      throw new Error(vscode.l10n.t("A replacement target is read-only."));
    }
    const document = await vscode.workspace.openTextDocument(uri);
    if (contentHash(document.getText()) !== planned.file.hash) throw new Error(vscode.l10n.t("Search results changed. Search again before replacing."));
    const stat = await Promise.resolve(vscode.workspace.fs.stat(uri)).catch(() => undefined);
    if (stat?.permissions && stat.permissions & vscode.FilePermission.Readonly) throw new Error(vscode.l10n.t("A replacement target is read-only."));
    loaded.push({planned, document, version: document.version});
  }
  const edit = new vscode.WorkspaceEdit();
  for (const {planned, document, version} of loaded) {
    if (document.isClosed || document.version !== version || contentHash(document.getText()) !== planned.file.hash || !stillValid() || !canReplace()) {
      throw new Error(vscode.l10n.t("Search results changed. Search again before replacing."));
    }
    for (const match of planned.matches) edit.replace(document.uri,
      new vscode.Range(document.positionAt(match.start), document.positionAt(match.end)),
      replacementText(planned.before, match, replacement, request.regex, preserveCase));
  }
  if (!await vscode.workspace.applyEdit(edit)) throw new Error(vscode.l10n.t("VS Code could not apply the replacement."));
}
