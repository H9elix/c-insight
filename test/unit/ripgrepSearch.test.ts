import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { canPrefilter, prefilterFiles } from "../../src/textSearch/ripgrepSearch";
import { DEFAULT_SEARCH_OPTIONS } from "../../src/textSearch/searchModel";
import { SearchCancelled } from "../../src/textSearch/matchingPool";

const binary = resolve("node_modules/@vscode/ripgrep-universal/bin", `${process.platform}-${process.arch}`, process.platform === "win32" ? "rg.exe" : "rg");
describe("native literal prefilter", () => {
  it("uses only compatible literals and UTF-8 roots, leaving regex, Unicode queries and legacy encodings to JS", () => {
    const options = {...DEFAULT_SEARCH_OPTIONS, query: "needle", wholeWord: true};
    assert(canPrefilter(options, ["utf8"]));
    for (const query of ["", "a\nb", "a\rb", "\0", "中文"]) assert(!canPrefilter({...options, query}, ["utf8"]));
    assert(!canPrefilter({...options, regex: true}, ["utf8"]));
    assert(!canPrefilter(options, ["utf8", "gbk"]));
  });
  it("handles spaces, punctuation and option-like filenames without a shell and preserves BOM candidates", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ci-native-search-"));
    try {
      const paths = [join(folder, "a; quote ' file.txt"), join(folder, "--flag.txt"), join(folder, "utf16.txt"), join(folder, "absent.txt")];
      await writeFile(paths[0], "NEEDLE needles\n"); await writeFile(paths[1], "needle\n");
      await writeFile(paths[2], Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("needle", "utf16le")]));
      await writeFile(paths[3], "nothing\n");
      const options = {...DEFAULT_SEARCH_OPTIONS, query: "needle"};
      assert.deepEqual([...await prefilterFiles(binary, paths, options, new AbortController().signal)].sort(), paths.slice(0, 3).sort());
      assert.equal((await prefilterFiles(binary, paths, {...options, query: "no_such_literal"}, new AbortController().signal)).size, 0);
      const controller = new AbortController();
      const pending = prefilterFiles(binary, paths, options, controller.signal); controller.abort();
      await assert.rejects(pending, SearchCancelled);
      await assert.rejects(prefilterFiles(join(folder, "missing-binary"), paths, options, new AbortController().signal));
    } finally { await rm(folder, {recursive: true, force: true}); }
  });
});
