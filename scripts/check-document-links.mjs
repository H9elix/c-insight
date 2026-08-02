import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", "dist", ".vscode-test"]);

function collectMarkdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collectMarkdownFiles(path));
    else if (extname(path).toLowerCase() === ".md") files.push(path);
  }
  return files;
}

function stripCodeFences(source) {
  return source.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, "");
}

function localTarget(rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, "");
  if (!target || target.startsWith("#")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return undefined;
  return decodeURIComponent(target.split(/[?#]/, 1)[0]);
}

const failures = [];
let checked = 0;
for (const file of collectMarkdownFiles(root)) {
  const source = stripCodeFences(readFileSync(file, "utf8"));
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of source.matchAll(linkPattern)) {
    const target = localTarget(match[1]);
    if (!target) continue;
    checked += 1;
    const resolved = target.startsWith("/")
      ? resolve(root, `.${target}`)
      : resolve(dirname(file), target);
    if (!existsSync(resolved)) {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(`${relative(root, file)}:${line} -> ${match[1]}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Broken local documentation links:\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation links are valid (${checked} local targets).`);
}
