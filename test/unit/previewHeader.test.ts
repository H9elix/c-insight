import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { previewHeader } from "../../src/views/previewHeader";
import { PREVIEW_HEADER_CLIENT } from "../../src/views/previewHeaderClient";

function browser() {
  const nodes = new Map<string, any>();
  for (const selector of [".title", ".preview-kind", ".preview-symbol", ".preview-file", ".preview-line", ".symbol-part", ".location", ".preview-status", ".status-symbol", ".status-label", ".controls", "preview-announcement"]) {
    const classes = new Set<string>(), listeners = new Map<string, (event: any) => void>();
    nodes.set(selector, {textContent: "", hidden: false, title: "", attributes: {} as Record<string, string>, scrollLeft: 0, clientLeft: 0, clientWidth: 60,
      classList: {toggle: (value: string, enabled: boolean) => {if (enabled) classes.add(value); else classes.delete(value);}, contains: (value: string) => classes.has(value)},
      setAttribute(name: string, value: string) {this.attributes[name] = value;},
      addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler), listeners,
      querySelector: (selector: string) => nodes.get(selector), getBoundingClientRect: () => ({left: 20, right: 80}),
    });
  }
  const execute = runInNewContext(PREVIEW_HEADER_CLIENT + ";({updatePreviewHeader,updatePreviewStatus})", {
    document: {querySelector: (selector: string) => nodes.get(selector), getElementById: (id: string) => nodes.get(id)},
    text: {loadingFailed: "Loading failed"},
  }) as {updatePreviewHeader(value: unknown): void; updatePreviewStatus(message: string, error?: boolean, loading?: boolean): void};
  return {...execute, node: (selector: string) => nodes.get(selector)};
}

describe("compact preview header", () => {
  it("keeps semantic identity and target position separate from the full paths", () => {
    assert.deepEqual(previewHeader("Definition", "release", "src/sample.c", "/source/src/sample.c", 96), {
      kind: "Definition", symbol: "release", fileName: "sample.c", line: ":97",
      tooltip: "Definition · release\nsrc/sample.c:97\n/source/src/sample.c:97",
    });
    const windows = previewHeader("Reference", "item", "src\\sample.c", "C:\\source\\src\\sample.c", 0);
    assert.equal(windows.fileName, "sample.c"); assert.equal(windows.line, ":1");
    assert.equal(previewHeader("Code Preview", "").tooltip, "Code Preview");
  });

  it("omits duplicate mode/path labels without changing other display names", () => {
    for (const title of ["Reference", "src/sample.c", "/source/src/sample.c", "sample.c", "src/sample.c:97", "src/sample.c:97:4"]) {
      assert.equal(previewHeader("Reference", title, "src/sample.c", "/source/src/sample.c", 96).symbol, "", title);
    }
    assert.equal(previewHeader("Definition", "sample", "src/sample.c", "/source/src/sample.c", 0).symbol, "sample");
    const value = previewHeader("Reference", "symbol", "src/sample.c", "src/sample.c", 0);
    assert.equal(value.tooltip.split("\n").length, 2, "Identical paths should appear only once");
  });

  it("updates only header text and tooltips, with untrusted text kept literal", () => {
    const page = browser(), payload = previewHeader("Definition", '<symbol "value">', "src/<sample>.c", "/source/<sample>.c", 8);
    page.updatePreviewHeader(payload);
    assert.equal(page.node(".preview-symbol").textContent, '<symbol "value">');
    assert.equal(page.node(".preview-file").textContent, "<sample>.c");
    assert.equal(page.node(".title").title, payload.tooltip);
    assert.equal(page.node(".title").attributes["aria-label"], payload.tooltip);
    assert.equal(page.node(".symbol-part").hidden, false);
    page.updatePreviewHeader(previewHeader("Reference", "src/sample.c", "src/sample.c", "/source/sample.c", 8));
    assert.equal(page.node(".symbol-part").hidden, true);
    for (const malformed of [null, undefined, "old title"]) assert.doesNotThrow(() => page.updatePreviewHeader(malformed));
    assert.doesNotMatch(PREVIEW_HEADER_CLIENT, /innerHTML|replaceChildren|postMessage|scrollTop/);
  });

  it("exposes loading/error details and announcements without reserving a footer", () => {
    const page = browser();
    page.updatePreviewStatus("Lines 2–80 / 200 · Scroll for more context");
    assert.equal(page.node(".status-symbol").textContent, "ⓘ"); assert(page.node(".status-label").hidden);
    page.updatePreviewStatus("Loading earlier source lines…", false, true);
    assert(page.node(".preview-status").classList.contains("loading"));
    assert.equal(page.node("preview-announcement").textContent, "Loading earlier source lines…");
    page.updatePreviewStatus("Source loading failed: <failure>", true);
    assert(page.node(".preview-status").classList.contains("error")); assert(!page.node(".preview-status").classList.contains("loading"));
    assert.equal(page.node(".status-label").textContent, "Loading failed"); assert(!page.node(".status-label").hidden);
    assert.equal(page.node(".preview-status").attributes["aria-label"], "Source loading failed: <failure>");
    page.updatePreviewStatus("Lines 1–200 / 200 · Complete file");
    assert(!page.node(".preview-status").classList.contains("error")); assert(page.node(".status-label").hidden);
    assert.equal(page.node("preview-announcement").textContent, "");
    const provider = readFileSync("src/views/codePreviewProvider.ts", "utf8");
    assert.doesNotMatch(provider, /class="load-status"|padding: 0 8px 12px/);
    assert.match(provider, /height: calc\(1\.5em \+ 16px\)/);
    assert.match(provider, /prefers-reduced-motion: reduce/);
    assert.match(provider, /\.vscode-reduce-motion \.preview-status/);
  });

  it("reveals focused toolbar buttons by scrolling only their own container", () => {
    const page = browser(), controls = page.node(".controls"), focus = controls.listeners.get("focusin");
    const target = (left: number, right: number) => ({closest: () => ({getBoundingClientRect: () => ({left, right})})});
    focus({currentTarget: controls, target: target(65, 100)}); assert.equal(controls.scrollLeft, 20);
    focus({currentTarget: controls, target: target(10, 35)}); assert.equal(controls.scrollLeft, 10);
    focus({currentTarget: controls, target: target(30, 55)}); assert.equal(controls.scrollLeft, 10);
    assert.doesNotMatch(PREVIEW_HEADER_CLIENT, /scrollIntoView/);
  });
});
