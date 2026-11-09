import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { isGitMetadata, isKnownBinaryFile, ProjectFileEntry, projectFileLimit, projectFileSort, sortProjectFiles } from "../../src/projectFiles/projectFileModel";

const file = (relativePath: string, rootName = "root"): ProjectFileEntry => ({
  uri: `file:///${rootName}/${relativePath}`, relativePath, rootName, name: relativePath.split("/").at(-1)!,
});

describe("Project Files presentation", () => {
  it("naturally sorts names and deterministically separates duplicate names and roots", () => {
    const entries = [file("src/file10.c"), file("z/file2.c"), file("a/file2.c"), file("a/file2.c", "other")];
    assert.deepEqual(sortProjectFiles(entries, "name").map(entry => entry.uri), [
      "file:///other/a/file2.c", "file:///root/a/file2.c", "file:///root/z/file2.c", "file:///root/src/file10.c",
    ]);
    assert.equal(entries[0].name, "file10.c", "Sorting must not mutate the file inventory");
  });
  it("supports paths and extension groups without reading file metadata", () => {
    const entries = [file("z/a.h"), file("a/z.c"), file("b/readme.md"), file("build")];
    assert.deepEqual(sortProjectFiles(entries, "path").map(entry => entry.relativePath), ["a/z.c", "b/readme.md", "build", "z/a.h"]);
    assert.deepEqual(sortProjectFiles(entries, "type").map(entry => entry.name), ["build", "z.c", "a.h", "readme.md"]);
  });
  it("normalizes settings and distinguishes Git metadata from ordinary dot files", () => {
    assert.equal(projectFileSort("modified"), "name");
    assert.equal(projectFileSort("path"), "path");
    assert.equal(projectFileLimit(Number.NaN), 50000);
    assert.equal(projectFileLimit(4), 1000);
    assert.equal(projectFileLimit(999999), 200000);
    assert(isGitMetadata("a/.git/config"));
    assert(isGitMetadata(".git"));
    assert(!isGitMetadata(".gitignore"));
    assert(!isGitMetadata("src/.github/actions.yml"));
  });
  it("keeps common binary assets out of the text-preview path", () => {
    for (const name of ["logo.PNG", "demo.o", "archive.zip", "program.bin"]) assert(isKnownBinaryFile(name));
    for (const name of ["main.c", "notes.md", "diagram.svg", "Makefile"]) assert(!isKnownBinaryFile(name));
  });
  it("keeps listing independent of semantic engines and content-change subscriptions", () => {
    const source = readFileSync("src/projectFiles/projectFilesExplorer.ts", "utf8");
    assert.doesNotMatch(source, /import .*AnalysisService|analysis\.|onDidChangeTextDocument|watcher\.onDidChange\(/);
    assert.match(source, /findFiles\("\*\*\/\*", undefined, maximum \+ 1, token\)/);
    assert.match(source, /createFileSystemWatcher\("\*\*\/\*", false, true, false\)/);
  });
});
