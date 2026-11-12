import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResultTreeModel, ResultTreeSource } from "../../src/views/resultTreeModel";
import { parseResultTreeMessage } from "../../src/views/resultTreeWebview";

interface Node {
  key: string; label?: string; initial?: boolean; children?: Node[]; parent?: Node;
  load?: () => Promise<Node[]>;
}

function fixture(initialRoots: Node[], filterLoadedChildren = false) {
  let roots = initialRoots;
  let loads = 0;
  const pending = new WeakMap<Node, Promise<Node[]>>();
  const source: ResultTreeSource<Node> = {
    roots: () => roots,
    describe: (node) => ({
      key: node.key, label: node.label ?? node.key, expandable: !!(node.children || node.load),
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
    loadedChildren: filterLoadedChildren ? node => node.children ?? [] : undefined,
  };
  const model = new ResultTreeModel(source);
  return { model, loads: () => loads, replace: (next: Node[]) => { roots = next; } };
}

describe("custom result tree model", () => {
  it("indexes collapsed materialized symbols without loading lazy children or changing expansion", async () => {
    const member: Node = { key: "read_frame" };
    const group: Node = { key: "Codec", children: [member] }; member.parent = group;
    const lazy: Node = { key: "unqueried", load: async () => { throw new Error("Must not load"); } };
    const f = fixture([group, lazy], true);
    await f.model.refresh();
    assert.deepEqual(f.model.snapshot().map(row => row.label), ["Codec", "unqueried"]);
    assert.deepEqual(f.model.filterSnapshot()?.map(row => row.label), ["Codec", "read_frame", "unqueried"]);
    assert.equal(f.loads(), 0);
    const hidden = f.model.filterSnapshot()!.find(row => row.node === member)!;
    assert.equal(f.model.row(hidden.id)?.node, member, "Filtered descendants must remain valid activation targets");
    member.label = "read_frame (highlighted)";
    assert.equal(f.model.updateDescription(member)?.id, hidden.id);
    assert.equal(f.model.filterSnapshot()!.find(row => row.id === hidden.id)?.label, member.label);
    await f.model.setExpanded(f.model.snapshot()[0].id, true);
    assert.equal(f.model.snapshot().find(row => row.node === member)?.id, hidden.id);
    await f.model.collapseAll();
    assert.equal(f.model.snapshot().length, 2);
    assert.equal(f.model.filterSnapshot()?.length, 3);
    assert.equal(f.loads(), 0);
  });

  it("keeps duplicate search identities distinct and drops obsolete materialized rows", async () => {
    const root: Node = { key: "Codec", children: [{ key: "same" }, { key: "same" }] };
    const f = fixture([root], true); await f.model.refresh();
    const [parent, first, second] = f.model.filterSnapshot()!;
    assert.equal(first.parent, parent.id); assert.notEqual(first.id, second.id);
    f.replace([{ key: "next-file" }]); await f.model.refresh();
    assert.equal(f.model.row(first.id), undefined);
    assert.deepEqual(f.model.filterSnapshot()?.map(row => row.label), ["next-file"]);
    f.model.dispose(); assert.equal(f.model.filterSnapshot(), undefined);
  });

  it("does not enable whole-tree indexing for ordinary lazy result views and bounds materialized cycles", async () => {
    const root: Node = { key: "root" }; root.children = [root];
    const ordinary = fixture([root]); await ordinary.model.refresh();
    assert.equal(ordinary.model.filterSnapshot(), undefined);
    const searchable = fixture([root], true); await searchable.model.refresh();
    assert.equal(searchable.model.filterSnapshot()?.length, 1);
  });

  it("updates presentation without loading branches or changing row identities", async () => {
    const root: Node = { key: "file", load: async () => [{ key: "child" }] };
    const f = fixture([root]);
    await f.model.refresh();
    const original = f.model.snapshot()[0];
    const patched = f.model.updateDescription(root);
    assert.equal(patched?.id, original.id);
    assert.equal(f.model.row(original.id)?.node, root);
    assert.equal(f.loads(), 0);
    assert.equal(f.model.updateDescription({ key: "absent" }), undefined);
  });
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
