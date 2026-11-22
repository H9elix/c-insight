import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  it("numbers every guide heading continuously without skipped levels", () => {
    for (const [language, guide] of [["zh-CN", chineseGuide], ["en", englishGuide]]) {
      const expected: number[] = [];
      let fence: string | undefined;
      for (const line of guide.split("\n")) {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1][0];
        if (marker) { fence = fence === marker ? undefined : marker; continue; }
        if (fence || !/^#{2,6} /.test(line)) continue;
        const heading = /^(#{2,6}) (\d+(?:\.\d+)*)\.? (.+)$/.exec(line);
        assert(heading, `${language}: unnumbered heading: ${line}`);
        const depth = heading[1].length - 2;
        const actual = heading[2].split(".").map(Number);
        assert.equal(actual.length, depth + 1, `${language}: heading depth mismatch: ${line}`);
        assert(depth <= expected.length, `${language}: skipped parent: ${line}`);
        expected.length = depth + 1;
        expected[depth] = (expected[depth] ?? 0) + 1;
        assert.deepEqual(actual, expected, `${language}: non-continuous numbering: ${line}`);
      }
    }
  });

  it("gives exactly fifteen independent views their own functional-view subsections", () => {
    const views = Object.values(manifest.contributes.views).flat().filter(view => !/^cInsight\.combined[1-4]$/.test(view.id));
    assert.equal(views.length, 15);
    for (const [language, guide, messages] of [["zh-CN", chineseGuide, chineseMessages], ["en", englishGuide, packageMessages]] as const) {
      const headings = [...guide.matchAll(/^### 3\.\d+ (.+)$/gm)].map(match => match[1]);
      assert.equal(headings.length, 15, `${language}: non-view content must not become a functional-view subsection`);
      views.forEach((view, index) => {
        const key = /^%(.+)%$/.exec(view.name)![1];
        assert(headings[index].includes(messages[key]), `${language}: missing or misplaced view: ${view.id}`);
      });
      assert(guide.indexOf("## 3.") < guide.indexOf(language === "zh-CN" ? "## 7. 总体更新逻辑" : "## 6. Update logic"));
    }
  });

  it("keeps README view inventories complete and separate from combinations", () => {
    for (const language of ["zh-CN", "en"]) {
      const readme = readFileSync(language === "en" ? "README.md" : "README.zh-CN.md", "utf8");
      const rows = readme.split("\n").filter(line => /^\| \d+ \|/.test(line));
      assert.equal(rows.length, 15, `${language}: expected fifteen numbered independent views`);
      assert(rows.every(row => row.includes("user-guide.") && row.includes("#view-")));
      assert.equal(new Set(rows.map(row => /#view-([^)]*)/.exec(row)?.[1])).size, 15, `${language}: duplicate view link`);
      const messages = language === "en" ? packageMessages : chineseMessages;
      Object.values(manifest.contributes.views).flat().filter(view => !/^cInsight\.combined[1-4]$/.test(view.id)).forEach((view, index) => {
        const key = /^%(.+)%$/.exec(view.name)![1];
        assert(rows[index].includes(messages[key]), `${language}: missing README view ${view.id}`);
      });
      assert(readme.includes("#combined-views"));
    }
  });

  it("keeps references to guide fragments valid across the current documentation", () => {
    function markdownFiles(folder: string): string[] {
      return readdirSync(folder, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
        ? markdownFiles(`${folder}/${entry.name}`) : entry.name.endsWith(".md") ? [`${folder}/${entry.name}`] : []);
    }
    const guides = new Map(["zh-CN", "en"].map(language => {
      const path = resolve(`docs/user/user-guide.${language}.md`);
      const source = readFileSync(path, "utf8");
      const anchors = [...source.matchAll(/<a id="([^"]+)"/g)].map(match => match[1]);
      assert(anchors.every(id => /^[\p{L}\p{N}_-]+$/u.test(id)), `${path}: invalid anchor`);
      const ids = new Set(anchors);
      assert.equal(ids.size, anchors.length, `${path}: duplicate anchor`);
      return [path, ids] as const;
    }));
    for (const file of ["README.md", "README.zh-CN.md", ...markdownFiles("docs")]) {
      const source = readFileSync(file, "utf8").replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, "");
      for (const link of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = link[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || !target.includes("#")) continue;
        const [name, fragment] = target.split("#");
        const ids = guides.get(name ? resolve(dirname(file), name) : resolve(file));
        if (ids && fragment) assert(ids.has(decodeURIComponent(fragment)), `${file}: broken user-guide fragment ${target}`);
      }
    }
  });

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
