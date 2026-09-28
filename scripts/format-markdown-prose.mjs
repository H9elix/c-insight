import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const docsRoot = path.join(repositoryRoot, "docs");
const githubRoot = path.join(repositoryRoot, ".github");
const rootMarkdown = [
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "PRIVACY.md",
  "README.md",
  "SECURITY.md",
];
const write = process.argv.includes("--write");
const stale = [];

for (const file of [
  ...rootMarkdown.map((file) => path.join(repositoryRoot, file)),
  ...markdownFiles(docsRoot),
  ...markdownFiles(githubRoot),
]) {
  const source = readFileSync(file, "utf8");
  const formatted = unwrapMarkdownProse(source);
  if (formatted === source) continue;
  if (write) writeFileSync(file, formatted);
  else stale.push(path.relative(repositoryRoot, file));
}

if (stale.length > 0) {
  console.error(
    `Markdown prose contains hard-wrapped continuation lines:\n${stale
      .map((file) => `- ${file}`)
      .join("\n")}\nRun npm run docs:prose to normalize it.`,
  );
  process.exitCode = 1;
}

function markdownFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...markdownFiles(candidate));
    else if (entry.isFile() && entry.name.endsWith(".md")) result.push(candidate);
  }
  return result.sort();
}

function unwrapMarkdownProse(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const output = [];
  let paragraph = [];
  let fence;

  const flush = () => {
    if (paragraph.length === 0) return;
    let joined = paragraph[0].trimEnd();
    for (const line of paragraph.slice(1)) {
      const next = line.trim();
      joined += joinSeparator(joined, next) + next;
    }
    output.push(joined);
    paragraph = [];
  };

  for (const line of lines) {
    const fenceMatch = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) {
      output.push(line);
      if (fenceMatch?.[1].startsWith(fence)) fence = undefined;
      continue;
    }
    if (fenceMatch) {
      flush();
      output.push(line);
      fence = fenceMatch[1][0];
      continue;
    }
    if (line.trim() === "") {
      flush();
      output.push("");
      continue;
    }
    if (
      paragraph.length > 0 &&
      /^(\s*)([-+*]|\d+[.)])\s+/.test(paragraph[0]) &&
      /^ {2,}\S/.test(line) &&
      !/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)
    ) {
      paragraph.push(line);
      continue;
    }
    if (isStandalone(line)) {
      flush();
      output.push(line);
      continue;
    }
    if (/^(\s*)([-+*]|\d+[.)])\s+/.test(line)) {
      flush();
      paragraph = [line];
      continue;
    }
    if (paragraph.length === 0) {
      paragraph = [line];
      continue;
    }
    if (paragraph.at(-1).endsWith("  ") || paragraph.at(-1).endsWith("\\")) {
      flush();
      paragraph = [line];
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return `${output.join("\n").replace(/\n+$/, "")}\n`;
}

function joinSeparator(previous, next) {
  const left = previous.at(-1) ?? "";
  const right = next[0] ?? "";
  if (
    (/\p{Script=Han}/u.test(left) && /\p{Script=Han}/u.test(right)) ||
    "，。；：、？！/（【《“‘".includes(left) ||
    "，。；：、？！/）】》”’".includes(right)
  ) {
    return "";
  }
  return " ";
}

function isStandalone(line) {
  return (
    /^\s{0,3}#{1,6}\s/.test(line) ||
    /^\s{0,3}(?:=+|-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^\s*\|/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*<!--/.test(line) ||
    /^\s*<\/?[A-Za-z][^>]*>\s*$/.test(line) ||
    /^\s*\[[^\]]+\]:\s+/.test(line) ||
    /^ {4,}\S/.test(line)
  );
}
