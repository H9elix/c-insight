import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TreeLocationClickClassifier } from "../../src/utils/treeLocationInteraction";

describe("tree location click classification", () => {
  it("previews first activation and opens the same node within the interval", () => {
    const classifier = new TreeLocationClickClassifier();
    assert.equal(classifier.classify("references:a", 500, 1_000), "preview");
    assert.equal(classifier.classify("references:a", 500, 1_500), "open");
  });

  it("does not combine different nodes or activations after the interval", () => {
    const classifier = new TreeLocationClickClassifier();
    assert.equal(classifier.classify("callers:a", 500, 1_000), "preview");
    assert.equal(classifier.classify("callers:b", 500, 1_100), "preview");
    assert.equal(classifier.classify("callers:b", 500, 1_601), "preview");
  });

  it("starts a new sequence after an open or reset", () => {
    const classifier = new TreeLocationClickClassifier();
    assert.equal(classifier.classify("symbols:a", 500, 1_000), "preview");
    assert.equal(classifier.classify("symbols:a", 500, 1_200), "open");
    assert.equal(classifier.classify("symbols:a", 500, 1_300), "preview");
    classifier.reset();
    assert.equal(classifier.classify("symbols:a", 500, 1_400), "preview");
  });

  it("does not treat a clock rollback as a double activation", () => {
    const classifier = new TreeLocationClickClassifier();
    assert.equal(classifier.classify("includes:a", 500, 1_000), "preview");
    assert.equal(classifier.classify("includes:a", 500, 900), "preview");
  });
});
