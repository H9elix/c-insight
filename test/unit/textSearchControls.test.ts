import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { TEXT_SEARCH_CLIENT } from "../../src/textSearch/textSearchClient";
import { searchDisclosureState, searchWindow } from "../../src/textSearch/textSearchPresentation";

class Element {
  children: Element[] = [];
  parent?: Element;
  id = ""; className = ""; value = ""; textContent = ""; title = "";
  checked = false; hidden = false; open = false; disabled = false;
  scrollTop = 0; clientHeight = 240; clientWidth = 320; scrollWidth = 320;
  style: Record<string, string> = {}; dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
  listeners = new Map<string, (event: any) => void>();
  onclick?: (event?: any) => void;
  constructor(readonly tag = "div") {}
  classList = {toggle: (name: string, enabled: boolean) => {
    const classes = new Set(this.className.split(" ")); if (enabled) classes.add(name); else classes.delete(name); this.className = [...classes].join(" ");
  }};
  setAttribute(name: string, value: string) {this.attributes[name] = value;}
  addEventListener(name: string, listener: (event: any) => void) {this.listeners.set(name, listener);}
  append(...children: Element[]) {for (const child of children) {child.remove(); child.parent = this; this.children.push(child);}}
  replaceChildren(...children: Element[]) {this.children.forEach(child => {child.parent = undefined;}); this.children = []; this.append(...children);}
  remove() {if (this.parent) {this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined;}}
  insertBefore(child: Element, before: Element | null) {child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); child.parent = this;}
  find(predicate: (element: Element) => boolean): Element | undefined {return predicate(this) ? this : this.children.map(child => child.find(predicate)).find(Boolean);}
  all(predicate: (element: Element) => boolean): Element[] {return [...predicate(this) ? [this] : [], ...this.children.flatMap(child => child.all(predicate))];}
  querySelector(tag: string) {return this.children.map(child => child.find(element => element.tag === tag)).find(Boolean);}
  focus() {} select() {}
}

function browser(saved: any = undefined, session = "session-1", readOnly = false) {
  const ids = ["query", "replacement", "include", "exclude", "scope", "useIgnores", "preserveCase", "options", "search", "clear", "cancel", "toggle", "folder", "previous", "next", "current", "checked", "all",
    "openResultsTop", "preserveLabel", "ignoresLabel", "filtersToggle", "filterSummary", "filterArea", "statisticsToggle", "statistics", "statusRow", "resultSummary", "replaceArea", "snapshotQuery", "status", "plan", "results"];
  const elements = new Map(ids.map(id => [id, Object.assign(new Element(), {id})]));
  elements.get("useIgnores")!.checked = true;
  const actions = new Element(), messages: any[] = [], windowListeners = new Map<string, (event: any) => void>();
  const get = (id: string): Element => elements.get(id) ?? [...elements.values()].map(element => element.find(child => child.id === id)).find(Boolean)!;
  runInNewContext(TEXT_SEARCH_CLIENT, {
    labels: new Proxy({}, {get: (_, key) => String(key)}), readOnly, client: "test-client", uiSession: session, disclosureFor: searchDisclosureState, windowFor: searchWindow,
    acquireVsCodeApi: () => ({postMessage: (message: any) => messages.push(message), getState: () => saved, setState: (value: unknown) => {saved = value;}}),
    document: {body: new Element("body"), getElementById: get, createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => Object.assign(new Element("text"), {textContent: text}),
      querySelectorAll: () => [actions], addEventListener: () => {}},
    window: {addEventListener: (name: string, listener: (event: any) => void) => windowListeners.set(name, listener)},
    getComputedStyle: () => ({fontSize: "13px", getPropertyValue: () => "13px"}), requestAnimationFrame: () => 1,
    ResizeObserver: class {observe() {}}, MutationObserver: class {observe() {}},
  });
  const request = {query: "needle", include: "", exclude: "", scope: "workspace", useIgnores: true, caseSensitive: false, wholeWord: false, regex: false};
  const receive = (extra: Record<string, any> = {}) => windowListeners.get("message")!({data: {type: "state", generation: 1, revision: 1, request, replacement: "", preserveCase: false,
    replaceVisible: false, searched: true, selected: undefined, stats: {matches: 3, files: 1, skipped: 0, timedOut: 0}, shown: 3, hiddenChecked: 0, ready: true, files: [], ...extra}});
  const populate = () => receive({reset: true, checkedAdded: ["a:0", "a:1", "a:2"], files: [{id: "a", label: "a.txt", totalMatches: 3, checkedMatches: 3,
    matches: [0, 1, 2].map(index => ({id: `a:${index}`, line: index, character: 0, snippet: "needle", highlightStart: 0, highlightEnd: 6}))}]});
  return {get, messages, receive, populate, saved: () => saved, rows: () => get("results").all(element => element.className === "match")};
}

