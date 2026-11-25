import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

interface ReleaseOptions { root: string; outDir: string; suffix?: string }
interface PackageResult { name: string; target: string; bytes: number; binaries: number; sha256: string }
interface ReleaseTargets {
  releaseTargets: {target: string; binary?: string}[];
  universalBinaries: string[];
  binaryFile(platform: string): string;
  packageName(manifest: {name: string; version: string}, target: string, suffix?: string): string;
}
const script = (name: string) => import(pathToFileURL(resolve(`scripts/${name}.mjs`)).href);

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "c-insight-package-test-"));
  const manifest = {name: "c-insight", version: "0.0.1", publisher: "H9elix", displayName: "C Insight", description: "Synthetic packaging fixture",
    engines: {vscode: "^1.95.0"}, main: "./dist/extension.js", activationEvents: ["onLanguage:c"], license: "MIT", repository: {type: "git", url: "https://github.com/H9elix/c-insight.git"},
    files: ["dist/extension.js", "dist/textSearchWorker.js", "dist/codicons/*", "dist/ripgrep/**/*", "README*", "LICENSE", "THIRD_PARTY_NOTICES.md"]};
  const files: Record<string, string> = {"package.json": JSON.stringify(manifest), "README.md": "# Fixture\n", "README.zh-CN.md": "# 测试夹具\n",
    LICENSE: "MIT fixture\n", "THIRD_PARTY_NOTICES.md": "# Test notices\n", "dist/extension.js": "module.exports = {};\n", "dist/textSearchWorker.js": "// worker\n",
    "dist/codicons/codicon.css": "/* icons */\n", "dist/codicons/codicon.ttf": "font fixture", "dist/ripgrep/sentinel.txt": "Keep the developer build untouched",
    ".cache/private.txt": "Must not be packaged", "node_modules/@vscode/ripgrep-universal/LICENSE": "MIT native fixture\n"};
  const targets: ReleaseTargets = await script("release-targets");
  for (const platform of targets.universalBinaries) files[`node_modules/@vscode/ripgrep-universal/bin/${targets.binaryFile(platform)}`] = `native ${platform}\n`;
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), {recursive: true});
    await writeFile(join(root, file), text);
    if (file.endsWith("/rg")) await chmod(join(root, file), 0o755);
  }
  return root;
}

