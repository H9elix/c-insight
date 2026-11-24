import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { COMBINED_ROLES } from "../../src/combined/combinedModel";
import { viewCatalog, type ViewCatalogLabels } from "../../src/views/viewCatalog";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const views = Object.values(manifest.contributes.views).flat() as Array<{id: string; name: unknown}>;
const labels: ViewCatalogLabels = {purposes: Object.fromEntries(COMBINED_ROLES.map(role => [role, `purpose:${role}`])) as ViewCatalogLabels["purposes"],
  combined: slot => `Combined View ${slot}`, create: "Create", manage: "Manage"};

describe("view discovery catalog", () => {
  it("lists exactly the sixteen independent panes in manifest order, with searchable aliases and purposes", () => {
    const entries = viewCatalog(views, [], labels);
    const independent = entries.filter(entry => entry.action === "view");
    assert.equal(independent.length, 16);
    assert.deepEqual(independent.map(entry => entry.viewId), views.filter(view => !view.id.includes("combined")).map(view => view.id));
    assert(independent.every(entry => entry.description && entry.detail));
    assert.deepEqual(entries.slice(-2).map(entry => entry.action), ["create", "manage"]);
  });
  it("accepts localized runtime metadata without treating objects as strings (CI-REG-050)", () => {
    const entries = viewCatalog([
      {id: "cInsight.callers", name: {value: "调用者", original: "Callers"}},
      {id: "cInsight.preview", name: {original: "Code Preview"}},
      {id: "cInsight.symbols", name: null}, {id: "foreign.callers", name: "Foreign"},
    ], [], labels);
    assert.deepEqual(entries.slice(0, 3).map(entry => entry.label), ["调用者", "Code Preview", "Document Symbols"]);
    assert.equal(entries.length, 5);
  });
  it("lists enabled slots only, disambiguates duplicate names and retains management actions when full", () => {
    const slots = Array.from({length: 4}, () => ({enabled: true, title: "Same", views: ["callers"]}));
    const enabled = viewCatalog(views, slots, labels).filter(entry => entry.action === "combined");
    assert.equal(enabled.length, 4);
    assert.deepEqual(enabled.map(entry => entry.description), [1, 2, 3, 4].map(labels.combined));
    assert.equal(viewCatalog(views, [{enabled: false}, null, {enabled: true}], labels).filter(entry => entry.action === "combined").length, 1);
  });
});
