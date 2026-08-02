import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const english = JSON.parse(
  readFileSync("package.nls.json", "utf8"),
) as Record<string, string>;
const chinese = JSON.parse(
  readFileSync("package.nls.zh-cn.json", "utf8"),
) as Record<string, string>;
const runtimeEnglish = JSON.parse(
  readFileSync("l10n/bundle.l10n.json", "utf8"),
) as Record<string, string>;
const runtimeChinese = JSON.parse(
  readFileSync("l10n/bundle.l10n.zh-cn.json", "utf8"),
) as Record<string, string>;

function collectMessageKeys(value: unknown, keys: Set<string>): void {
  if (typeof value === "string") {
    const match = /^%(.+)%$/.exec(value);
    if (match) keys.add(match[1]);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMessageKeys(item, keys);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectMessageKeys(item, keys);
  }
}

describe("manifest localization", () => {
  it("provides matching English and Simplified Chinese catalogs", () => {
    assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
    assert.deepEqual(
      Object.keys(runtimeChinese).sort(),
      Object.keys(runtimeEnglish).sort(),
    );
  });

  it("defines every message referenced by package.json", () => {
    const keys = new Set<string>();
    collectMessageKeys(manifest, keys);
    for (const key of keys) {
      assert.ok(english[key], `Missing default message: ${key}`);
      assert.ok(chinese[key], `Missing zh-cn message: ${key}`);
    }
  });

  it("localizes all command, view, welcome, and configuration descriptions", () => {
    for (const command of manifest.contributes.commands) {
      assert.match(command.title, /^%.+%$/);
    }
    for (const view of Object.values(manifest.contributes.views).flat() as Array<{ name: string }>) {
      assert.match(view.name, /^%.+%$/);
    }
    for (const welcome of manifest.contributes.viewsWelcome as Array<{ contents: string }>) {
      assert.match(welcome.contents, /^%.+%$/);
    }
    for (const setting of Object.values(manifest.contributes.configuration.properties) as Array<{
      description?: string;
      enumDescriptions?: string[];
    }>) {
      if (setting.description) assert.match(setting.description, /^%.+%$/);
      for (const description of setting.enumDescriptions ?? []) {
        assert.match(description, /^%.+%$/);
      }
    }
  });

  it("keeps translatable UI terminology localized in Chinese catalogs", () => {
    const manifestMessages = Object.values(chinese).join("\n");
    const runtimeMessages = Object.values(runtimeChinese).join("\n");

    assert.doesNotMatch(manifestMessages, /\bProvider\b/);
    assert.doesNotMatch(runtimeMessages, /\bProvider\b/);
    assert.doesNotMatch(runtimeMessages, /C\/C\+\+ language service/);
    assert.doesNotMatch(manifestMessages, /筛选按/);
  });

  it("uses consistent spacing between Chinese and Latin-script terms", () => {
    const messages = [...Object.values(chinese), ...Object.values(runtimeChinese)];
    for (const message of messages) {
      assert.doesNotMatch(message, /[\p{Script=Han}][A-Za-z]/u, message);
      assert.doesNotMatch(message, /[A-Za-z0-9][\p{Script=Han}]/u, message);
    }
  });

  it("uses stable Chinese verbs and result-state terminology", () => {
    assert.equal(runtimeChinese["No navigation history"], "暂无导航历史");
    assert.equal(runtimeChinese["No bookmarks"], "暂无书签");
    assert.match(runtimeChinese["No references found"], /未找到/);
    assert.match(runtimeChinese["Callers unavailable"], /不可用/);
    assert.match(runtimeChinese["References query failed"], /查询失败/);
    assert.match(chinese["command.cInsight.relationshipGraph.show.title"], /显示/);
    assert.match(chinese["command.cInsight.openProjectDiagnostics.title"], /打开/);
    assert.match(chinese["command.cInsight.history.clear.title"], /清除/);
    assert.match(runtimeChinese["Reset Layout"], /重置/);
  });
});