describe("platform release packaging", () => {
  it("keeps explicit Marketplace targets, ARM host mapping, Universal inventory and preview names", async () => {
    const {releaseTargets, universalBinaries, packageName}: ReleaseTargets = await script("release-targets");
    assert.deepEqual(releaseTargets.map(item => item.target), ["win32-x64", "win32-arm64", "linux-x64", "linux-arm64", "linux-armhf", "darwin-x64", "darwin-arm64", "universal"]);
    assert.equal(releaseTargets.find(item => item.target === "linux-armhf")?.binary, "linux-arm");
    assert.equal(universalBinaries.length, 12);
    assert.equal(new Set(universalBinaries).size, 12);
    assert.equal(packageName({name: "c-insight", version: "0.0.1"}, "linux-x64", "platform-packages-preview"), "c-insight-0.0.1-linux-x64-platform-packages-preview.vsix");
    assert.throws(() => packageName({name: "c-insight", version: "0.0.1"}, "web"), /Unsupported/);
    assert.throws(() => packageName({name: "c-insight", version: "0.0.1"}, "universal", "../escape"), /suffix/);
  });

  it("creates and checks all real VSIX archives without pruning developer files", async t => {
    const root = await fixture(), options = {root, outDir: join(root, "output"), suffix: "packaging-preview"};
    const {packageRelease}: {packageRelease(options: ReleaseOptions): Promise<PackageResult[]>} = await script("package-release");
    const {verifyReleaseAssets, sha256}: {verifyReleaseAssets(options: ReleaseOptions): Promise<PackageResult[]>; sha256(bytes: Buffer): string} = await script("verify-release-assets");
    try {
      const results = await packageRelease(options);
      assert.equal(results.length, 8);
      assert(results.slice(0, 7).every(item => item.binaries === 1));
      assert.equal(results.at(-1)?.binaries, 12);
      assert.equal(await readFile(join(root, "dist/ripgrep/sentinel.txt"), "utf8"), "Keep the developer build untouched");
      assert.deepEqual(await readdir(join(root, "dist/ripgrep")), ["sentinel.txt"]);
      for (const result of results) {
        const zip = await JSZip.loadAsync(await readFile(join(options.outDir, result.name)));
        assert(!zip.file("extension/.cache/private.txt"));
        assert(!zip.file("extension/dist/ripgrep/sentinel.txt"));
      }
      const selected = results.find(result => result.target === "linux-armhf")!;
      const archive = join(options.outDir, selected.name), original = await readFile(archive);
      const sumsPath = join(options.outDir, "SHA256SUMS"), originalSums = await readFile(sumsPath, "utf8");
      async function changedZip(change: (zip: JSZip) => void, expected: RegExp): Promise<void> {
        try {
          const zip = await JSZip.loadAsync(original);
          change(zip);
          const bytes = await zip.generateAsync({type: "nodebuffer", platform: "UNIX", compression: "DEFLATE"});
          await writeFile(archive, bytes);
          await writeFile(sumsPath, originalSums.replace(selected.sha256, sha256(bytes)));
          await assert.rejects(verifyReleaseAssets(options), expected);
        } finally { await writeFile(archive, original); await writeFile(sumsPath, originalSums); }
      }
      await t.test("rejects an unrelated native executable even with a valid checksum", () => changedZip(zip => {
        zip.file("extension/dist/ripgrep/linux-x64/rg", "wrong platform", {unixPermissions: 0o100755});
      }, /wrong native executable set/));
      await t.test("rejects altered binaries", () => changedZip(zip => {
        zip.file("extension/dist/ripgrep/linux-arm/rg", "changed", {unixPermissions: 0o100755});
      }, /changed native executable/));
      await t.test("rejects lost executable permission", () => changedZip(zip => {
        zip.file("extension/dist/ripgrep/linux-arm/rg")!.unixPermissions = 0o100644;
      }, /executable permission/));
      await t.test("rejects a missing license", () => changedZip(zip => { zip.remove("extension/dist/ripgrep/LICENSE"); }, /missing.*LICENSE/));
      await t.test("rejects a missing runtime asset", () => changedZip(zip => { zip.remove("extension/dist/textSearchWorker.js"); }, /missing.*textSearchWorker/));
      await t.test("rejects differing shared code", () => changedZip(zip => { zip.file("extension/dist/extension.js", "// changed"); }, /content differs/));
      await t.test("rejects a wrong platform label", async () => {
        const zip = await JSZip.loadAsync(original), xml = await zip.file("extension.vsixmanifest")!.async("string");
        await changedZip(candidate => { candidate.file("extension.vsixmanifest", xml.replace('TargetPlatform="linux-armhf"', 'TargetPlatform="linux-x64"')); }, /incorrect install target/);
      });
      await t.test("rejects bad and incomplete checksum manifests", async () => {
        try {
          await writeFile(sumsPath, originalSums.replace(selected.sha256, "0".repeat(64)));
          await assert.rejects(verifyReleaseAssets(options), /Checksum mismatch/);
          await writeFile(sumsPath, originalSums.split("\n").slice(1).join("\n"));
          await assert.rejects(verifyReleaseAssets(options), /Missing VSIX checksums/);
          await writeFile(sumsPath, originalSums + originalSums.split("\n")[0] + "\n");
          await assert.rejects(verifyReleaseAssets(options), /duplicate checksum/);
        } finally { await writeFile(sumsPath, originalSums); }
      });
      await t.test("rejects stale output and preserves unrelated files", async () => {
        const unrelated = join(options.outDir, "unrelated.vsix");
        try {
          await writeFile(unrelated, "preserve");
          await assert.rejects(verifyReleaseAssets(options), /Unexpected or missing/);
          await assert.rejects(packageRelease(options), /unrelated VSIX/);
          assert.equal(await readFile(unrelated, "utf8"), "preserve");
        } finally { await rm(unrelated); }
      });
      assert.equal((await verifyReleaseAssets(options)).length, 8);
    } finally { await rm(root, {recursive: true, force: true}); }
  });

  it("publishes every verified package through one gated release workflow", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    assert.match(manifest.scripts["package:release"], /^npm run check && node scripts\/package-release\.mjs$/);
    const release = await readFile(".github/workflows/release.yml", "utf8");
    assert(release.indexOf("npm run package:release\n") < release.indexOf("npm run package:release:verify"));
    assert(release.indexOf("npm run package:release:verify") < release.indexOf("gh release create"));
    assert.match(release, /"\$packages"\/\*\.vsix/);
    assert.match(release, /"\$packages\/SHA256SUMS"/);
    assert.match(await readFile(".github/workflows/ci.yml", "utf8"), /node scripts\/package-release\.mjs/);
  });
});
