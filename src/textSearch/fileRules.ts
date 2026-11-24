import ignore, { type Ignore } from "ignore";
import { minimatch } from "minimatch";
import iconv from "iconv-lite";

export interface IgnoreLayer { base: string; rules: Ignore }
export function ignoreLayer(base: string, text: string): IgnoreLayer { return {base, rules: ignore().add(text)}; }
export function isIgnored(path: string, directory: boolean, layers: IgnoreLayer[]): boolean {
  let ignored = false;
  for (const layer of layers) {
    if (!path.startsWith(layer.base)) continue;
    const relative = path.slice(layer.base.length) + (directory ? "/" : "");
    if (!relative) continue;
    const result = layer.rules.test(relative);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}
export function matchesPatterns(path: string, patterns: string): boolean {
  return patterns.split(",").map(value => value.trim()).filter(Boolean)
    .some(pattern => minimatch(path, pattern, {dot: true, matchBase: !pattern.includes("/")}));
}
export function excludedBySettings(path: string, rules: Record<string, unknown>, siblings: readonly string[]): boolean {
  return Object.entries(rules).some(([pattern, value]) => {
    if (!value || !minimatch(path, pattern, {dot: true})) return false;
    if (value === true) return true;
    if (typeof value !== "object" || !("when" in value) || typeof value.when !== "string") return false;
    const name = path.split("/").at(-1)!, base = name.replace(/\.[^.]*$/, "");
    return siblings.includes(value.when.replace(/\$\(basename\)/g, base));
  });
}
export function decodeSearchFile(bytes: Uint8Array, configuredEncoding: string): string {
  let encoding = configuredEncoding.toLowerCase();
  const buffer = Buffer.from(bytes);
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = "utf16le";
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = "utf16be";
  else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) encoding = "utf8";
  if (!iconv.encodingExists(encoding)) throw new Error("Unsupported encoding.");
  if (!/^utf[-_]?16/.test(encoding) && buffer.subarray(0, 8192).includes(0)) throw new Error("Binary file.");
  const text = iconv.decode(buffer, encoding);
  if (text.includes("\ufffd")) throw new Error("Uncertain text encoding.");
  return text;
}
