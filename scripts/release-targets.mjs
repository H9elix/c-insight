import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

// Marketplace target names are not always Node.js platform/architecture names.
export const releaseTargets = Object.freeze([
  {target: "win32-x64", binary: "win32-x64"},
  {target: "win32-arm64", binary: "win32-arm64"},
  {target: "linux-x64", binary: "linux-x64"},
  {target: "linux-arm64", binary: "linux-arm64"},
  {target: "linux-armhf", binary: "linux-arm"},
  {target: "darwin-x64", binary: "darwin-x64"},
  {target: "darwin-arm64", binary: "darwin-arm64"},
  {target: "universal"},
].map(Object.freeze));

export const universalBinaries = Object.freeze([
  "darwin-arm64", "darwin-x64", "linux-arm", "linux-arm64", "linux-ia32",
  "linux-ppc64", "linux-riscv64", "linux-s390x", "linux-x64",
  "win32-arm64", "win32-ia32", "win32-x64",
]);

export function binaryFile(platform) {
  return `${platform}/${platform.startsWith("win32-") ? "rg.exe" : "rg"}`;
}

export function packageName(manifest, target, suffix = "") {
  if (suffix && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(suffix)) throw new Error("Invalid temporary package suffix.");
  if (!releaseTargets.some(entry => entry.target === target)) throw new Error(`Unsupported release target: ${target}`);
  return `${manifest.name}-${manifest.version}-${target}${suffix ? `-${suffix}` : ""}.vsix`;
}

export async function releaseArguments(args = process.argv.slice(2)) {
  const {values} = parseArgs({args, options: {"out-dir": {type: "string"}, suffix: {type: "string"}}});
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
  return {root: repositoryRoot, outDir: resolve(values["out-dir"] ?? `.cache/release-packages/${manifest.version}`), suffix: values.suffix ?? ""};
}
