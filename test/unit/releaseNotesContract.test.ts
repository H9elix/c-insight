import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
  scripts?: Record<string, string>;
};
const tag = `v${manifest.version}`;
const notesPath = `docs/releases/${tag}.md`;

describe("release notes contract", () => {
  it("keeps curated bilingual notes for the package version", () => {
    assert.equal(existsSync(notesPath), true, `Missing ${notesPath}`);
    const notes = readFileSync(notesPath, "utf8");
    assert.match(notes, new RegExp(`^# C Insight ${manifest.version.replaceAll(".", "\\.")}$`, "m"));
    assert.match(notes, /^## 中文$/m);
    assert.match(notes, /^## English$/m);
    assert.doesNotMatch(
      notes,
      /^## (?:安装与校验|验证|保留边界|已知限制|Installation and verification|Validation|Known limitations)(?:\s|$)/mi,
    );
    assert.match(notes, new RegExp(`https://github\\.com/H9elix/c-insight/compare/[^\\s]+\\.\\.${tag.replaceAll(".", "\\.")}`));
    assert.doesNotMatch(notes, /\b(?:TODO|TBD)\b/i);
  });

  it("publishes the curated file through the release workflow", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    assert.match(workflow, /npm run release:notes:check/);
    assert.match(
      workflow,
      /--notes-file "docs\/releases\/\$GITHUB_REF_NAME\.md"/,
    );
    assert.doesNotMatch(workflow, /--generate-notes/);
    assert.match(manifest.scripts?.check ?? "", /release:notes:check/);
  });
});
