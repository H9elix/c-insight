import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const repositoryUrl = "https://github.com/H9elix/c-insight";
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  author?: { name?: string };
  repository?: { url?: string };
  homepage?: string;
  bugs?: { url?: string };
  scripts?: Record<string, string>;
};

describe("public repository contract", () => {
  it("publishes stable repository and maintainer metadata", () => {
    assert.equal(manifest.author?.name, "you_jinchun");
    assert.equal(manifest.repository?.url, `${repositoryUrl}.git`);
    assert.equal(manifest.homepage, `${repositoryUrl}#readme`);
    assert.equal(manifest.bugs?.url, `${repositoryUrl}/issues`);
    assert.doesNotMatch(
      manifest.scripts?.package ?? "",
      /allow-missing-repository/,
    );
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
