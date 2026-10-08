import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
);
const expectedTag = `v${manifest.version}`;
const releaseNotesPath = resolve(
  repositoryRoot,
  "docs",
  "releases",
  `${expectedTag}.md`,
);
const failures = [];

if (process.env.GITHUB_REF_NAME?.startsWith("v")) {
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    failures.push(
      `Tag ${process.env.GITHUB_REF_NAME} does not match package version ${manifest.version}.`,
    );
  }
}

if (!existsSync(releaseNotesPath)) {
  failures.push(`Missing curated release notes: docs/releases/${expectedTag}.md`);
} else {
  const releaseNotes = readFileSync(releaseNotesPath, "utf8");
  const requiredPatterns = [
    [`release heading`, new RegExp(`^# C Insight ${escapeRegExp(manifest.version)}$`, "m")],
    ["Chinese section", /^## 中文$/m],
    ["English section", /^## English$/m],
    [
      "installation and verification section",
      /^## 安装与校验 \/ Installation and verification$/m,
    ],
    [
      "version comparison link",
      new RegExp(
        `https://github\\.com/H9elix/c-insight/compare/[^\\s]+\\.\\.${escapeRegExp(expectedTag)}`,
      ),
    ],
  ];

  for (const [description, pattern] of requiredPatterns) {
    if (!pattern.test(releaseNotes)) {
      failures.push(`Release notes are missing the ${description}.`);
    }
  }
  if (/\b(?:TODO|TBD)\b/i.test(releaseNotes)) {
    failures.push("Release notes still contain a TODO or TBD placeholder.");
  }
}

if (failures.length > 0) {
  console.error(`Release notes contract failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Curated release notes are valid for ${expectedTag}.`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
