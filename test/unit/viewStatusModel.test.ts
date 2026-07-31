import assert from "node:assert/strict";
import test from "node:test";
import {
  ViewStatusKind,
  viewStatusPresentation,
} from "../../src/utils/viewStatusModel";

test("view status kinds have stable, distinct context values", () => {
  const kinds: ViewStatusKind[] = [
    "idle",
    "loading",
    "empty",
    "cancelled",
    "stale",
    "limited",
    "error",
    "success",
  ];
  const contexts = kinds.map(
    (kind) => viewStatusPresentation(kind).contextValue,
  );
  assert.equal(new Set(contexts).size, kinds.length);
  assert.ok(contexts.every((value) => value.startsWith("cInsightStatus.")));
});

test("view status icons distinguish active and exceptional states", () => {
  assert.equal(viewStatusPresentation("loading").icon, "loading~spin");
  assert.equal(viewStatusPresentation("cancelled").icon, "circle-slash");
  assert.equal(viewStatusPresentation("stale").icon, "history");
  assert.equal(viewStatusPresentation("limited").icon, "warning");
  assert.equal(viewStatusPresentation("error").icon, "error");
});
