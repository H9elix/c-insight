import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const clientRequire = createRequire(resolve("node_modules/vscode-languageclient/package.json"));
const minimatch = clientRequire("minimatch") as typeof import("minimatch");
const glob = createRequire(resolve("node_modules/@vscode/l10n-dev/package.json"))("glob") as {
  sync(patterns: string[], options: Record<string, unknown>): string[];
};

interface MatcherCompatibility {
  supportedClientVersion: string;
  adaptLanguageClientMatcher(source: string, file: string, version: string): string;
  languageClientMinimatchCompat(root: string): import("esbuild").Plugin;
}

const compatibility = (): Promise<MatcherCompatibility> =>
  import(pathToFileURL(resolve("scripts/languageclient-minimatch-compat.mjs")).href);

// Execute the installed language client's matcher, mocking only VS Code's URI boundary.
async function clientMatcher(): Promise<(pattern: unknown, resource: { fsPath: string }) => boolean> {
  const file = clientRequire.resolve("./lib/common/utils/globPattern.js");
  const exports: { matchGlobPattern?: (pattern: unknown, resource: { fsPath: string }) => boolean } = {};
  const { adaptLanguageClientMatcher, supportedClientVersion } = await compatibility();
  const source = adaptLanguageClientMatcher(readFileSync(file, "utf8"), "lib/common/utils/globPattern.js", supportedClientVersion);
  runInNewContext(source, {
    exports,
    require: (id: string) => {
      if (id === "minimatch") return minimatch;
      assert.equal(id, "vscode");
      return { Uri: { parse: (uri: string) => {
        const path = new URL(uri).pathname;
        return { path, with: (change: { path: string }) => ({ fsPath: change.path }) };
      } } };
    },
  });
  assert.ok(exports.matchGlobPattern);
  return exports.matchGlobPattern;
}

