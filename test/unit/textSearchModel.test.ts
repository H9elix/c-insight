import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import iconv from "iconv-lite";
import { applyMatches, DEFAULT_SEARCH_OPTIONS, findMatches, replacementText } from "../../src/textSearch/searchModel";
import { decodeSearchFile, excludedBySettings, ignoreLayer, isIgnored, matchesPatterns } from "../../src/textSearch/fileRules";
import { MatchingWorker, MatchTimeout, SearchCancelled } from "../../src/textSearch/matchingPool";

describe("independent text matching", () => {
  it("supports literals, case, Unicode whole words and UTF-16/CRLF coordinates", () => {
    const text = "FOO foo food 中文词 中文\r\n😀foo bar";
    const options = {...DEFAULT_SEARCH_OPTIONS, query: "foo", wholeWord: true};
    assert.deepEqual(findMatches(text, options, 10).matches.map(match => [match.line, match.character]), [[0, 0], [0, 4], [1, 2]]);
    assert.equal(findMatches(text, {...options, caseSensitive: true}, 10).matches.length, 2);
    assert.equal(findMatches(text, {...options, query: "中文"}, 10).matches.length, 1);
    assert.equal(findMatches("a.b axb", {...options, query: "a.b"}, 10).matches.length, 1);
  });
  it("supports multiline regex, empty matches and bounded results", () => {
    assert.equal(findMatches("😀x", {...DEFAULT_SEARCH_OPTIONS, query: "(?=.)", regex: true}, 10).matches.length, 2);
    assert.equal(findMatches("ab\r\ncd", {...DEFAULT_SEARCH_OPTIONS, query: "ab.*cd", regex: true, multiline: true}, 10).matches[0].endLine, 1);
    assert.deepEqual(findMatches("xxx", {...DEFAULT_SEARCH_OPTIONS, query: "x"}, 2).matches.length, 2);
    assert.equal(findMatches("xxx", {...DEFAULT_SEARCH_OPTIONS, query: "x"}, 2).truncated, true);
    assert.throws(() => findMatches("x", {...DEFAULT_SEARCH_OPTIONS, query: "(", regex: true}, 10));
  });
  it("expands captures, named groups, dollars and preserve-case replacements", () => {
    const text = "foo12 FOO12 Foo12";
    const matches = findMatches(text, {...DEFAULT_SEARCH_OPTIONS, query: "(?<word>foo)(\\d+)", regex: true}, 10).matches;
    assert.equal(replacementText(text, matches[0], "$<word>-$2-$$-$&", true, false), "foo-12-$-foo12");
    assert.equal(applyMatches(text, matches, "bar", false, true), "bar BAR Bar");
    assert.equal(applyMatches("Foo", findMatches("Foo", {...DEFAULT_SEARCH_OPTIONS, query: "foo"}, 10).matches, "", false, true), "");
  });
  it("decodes BOM, GBK and rejects binary/uncertain encodings", () => {
    assert.equal(decodeSearchFile(iconv.encode("中文", "gbk"), "gbk"), "中文");
    assert.equal(decodeSearchFile(iconv.encode("中文", "utf16le", {addBOM: true}), "utf8"), "中文");
    assert.throws(() => decodeSearchFile(Uint8Array.of(0, 1, 2), "utf8"));
    assert.throws(() => decodeSearchFile(Uint8Array.of(0xff), "utf8"));
    assert.throws(() => decodeSearchFile(Uint8Array.of(1), "unknown"));
  });
  it("handles nested ignore bases, glob lists and conditional exclude siblings", () => {
    assert.equal(isIgnored("src/cache/a.c", false, [ignoreLayer("src/", "cache/\n!keep.c")]), true);
    assert.equal(isIgnored("other/cache/a.c", false, [ignoreLayer("src/", "cache/")]), false);
    assert.equal(matchesPatterns("src/a.c", "*.h, **/*.c"), true);
    assert.equal(excludedBySettings("src/a.js", {"**/*.js": {when: "$(basename).ts"}}, ["a.js", "a.ts"]), true);
    assert.equal(excludedBySettings("src/a.js", {"**/*.js": false}, ["a.js"]), false);
  });
  it("terminates pathological expressions and can restart, without blocking cancellation", async () => {
    const worker = new MatchingWorker(resolve(__dirname, "../../src/textSearch/searchWorker.js"), 150);
    try {
      await assert.rejects(worker.match("a".repeat(10000) + "!", {...DEFAULT_SEARCH_OPTIONS, query: "(a+)+$", regex: true}, 10, new AbortController().signal), MatchTimeout);
      assert.equal((await worker.match("foo", {...DEFAULT_SEARCH_OPTIONS, query: "foo"}, 10, new AbortController().signal)).matches.length, 1);
      const controller = new AbortController();
      const pending = worker.match("a".repeat(10000) + "!", {...DEFAULT_SEARCH_OPTIONS, query: "(a+)+$", regex: true}, 10, controller.signal);
      controller.abort(); await assert.rejects(pending, SearchCancelled);
    } finally { worker.dispose(); }
  });
});
