import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { COMMANDS, CONTEXT_KEYS } from "../ids";
import { WebviewResultTree } from "../views/resultTreeView";
import { combinedLayout, combinedLayoutRevision, combinedHoverTiming, reorderCombinedPane, COMBINED_ROLES, COMBINED_SLOTS, CombinedLayout, CombinedRole, CombinedSlot, isCombinedRole, matchesPaneCondition } from "./combinedModel";
import { EmbeddedView } from "./embeddedView";
import { embeddedDocument, renderCombinedWebview } from "./combinedWebview";
import { manifestLabel } from "./combinedManifest";

interface ManifestCommand { command: string; title: unknown; icon?: unknown }
interface ManifestMenu { command: string; when?: string; group?: string }
interface Pane { view: EmbeddedView; tree?: WebviewResultTree; generation: number; sentGeneration?: number; acknowledged?: number; collapsed: boolean }
interface Surface { view: vscode.WebviewView; nonce: string; ready: boolean; panes: Map<CombinedRole, Pane>; listeners: vscode.Disposable[]; publishTimer?: NodeJS.Timeout }
interface PaneAction { command: string; title: string; icon?: string; primary: boolean }
interface PresentationFactory {
  create(role: CombinedRole, view: EmbeddedView): WebviewResultTree | undefined;
  prefer(role: CombinedRole, tree: WebviewResultTree | undefined, view: EmbeddedView): void;
  flags(): Readonly<Record<string, boolean>>;
}

