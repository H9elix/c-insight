import * as vscode from "vscode";
import { COMMANDS } from "../ids";
import { COMBINED_SLOTS, combinedLayout } from "../combined/combinedModel";
import { viewCatalog, type ViewCatalogEntry } from "./viewCatalog";

export type ViewRegistrar = typeof vscode.window.registerWebviewViewProvider;
export const VIEW_DISCOVERY_NOTICE_KEY = "viewDiscoveryNoticeShown";
interface ObservedView { id: string; view: vscode.WebviewView; listeners: vscode.Disposable[] }
interface CatalogPick extends vscode.QuickPickItem { entry?: ViewCatalogEntry }

/** Owns view discovery only; no analysis service, query demand or layout positioning. */
export class ViewDiscovery implements vscode.Disposable {
  private readonly observed = new Set<ObservedView>();
  private readonly registered = new Set<string>();
  private commandsReady = false;
  private seenVisibleView = false;
  private attemptedNotice = false;
  private disposed = false;
  private pickerCount = 0;
  private activeEntry?: ViewCatalogEntry;

  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {}

  readonly registerView: ViewRegistrar = (id, provider, options) => {
    this.registered.add(id);
    const registration = vscode.window.registerWebviewViewProvider(id, {
      resolveWebviewView: (view, resolveContext, token) => {
        const observation: ObservedView = {id, view, listeners: []};
        const visible = () => {
          const slot = /^cInsight\.combined([1-4])$/.exec(id)?.[1];
          if (!this.disposed && view.visible && (!slot || combinedLayout(this.slots()[Number(slot) - 1]).enabled)) {
            this.seenVisibleView = true; this.maybeNotify();
          }
        };
        this.observed.add(observation);
        observation.listeners.push(view.onDidChangeVisibility(visible), view.onDidDispose(() => this.remove(observation)));
        visible();
        return provider.resolveWebviewView(view, resolveContext, token);
      },
    }, options);
    return new vscode.Disposable(() => {
      registration.dispose(); this.registered.delete(id);
      for (const item of [...this.observed]) if (item.id === id) this.remove(item);
    });
  };

  ready(): void { this.commandsReady = true; this.maybeNotify(); }

  private maybeNotify(): void {
    if (this.disposed || !this.commandsReady || !this.seenVisibleView || this.attemptedNotice) return;
    this.attemptedNotice = true;
    void this.notify().catch(error => this.log("View discovery notice failed", error));
  }

  private async notify(): Promise<void> {
    try {
      if (this.context.globalState.get<boolean>(VIEW_DISCOVERY_NOTICE_KEY)) return;
      await this.context.globalState.update(VIEW_DISCOVERY_NOTICE_KEY, true);
    } catch (error) { this.log("Could not save view discovery notice state", error); }
    if (this.disposed) return;
    const open = vscode.l10n.t("Open Views…");
    const action = await vscode.window.showInformationMessage(
      vscode.l10n.t("Use C Insight: Open View… to find individual views or create and manage combined views."), open,
    );
    if (!this.disposed && action === open) await vscode.commands.executeCommand(COMMANDS.OPEN_VIEW);
  }

  private slots(): unknown[] {
    const configuration = vscode.workspace.getConfiguration("cInsight.combinedViews");
    return COMBINED_SLOTS.map(slot => configuration.get(`slot${slot}`));
  }

