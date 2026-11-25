import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { nativeArgs, nativeQuery, searchGlobs } from "../../src/textSearch/nativeSearchQuery";
import { compilePatterns } from "../../src/textSearch/fileRules";
import { runNativeSearch, matchNativeText, type NativeMatch } from "../../src/textSearch/nativeSearchProcess";
import { DEFAULT_SEARCH_OPTIONS } from "../../src/textSearch/searchModel";
import { SearchCancelled } from "../../src/textSearch/matchingPool";

const binary = resolve("node_modules/@vscode/ripgrep-universal/bin", `${process.platform}-${process.arch}`, process.platform === "win32" ? "rg.exe" : "rg");
const options = {...DEFAULT_SEARCH_OPTIONS, query: "foo"};
async function memory(text: string, query = options, maximumMatches?: number, replacement?: string) {
  const matches: NativeMatch[] = [];
  const stats = await runNativeSearch(binary, query, {paths: ["-"], input: text, filters: {useIgnores: false}, maximumMatches, replacement}, new AbortController().signal,
    async (_path, found) => {for (const match of found) matches.push(match);});
  return {matches, stats};
}
describe("native workspace search semantics", () => {
  it("builds native patterns instead of treating Multiline as implicit dotAll", () => {
    assert(nativeQuery({...options, query: "中foo"}).fixed);
    assert(!nativeQuery({...options, query: "a\\nb", regex: true}).fixed);
    assert(nativeQuery({...options, query: "a\\nb", regex: true}).multiline);
    assert(!nativeQuery({...options, query: "a.*b", regex: true, multiline: true}).multiline);
    assert(nativeArgs(options).includes("--no-config"));
    assert.equal(nativeQuery({...options, wholeWord: true}).pattern, "\\bfoo\\b");
    assert.equal(nativeQuery({...options, query: "中文", wholeWord: true}).pattern, "中文");
  });
  it("matches Unicode regex and words with native workspace rules", async () => {
    assert.deepEqual((await memory("abc 中文", {...options, query: "\\w+", regex: true})).matches.map(match => match.value), ["abc", "中文"]);
    assert.equal((await memory("foo food foo_bar foó", {...options, wholeWord: true})).matches.length, 1);
    assert.equal((await memory("a\nb", {...options, query: "a.*b", regex: true, multiline: true})).matches.length, 0);
  });
  it("converts UTF-8 offsets to UTF-16 and accepts LF and CRLF multiline queries", async () => {
    const result = await memory("中文😀foo\r\nfoo\n");
    assert.deepEqual(result.matches.map(match => [match.line, match.character, match.endCharacter]), [[0, 4, 7], [1, 0, 3]]);
    for (const text of ["a\nb", "a\r\nb"]) {
      for (const query of [{...options, query: "a\nb"}, {...options, query: "a\\nb", regex: true}]) {
        const matches = (await memory(text, query)).matches;
        assert.equal(matches.length, 1); assert.equal(matches[0].endLine, 1); assert.equal(matches[0].endCharacter, 1);
      }
    }
    assert.equal((await memory("ab", {...options, query: "(?=a)\\u0061\\u0062", regex: true})).matches[0].value, "ab");
  });
  it("uses the same native captures for replacement and enforces only requested match limits", async () => {
    const replaced = await memory("foo12 foo34", {...options, query: "foo(\\d+)", regex: true}, undefined, "${1}");
    assert.deepEqual(replaced.matches.map(match => match.replacement), ["12", "34"]);
    const limited = await memory("foo foo", options, 1); assert.equal(limited.matches.length, 1); assert(limited.stats.limited);
    assert(!(await memory("foo", options, 1)).stats.limited);
    assert.equal((await memory("foo\n".repeat(21001))).matches.length, 21001);
  });
  it("handles explicit paths without a shell, cancellation and missing binaries", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ci-native-results-"));
    try {
      const path = join(folder, "--quote '; file.txt"); await writeFile(path, "foo");
      let found = 0;
      await runNativeSearch(binary, options, {paths: [path]}, new AbortController().signal, async () => {found++;}); assert.equal(found, 1);
      const controller = new AbortController(); controller.abort();
      await assert.rejects(runNativeSearch(binary, options, {paths: [path]}, controller.signal, async () => undefined), SearchCancelled);
      await assert.rejects(runNativeSearch(join(folder, "missing"), options, {paths: [path]}, new AbortController().signal, async () => undefined), /unavailable/);
    } finally {await rm(folder, {recursive: true, force: true});}
  });
  it("expands editor replacement tokens using native captures, including Unicode and literal dollars", async () => {
    const query = {...options, query: "(?<word>\\w+)", regex: true};
    const found = await matchNativeText(binary, "中文", query, new AbortController().signal, "$1/$<word>/$&/$$/$12/$99");
    assert.equal(found[0].replacementValue, "中文/中文/中文/$/中文2/$99");
    const context = await matchNativeText(binary, "-foo+", {...options, regex: true}, new AbortController().signal, "$`:$&:$'");
    assert.equal(context[0].replacementValue, "-:foo:+");
  });
  it("applies native ignores, explicit include overrides, anchored paths and symlink settings", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ci-native-rules-"));
    try {
      await mkdir(join(folder, "src")); await mkdir(join(folder, "deep/src"), {recursive: true});
      for (const [path, value] of Object.entries({"src/one.txt": "foo", "deep/src/two.txt": "foo", "ignored.txt": "foo", ".gitignore": "ignored.txt\n"})) await writeFile(join(folder, path), value);
      const search = async (filters: Parameters<typeof nativeArgs>[1]) => {
        const found: string[] = [];
        await runNativeSearch(binary, options, {cwd: folder, paths: ["."], filters}, new AbortController().signal, async path => {found.push(path.replaceAll("\\", "/").replace(/^\.\//, ""));});
        return found.sort();
      };
      assert.deepEqual(await search({useIgnores: true}), ["deep/src/two.txt", "src/one.txt"]);
      assert.deepEqual(await search({useIgnores: true, includes: searchGlobs("*.txt")}), ["deep/src/two.txt", "ignored.txt", "src/one.txt"]);
      assert.deepEqual(await search({includes: searchGlobs("./src")}), ["src/one.txt"]);
      assert(compilePatterns("**/*.TXT", true)("src/one.txt")); assert(!compilePatterns("**/*.TXT")("src/one.txt"));
      if (process.platform !== "win32") {
        await symlink(join(folder, "src/one.txt"), join(folder, "linked.txt"));
        assert(!(await search({followSymlinks: false})).includes("linked.txt")); assert((await search({followSymlinks: true})).includes("linked.txt"));
      }
    } finally {await rm(folder, {recursive: true, force: true});}
  });
});