/** Native slots own layout only. Existing feature controllers remain the only query/state owners. */
export class CombinedViewManager implements vscode.Disposable {
  private readonly surfaces = new Map<CombinedSlot, Surface>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly commands: ManifestCommand[];
  private readonly menus: ManifestMenu[];
  private readonly names = new Map<CombinedRole, string>();
  private readonly inspections = new Map<number, (value: unknown) => void>();
  private nextInspection = 0;
  private nextDocumentGeneration = 0;
  private iconAssets?: Promise<{css: string; font: string}>;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext, private readonly factory: PresentationFactory) {
    const manifest = context.extension.packageJSON as { contributes: { commands: ManifestCommand[]; menus: Record<string, ManifestMenu[]>; views: Record<string, {id: string; name: unknown}[]> } };
    this.commands = manifest.contributes.commands; this.menus = manifest.contributes.menus["view/title"];
    Object.values(manifest.contributes.views).flat().forEach(view => {
      const role = view.id.replace(/^cInsight\./, "");
      if (isCombinedRole(role)) this.names.set(role, manifestLabel(view.name, role));
    });
    COMBINED_SLOTS.forEach(slot => this.disposables.push(vscode.window.registerWebviewViewProvider(`cInsight.combined${slot}`, {
      resolveWebviewView: (view, _context, token) => this.resolve(slot, view, token),
    }, { webviewOptions: { retainContextWhenHidden: true } })));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration("cInsight.combinedViews")) return;
      void this.synchronizeAvailability();
      this.surfaces.forEach((surface, slot) => this.reconcile(slot, surface));
    }));
    void this.synchronizeAvailability();
  }

  private async synchronizeAvailability(): Promise<void> {
    const keys = [CONTEXT_KEYS.COMBINED_1_ENABLED, CONTEXT_KEYS.COMBINED_2_ENABLED,
      CONTEXT_KEYS.COMBINED_3_ENABLED, CONTEXT_KEYS.COMBINED_4_ENABLED];
    await Promise.all(COMBINED_SLOTS.map((slot,index) => vscode.commands.executeCommand("setContext", keys[index], this.layout(slot).enabled)));
    await vscode.commands.executeCommand("setContext", CONTEXT_KEYS.COMBINED_READY, true);
  }

  private layout(slot: CombinedSlot): CombinedLayout {
    return combinedLayout(vscode.workspace.getConfiguration("cInsight.combinedViews").get(`slot${slot}`));
  }
  private title(slot: CombinedSlot): string { return this.layout(slot).title || vscode.l10n.t("Combined View {number}", {number: slot}); }
  private async save(slot: CombinedSlot, value: CombinedLayout): Promise<void> {
    await vscode.workspace.getConfiguration("cInsight.combinedViews").update(`slot${slot}`, combinedLayout(value), vscode.ConfigurationTarget.Global);
  }
  async create(): Promise<void> {
    const slot = COMBINED_SLOTS.find(slot => !this.layout(slot).enabled);
    if (!slot) { void vscode.window.showInformationMessage(vscode.l10n.t("All four combined views are in use. Manage an existing view to change its panes.")); return; }
    await this.save(slot, {...combinedLayout(undefined), enabled: true});
    await this.synchronizeAvailability();
    await vscode.commands.executeCommand(`cInsight.combined${slot}.focus`);
    await this.perform(slot, "add");
  }
  async manage(argument?: unknown): Promise<void> {
    const id = argument && typeof argument === "object" ? (argument as {viewId?: unknown}).viewId : undefined;
    const match = typeof id === "string" ? /^cInsight\.combined([1-4])$/.exec(id) : undefined;
    const slot = match ? Number(match[1]) as CombinedSlot : (await vscode.window.showQuickPick(
      COMBINED_SLOTS.filter(slot => this.layout(slot).enabled).map(slot => ({label: this.title(slot), slot})),
      {title: vscode.l10n.t("Manage Combined View")},
    ))?.slot;
    if (slot) await this.interact(slot, () => this.perform(slot, "menu"));
  }
  refreshActions(): void { this.surfaces.forEach((surface, slot) => this.publish(slot, surface)); }

  private async resolve(slot: CombinedSlot, view: vscode.WebviewView, token: vscode.CancellationToken): Promise<void> {
    const assets = vscode.Uri.joinPath(this.context.extensionUri, "dist", "codicons");
    this.iconAssets ??= Promise.all([vscode.workspace.fs.readFile(vscode.Uri.joinPath(assets,"codicon.css")),
      vscode.workspace.fs.readFile(vscode.Uri.joinPath(assets,"codicon.ttf"))]).then(([css,font])=>({css:Buffer.from(css).toString("utf8"),font:Buffer.from(font).toString("base64")}));
    const icons = await this.iconAssets;
    if (this.disposed || token.isCancellationRequested) return;
    this.disposeSurface(slot);
    view.webview.options = { enableScripts: true, localResourceRoots: [assets] };
    const surface: Surface = {view, nonce: randomBytes(16).toString("hex"), ready: false, panes: new Map(), listeners: []};
    this.surfaces.set(slot, surface);
    view.webview.html = renderCombinedWebview(surface.nonce, view.webview.cspSource,
      view.webview.asWebviewUri(vscode.Uri.joinPath(assets, "codicon.css")).toString(), {
        empty: vscode.l10n.t("Add panes to build your browsing layout."), add: vscode.l10n.t("Add Panes"),
        direction: vscode.l10n.t("Switch Horizontal / Vertical"), hover: vscode.l10n.t("Toggle Hover Expansion"),
        manage: vscode.l10n.t("Manage Combined View"), collapse: vscode.l10n.t("Collapse / Expand Pane"),
        actions: vscode.l10n.t("Pane Actions and Layout"), splitter: vscode.l10n.t("Resize neighboring panes"),
        reorder: vscode.l10n.t("Drag to reorder pane"),
        hoverDirection: vscode.l10n.t("Expansion Direction"), both: vscode.l10n.t("Both Directions"),
        forwardRight: vscode.l10n.t("Expand Right"), forwardDown: vscode.l10n.t("Expand Down"),
        switchHoverDirection: vscode.l10n.t("Switch expansion direction"),
      }, this.context.extensionMode === vscode.ExtensionMode.Test, icons);
    surface.listeners.push(
      view.webview.onDidReceiveMessage((message: unknown) => {
        void this.receive(slot, surface, message).catch(error => void vscode.window.showErrorMessage(`C Insight: ${String(error)}`));
      }),
      view.onDidChangeVisibility(() => {
        if (!view.visible) void view.webview.postMessage({type: "cancelInteractions"});
        surface.panes.forEach(pane => pane.view.setVisible(view.visible && !pane.collapsed && this.layout(slot).enabled));
        if (view.visible) this.reconcile(slot, surface);
      }),
      view.onDidDispose(() => this.disposeSurface(slot)),
    );
    this.reconcile(slot, surface);
  }

  private reconcile(slot: CombinedSlot, surface: Surface): void {
    const layout = this.layout(slot);
    if (layout.enabled && surface.view.title !== this.title(slot)) surface.view.title = this.title(slot);
    const roles = layout.enabled ? layout.views : [];
    for (const [role, pane] of surface.panes) if (!roles.includes(role)) { pane.view.dispose(); surface.panes.delete(role); }
    for (const role of roles) if (surface.view.visible && !surface.panes.has(role)) {
      const view = new EmbeddedView(`cInsight.${role}`, surface.view, this.names.get(role) ?? role, () => {
        pane.generation = ++this.nextDocumentGeneration; pane.acknowledged = undefined;
        if (!surface.publishTimer) surface.publishTimer = setTimeout(() => { surface.publishTimer = undefined; this.publish(slot, surface); }, 0);
      }, message => surface.ready ? surface.view.webview.postMessage({type: "panePost", role, generation: pane.generation, message}) : Promise.resolve(false));
      const pane: Pane = {view, generation: ++this.nextDocumentGeneration, collapsed: false}; surface.panes.set(role, pane);
      view.setVisible(surface.view.visible);
      pane.tree = this.factory.create(role, view);
    }
    this.publish(slot, surface);
  }

  private actions(role: CombinedRole): PaneAction[] {
    const flags = this.factory.flags(), id = `cInsight.${role}`;
    const result: PaneAction[] = [];
    for (const menu of this.menus) {
      if (!matchesPaneCondition(menu.when ?? "", id, flags)) continue;
      const command = this.commands.find(command => command.command === menu.command);
      if (command && !result.some(action => action.command === command.command)) result.push({command: command.command,
        title: manifestLabel(command.title, command.command).replace(/^C Insight[:：]\s*/u, ""),
        icon: typeof command.icon === "string" ? command.icon.match(/^\$\(([^)]+)\)$/)?.[1] : undefined,
        primary: !!menu.group?.startsWith("navigation")});
    }
    return result;
  }
  private publish(slot: CombinedSlot, surface: Surface): void {
    if (!surface.ready || !surface.view.visible || !this.layout(slot).enabled || this.surfaces.get(slot) !== surface) return;
    const config = vscode.workspace.getConfiguration("cInsight.combinedViews");
    void surface.view.webview.postMessage({type: "layout", layout: this.layout(slot), title: this.title(slot),
      hover: config.get("hoverExpand", true),
      hoverTiming: combinedHoverTiming({enterDelay: config.get("hoverEnterDelay"), animationDuration: config.get("hoverAnimationDuration"), leaveDelay: config.get("hoverLeaveDelay")}),
      panes: [...surface.panes].map(([role, pane]) => {
        const html = pane.sentGeneration === pane.generation ? undefined : embeddedDocument(pane.view.webview.html, surface.nonce, pane.generation);
        pane.sentGeneration = pane.generation;
        return {role, title: this.names.get(role) ?? role, generation: pane.generation, html, actions: this.actions(role)};
      }),
    });
  }
  private async receive(slot: CombinedSlot, surface: Surface, value: unknown): Promise<void> {
    if (this.surfaces.get(slot) !== surface || !value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (message.type === "inspection" && typeof message.request === "number" && this.context.extensionMode === vscode.ExtensionMode.Test) {
      this.inspections.get(message.request)?.(message); return;
    }
    if (message.type === "ready") {
      surface.ready = true;
      const states = message.states && typeof message.states === "object" ? message.states as Record<string, {collapsed?: boolean}> : {};
      surface.panes.forEach((pane, role) => { pane.sentGeneration = undefined; pane.collapsed = states[role]?.collapsed === true; pane.view.setVisible(surface.view.visible && !pane.collapsed); });
      this.publish(slot, surface); return;
    }
    if (message.type === "manage" && ["add", "direction", "hover", "toggleHoverDirection", "menu"].includes(String(message.action))) {
      await this.interact(slot, () => this.perform(slot, String(message.action))); return;
    }
    if (message.type === "ratios" && Array.isArray(message.ratios)) {
      const layout = this.layout(slot), ratios = message.ratios;
      if (ratios.length !== layout.views.length || !ratios.every(value => typeof value === "number" && Number.isFinite(value) && value > 0)) return;
      const max = Math.max(...ratios as number[]);
      await this.save(slot, {...layout, ratios: (ratios as number[]).map(value => value / max)}); return;
    }
    if (message.type === "reorder" && Number.isSafeInteger(message.request) && (message.request as number) > 0) {
      let success = false;
      try {
        const layout = this.layout(slot);
        if (surface.view.visible && layout.enabled && message.revision === combinedLayoutRevision(layout) &&
          isCombinedRole(message.role) && layout.views.includes(message.role) && isCombinedRole(message.target) && layout.views.includes(message.target) &&
          (message.side === "before" || message.side === "after")) {
          const reordered = reorderCombinedPane(layout, message.role, message.target, message.side);
          if (reordered !== layout) await this.save(slot, reordered);
          success = true;
        }
      } finally {
        // Always resynchronize, including stale requests and failed settings writes.
        this.publish(slot, surface);
        await surface.view.webview.postMessage({type: "reorderResult", request: message.request, success});
      }
      return;
    }
    if (!isCombinedRole(message.role)) return;
    const role = message.role, pane = surface.panes.get(role);
    if (!pane) return;
    if (message.type === "collapse" && typeof message.collapsed === "boolean") {
      pane.collapsed = message.collapsed; pane.view.setVisible(surface.view.visible && !pane.collapsed); return;
    }
    if (message.type === "frameReady" && message.generation === pane.generation) { pane.acknowledged = pane.generation; return; }
    if (message.type === "focus" || message.type === "action" || message.type === "paneMenu") this.factory.prefer(role, pane.tree, pane.view);
    if (message.type === "paneMessage" && message.generation === pane.generation && pane.view.visible) {
      pane.view.webview.receiveMessage(message.message);
    } else if (message.type === "paneMenu") {
      await this.interact(slot, async () => {
        const entries = this.actions(role).map(action => ({label: action.title, command: action.command, layoutAction: ""}));
        entries.push({label: vscode.l10n.t("Move Pane Earlier"), command: "", layoutAction: "earlier"},
          {label: vscode.l10n.t("Move Pane Later"), command: "", layoutAction: "later"},
          {label: vscode.l10n.t("Remove Pane"), command: "", layoutAction: "remove"});
        const selected = await vscode.window.showQuickPick(entries, {title: this.names.get(role)});
        if (selected?.command) await this.runAction(role, selected.command);
        else if (selected?.layoutAction) {
          const layout = this.layout(slot), index = layout.views.indexOf(role);
          if (index < 0) return;
          if (selected.layoutAction === "remove") { layout.views.splice(index, 1); layout.ratios.splice(index, 1); }
          else {
            const target = index + (selected.layoutAction === "earlier" ? -1 : 1);
            if (target < 0 || target >= layout.views.length) return;
            [layout.views[index], layout.views[target]] = [layout.views[target], layout.views[index]];
            [layout.ratios[index], layout.ratios[target]] = [layout.ratios[target], layout.ratios[index]];
          }
          await this.save(slot, layout);
        }
      });
    } else if (message.type === "action" && typeof message.command === "string") await this.interact(slot, () => this.runAction(role, message.command as string));
  }
  private async runAction(role: CombinedRole, command: string): Promise<void> {
    if (this.actions(role).some(action => action.command === command)) await vscode.commands.executeCommand(command);
    this.refreshActions();
  }
  private async interact(slot: CombinedSlot, operation: () => Promise<void>): Promise<void> {
    const surface = this.surfaces.get(slot);
    await surface?.view.webview.postMessage({type: "suspend", value: true});
    try { await operation(); } finally {
      if (surface && this.surfaces.get(slot) === surface) await surface.view.webview.postMessage({type: "suspend", value: false});
    }
  }
  private async perform(slot: CombinedSlot, action: string): Promise<void> {
    const layout = this.layout(slot);
    if (action === "menu") {
      const selected = await vscode.window.showQuickPick([
        {label: vscode.l10n.t("Add Panes"), action: "add"}, {label: vscode.l10n.t("Rename Combined View"), action: "rename"},
        {label: vscode.l10n.t("Switch Horizontal / Vertical"), action: "direction"},
        {label: vscode.l10n.t("Expansion Direction"), action: "hoverDirection"},
        {label: vscode.l10n.t("Reset Equal Pane Sizes"), action: "equal"}, {label: vscode.l10n.t("Toggle Hover Expansion"), action: "hover"},
        {label: vscode.l10n.t("Delete Combined View"), action: "delete"},
      ], {title: this.title(slot)});
      if (selected) await this.perform(slot, selected.action);
      return;
    }
    if (action === "hover") {
      const config = vscode.workspace.getConfiguration("cInsight.combinedViews");
      await config.update("hoverExpand", !config.get("hoverExpand", true), vscode.ConfigurationTarget.Global); return;
    }
    if (action === "add") {
      const selected = await vscode.window.showQuickPick(COMBINED_ROLES.filter(role => !layout.views.includes(role)).map(role => ({label: this.names.get(role) ?? role, role})),
        {title: vscode.l10n.t("Add Panes"), canPickMany: true});
      if (!selected?.length) return;
      layout.views.push(...selected.map(item => item.role)); layout.ratios.push(...selected.map(() => 1));
    } else if (action === "rename") {
      const name = await vscode.window.showInputBox({title: vscode.l10n.t("Rename Combined View"), value: this.title(slot),
        validateInput: value => value.trim().length > 80 ? vscode.l10n.t("Use at most 80 characters.") : undefined});
      if (name === undefined) return; layout.title = name;
    } else if (action === "toggleHoverDirection") layout.hoverDirection = layout.hoverDirection === "forward" ? "both" : "forward";
    else if (action === "hoverDirection") {
      const selected = await vscode.window.showQuickPick([
        {label: layout.direction === "vertical" ? vscode.l10n.t("Expand Down") : vscode.l10n.t("Expand Right"), value: "forward" as const, picked: layout.hoverDirection === "forward"},
        {label: vscode.l10n.t("Both Directions"), value: "both" as const, picked: layout.hoverDirection === "both"},
      ], {title: vscode.l10n.t("Expansion Direction")});
      if (!selected) return; layout.hoverDirection = selected.value;
    } else if (action === "direction") layout.direction = layout.direction === "horizontal" ? "vertical" : "horizontal";
    else if (action === "equal") layout.ratios = layout.views.map(() => 1);
    else if (action === "delete") {
      const remove = vscode.l10n.t("Delete Combined View");
      if (await vscode.window.showWarningMessage(vscode.l10n.t("Delete {name}?", {name: this.title(slot)}), {modal: true}, remove) !== remove) return;
      await this.save(slot, combinedLayout(undefined)); return;
    } else return;
    await this.save(slot, layout);
  }
  stateForTest() { return [...this.surfaces].map(([slot, surface]) => ({slot, ready: surface.ready, visible: surface.view.visible,
    panes: [...surface.panes].map(([role, pane]) => ({role, visible: pane.view.visible, generation: pane.generation, acknowledged: pane.acknowledged}))})); }
  async interactionForTest(slot: CombinedSlot, role: CombinedRole, message?: unknown): Promise<unknown> {
    const pane = this.surfaces.get(slot)?.panes.get(role);
    return pane?.tree?.interactionForTest(message);
  }
  async browserForTest(slot: CombinedSlot, action?: unknown): Promise<unknown> {
    if (this.context.extensionMode !== vscode.ExtensionMode.Test) return undefined;
    const surface = this.surfaces.get(slot); if (!surface) return undefined;
    if (action && typeof action === "object") await surface.view.webview.postMessage({...action, type: "testInteraction"});
    const request = ++this.nextInspection;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.inspections.delete(request); reject(new Error("Combined browser inspection timed out")); }, 5000);
      this.inspections.set(request, value => { clearTimeout(timer); this.inspections.delete(request); resolve(value); });
      void surface.view.webview.postMessage({type: "inspect", request});
    });
  }
  private disposeSurface(slot: CombinedSlot): void {
    const surface = this.surfaces.get(slot); if (!surface) return;
    this.surfaces.delete(slot); clearTimeout(surface.publishTimer);
    surface.listeners.forEach(item => item.dispose()); surface.panes.forEach(pane => pane.view.dispose());
  }
  dispose(): void { this.disposed = true; COMBINED_SLOTS.forEach(slot => this.disposeSurface(slot)); this.disposables.forEach(item => item.dispose()); }
}

export function registerCombinedCommands(register: (id: typeof COMMANDS.COMBINED_VIEWS_CREATE | typeof COMMANDS.COMBINED_VIEWS_MANAGE, callback: (...args: unknown[]) => unknown) => void,
  manager: CombinedViewManager): void {
  register(COMMANDS.COMBINED_VIEWS_CREATE, () => manager.create());
  register(COMMANDS.COMBINED_VIEWS_MANAGE, argument => manager.manage(argument));
}
