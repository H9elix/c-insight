import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { projectFileFollowAction, ProjectFileFollowState } from "../../src/projectFiles/projectFileFollowModel";
import { parseResultTreeMessage } from "../../src/views/resultTreeWebview";

const normal: ProjectFileFollowState = { locked: false, visible: true, windowFocused: true, viewFocused: false,
  interacting: false, opening: false, hasTarget: true, followEnabled: true, opened: false };

describe("Project Files automatic follow policy", () => {
  it("conditionally clears during editor following and always clears after a successful open", () => {
    assert.deepEqual(projectFileFollowAction(normal), { clear: "ifHidden", reveal: true });
    assert.deepEqual(projectFileFollowAction({ ...normal, opened: true }), { clear: "always", reveal: true });
  });
  for (const field of ["locked", "viewFocused", "interacting", "opening"] as const) {
    it(`defers all automatic actions while ${field}`, () => {
      assert.equal(projectFileFollowAction({ ...normal, [field]: true }), undefined);
      assert.equal(projectFileFollowAction({ ...normal, [field]: true, opened: true }), undefined);
    });
  }
  for (const field of ["visible", "windowFocused", "hasTarget"] as const) {
    it(`does not clear or scroll without ${field}`, () => {
      assert.equal(projectFileFollowAction({ ...normal, [field]: false, opened: true }), undefined);
    });
  }
  it("does not turn a presentation preference into the lock state", () => {
    assert.equal(projectFileFollowAction({ ...normal, followEnabled: false }), undefined);
    assert.deepEqual(projectFileFollowAction({ ...normal, followEnabled: false, opened: true }), { clear: "always", reveal: false });
  });
  it("validates focus/input metadata and keeps legacy activation messages compatible", () => {
    assert.deepEqual(parseResultTreeMessage({ type: "interaction", focused: true, inputRevision: 3, uri: "ignored" }),
      { type: "interaction", focused: true, inputRevision: 3 });
    for (const inputRevision of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", undefined]) {
      assert.equal(parseResultTreeMessage({ type: "interaction", focused: false, inputRevision }), undefined);
    }
    assert.deepEqual(parseResultTreeMessage({ type: "activate", id: "file", intent: "open" }), { type: "activate", id: "file", intent: "open" });
    assert.deepEqual(parseResultTreeMessage({ type: "activate", id: "file", intent: "open", inputRevision: 4 }),
      { type: "activate", id: "file", intent: "open", inputRevision: 4 });
  });
  it("keeps lock and unlock in the same title-bar slot", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const menu = manifest.contributes.menus["view/title"] as Array<{ command: string; group: string; when: string }>;
    const lock = menu.find(item => item.command === "cInsight.projectFiles.lock")!;
    const unlock = menu.find(item => item.command === "cInsight.projectFiles.unlock")!;
    assert.equal(lock.group, unlock.group);
    assert.match(lock.when, /!cInsight\.projectFilesLocked/);
    assert.match(unlock.when, /&& cInsight\.projectFilesLocked/);
  });
});