  private entries(): ViewCatalogEntry[] {
    const manifest = this.context.extension.packageJSON as {contributes: {views: Record<string, Array<{id: string; name: unknown}>>}};
    return viewCatalog(Object.values(manifest.contributes.views).flat(), this.slots(), {
      purposes: {
        context: vscode.l10n.t("Current symbol summary and definition/declaration links"),
        preview: vscode.l10n.t("Preview source locations and continue browsing definitions"),
        references: vscode.l10n.t("Find symbol uses with classification, filters and grouping"),
        callers: vscode.l10n.t("Browse incoming calls and their exact source locations"),
        callees: vscode.l10n.t("Browse functions called by the selected function"),
        supertypes: vscode.l10n.t("Browse C++ base types; requires clangd"),
        subtypes: vscode.l10n.t("Browse C++ derived types; requires clangd"),
        includes: vscode.l10n.t("Browse files included by a source or header file"),
        includedBy: vscode.l10n.t("Browse files that include a source or header file"),
        history: vscode.l10n.t("Return to previously browsed code locations"),
        bookmarks: vscode.l10n.t("Save and organize frequently used code locations"),
        workspaceSymbols: vscode.l10n.t("Search symbols across the workspace"),
        symbols: vscode.l10n.t("Browse symbols in the active document"),
        projectFiles: vscode.l10n.t("Search and sort workspace files"),
        status: vscode.l10n.t("Inspect the analysis engine, compilation settings and runtime status"),
        textSearch: vscode.l10n.t("Search text and preview safe replacements across files"),
      },
      combined: slot => vscode.l10n.t("Combined View {number}", {number: slot}),
      create: vscode.l10n.t("Create Combined View…"), manage: vscode.l10n.t("Manage Combined Views…"),
    });
  }

  async open(): Promise<void> {
    const entries = this.entries(), picks: CatalogPick[] = [];
    const separator = (label: string) => picks.push({label, kind: vscode.QuickPickItemKind.Separator});
    separator(vscode.l10n.t("Individual Views"));
    picks.push(...entries.filter(entry => entry.action === "view").map(entry => ({...entry, entry})));
    const combined = entries.filter(entry => entry.action === "combined");
    if (combined.length) { separator(vscode.l10n.t("Existing Combined Views")); picks.push(...combined.map(entry => ({...entry, entry}))); }
    separator(vscode.l10n.t("Combined View Management"));
    picks.push(...entries.filter(entry => entry.action === "create" || entry.action === "manage").map(entry => ({...entry, entry})));
    this.pickerCount++;
    try {
      const selected = await vscode.window.showQuickPick(picks, {
        title: vscode.l10n.t("C Insight: Open View…"),
        placeHolder: vscode.l10n.t("Search by view name or purpose"), matchOnDescription: true, matchOnDetail: true,
        onDidSelectItem: item => { this.activeEntry = (item as CatalogPick).entry; },
      });
      if (!this.disposed && selected?.entry) await this.accept(selected.entry);
    } finally { this.pickerCount--; this.activeEntry = undefined; }
  }

  private async accept(entry: ViewCatalogEntry): Promise<void> {
    if (entry.action === "view") { await vscode.commands.executeCommand(`${entry.viewId}.focus`); return; }
    const slots = this.slots();
    if (entry.action === "combined") {
      if (!entry.slot || !combinedLayout(slots[entry.slot - 1]).enabled) {
        void vscode.window.showInformationMessage(vscode.l10n.t("This combined view is no longer enabled. Open the view list again to choose another view.")); return;
      }
      await vscode.commands.executeCommand(`${entry.viewId}.focus`); return;
    }
    if (entry.action === "create") { await vscode.commands.executeCommand(COMMANDS.COMBINED_VIEWS_CREATE); return; }
    if (slots.some(slot => combinedLayout(slot).enabled)) { await vscode.commands.executeCommand(COMMANDS.COMBINED_VIEWS_MANAGE); return; }
    const create = vscode.l10n.t("Create Combined View…");
    if (await vscode.window.showInformationMessage(vscode.l10n.t("No combined views exist yet. Create one to get started."), create) === create && !this.disposed)
      await vscode.commands.executeCommand(COMMANDS.COMBINED_VIEWS_CREATE);
  }

  private log(message: string, error: unknown): void { this.output.appendLine(`${message}: ${String(error)}`); }
  private remove(item: ObservedView): void { this.observed.delete(item); item.listeners.splice(0).forEach(listener => listener.dispose()); }
  stateForTest() {
    return {registered: [...this.registered], visible: [...this.observed].filter(item => item.view.visible).map(item => item.id),
      ready: this.commandsReady, noticeAttempted: this.attemptedNotice, pickerOpen: this.pickerCount > 0, activeEntry: this.activeEntry};
  }
  dispose(): void { this.disposed = true; for (const item of [...this.observed]) this.remove(item); }
}