describe("compact search controls", () => {
  it("defaults to folded sections and keeps accessible compact match controls", () => {
    const page = browser();
    assert(page.get("filterArea").hidden); assert(page.get("statistics").hidden);
    assert.equal(page.get("filtersToggle").attributes["aria-expanded"], "false");
    for (const id of ["caseSensitive", "wholeWord", "regex"]) assert.equal(page.get(id).attributes["aria-label"], id);
    assert.equal(page.get("caseSensitive").parent?.children[1].textContent, "Aa");
    assert.equal(page.get("regex").parent?.children[1].textContent, ".*");
    page.receive({searched: false, generation: 0});
    assert(page.get("statusRow").hidden); assert(page.get("cancel").hidden); assert.equal(page.get("status").textContent, "idle");
  });

  it("remembers each presentation only within the same extension session and never sends a query on disclosure", () => {
    const page = browser(); page.populate(); const rows = page.rows();
    page.get("filtersToggle").onclick!(); page.get("statisticsToggle").onclick!(); page.receive();
    assert(!page.get("filterArea").hidden); assert(!page.get("statistics").hidden);
    assert.equal(page.messages.length, 1, "Only the initial ready message is allowed");
    assert.equal(page.rows()[0], rows[0]);
    const restored = browser(page.saved()); assert(!restored.get("filterArea").hidden); assert(!restored.get("statistics").hidden);
    const separate = browser(); assert(separate.get("filterArea").hidden); assert(separate.get("statistics").hidden);
    const restarted = browser(page.saved(), "session-2"); assert(restarted.get("filterArea").hidden); assert(restarted.get("statistics").hidden);
    for (const malformed of [undefined, null, true, "open", {session: "session-1", filters: "true", statistics: 1}]) {
      assert.deepEqual(searchDisclosureState(malformed, "session-1"), {session: "session-1", filters: false, statistics: false});
    }
  });

  it("retains and explains hidden filters without changing query rules", () => {
    const page = browser(); page.populate();
    page.receive({request: {query: "needle", scope: "workspace", include: "**/*.c", exclude: "<unsafe>", useIgnores: false}});
    assert(!page.get("filterSummary").hidden);
    assert.equal(page.get("filterSummary").textContent, "includeSummary: **/*.c · excludeSummary: <unsafe> · ignoresDisabled");
    assert.equal(page.get("filtersToggle").textContent, "filters (3)");
    page.get("filterSummary").onclick!(); assert(!page.get("filterArea").hidden); assert(page.get("filterSummary").hidden);
    page.get("filtersToggle").onclick!(); assert.equal(page.get("include").value, "**/*.c");
    assert.equal(page.get("exclude").value, "<unsafe>"); assert.equal(page.get("useIgnores").checked, false);
    assert.equal(page.messages.length, 1);
  });

  it("shows checkboxes only for replacement while preserving checked state and row identity", () => {
    const page = browser(); page.populate(); const row = page.rows()[0], checkbox = row.children[0];
    assert(checkbox.hidden); assert(checkbox.checked);
    page.receive({replaceVisible: true}); assert(!checkbox.hidden); assert(!page.get("replaceArea").hidden);
    page.receive(); assert(checkbox.hidden); assert(checkbox.checked);
    page.receive({replaceVisible: true}); assert(!checkbox.hidden); assert(checkbox.checked); assert.equal(page.rows()[0], row);
    const snapshot = browser(undefined, "", true); snapshot.populate(); snapshot.receive({replaceVisible: true}); assert(snapshot.rows()[0].children[0].hidden);
  });

  it("keeps warnings and hidden replacement selections visible when details are folded", () => {
    const page = browser(); page.populate();
    page.receive({error: "read failed", stale: true, replaceVisible: true, hiddenChecked: 4, stats: {matches: 7, files: 2, skipped: 1, timedOut: 0}});
    assert(page.get("statistics").hidden); assert(!page.get("status").hidden);
    for (const warning of ["read failed", "stale", "partial", "hiddenChecked: 4"]) assert(page.get("status").textContent.includes(warning));
    assert.equal(page.get("resultSummary").textContent, "shown: 3 / 7");
    page.receive({loading: true}); assert(!page.get("cancel").hidden); assert(page.get("status").textContent.includes("searching"));
    page.receive({stats: {matches: 0, files: 0, skipped: 0, timedOut: 0}, shown: 0});
    assert.equal(page.get("status").textContent, "noMatches"); assert(page.get("cancel").hidden);
    page.receive({stats: {matches: 0, files: 0, skipped: 0, timedOut: 0, cancelled: true}, shown: 0});
    assert.equal(page.get("status").textContent, "partial", "A cancelled empty query must not claim no matches exist");
  });
});
