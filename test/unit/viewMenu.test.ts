import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
describe("view discovery menu contracts", () => {
  it("keeps seven ordered top-level entries and moves six navigation actions to a localized submenu", () => {
    const items = manifest.contributes.menus["editor/context"];
    assert.deepEqual(items.map((item: any) => item.command ?? item.submenu), ["cInsight.openView", "cInsight.bookmarks.addCurrent",
      "cInsight.includeHierarchy.showIncludes", "cInsight.includeHierarchy.showIncludedBy", "cInsight.relationshipGraph.show", "cInsight.relationshipGraph.showFile", "cInsight.symbolNavigation"]);
    assert.deepEqual(items.map((item: any) => item.group), Array.from({length: 7}, (_, index) => `2_cInsight@${index + 1}`));
    assert(items.every((item: any) => item.when === "resourceLangId == c || resourceLangId == cpp || resourceLangId == objective-c || resourceLangId == objective-cpp"));
    const navigation = manifest.contributes.menus["cInsight.symbolNavigation"];
    assert.deepEqual(navigation.map((item: any) => item.command), ["cInsight.goToDefinition", "cInsight.findReferences", "cInsight.showIncomingCalls", "cInsight.showOutgoingCalls", "cInsight.typeHierarchy.showSupertypes", "cInsight.typeHierarchy.showSubtypes"]);
    assert.equal(navigation[2].when, "resourceLangId == c || resourceLangId == cpp");
    assert.equal(navigation[4].when, "resourceLangId == cpp || resourceLangId == objective-cpp");
    assert.match(manifest.contributes.submenus.find((menu: any) => menu.id === "cInsight.symbolNavigation").label, /^%.+%$/);
  });
  it("retains the Command Palette and definition/reference shortcuts", () => {
    assert.equal(manifest.contributes.menus.commandPalette, undefined);
    assert(manifest.contributes.keybindings.some((item: any) => item.command === "cInsight.goToDefinition" && item.key.toLowerCase() === "f12"));
    assert(manifest.contributes.keybindings.some((item: any) => item.command === "cInsight.findReferences" && item.key.toLowerCase() === "shift+f12"));
  });
  it("documents localized submenu ancestry, not the internal menu ID", () => {
    for (const [language, path] of [["zh-CN", "编辑器右键菜单 → C Insight：符号导航"], ["en", "Editor context menu → C Insight: Symbol Navigation"]]) {
      const guide = readFileSync(`docs/user/user-guide.${language}.md`, "utf8");
      const row = guide.split("\n").find(line => line.includes("`cInsight.goToDefinition`"));
      assert(row); assert(row.includes(path)); assert(!row.includes("cInsight.symbolNavigation"));
    }
  });
});
