import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface Manifest {
  contributes: {
    commands: Array<{ command: string; title: string }>;
    configuration: {
      properties: Record<string, { default?: unknown }>;
    };
    views: Record<string, Array<{ id: string; name: string }>>;
  };
}

const manifest = JSON.parse(
  readFileSync("package.json", "utf8"),
) as Manifest;
const packageMessages = JSON.parse(
  readFileSync("package.nls.json", "utf8"),
) as Record<string, string>;
const chineseMessages = JSON.parse(
  readFileSync("package.nls.zh-cn.json", "utf8"),
) as Record<string, string>;
const chineseGuide = readFileSync("docs/user/user-guide.zh-CN.md", "utf8");
const englishGuide = readFileSync("docs/user/user-guide.en.md", "utf8");

describe("user guide completeness", () => {
  it("lists every contributed configuration with its default value", () => {
    for (const [key, configuration] of Object.entries(
      manifest.contributes.configuration.properties,
    )) {
      const row = chineseGuide
        .split("\n")
        .find((line) => line.includes(`| \`${key}\` |`));
      assert.ok(row, `Missing configuration documentation: ${key}`);
      if (configuration.default !== undefined) {
        const serialized =
          JSON.stringify(configuration.default);
        assert.ok(
          row.replaceAll(" ", "").includes(`\`${serialized}\``),
          `Incorrect or missing default for ${key}: ${serialized}`,
        );
      }
    }
  });

  it("lists every contributed command ID exactly once in both guides", () => {
    for (const [language, guide] of [
      ["zh-CN", chineseGuide],
      ["en", englishGuide],
    ]) {
      const commandReference = guide.slice(
        guide.indexOf("<!-- GENERATED COMMAND REFERENCE START -->"),
        guide.indexOf("<!-- GENERATED COMMAND REFERENCE END -->"),
      );
      for (const command of manifest.contributes.commands) {
        const matches = commandReference.split(`\`${command.command}\``).length - 1;
        assert.equal(matches, 1, `${language} command reference mismatch: ${command.command}`);
      }
    }
  });

  it("describes every contributed view by name in both guides", () => {
    for (const [language, guide, messages] of [
      ["zh-CN", chineseGuide, chineseMessages],
      ["en", englishGuide, packageMessages],
    ] as const) {
      const lowerGuide = guide.toLowerCase();
      for (const view of Object.values(manifest.contributes.views).flat()) {
        const match = /^%(.+)%$/.exec(view.name);
        const viewName = match ? messages[match[1]] ?? view.name : view.name;
        assert.ok(
          lowerGuide.includes(viewName.toLowerCase()),
          `Missing ${language} view documentation: ${view.id} (${viewName})`,
        );
      }
    }
  });

  it("lists every configuration family in the English guide", () => {
    const families = new Set(
      Object.keys(manifest.contributes.configuration.properties).map((key) =>
        key.split(".").slice(0, 2).join("."),
      ),
    );
    for (const family of families) {
      assert.ok(
        englishGuide.includes(family),
        `Missing English configuration family: ${family}`,
      );
    }
  });
});
