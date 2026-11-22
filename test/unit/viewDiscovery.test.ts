import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import * as ids from "../../src/ids";
import * as model from "../../src/combined/combinedModel";
import * as catalog from "../../src/views/viewCatalog";

const compiled = ts.transpileModule(readFileSync("src/views/viewDiscovery.ts", "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function signal() {
  const callbacks = new Set<() => void>();
  return {event: (callback: () => void) => {callbacks.add(callback); return {dispose: () => callbacks.delete(callback)};},
    fire: () => [...callbacks].forEach(callback => callback()), get size() {return callbacks.size;}};
}
function fixture(store = new Map<string, boolean>()) {
  const registrations = new Map<string, any>(), executed: string[] = [], messages: string[] = [], logs: string[] = [];
  const slots: unknown[] = [];
  let pick: ((items: any[], options: any) => any) = () => undefined;
  let response: string | undefined;
  let persist: (key: string, value: boolean) => Promise<void> = async (key, value) => {store.set(key, value);};
  const vscode = {
    Disposable: class {constructor(private callback: () => void) {} dispose() {this.callback();}},
    QuickPickItemKind: {Separator: -1}, l10n: {t: (value: string, args?: {number: number}) => value.replace("{number}", String(args?.number))},
    window: {
      registerWebviewViewProvider: (id: string, provider: any, options: any) => {registrations.set(id, {provider, options}); return {dispose: () => registrations.delete(id)};},
      showInformationMessage: async (message: string) => {messages.push(message); return response;},
      showQuickPick: async (items: any[], options: any) => pick(items, options),
    },
    commands: {executeCommand: async (id: string) => {executed.push(id);}},
    workspace: {getConfiguration: () => ({get: (key: string) => slots[Number(key.slice(4)) - 1]})},
  };
  const module = {exports: {} as any};
  runInNewContext(compiled, {module, exports: module.exports, require: (id: string) => {
    if (id === "vscode") return vscode;
    if (id === "../ids") return ids;
    if (id === "../combined/combinedModel") return model;
    if (id === "./viewCatalog") return catalog;
    throw new Error(`Unexpected discovery dependency: ${id}`);
  }});
  const service = new module.exports.ViewDiscovery({extension: {packageJSON: manifest}, globalState: {
    get: (key: string) => store.get(key), update: (key: string, value: boolean) => persist(key, value),
  }}, {appendLine: (message: string) => logs.push(message)});
  function resolve(id = "cInsight.history", visible = false, provider = {resolveWebviewView: () => undefined}) {
    const change = signal(), dispose = signal();
    const view = {visible, onDidChangeVisibility: change.event, onDidDispose: dispose.event};
    const options = {webviewOptions: {retainContextWhenHidden: true}};
    const registration = service.registerView(id, provider, options);
    const context = {state: {}}, token = {isCancellationRequested: false};
    const result = registrations.get(id).provider.resolveWebviewView(view, context, token);
    assert.equal(registrations.get(id).options, options);
    return {view, change, dispose, registration, result, context, token};
  }
  return {service, store, slots, executed, messages, logs, registrations, resolve,
    choose: (fn: typeof pick) => {pick = fn;}, respond: (value: string) => {response = value;},
    persistWith: (fn: typeof persist) => {persist = fn;}};
}

describe("view discovery notice lifecycle", () => {
  it("does not prompt on activation, hidden resolution or picker cancellation", async () => {
    const f = fixture(); f.service.ready(); f.resolve(); await f.service.open(); await flush();
    assert.equal(f.messages.length, 0); assert.equal(f.store.size, 0); assert.deepEqual(f.executed, []);
    f.service.dispose();
  });
  it("queues visible non-query panes until commands are ready and coalesces multiple panes", async () => {
    const f = fixture(); const first = f.resolve("cInsight.history", true); f.resolve("cInsight.bookmarks", true);
    await flush(); assert.equal(f.messages.length, 0);
    f.service.ready(); await flush(); assert.equal(f.messages.length, 1); assert.equal(f.store.size, 1);
    first.change.fire(); await flush(); assert.equal(f.messages.length, 1);
    f.service.dispose(); assert.equal(first.change.size, 0); assert.equal(first.dispose.size, 0);
  });
  it("shows on later visibility, skips disabled combinations, and persists dismissal across activation", async () => {
    const f = fixture(); f.service.ready(); const hidden = f.resolve();
    f.resolve("cInsight.combined1", true); await flush(); assert.equal(f.messages.length, 0);
    hidden.view.visible = true; hidden.change.fire(); await flush(); assert.equal(f.messages.length, 1);
    const next = fixture(f.store); next.service.ready(); next.resolve("cInsight.bookmarks", true); await flush();
    assert.equal(next.messages.length, 0);
    const otherProfile = fixture(); otherProfile.service.ready(); otherProfile.resolve("cInsight.context", true); await flush();
    assert.equal(otherProfile.messages.length, 1);
    [f, next, otherProfile].forEach(item => item.service.dispose());
  });
  it("accepting the notice opens the picker command, without opening a pane itself", async () => {
    const f = fixture(); f.respond("Open Views…"); f.service.ready(); f.slots[1] = {enabled: true}; f.resolve("cInsight.combined2", true);
    await flush(); assert.deepEqual(f.executed, [ids.COMMANDS.OPEN_VIEW]); f.service.dispose();
  });
  it("logs storage failure without repeated prompts or unhandled rejection", async () => {
    const f = fixture(); f.persistWith(async () => {throw new Error("storage unavailable");});
    f.service.ready(); const view = f.resolve("cInsight.bookmarks", true); await flush(); view.change.fire(); await flush();
    assert.equal(f.messages.length, 1); assert.equal(f.logs.length, 1); f.service.dispose();
  });
  it("does not show a pending notice after disposal", async () => {
    const f = fixture(); let saved!: () => void;
    f.persistWith(() => new Promise(resolve => {saved = resolve;})); f.service.ready(); f.resolve("cInsight.history", true);
    f.service.dispose(); saved(); await flush(); assert.equal(f.messages.length, 0);
  });
  it("preserves native resolution context, cancellation, this and async return, and unregisters listeners", async () => {
    const f = fixture(); let args: unknown[] = [];
    const provider = {resolveWebviewView(...values: unknown[]) {assert.equal(this, provider); args = values; return Promise.resolve(42);}};
    const view = f.resolve("cInsight.preview", false, provider as any);
    assert.deepEqual(args, [view.view, view.context, view.token]); assert.equal(await view.result, 42);
    view.registration.dispose(); assert.equal(view.change.size, 0); assert.equal(view.dispose.size, 0);
    assert.equal(f.registrations.size, 0); f.service.dispose();
  });
});

describe("view picker actions", () => {
  it("searches aliases and purposes; highlighting and cancelling have no side effects", async () => {
    const f = fixture(); f.choose((items, options) => {
      assert.equal(items.filter(item => item.entry?.action === "view").length, 15);
      assert(options.matchOnDescription && options.matchOnDetail);
      options.onDidSelectItem(items.find(item => item.entry?.viewId === "cInsight.callers")); return undefined;
    });
    await f.service.open(); assert.deepEqual(f.executed, []); assert.equal(f.store.size, 0);
    assert.equal(f.service.stateForTest().pickerOpen, false); f.service.dispose();
  });
  it("opens the chosen independent native view directly even when it also belongs to a combination", async () => {
    const f = fixture(); f.slots[0] = {enabled: true, views: ["callers"]};
    f.choose(items => items.find(item => item.entry?.viewId === "cInsight.callers")); await f.service.open();
    assert.deepEqual(f.executed, ["cInsight.callers.focus"]); f.service.dispose();
  });
  it("focuses the exact combined slot, but never recreates one closed while the picker was open", async () => {
    const f = fixture(); f.slots[2] = {enabled: true, title: "Third"};
    f.choose(items => items.find(item => item.entry?.slot === 3)); await f.service.open();
    assert.deepEqual(f.executed, ["cInsight.combined3.focus"]); f.executed.length = 0;
    f.choose(items => {const selected = items.find(item => item.entry?.slot === 3); f.slots[2] = undefined; return selected;});
    await f.service.open(); assert.deepEqual(f.executed, []); assert.match(f.messages[0], /no longer enabled/); f.service.dispose();
  });
  it("delegates creation and management, and offers explicit creation when no combinations exist", async () => {
    const f = fixture(); f.choose(items => items.find(item => item.entry?.action === "manage"));
    await f.service.open(); assert.deepEqual(f.executed, []); assert.match(f.messages[0], /No combined views/);
    f.respond("Create Combined View…"); await f.service.open();
    assert.deepEqual(f.executed, [ids.COMMANDS.COMBINED_VIEWS_CREATE]);
    f.slots[0] = {enabled: true}; await f.service.open(); assert.equal(f.executed.at(-1), ids.COMMANDS.COMBINED_VIEWS_MANAGE);
    f.choose(items => items.find(item => item.entry?.action === "create")); await f.service.open();
    assert.equal(f.executed.at(-1), ids.COMMANDS.COMBINED_VIEWS_CREATE); f.service.dispose();
  });
});
