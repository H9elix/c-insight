import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResultTreeModel, ResultTreeSource } from "../../src/views/resultTreeModel";
import { parseResultTreeMessage } from "../../src/views/resultTreeWebview";

interface Node {
  key: string; initial?: boolean; children?: Node[]; parent?: Node;
  load?: () => Promise<Node[]>;
}

function fixture(initialRoots: Node[]) {
  let roots = initialRoots;
  let loads = 0;
  const pending = new WeakMap<Node, Promise<Node[]>>();
  const source: ResultTreeSource<Node> = {
    roots: () => roots,
    describe: (node) => ({
      key: node.key, label: node.key, expandable: !!(node.children || node.load),
      initiallyExpanded: !!node.initial, navigable: true, actionable: false,
    }),
    children: async (node) => {
      if (!node.children && node.load) {
        let request = pending.get(node);
        if (!request) { loads++; request = node.load(); pending.set(node, request); }
        node.children = await request;
      }
      for (const child of node.children ?? []) child.parent = node;
      return node.children ?? [];
    },
    parent: (node) => node.parent,
  };
  const model = new ResultTreeModel(source);
  return { model, loads: () => loads, replace: (next: Node[]) => { roots = next; } };
}

describe("custom result tree model", () => {
  it("loads only explicitly expanded branches and retains expansion on metadata refresh", async () => {
    const root: Node = { key: "caller", load: async () => [{ key: "child" }] };
    const f = fixture([root]);
    await f.model.refresh();
    assert.equal(f.loads(), 0);
    const id = f.model.snapshot()[0].id;
    await f.model.setExpanded(id, true);
    assert.equal(f.loads(), 1);
    assert.equal(f.model.snapshot().length, 2);
    await f.model.refresh();
    assert.equal(f.model.row(id)?.expanded, true);
    assert.equal(f.loads(), 1);
    await f.model.setExpanded(id, false);
    assert.equal(f.model.snapshot().length, 1);
    await f.model.setExpanded(id, true);
    assert.equal(f.loads(), 1);
  });

  it("does not reopen a branch collapsed while its lazy request is still pending", async () => {
    let finish!: (nodes: Node[]) => void;
    const root: Node = { key: "slow", load: () => new Promise((resolve) => { finish = resolve; }) };
    const f = fixture([root]);
    await f.model.refresh();
    const id = f.model.snapshot()[0].id;
    const expansion = f.model.setExpanded(id, true);
    await f.model.setExpanded(id, false);
    finish([{ key: "late" }]);
    await expansion;
    assert.equal(f.model.row(id)?.expanded, false);
    assert.equal(f.model.snapshot().length, 1);
  });

  it("discards children returned for an obsolete root generation", async () => {
    let finish!: (nodes: Node[]) => void;
    const f = fixture([{ key: "old", load: () => new Promise((resolve) => { finish = resolve; }) }]);
    await f.model.refresh();
    const expansion = f.model.setExpanded(f.model.snapshot()[0].id, true);
    f.replace([{ key: "new" }]);
    await f.model.refresh();
    finish([{ key: "obsolete" }]);
    await expansion;
    assert.deepEqual(f.model.snapshot().map((row) => row.label), ["new"]);
  });

  it("supports reveal, collapse all, and initially expanded References groups", async () => {
    const leaf: Node = { key: "reference" };
    const root: Node = { key: "file", initial: true, children: [leaf] };
    const f = fixture([root]);
    await f.model.refresh();
    assert.equal(f.model.snapshot().length, 2);
    await f.model.collapseAll();
    assert.equal(f.model.snapshot().length, 1);
    const id = await f.model.reveal(leaf);
    assert.equal(f.model.row(id!)?.node, leaf);
    assert.equal(f.model.snapshot().length, 2);
    root.initial = false;
    await f.model.refresh();
    assert.equal(f.model.snapshot().length, 1);
  });

  it("can collapse an uninitialized default-expanded tree without fetching children", async () => {
    const f = fixture([{ key: "file", initial: true, load: async () => [{ key: "reference" }] }]);
    await f.model.collapseAll();
    assert.equal(f.loads(), 0);
    assert.equal(f.model.snapshot()[0].expanded, false);
    await f.model.refresh();
    assert.equal(f.model.snapshot()[0].expanded, false);
  });

  it("distinguishes duplicate labels and renders lazy-load failures without dropping results", async () => {
    const f = fixture([
      { key: "same", load: async () => { throw new Error("unavailable"); } },
      { key: "same" },
    ]);
    await f.model.refresh();
    const [first, second] = f.model.snapshot();
    assert.notEqual(first.id, second.id);
    await f.model.setExpanded(first.id, true);
    assert.match(f.model.row(first.id)?.error ?? "", /unavailable/);
    assert.equal(f.model.snapshot().length, 2);
  });

  it("invalidates in-flight hydration when disposed", async () => {
    let finish!: (nodes: Node[]) => void;
    const f = fixture([{ key: "old", initial: true, load: () => new Promise((resolve) => { finish = resolve; }) }]);
    const hydration = f.model.refresh();
    f.model.dispose();
    finish([{ key: "late" }]);
    await hydration;
    assert.equal(f.model.snapshot().length, 0);
  });
});

describe("custom result tree message boundary", () => {
  it("keeps navigation, expansion, and permitted menu actions distinct", () => {
    assert.deepEqual(parseResultTreeMessage({ type: "activate", id: "a", intent: "open" }),
      { type: "activate", id: "a", intent: "open" });
    assert.deepEqual(parseResultTreeMessage({ type: "expand", id: "a", expanded: false }),
      { type: "expand", id: "a", expanded: false });
    assert.equal(parseResultTreeMessage({ type: "activate", id: "a", intent: "execute" }), undefined);
    assert.equal(parseResultTreeMessage({ type: "expand", id: "a", expanded: "false" }), undefined);
    assert.equal(parseResultTreeMessage({ type: "action", id: "a", command: "x".repeat(128) }), undefined);
    assert.equal(parseResultTreeMessage({ type: "resolve", ids: Array(401).fill("a") }), undefined);
    assert.equal(parseResultTreeMessage({ type: "activate", id: "x".repeat(16_385), intent: "open" }), undefined);
  });
});