describe("security override dependency compatibility", () => {
  it("uses explicit consumer overrides compatible with npm 10 lock validation", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      overrides: Record<string, { minimatch?: string; glob?: string }>;
    };
    for (const consumer of ["vscode-languageclient", "@vscode/vsce", "@typescript-eslint/typescript-estree"]) {
      assert.equal(manifest.overrides[consumer]?.minimatch, "11.0.5", consumer);
    }
    assert.equal(manifest.overrides["@vscode/l10n-dev"]?.glob, "14.0.4");
    assert.equal(Object.keys(manifest.overrides).some(key => key.startsWith("minimatch")), false);
  });

  it("tests the fixed matcher actually resolved by the language client and rejects stale nested copies", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path.endsWith("node_modules/minimatch") && Number(entry.version?.split(".")[0]) >= 7) {
        assert.equal(entry.version, "11.0.5", path);
      }
    }
    assert.equal(clientRequire("minimatch"), createRequire(resolve("package.json"))("minimatch"));
    assert.equal(Object.getOwnPropertyDescriptor(minimatch.Minimatch.prototype, "makeRe"), undefined);
  });

  it("preserves language-client string glob matching and Windows pattern normalization", async () => {
    const match = await clientMatcher();
    for (const [pattern, path, expected] of [
      ["**/*.{c,cpp,h,hpp}", "/workspace/src/main.c", true],
      ["**/*.{c,cpp,h,hpp}", "/workspace/include/detail/value.hpp", true],
      ["**/*.{c,cpp,h,hpp}", "/workspace/README.md", false],
      ["**/*.c", "/workspace/src/main.cpp", false],
      ["**/*.c", "/workspace/.cache/main.c", false],
      ["**/file?.[ch]", "/workspace/file2.h", true],
      ["**/file?.[ch]", "/workspace/file22.h", false],
      ["C:\\workspace\\**\\*.c", "C:/workspace/src/main.c", true],
      ["**/+(main).c", "/workspace/main.c", false],
      ["**/+(main).c", "/workspace/+(main).c", true],
      ["#comment", "/workspace/main.c", false],
      ["", "", false],
    ] as const) assert.equal(match(pattern, { fsPath: path }), expected, `${pattern}: ${path}`);
  });

  it("keeps relative glob bases bounded for file and remote URIs", async () => {
    const match = await clientMatcher();
    for (const baseUri of ["file:///workspace", { uri: "vscode-remote://ssh-remote+test/workspace" }]) {
      const pattern = { baseUri, pattern: "src/**/*.{c,h}" };
      assert.equal(match(pattern, { fsPath: "/workspace/src/main.c" }), true);
      assert.equal(match(pattern, { fsPath: "/other/src/main.c" }), false);
      assert.equal(match(pattern, { fsPath: "/workspace/include/main.h" }), false);
    }
    assert.equal(match({ baseUri: "not a URI", pattern: "**/*.c" }, { fsPath: "/workspace/main.c" }), false);
  });

  it("retains file-operation parsed-pattern validation, dot-file and ignore-case options", async () => {
    const { adaptLanguageClientMatcher, supportedClientVersion } = await compatibility();
    const source = readFileSync(clientRequire.resolve("./lib/common/fileOperations.js"), "utf8");
    const adapted = adaptLanguageClientMatcher(source, "lib/common/fileOperations.js", supportedClientVersion);
    assert.ok(adapted.includes("if (matcher.set.length === 0)"));
    assert.equal(adapted.includes("matcher.makeRe()"), false);
    const matcher = new minimatch.Minimatch("**/*.{c,h}", { dot: true, nocase: true });
    assert.ok(matcher.set.length);
    assert.equal(matcher.match("/workspace/.generated/config.H"), true);
    assert.equal(matcher.match("/workspace/src/main.C"), true);
    assert.equal(matcher.match("/workspace/src/main.cpp"), false);
    assert.equal(new minimatch.Minimatch("**/*.c", { dot: true }).match("/workspace/main.C"), false);
    assert.equal(new minimatch.Minimatch("#comment").set.length, 0);
    assert.equal(new minimatch.Minimatch("").set.length, 0);
  });

  it("fails closed when the client version or either patch location changes", async () => {
    const { adaptLanguageClientMatcher, supportedClientVersion } = await compatibility();
    for (const file of ["lib/common/utils/globPattern.js", "lib/common/fileOperations.js"]) {
      assert.throws(() => adaptLanguageClientMatcher("", file, supportedClientVersion), /exactly one/);
      assert.throws(() => adaptLanguageClientMatcher("if (!matcher.makeRe()) if (!matcher.makeRe())", file, supportedClientVersion), /exactly one/);
      assert.throws(() => adaptLanguageClientMatcher("if (!matcher.makeRe())", file, "99.0.0"), /Review/);
    }
    assert.throws(() => adaptLanguageClientMatcher("if (!matcher.makeRe())", "other.js", supportedClientVersion), /Review/);
  });

  it("rejects a bundle that omitted the guarded client modules", async () => {
    const { build } = await import("esbuild");
    const { languageClientMinimatchCompat } = await compatibility();
    await assert.rejects(build({
      stdin: { contents: "export const unrelated = 1;" }, bundle: true, write: false, logLevel: "silent",
      plugins: [languageClientMinimatchCompat(process.cwd())],
    }), /Expected both language-client/);
  });

  it("retains l10n glob.sync array patterns, braces, absolute paths and directory exclusion", () => {
    const root = mkdtempSync(join(tmpdir(), "c-insight-dependency-glob-"));
    try {
      const files = ["src/main.ts", "src/nested/view.tsx", "src/nested/helper.js", "src/view.jsx", "src/notes.md"];
      for (const file of files) {
        const path = join(root, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "");
      }
      mkdirSync(join(root, "src/directory.ts"));
      const source = join(root, "src").replaceAll("\\", "/");
      const matches = glob.sync([`${source}/{,**}/*.{ts,tsx,js,jsx}`, `${source}/main.ts`], {
        nodir: true, absolute: true, windowsPathsNoEscape: true,
      });
      assert.deepEqual(matches.sort(), files.filter(file => !file.endsWith(".md")).map(file => join(root, file).replaceAll("\\", "/")).sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
