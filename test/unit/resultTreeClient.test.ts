import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { resultTreeClientScript } from "../../src/views/resultTreeWebview";

/** A small event/DOM harness; executes the shipped browser handlers, not copied logic. */
class Element {
  children: Element[] = [];
  parent?: Element;
  className = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners = new Map<string, (event: any) => void>();
  textContent = "";
  value = "";
  hidden = false;
  scrollTop = 0;
  clientHeight = 240;
  offsetWidth = 160;
  offsetHeight = 40;
  id = "";
  focused = false;
  constructor(readonly tag = "div") {}
  classList = {
    toggle: (name: string, enabled: boolean): void => {
      const names = new Set(this.className.split(" "));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(" ");
    },
  };
  addEventListener(name: string, callback: (event: any) => void): void { this.listeners.set(name, callback); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  removeAttribute(name: string): void { delete this.attributes[name]; }
  append(...nodes: Element[]): void {
    for (const node of nodes) {
      if (node.tag === "fragment") this.append(...node.children);
      else { node.parent = this; this.children.push(node); }
    }
  }
  replaceChildren(...nodes: Element[]): void { this.children = []; this.append(...nodes); }
  closest(selector: string): Element | undefined {
    const matches = selector.startsWith(".") ? this.className.split(" ").includes(selector.slice(1)) : this.tag === selector;
    return matches ? this : this.parent?.closest(selector);
  }
  contains(other: Element): boolean { return other === this || this.children.some((child) => child.contains(other)); }
  focus(): void { this.focused = true; }
  get firstElementChild(): Element | undefined { return this.children[0]; }
}

function harness(persistentFilter = false) {
  const elements = new Map(["tree", "canvas", "filter", "menu", "collapse", "filter-toggle", "toolbar", "filter-clear", "empty", "status"]
    .map((id) => [id, new Element()]));
  elements.get("toolbar")!.dataset.persistentFilter = String(persistentFilter);
  const messages: any[] = [];
  const windowListeners = new Map<string, (event: any) => void>();
  let now = 1_000;
  runInNewContext(resultTreeClientScript, {
    Element, Date: { now: () => now },
    acquireVsCodeApi: () => ({ postMessage: (value: unknown) => messages.push(value), getState: () => ({}), setState: () => undefined }),
    document: {
      getElementById: (id: string) => elements.get(id),
      createElement: (tag: string) => new Element(tag),
      createDocumentFragment: () => new Element("fragment"),
      createTextNode: (text: string) => Object.assign(new Element("text"), { textContent: text }),
      addEventListener: () => undefined,
    },
    window: { addEventListener: (name: string, listener: (event: any) => void) => windowListeners.set(name, listener), innerWidth: 600, innerHeight: 400 },
    requestAnimationFrame: (callback: () => void) => callback(),
    ResizeObserver: class { observe(): void {} },
  });
  const receive = (data: unknown): void => { windowListeners.get("message")!({ data }); };
  const state = (expanded = false, count = 1): void => {
    receive({ type: "state", doubleClickInterval: 500,
      rows: Array.from({ length: count }, (_, index) => ({
        id: `node-${index}`, label: `function_${index}`, description: "source.c:12",
        depth: 0, expanded, expandable: true, navigable: true,
        position: index + 1, siblings: count, icon: "symbol-function", actions: [],
      })),
    });
  };
  const dispatch = (type: string, target: Element, extra = {}): void => {
    elements.get("tree")!.listeners.get(type)!({
      target, detail: 1, preventDefault: () => undefined, stopPropagation: () => undefined, ...extra,
    });
  };
  return { elements, messages, state, dispatch, receive, advance: (ms: number) => { now += ms; } };
}

describe("custom result tree browser interaction", () => {
  for (const expanded of [false, true]) {
    it(`opens on a second name click without ${expanded ? "collapsing" : "expanding"} the branch`, () => {
      const h = harness(); h.state(expanded);
      const row = h.elements.get("canvas")!.children[0];
      const label = row.children[2];
      h.dispatch("click", label);
      h.advance(100);
      h.dispatch("click", label, { detail: 2 });
      h.dispatch("dblclick", label, { detail: 2 });
      assert.deepEqual(h.messages.filter((message) => message.type === "activate").map((message) => message.intent), ["preview", "open"]);
      assert.equal(h.messages.some((message) => message.type === "expand"), false);
      assert.equal(row.attributes["aria-expanded"], String(expanded));
    });
  }

  it("uses the arrow only for expansion and does not navigate even on double click", () => {
    const h = harness(); h.state();
    const arrow = h.elements.get("canvas")!.children[0].children[0];
    h.dispatch("click", arrow);
    h.dispatch("click", arrow, { detail: 2 });
    h.dispatch("dblclick", arrow, { detail: 2 });
    const actions = h.messages.filter((message) => message.type !== "ready");
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "expand");
    assert.equal(actions[0].expanded, true);
  });

  it("keeps Enter navigation separate from right/left keyboard expansion", () => {
    const h = harness(); h.state();
    const label = h.elements.get("canvas")!.children[0].children[2];
    h.dispatch("click", label);
    h.dispatch("keydown", h.elements.get("tree")!, { key: "Enter" });
    assert.equal(h.messages.at(-1).type, "activate");
    assert.equal(h.messages.at(-1).intent, "open");
    h.dispatch("keydown", h.elements.get("tree")!, { key: "ArrowRight" });
    assert.equal(h.messages.at(-1).type, "expand");
  });

  it("keeps repeated slow clicks as previews and virtualizes a large result list", () => {
    const h = harness(); h.state(false, 10_000);
    const canvas = h.elements.get("canvas")!;
    assert.ok(canvas.children.length < 50);
    assert.equal(canvas.style.height, "240000px");
    const label = canvas.children[0].children[2];
    h.dispatch("click", label); h.advance(600); h.dispatch("click", label);
    assert.equal(h.messages.some((message) => message.intent === "open"), false);
  });

  it("filters every loaded file by cached name/path, exposes clear, and does not request navigation", () => {
    const h = harness(true); h.state(false, 10000);
    const filter = h.elements.get("filter")!;
    const change = () => filter.listeners.get("input")!({});
    filter.value = "FUNCTION_9999"; change();
    assert.equal(h.elements.get("canvas")!.children.length, 1);
    assert.equal(h.elements.get("filter-clear")!.hidden, false);
    filter.value = "missing.c"; change();
    assert.equal(h.elements.get("empty")!.hidden, false);
    assert.equal(h.elements.get("canvas")!.children.length, 0);
    h.elements.get("filter-clear")!.listeners.get("click")!({});
    assert.equal(filter.value, "");
    assert.equal(filter.focused, true);
    assert.equal(h.elements.get("filter-clear")!.hidden, true);
    assert.equal(h.elements.get("canvas")!.style.height, "240000px");
    assert.equal(h.messages.some(message => message.type === "activate"), false);
    h.receive({ type: "state", rows: [{ id: "path", label: "main.c", filterText: "root/src/main.c", description: "src" }] });
    filter.value = "SRC/MAIN.C"; change();
    assert.equal(h.elements.get("canvas")!.children.length, 1);
  });

  it("retains persistent input across refresh/reveal and does not reveal filtered-out active files", () => {
    const h = harness(true); h.state(false, 3);
    const filter = h.elements.get("filter")!;
    filter.value = "function_2"; filter.listeners.get("input")!({});
    h.elements.get("tree")!.scrollTop = 17;
    h.receive({ type: "reveal", id: "node-0", focus: false, select: false });
    assert.equal(filter.value, "function_2");
    assert.equal(h.elements.get("tree")!.scrollTop, 17);
    h.state(false, 3);
    assert.equal(filter.value, "function_2");
    filter.listeners.get("keydown")!({ key: "Escape" });
    assert.equal(filter.value, "");
    assert.equal(filter.hidden, false);
  });

  it("preserves the existing reveal-clears-filter behavior for ordinary result windows", () => {
    const h = harness(); h.state();
    h.elements.get("filter")!.value = "not-found";
    h.receive({ type: "reveal", id: "node-0", focus: false, select: false });
    assert.equal(h.elements.get("filter")!.value, "");
    assert.equal(h.elements.get("canvas")!.children.length, 1);
  });

  it("patches active-file presentation without clearing input, selection or full data", () => {
    const h = harness(true); h.state(false, 2);
    h.elements.get("filter")!.value = "function_1";
    h.elements.get("filter")!.listeners.get("input")!({});
    h.receive({ type: "patch", rows: [{ id: "node-1", label: "function_1", description: "Active file",
      navigable: true, depth: 0, position: 2, siblings: 2, highlights: [[0, 10]], actions: [] }] });
    assert.equal(h.elements.get("filter")!.value, "function_1");
    assert.equal(h.elements.get("canvas")!.children.length, 1);
    assert.equal(h.elements.get("canvas")!.children[0].children[3].textContent, "Active file");
    h.receive({ type: "status", status: "Limit reached" });
    assert.equal(h.elements.get("status")!.textContent, "Limit reached");
    assert.equal(h.messages.some(message => message.type === "activate"), false);
  });
});
