import type * as vscode from "vscode";
import type { TreeNode } from "./treeNode";
import type { WebviewResultTree } from "./resultTreeView";
import { resultTreeFollowAction } from "./resultTreeFollowModel";

interface FollowOptions {
  target(opened?: TreeNode): TreeNode | undefined;
  key(node: TreeNode): string;
  enabled(): boolean;
}
type FollowView = Pick<WebviewResultTree, "visible" | "hasFocus" | "inputRevision" |
  "onDidChangeVisibility" | "onDidChangeInteraction" | "onDidLoseFollowVisibility" | "followTarget" | "setAutomaticFollowBlocked">;
type FollowWindow = Pick<typeof vscode.window, "state" | "onDidChangeWindowState">;

/** Shared lifecycle for persistent search views. No file discovery or semantic queries. */
export class ResultTreeFollowController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private locked = false;
  private interacting = false;
  private opening?: number;
  private pendingOpened?: { node: TreeNode; key: string; inputRevision: number };
  private lastViewFocused = false;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private activationRevision = 0;
  private disposed = false;
  private followActions = 0;
  private lastFollowAction?: { key: string; uri?: string; line?: number;
    clear: "always" | "ifHidden" | "never"; reveal: boolean; inputRevision: number };

  constructor(
    private readonly view: FollowView,
    private readonly options: FollowOptions,
    private readonly window: FollowWindow,
    private readonly delay = 100,
  ) {
    this.disposables.push(
      view.onDidChangeVisibility(({ visible }) => {
        this.cancel();
        if (!visible) {
          this.pendingOpened = undefined; this.opening = undefined;
          this.activationRevision++; this.lastViewFocused = false;
        }
        this.synchronizePolicy();
        if (visible) this.schedule();
      }),
      view.onDidChangeInteraction(({ focused }) => {
        const entered = focused && !this.lastViewFocused;
        this.lastViewFocused = focused;
        this.cancel();
        if (this.opening === undefined && entered) this.pendingOpened = undefined;
        this.schedule();
      }),
      window.onDidChangeWindowState(() => {
        this.cancel(); this.synchronizePolicy(); this.schedule();
      }),
      view.onDidLoseFollowVisibility(({node,inputRevision}) => {
        if (this.timer || this.pendingOpened || this.disposed || this.opening !== undefined ||
          !this.options.enabled() || inputRevision !== this.view.inputRevision) return;
        const target = this.options.target();
        if (!target || this.options.key(target) !== this.options.key(node)) return;
        this.cancel(); const generation = this.generation, key = this.options.key(node);
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.follow(generation, {key,inputRevision}).catch(() => undefined);
        }, this.delay);
      }),
    );
    this.synchronizePolicy();
  }

  get isLocked(): boolean { return this.locked; }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.cancel();
    if (locked) this.pendingOpened = undefined;
    this.synchronizePolicy();
    if (!locked) this.schedule();
  }

  async interact(operation: () => Promise<void>): Promise<void> {
    this.interacting = true;
    this.cancel(); this.synchronizePolicy();
    try { await operation(); }
    finally {
      this.interacting = false;
      this.cancel(); this.synchronizePolicy();
    }
  }

  async activate(node: TreeNode, intent: "preview" | "open", inputRevision: number,
    operation: (current: () => boolean) => Promise<boolean>): Promise<void> {
    if (this.disposed || !this.view.visible) return;
    const revision = ++this.activationRevision;
    const current = () => !this.disposed && revision === this.activationRevision;
    this.cancel(); this.pendingOpened = undefined;
    this.opening = intent === "open" ? revision : undefined;
    this.synchronizePolicy();
    let completed = false;
    try {
      completed = await operation(current);
      if (completed && intent === "open" && !this.locked && current()) {
        this.pendingOpened = { node, key: this.options.key(node), inputRevision };
      }
    } finally {
      if (this.opening === revision) this.opening = undefined;
      if (!completed && current()) this.cancel();
      this.synchronizePolicy();
      if (this.pendingOpened && current()) this.schedule();
    }
  }

  cancel(): void {
    clearTimeout(this.timer); this.timer = undefined;
    this.generation++;
  }

  schedule(): void {
    this.cancel();
    if (this.disposed || !this.view.visible) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.follow(generation).catch(() => undefined);
    }, this.delay);
  }

  stateForTest() {
    return { locked: this.locked, focused: this.view.hasFocus, inputRevision: this.view.inputRevision,
      followActions: this.followActions, lastFollowAction: this.lastFollowAction };
  }

  dispose(): void {
    this.disposed = true; this.activationRevision++;
    this.cancel();
    this.disposables.forEach(item => item.dispose());
  }

  private synchronizePolicy(): void {
    this.view.setAutomaticFollowBlocked(this.locked || !this.view.visible || !this.window.state.focused ||
      this.interacting || this.opening !== undefined);
  }

  private async follow(generation: number, viewport?: {key:string;inputRevision:number}): Promise<void> {
    const node = this.options.target(this.pendingOpened?.node);
    const key = node ? this.options.key(node) : undefined;
    const opened = !!node && this.pendingOpened?.key === key;
    if (viewport && (viewport.key !== key || viewport.inputRevision !== this.view.inputRevision || !this.options.enabled() || opened)) return;
    const decision = resultTreeFollowAction({
      locked: this.locked, visible: this.view.visible, windowFocused: this.window.state.focused,
      viewFocused: this.view.hasFocus, interacting: this.interacting, opening: this.opening !== undefined,
      hasTarget: !!node, followEnabled: this.options.enabled(), opened,
    });
    if (!decision || !node || this.disposed || generation !== this.generation) return;
    const action = { ...decision, ...(viewport ? {clear:"never" as const} : {}),
      inputRevision: viewport ? viewport.inputRevision : opened ? this.pendingOpened!.inputRevision : this.view.inputRevision };
    this.synchronizePolicy();
    const sent = await this.view.followTarget(node, action, () => {
      if (this.disposed || generation !== this.generation || this.locked || !this.view.visible ||
        this.view.hasFocus || !this.window.state.focused) return false;
      if (viewport && (!this.options.enabled() || viewport.inputRevision !== this.view.inputRevision)) return false;
      const current = this.options.target(this.pendingOpened?.node);
      return !!current && this.options.key(current) === key;
    });
    if (sent) {
      this.followActions++;
      this.lastFollowAction = { key: key!, uri: node.location?.uri.toString(), line: node.location?.range.start.line, ...action };
      if (opened) this.pendingOpened = undefined;
    }
  }
}
