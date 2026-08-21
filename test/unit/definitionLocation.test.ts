import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  functionLocationSignature,
  preferredFunctionLocation,
} from "../../src/utils/definitionLocation";

function location(uri: string, line: number) {
  return {
    uri: { toString: () => uri },
    range: {
      start: { line, character: 4 },
      end: { line, character: 12 },
    },
  };
}

describe("preferred function location", () => {
  it("prefers the first definition distinct from declarations", () => {
    const declaration = location("file:///api.h", 10);
    const definition = location("file:///impl.c", 20);
    assert.deepEqual(
      preferredFunctionLocation(
        [declaration, definition],
        [declaration],
      ),
      { location: definition, kind: "definition" },
    );
  });

  it("marks a shared provider location as a declaration fallback", () => {
    const declaration = location("file:///api.h", 10);
    assert.deepEqual(
      preferredFunctionLocation([declaration], [declaration]),
      { location: declaration, kind: "declaration-fallback" },
    );
  });

  it("uses declaration then call provider locations as bounded fallbacks", () => {
    const declaration = location("file:///api.h", 10);
    const callRoot = location("file:///other.h", 11);
    assert.equal(
      preferredFunctionLocation([], [declaration], callRoot)?.location,
      declaration,
    );
    assert.equal(
      preferredFunctionLocation([], [], callRoot)?.location,
      callRoot,
    );
    assert.equal(preferredFunctionLocation([], []), undefined);
  });

  it("includes quality and exact range in the display signature", () => {
    const value = location("file:///impl.c", 20);
    const definition = preferredFunctionLocation([value], []);
    const fallback = preferredFunctionLocation([value], [value]);
    assert.notEqual(
      functionLocationSignature(definition),
      functionLocationSignature(fallback),
    );
  });
});
