import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMacroDefinitionLocation,
  macroCallerScopeKey,
  macroDefinitionName,
  sourceLineAt,
} from "../../src/callHierarchy/macroCallerScopeModel";

describe("macro caller scope", () => {
  it("recognizes object-like and function-like macro names", () => {
    assert.equal(macroDefinitionName("#define LOG printf"), "LOG");
    assert.equal(macroDefinitionName("  # define LOG(...) printf(__VA_ARGS__)"), "LOG");
    assert.equal(macroDefinitionName("printf(\"#define LOG\")"), undefined);
  });

  it("reads source lines with LF or CRLF endings", () => {
    assert.equal(sourceLineAt("zero\none\ntwo", 1), "one");
    assert.equal(sourceLineAt("zero\r\none\r\ntwo", 2), "two");
    assert.equal(sourceLineAt("zero", -1), undefined);
  });

  it("keeps macro identity and excludes its definition occurrence", () => {
    const scope = {
      queryUri: "file:///fixture.c",
      queryPosition: { line: 8, character: 4 },
      name: "LOG_ALIAS",
      expandedTargetName: "printf",
      definitions: [{
        uri: "file:///fixture.c",
        range: {
          start: { line: 2, character: 8 },
          end: { line: 2, character: 17 },
        },
      }],
    };
    assert.match(macroCallerScopeKey(scope), /LOG_ALIAS:printf$/);
    assert.equal(
      isMacroDefinitionLocation(
        scope,
        "file:///fixture.c",
        { line: 2, character: 8 },
      ),
      true,
    );
    assert.equal(
      isMacroDefinitionLocation(
        scope,
        "file:///fixture.c",
        { line: 8, character: 4 },
      ),
      false,
    );
  });
});
