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
const guide = readFileSync("docs/user/user-guide.zh-CN.md", "utf8");

function resolveManifestMessage(value: string): string {
  const match = /^%(.+)%$/.exec(value);
  return match ? packageMessages[match[1]] ?? value : value;
}

describe("user guide completeness", () => {
  it("lists every contributed configuration with its default value", () => {
    for (const [key, configuration] of Object.entries(
      manifest.contributes.configuration.properties,
    )) {
      const row = guide
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

  it("lists every contributed command ID exactly once", () => {
    const commandReference = guide.slice(
      guide.indexOf("<!-- GENERATED COMMAND REFERENCE START -->"),
      guide.indexOf("<!-- GENERATED COMMAND REFERENCE END -->"),
    );
    for (const command of manifest.contributes.commands) {
      const matches =
        commandReference.split(`\`${command.command}\``).length - 1;
      assert.equal(
        matches,
        1,
        `Command reference mismatch: ${command.command}`,
      );
    }
  });

  it("describes every contributed view by name", () => {
    const lowerGuide = guide.toLowerCase();
    for (const view of Object.values(manifest.contributes.views).flat()) {
      const viewName = resolveManifestMessage(view.name);
      assert.ok(
        lowerGuide.includes(viewName.toLowerCase()),
        `Missing view documentation: ${view.id} (${viewName})`,
      );
    }
  });
});
