import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

const repositoryUrl = "https://github.com/H9elix/c-insight";
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  author?: { name?: string };
  repository?: { url?: string };
  homepage?: string;
  bugs?: { url?: string };
  files?: string[];
  scripts?: Record<string, string>;
};

describe("public repository contract", () => {
  it("publishes stable repository and maintainer metadata", () => {
    assert.equal(manifest.author?.name, "H9elix");
    assert.equal(manifest.repository?.url, `${repositoryUrl}.git`);
    assert.equal(manifest.homepage, `${repositoryUrl}#readme`);
    assert.equal(manifest.bugs?.url, `${repositoryUrl}/issues`);
    assert.doesNotMatch(
      manifest.scripts?.package ?? "",
      /allow-missing-repository/,
    );
  });

  it("publishes linked English and Simplified Chinese landing pages", () => {
    const englishReadme = readFileSync("README.md", "utf8");
    const chineseReadme = readFileSync("README.zh-CN.md", "utf8");
    assert.match(englishReadme, /\[阅读简体中文 README\]\(README\.zh-CN\.md\)/);
    assert.match(chineseReadme, /\[Read the English README\]\(README\.md\)/);
    assert.equal(manifest.files?.includes("README.md"), true);
    assert.equal(manifest.files?.includes("README.zh-CN.md"), true);
  });

  it("publishes bounded README media without adding it to the VSIX", () => {
    const englishReadme = readFileSync("README.md", "utf8");
    const chineseReadme = readFileSync("README.zh-CN.md", "utf8");
    const assets = [
      "overview.png",
      "core-navigation.gif",
      "call-hierarchy.gif",
      "relationship-graph.gif",
    ];
    let totalBytes = 0;
    for (const asset of assets) {
      const path = `.github/readme-assets/${asset}`;
      assert.equal(existsSync(path), true, `Missing README asset: ${path}`);
      assert.match(englishReadme, new RegExp(`\\(${path.replaceAll(".", "\\.")}\\)`));
      assert.match(chineseReadme, new RegExp(`\\(${path.replaceAll(".", "\\.")}\\)`));
      const bytes = statSync(path).size;
      totalBytes += bytes;
      assert.ok(bytes <= 5 * 1024 * 1024, `${path} exceeds 5 MiB`);
    }
    assert.ok(totalBytes <= 12 * 1024 * 1024, "README media exceeds 12 MiB");
    assert.equal(manifest.files?.some((file) => file.startsWith(".github/")), false);
  });

  it("keeps local state and machine-specific test paths out of publication", () => {
    assert.match(readFileSync(".gitignore", "utf8"), /^\.vscode\/$/m);
    for (const file of [
      "scripts/acceptance-ffmpeg.mjs",
      "test/e2e/runFfmpegMicrosoftTest.ts",
    ]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /\/home\//);
    }
  });

  it("includes public contribution, automation, and security entry points", () => {
    for (const file of [
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      ".github/dependabot.yml",
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      ".github/ISSUE_TEMPLATE/feature_request.yml",
      ".github/PULL_REQUEST_TEMPLATE.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "PRIVACY.md",
      "THIRD_PARTY_NOTICES.md",
    ]) {
      assert.equal(existsSync(file), true, `Missing public repository file: ${file}`);
    }
    assert.match(
      readFileSync("SECURITY.md", "utf8"),
      /Report a vulnerability/,
    );
  });
});
