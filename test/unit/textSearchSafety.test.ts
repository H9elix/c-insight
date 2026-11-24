import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import * as minimatch from "minimatch";
import * as ts from "typescript";
import * as model from "../../src/textSearch/searchModel";
import * as rules from "../../src/textSearch/fileRules";
import type { SearchFile, SearchRequest } from "../../src/textSearch/workspaceSearch";

function fixture(trusted: boolean, writable: boolean) {
  let reads = 0, writes = 0;
  const workspace = {isTrusted: trusted, fs: {isWritableFileSystem: () => writable},
    asRelativePath: () => "one.txt",
    getConfiguration: () => ({get: () => false}), openTextDocument: () => {reads++; throw new Error("Unexpected open");},
    applyEdit: () => {writes++; return true;}};
  const vscode = {workspace, l10n: {t: (value: string) => value}, Uri: {parse: (value: string) => ({scheme: "file", toString: () => value})}};
  const module = {exports: {} as typeof import("../../src/textSearch/replacementPlan")};
  const source = ts.transpileModule(readFileSync("src/textSearch/replacementPlan.ts", "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source, {module, exports: module.exports, Buffer, require: (id: string) => {
    if (id === "vscode") return vscode;
    if (id === "./searchModel") return model;
    if (id === "./fileRules") return rules;
    if (id === "node:crypto") return crypto;
    if (id === "minimatch") return minimatch;
    throw new Error(`Unexpected replacement dependency: ${id}`);
  }});
  return {...module.exports, counts: () => ({reads, writes})};
}
const request = {...model.DEFAULT_SEARCH_OPTIONS, query: "x", scope: "workspace", include: "", exclude: "", useIgnores: true} as SearchRequest;
function file(id: string): SearchFile {return {id, uri: `file:///${id}.txt`, label: id, hash: model.contentHash("x"),
  matches: model.findMatches("x", request, 10).matches.map(match => ({...match, id}))};}

describe("replacement safety gates", () => {
  it("rejects untrusted and read-only writes before opening a target", async () => {
    for (const [trusted, writable] of [[false, true], [true, false]]) {
      const f = fixture(trusted, writable), target = file("one");
      const plan = await f.createReplacementPlan([target], new Set(["one"]), 1, request, "y", false, async () => ({text: "x"}));
      await assert.rejects(f.applyReplacementPlan(plan, request, "y", false, () => true), trusted ? /read-only/ : /unavailable/);
      assert.deepEqual(f.counts(), {reads: 0, writes: 0});
    }
  });
  it("bounds batch count before reading and rejects stale content or document versions", async () => {
    const f = fixture(true, true), files = Array.from({length: 201}, (_, i) => file(String(i)));
    await assert.rejects(f.createReplacementPlan(files, new Set(files.map(file => file.id)), 1, request, "y", false, async () => assert.fail("Oversized batch read files")), /200/);
    await assert.rejects(f.createReplacementPlan([files[0]], new Set(["0"]), 1, request, "y", false, async () => ({text: "changed"})), /changed/);
    files[0].version = 3;
    await assert.rejects(f.createReplacementPlan([files[0]], new Set(["0"]), 1, request, "y", false, async () => ({text: "x", version: 4})), /changed/);
  });
});
