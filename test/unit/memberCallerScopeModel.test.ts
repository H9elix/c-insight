import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  memberAccessOperator,
  memberCallerScopeKey,
  offsetAtPosition,
  parseMemberAccessChain,
  positionAtOffset,
} from "../../src/callHierarchy/memberCallerScopeModel";

function parse(source: string, member = "codecpar") {
  return parseMemberAccessChain(source, source.lastIndexOf(member));
}

describe("member caller scope model", () => {
  it("recognizes direct pointer and object member bases", () => {
    assert.deepEqual(parse("st->codecpar"), {
      rootName: "st",
      rootStart: 0,
      rootEnd: 2,
      segments: [{ name: "codecpar", start: 4, end: 12, operator: "->" }],
    });
    assert.deepEqual(parse("stream . codecpar"), {
      rootName: "stream",
      rootStart: 0,
      rootEnd: 6,
      segments: [{ name: "codecpar", start: 9, end: 17, operator: "." }],
    });
    assert.deepEqual(parse("( st ) /* direct */ -> codecpar"), {
      rootName: "st",
      rootStart: 2,
      rootEnd: 4,
      segments: [{ name: "codecpar", start: 23, end: 31, operator: "->" }],
    });
  });

  it("preserves the complete path for nested member accesses", () => {
    assert.deepEqual(parse("st->codecpar->sample_rate", "sample_rate"), {
      rootName: "st",
      rootStart: 0,
      rootEnd: 2,
      segments: [
        { name: "codecpar", start: 4, end: 12, operator: "->" },
        { name: "sample_rate", start: 14, end: 25, operator: "->" },
      ],
    });
    assert.deepEqual(parse("ctx.stream->codecpar", "codecpar"), {
      rootName: "ctx",
      rootStart: 0,
      rootEnd: 3,
      segments: [
        { name: "stream", start: 4, end: 10, operator: "." },
        { name: "codecpar", start: 12, end: 20, operator: "->" },
      ],
    });
  });

  it("leaves complex or runtime-selected bases unresolved", () => {
    for (const source of [
      "get_stream()->codecpar",
      "streams[index]->codecpar",
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

  it("converts protocol positions without opening a VS Code document", () => {
    const source = "first\n  st->codecpar->sample_rate\nlast";
    const position = { line: 1, character: 16 };
    const offset = offsetAtPosition(source, position);
    assert.equal(source.slice(offset, offset + "sample_rate".length), "sample_rate");
    assert.deepEqual(positionAtOffset(source, offset), position);
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
    const nested = {
      queryUri: "file:///a.c",
      queryPosition: { line: 3, character: 20 },
      memberName: "value",
      memberRange: {
        start: { line: 3, character: 20 },
        end: { line: 3, character: 25 },
      },
      anchor: {
        name: "selected",
        range: {
          start: { line: 3, character: 2 },
          end: { line: 3, character: 10 },
        },
        operator: "->" as const,
        path: [
          { name: "leaf", operator: "->" as const },
          { name: "value", operator: "->" as const },
        ],
      },
    };
    assert.notEqual(
      memberCallerScopeKey(nested),
      memberCallerScopeKey({
        ...nested,
        anchor: {
          ...nested.anchor,
          path: [{ name: "value", operator: "->" }],
        },
      }),
    );
  });
});
