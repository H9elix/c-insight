import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  functionLocationSignature,
  independentDeclarationLocations,
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

  it("keeps every independent declaration in provider order", () => {
    const definition = location("file:///source.c", 20);
    const first = location("file:///first.h", 4);
    const second = location("file:///second.h", 8);

    assert.deepEqual(
      independentDeclarationLocations(
        [definition],
        [first, definition, first, second],
      ),
      [first, second],
    );
  });

  it("hides a declaration already represented by the tree node", () => {
    const declaration = location("file:///header.h", 4);
    assert.deepEqual(
      independentDeclarationLocations([], [declaration], declaration),
      [],
    );
  });

  it("uses a distinct call provider location when definition returns the declaration", () => {
    const declaration = location("file:///header.h", 4);
    const callSite = location("file:///caller.c", 30);
    const providerDefinition = location("file:///source.c", 20);
    assert.deepEqual(
      independentDeclarationLocations(
        [declaration],
        [declaration],
        callSite,
        providerDefinition,
      ),
      [declaration],
    );
  });

  it("hides a provider location returned by both definition and declaration", () => {
    const shared = location("file:///source.c", 20);
    const callSite = location("file:///caller.c", 30);
    assert.deepEqual(
      independentDeclarationLocations(
        [shared],
        [shared],
        callSite,
        shared,
      ),
      [],
    );
  });
});
