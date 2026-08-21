import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CallOccurrenceInput,
  projectCallOccurrences,
} from "../../src/callHierarchy/callOccurrenceModel";

interface Relation {
  name: string;
}

describe("call occurrence projection", () => {
  it("flattens every call site and makes only the earliest site canonical", () => {
    const occurrences = projectCallOccurrences([
      input("add", "add", [range(10, 4), range(11, 4)]),
      input("main", "main", [range(21, 4), range(22, 4), range(23, 4)]),
    ]);

    assert.deepEqual(
      occurrences.map((occurrence) => ({
        name: occurrence.value.name,
        line: occurrence.range.start.line + 1,
        ordinal: occurrence.ordinal,
        total: occurrence.total,
        canonical: occurrence.canonical,
      })),
      [
        { name: "add", line: 11, ordinal: 1, total: 2, canonical: true },
        { name: "add", line: 12, ordinal: 2, total: 2, canonical: false },
        { name: "main", line: 22, ordinal: 1, total: 3, canonical: true },
        { name: "main", line: 23, ordinal: 2, total: 3, canonical: false },
        { name: "main", line: 24, ordinal: 3, total: 3, canonical: false },
      ],
    );
  });

  it("preserves global source order when different callees are interleaved", () => {
    const occurrences = projectCallOccurrences([
      input("foo", "foo", [range(2, 2), range(6, 2)]),
      input("bar", "bar", [range(4, 2)]),
    ]);

    assert.deepEqual(
      occurrences.map((occurrence) => [
        occurrence.value.name,
        occurrence.range.start.line,
        occurrence.canonical,
      ]),
      [
        ["foo", 2, true],
        ["bar", 4, true],
        ["foo", 6, false],
      ],
    );
  });

  it("deduplicates exact ranges and gives every occurrence a stable id", () => {
    const duplicate = input("add", "add", [range(10, 4), range(10, 4)]);
    const occurrences = projectCallOccurrences([duplicate, duplicate]);

    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].canonical, true);
    assert.match(occurrences[0].id, /add/);
    assert.equal(
      occurrences[0].id,
      projectCallOccurrences([duplicate])[0].id,
    );
  });

  it("uses the definition as an expandable fallback when ranges are absent", () => {
    const occurrences = projectCallOccurrences([
      input("missing", "missing", [], "file:///definition.c", range(30, 2)),
    ]);

    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].uri, "file:///definition.c");
    assert.equal(occurrences[0].range.start.line, 30);
    assert.equal(occurrences[0].fallback, true);
    assert.equal(occurrences[0].canonical, true);
  });

  it("sorts files, lines, columns and semantic keys deterministically", () => {
    const occurrences = projectCallOccurrences([
      input("z", "z", [range(1, 8)], "file:///z.c"),
      input("b", "b", [range(1, 2)], "file:///b.c"),
      input("a", "a", [range(1, 2)], "file:///b.c"),
    ]);

    assert.deepEqual(
      occurrences.map((occurrence) => occurrence.semanticKey),
      ["a", "b", "z"],
    );
  });
});

function input(
  semanticKey: string,
  name: string,
  ranges: ReturnType<typeof range>[],
  uri = "file:///main.c",
  fallbackRange = range(100, 0),
): CallOccurrenceInput<Relation> {
  return {
    semanticKey,
    callSiteUri: uri,
    ranges,
    fallbackUri: uri,
    fallbackRange,
    value: { name },
  };
}

function range(line: number, character: number) {
  return {
    start: { line, character },
    end: { line, character: character + 3 },
  };
}
