import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CallHierarchyItem } from "vscode-languageclient/node";
import {
  callHierarchyKey,
  findExplicitIndirectCalls,
  isRecursiveCall,
  looksLikeExplicitIndirectCall,
  recursionKind,
} from "../../src/utils/callHierarchy";

describe("call hierarchy utilities", () => {
  const item: CallHierarchyItem = {
    name: "calculate",
    kind: 12,
    uri: "file:///workspace/main.cpp",
    range: {
      start: { line: 1, character: 0 },
      end: { line: 3, character: 1 },
    },
    selectionRange: {
      start: { line: 1, character: 4 },
      end: { line: 1, character: 13 },
    },
  };

  it("creates a stable location-sensitive key", () => {
    assert.equal(
      callHierarchyKey(item),
      "file:///workspace/main.cpp:1:4:calculate",
    );
  });

  it("detects recursion only on the active ancestor path", () => {
    const key = callHierarchyKey(item);
    assert.equal(isRecursiveCall(key, ["another", key]), true);
    assert.equal(isRecursiveCall(key, ["another"]), false);
    assert.equal(recursionKind(key, ["another", key]), "direct");
    assert.equal(recursionKind(key, [key, "another"]), "indirect");
    assert.equal(recursionKind(key, ["another"]), undefined);
  });

  it("recognizes explicit function-pointer call syntax", () => {
    assert.equal(looksLikeExplicitIndirectCall("(*callback)(value);", 2), true);
    assert.equal(
      looksLikeExplicitIndirectCall("(object.*method)(value);", 9),
      true,
    );
    assert.equal(looksLikeExplicitIndirectCall("direct(value);", 0), false);
  });

  it("finds explicit indirect call sites without guessing ordinary calls", () => {
    assert.deepEqual(
      findExplicitIndirectCalls(
        [
          "(*callback)(value);",
          "(object.*handler)(value);",
          "ordinary(value);",
          '// "(*ignored)(value)"',
          "/* (*also_ignored)(",
          "value); */",
        ],
        20,
      ).map(({ line, expression, kind }) => ({ line, expression, kind })),
      [
        {
          line: 20,
          expression: "(*callback)(",
          kind: "function-pointer",
        },
        {
          line: 21,
          expression: "object.*handler)(",
          kind: "member-function-pointer",
        },
      ],
    );
  });
});
