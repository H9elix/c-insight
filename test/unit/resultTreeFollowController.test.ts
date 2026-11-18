import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as vscode from "vscode";
import type { TreeNode } from "../../src/views/treeNode";
import { ResultTreeFollowController } from "../../src/views/resultTreeFollowController";

function emitter<T>() {
  const listeners = new Set<(event: T) => unknown>();
  const event: vscode.Event<T> = listener => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; };
  return { event, fire: (value: T) => { for (const listener of listeners) listener(value); } };
}
function fixture() {
  const interaction = emitter<{ focused: boolean; inputRevision: number }>();
  const visibility = emitter<{ visible: boolean }>();
  const windowState = emitter<vscode.WindowState>();
  let target: TreeNode = { id: "a", label: "a" }, enabled = true, blocked = true;
  let holdFollow: Promise<void> | undefined;
  const calls: Array<{ key: string; clear: string; reveal: boolean; inputRevision: number }> = [];
  const view = {
    visible: true, hasFocus: false, inputRevision: 0,
    onDidChangeVisibility: visibility.event, onDidChangeInteraction: interaction.event,
    setAutomaticFollowBlocked: (value: boolean) => { blocked = value; },
    followTarget: async (node: TreeNode, action: { clear: "always" | "ifHidden"; reveal: boolean; inputRevision: number }, current: () => boolean) => {
      await holdFollow;
      if (blocked || !current()) return false;
      calls.push({ key: node.id!, ...action }); return true;
    },
  };
  const window = { state: { focused: true, active: true }, onDidChangeWindowState: windowState.event };
  const controller = new ResultTreeFollowController(view, {
    target: () => target, key: node => node.id!, enabled: () => enabled,
  }, window, 1);
  return { controller, view, calls,
    node: (key: string) => ({ id: key, label: key }),
    setTarget: (key: string) => { target = { id: key, label: key }; },
    setEnabled: (value: boolean) => { enabled = value; },
    hold: (value: Promise<void>) => { holdFollow = value; },
    focus: (value: boolean) => { view.hasFocus = value; interaction.fire({ focused: value, inputRevision: view.inputRevision }); },
    visible: (value: boolean) => { view.visible = value; visibility.fire({ visible: value }); },
    windowFocused: (value: boolean) => { window.state.focused = value; windowState.fire(window.state); },
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe("persistent result-tree follow lifecycle", () => {
  it("shares focus, independent lock, window and visibility gates without querying data", async t => {
    const f = fixture(); t.after(() => f.controller.dispose());
    f.controller.schedule(); await settle();
    assert.equal(f.calls.at(-1)?.clear, "ifHidden");
    f.focus(true); f.setTarget("b"); f.controller.schedule(); await settle();
    assert.equal(f.calls.length, 1);
    f.focus(false); await settle(); assert.equal(f.calls.at(-1)?.key, "b");
    f.controller.setLocked(true); f.setTarget("c"); f.controller.schedule(); await settle();
    assert.equal(f.calls.length, 2);
    f.controller.setLocked(false); await settle(); assert.equal(f.calls.at(-1)?.key, "c");
    f.windowFocused(false); f.controller.schedule(); await settle(); assert.equal(f.calls.length, 3);
    f.windowFocused(true); await settle(); assert.equal(f.calls.length, 4);
    f.visible(false); f.controller.schedule(); await settle(); assert.equal(f.calls.length, 4);
  });

  it("clears successful unchanged-target opens even when automatic reveal is disabled", async t => {
    const f = fixture(); t.after(() => f.controller.dispose()); f.setEnabled(false);
    for (let repeat = 0; repeat < 2; repeat++) {
      f.focus(true); f.view.inputRevision = repeat + 3;
      await f.controller.activate(f.node("a"), "open", f.view.inputRevision, async () => { f.focus(false); return true; });
      await settle();
      assert.deepEqual(f.calls.at(-1), { key: "a", clear: "always", reveal: false, inputRevision: repeat + 3 });
    }
    assert.equal(f.calls.length, 2);
  });

  it("preserves a locked query after explicit navigation and keeps preview activation non-clearing", async t => {
    const f = fixture(); t.after(() => f.controller.dispose());
    f.controller.setLocked(true);
    await f.controller.activate(f.node("a"), "open", 0, async () => true); await settle();
    assert.equal(f.calls.length, 0);
    f.focus(true); f.controller.setLocked(false);
    await f.controller.activate(f.node("a"), "preview", 0, async () => true); await settle();
    assert.equal(f.calls.length, 0);
    f.focus(false); await settle(); assert.equal(f.calls.at(-1)?.clear, "ifHidden");
  });

  it("does not dispatch clear or fallback follow after failed editor opens", async t => {
    const f = fixture(); t.after(() => f.controller.dispose());
    f.focus(true);
    await assert.rejects(f.controller.activate(f.node("a"), "open", 0, async () => {
      f.focus(false); throw new Error("synthetic open failure");
    }));
    await settle(); assert.equal(f.calls.length, 0);
    await f.controller.activate(f.node("a"), "open", 0, async () => false);
    await settle(); assert.equal(f.calls.length, 0);
  });

  it("lets newer open/preview activations revoke old in-flight open ownership", async t => {
    const f = fixture(); t.after(() => f.controller.dispose());
    for (const intent of ["open", "preview"] as const) {
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const old = f.controller.activate(f.node("a"), "open", 0, async current => { await held; return current(); });
      f.setTarget("b");
      const count = f.calls.length;
      await f.controller.activate(f.node("b"), intent, 7, async () => true);
      release(); await old; await settle();
      const calls = f.calls.slice(count);
      assert.equal(calls.length, intent === "open" ? 1 : 0);
      if (calls.length) assert.equal(calls[0].key, "b");
    }
  });

  it("passes the original input revision so browser-side guards can reject a late clear", async t => {
    const f = fixture(); t.after(() => f.controller.dispose());
    await f.controller.activate(f.node("a"), "open", 4, async () => { f.view.inputRevision = 9; return true; });
    await settle(); assert.equal(f.calls.at(-1)?.inputRevision, 4);
  });

  it("blocks queued follows while a sort picker is open and after disposal", async t => {
    const f = fixture(); t.after(() => f.controller.dispose());
    await f.controller.interact(async () => { f.controller.schedule(); await settle(); assert.equal(f.calls.length, 0); });
    await settle(); assert.equal(f.calls.length, 0);
    let release!: () => void;
    f.hold(new Promise<void>(resolve => { release = resolve; }));
    f.controller.schedule(); await settle(); f.controller.dispose(); release(); await settle();
    assert.equal(f.calls.length, 0);
  });

  it("revokes in-flight opens on hide and ignores stale activations while hidden", async t => {
    const f = fixture(); t.after(() => f.controller.dispose());
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const open = f.controller.activate(f.node("a"), "open", 0, async current => { await held; return current(); });
    f.visible(false); release(); await open;
    let executed = false;
    await f.controller.activate(f.node("a"), "preview", 0, async () => { executed = true; return true; });
    await settle(); assert.equal(executed, false); assert.equal(f.calls.length, 0);
  });
});
