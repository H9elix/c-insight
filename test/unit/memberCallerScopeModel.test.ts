import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  memberAccessOperator,
  memberCallerScopeKey,
  parseDirectMemberAccess,
} from "../../src/callHierarchy/memberCallerScopeModel";

function parse(source: string, member = "codecpar") {
  return parseDirectMemberAccess(source, source.lastIndexOf(member));
}

describe("member caller scope model", () => {
  it("recognizes direct pointer and object member bases", () => {
    assert.deepEqual(parse("st->codecpar"), {
      baseName: "st",
      baseStart: 0,
      baseEnd: 2,
      operator: "->",
    });
    assert.deepEqual(parse("stream . codecpar"), {
      baseName: "stream",
      baseStart: 0,
      baseEnd: 6,
      operator: ".",
    });
    assert.deepEqual(parse("( st ) /* direct */ -> codecpar"), {
      baseName: "st",
      baseStart: 2,
      baseEnd: 4,
      operator: "->",
    });
  });

  it("leaves complex or runtime-selected bases unresolved", () => {
    for (const source of [
      "get_stream()->codecpar",
      "streams[index]->codecpar",
      "ctx->stream->codecpar",
      "((AVStream *)opaque)->codecpar",
      "GET_STREAM(ctx)->codecpar",
      "this->codecpar",
    ]) {
      assert.equal(parse(source), undefined, source);
    }
    assert.equal(
      memberAccessOperator(
        "member_factory()->codecpar",
        "member_factory()->".length,
      ),
      "->",
    );
  });

  it("creates a query-origin-sensitive scope key", () => {
    assert.notEqual(
      memberCallerScopeKey({
        queryUri: "file:///a.c",
        queryPosition: { line: 1, character: 4 },
        memberName: "codecpar",
        memberRange: {
          start: { line: 1, character: 4 },
          end: { line: 1, character: 12 },
        },
      }),
      memberCallerScopeKey({
        queryUri: "file:///a.c",
        queryPosition: { line: 2, character: 4 },
        memberName: "codecpar",
        memberRange: {
          start: { line: 2, character: 4 },
          end: { line: 2, character: 12 },
        },
      }),
    );
  });
});
