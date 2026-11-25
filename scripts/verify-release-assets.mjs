import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { binaryFile, packageName, releaseArguments, releaseTargets, repositoryRoot, universalBinaries } from "./release-targets.mjs";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** Validate the files that will actually be attached, not the staging directory. */
export async function verifyReleaseAssets({root = repositoryRoot, outDir, suffix = ""}) {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const names = releaseTargets.map(({target}) => packageName(manifest, target, suffix)).sort();
  assert.deepEqual((await readdir(outDir)).filter(name => name.endsWith(".vsix")).sort(), names, "Unexpected or missing release VSIX");
  const sums = new Map();
  for (const line of (await readFile(resolve(outDir, "SHA256SUMS"), "utf8")).trim().split("\n")) {
    const match = /^([a-f0-9]{64}) {2}([a-zA-Z0-9._-]+\.vsix)$/.exec(line);
    assert(match && names.includes(match[2]) && !sums.has(match[2]), `Invalid or duplicate checksum entry: ${line}`);
    sums.set(match[2], match[1]);
  }
  assert.equal(sums.size, names.length, "Missing VSIX checksums");
  const nativeRoot = resolve(root, "node_modules/@vscode/ripgrep-universal");
  assert.deepEqual((await readdir(resolve(nativeRoot, "bin"))).sort(), [...universalBinaries], "Review the changed native platform inventory");
  const nativeHashes = new Map(await Promise.all(universalBinaries.map(async platform => {
    const file = binaryFile(platform);
    return [file, sha256(await readFile(resolve(nativeRoot, "bin", file)))];
  })));
  const licenseHash = sha256(await readFile(resolve(nativeRoot, "LICENSE")));
  let commonPayload;
  const results = [];
  for (const {target, binary} of releaseTargets) {
    const name = packageName(manifest, target, suffix), bytes = await readFile(resolve(outDir, name));
    assert.equal(sha256(bytes), sums.get(name), `Checksum mismatch: ${name}`);
    const zip = await JSZip.loadAsync(bytes, {checkCRC32: true});
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    const entry = file => {
      const found = zip.file(file);
      assert(found, `${name}: missing ${file}`);
      return found;
    };
    const identity = /<Identity\b[^>]*\/?\s*>/.exec(await entry("extension.vsixmanifest").async("string"))?.[0];
    assert(identity, `${name}: missing VSIX identity`);
    for (const [attribute, value] of [["Id", manifest.name], ["Version", manifest.version], ["Publisher", manifest.publisher]]) {
      assert.equal(new RegExp(`\\b${attribute}="([^"]+)"`).exec(identity)?.[1], value, `${name}: incorrect VSIX ${attribute}`);
    }
    const platform = /\bTargetPlatform="([^"]+)"/.exec(identity)?.[1];
    assert.equal(platform, target === "universal" ? undefined : target, `${name}: incorrect install target`);
    const packaged = JSON.parse(await entry("extension/package.json").async("string"));
    for (const key of ["name", "version", "publisher"]) assert.equal(packaged[key], manifest[key], `${name}: incorrect ${key}`);
    // vsce canonicalizes the root README and license names inside the archive.
    for (const file of ["dist/extension.js", "dist/textSearchWorker.js", "dist/codicons/codicon.css", "dist/codicons/codicon.ttf", "LICENSE.txt", "readme.md", "README.zh-CN.md", "THIRD_PARTY_NOTICES.md"]) entry(`extension/${file}`);
    const prefix = "extension/dist/ripgrep/";
    const nativeFiles = entries.filter(file => file.name.startsWith(prefix) && file.name !== `${prefix}LICENSE`);
    const expected = (binary ? [binary] : universalBinaries).map(binaryFile).sort();
    assert.deepEqual(nativeFiles.map(file => file.name.slice(prefix.length)).sort(), expected, `${name}: wrong native executable set`);
    assert.equal(sha256(await entry(`${prefix}LICENSE`).async("nodebuffer")), licenseHash, `${name}: incorrect native license`);
    for (const file of nativeFiles) {
      const relative = file.name.slice(prefix.length);
      assert.equal(sha256(await file.async("nodebuffer")), nativeHashes.get(relative), `${name}: changed native executable`);
      if (!relative.startsWith("win32-")) assert(Number(file.unixPermissions) & 0o111, `${name}: lost native executable permission`);
    }
    const payload = await Promise.all(entries.filter(file => file.name.startsWith("extension/") && !file.name.startsWith(prefix))
      .sort((a, b) => a.name.localeCompare(b.name)).map(async file => [file.name, sha256(await file.async("nodebuffer"))]));
    if (commonPayload) assert.deepEqual(payload, commonPayload, `${name}: platform-independent content differs`);
    else commonPayload = payload;
    results.push({name, target, bytes: bytes.length, binaries: expected.length, sha256: sums.get(name)});
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const result of await verifyReleaseAssets(await releaseArguments())) console.log(`${result.name}: verified (${result.binaries} native binaries)`);
}
