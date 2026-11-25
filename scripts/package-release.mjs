import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createVSIX, listFiles, PackageManager } from "@vscode/vsce";
import { binaryFile, packageName, releaseArguments, releaseTargets, repositoryRoot, universalBinaries } from "./release-targets.mjs";
import { sha256, verifyReleaseAssets } from "./verify-release-assets.mjs";

/** Stage the package whitelist only; never prune the working tree's dist assets. */
export async function packageRelease({root = repositoryRoot, outDir, suffix = ""}) {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const names = releaseTargets.map(({target}) => packageName(manifest, target, suffix));
  await mkdir(outDir, {recursive: true});
  const extras = (await readdir(outDir)).filter(file => file.endsWith(".vsix") && !names.includes(file));
  assert.equal(extras.length, 0, "Output contains unrelated VSIX files; choose a separate --out-dir.");
  const temporary = await mkdtemp(join(tmpdir(), "c-insight-packages-"));
  const stage = join(temporary, "extension"), output = join(temporary, "packages");
  try {
    await mkdir(output, {recursive: true});
    for (const file of await listFiles({cwd: root, packageManager: PackageManager.None})) {
      if (file.startsWith("dist/ripgrep/")) continue;
      const destination = join(stage, file);
      await mkdir(dirname(destination), {recursive: true});
      await cp(resolve(root, file), destination);
    }
    const source = resolve(root, "node_modules/@vscode/ripgrep-universal");
    assert.deepEqual((await readdir(join(source, "bin"))).sort(), [...universalBinaries], "Review the changed native platform inventory");
    for (const {target, binary} of releaseTargets) {
      const native = join(stage, "dist/ripgrep");
      await rm(native, {recursive: true, force: true});
      await mkdir(native, {recursive: true});
      await cp(join(source, "LICENSE"), join(native, "LICENSE"));
      for (const platform of binary ? [binary] : universalBinaries) {
        const file = binaryFile(platform);
        await mkdir(dirname(join(native, file)), {recursive: true});
        await cp(join(source, "bin", file), join(native, file));
      }
      await createVSIX({cwd: stage, packagePath: join(output, packageName(manifest, target, suffix)),
        target: target === "universal" ? undefined : target, dependencies: false, githubBranch: "main"});
    }
    const sums = await Promise.all([...names].sort().map(async name => `${sha256(await readFile(join(output, name)))}  ${name}\n`));
    await writeFile(join(output, "SHA256SUMS"), sums.join(""));
    const verified = await verifyReleaseAssets({root, outDir: output, suffix});
    for (const file of [...names, "SHA256SUMS"]) await cp(join(output, file), join(outDir, file));
    return verified;
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = await releaseArguments();
  for (const result of await packageRelease(options)) console.log(`${result.name}: ${(result.bytes / 1024 / 1024).toFixed(2)} MiB, ${result.binaries} native binaries`);
  console.log(`Verified release packages and SHA256SUMS: ${options.outDir}`);
}
