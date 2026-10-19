import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMacroDefinitionLocation,
  hoverDefinesMacro,
  macroCallerAnchor,
  macroCallerScopeKey,
  macroDefinitionDirective,
  macroDefinitionName,
  sourceLineAt,
} from "../../src/callHierarchy/macroCallerScopeModel";

describe("macro caller scope", () => {
  it("requires a same-name macro heading and directive in clangd hover", () => {
    assert.equal(hoverDefinesMacro("macro FEATURE\n\n#define FEATURE 1", "FEATURE"), true);
    assert.equal(hoverDefinesMacro("### macro `TRACE`  \n\n---\n```cpp\n#define TRACE target\n```", "TRACE"), true);
    assert.equal(hoverDefinesMacro("macro FEATURE\n#define OTHER 1", "FEATURE"), false);
    assert.equal(hoverDefinesMacro("macro OTHER\n#define FEATURE 1", "FEATURE"), false);
    assert.equal(hoverDefinesMacro("### function `FEATURE`\nExample:\n#define FEATURE 1", "FEATURE"), false);
    assert.equal(hoverDefinesMacro("#define FEATURE 1", "FEATURE"), false);
    assert.equal(hoverDefinesMacro(undefined, "FEATURE"), false);
  });

  it("anchors a source-less macro at the exact selected use without excluding it", () => {
    const scope = {
      queryUri: "file:///main.c", queryPosition: { line: 11, character: 8 },
      queryRange: { start: { line: 11, character: 4 }, end: { line: 11, character: 11 } },
      name: "FEATURE", definitions: [],
    };
    assert.deepEqual(macroCallerAnchor(scope), { uri: scope.queryUri, range: scope.queryRange });
    assert.equal(isMacroDefinitionLocation(scope, scope.queryUri, scope.queryRange.start), false);
  });

  it("recognizes object-like and function-like macro names", () => {
    assert.equal(macroDefinitionName("#define LOG printf"), "LOG");
    assert.equal(macroDefinitionName("  # define LOG(...) printf(__VA_ARGS__)"), "LOG");
    assert.equal(macroDefinitionName("printf(\"#define LOG\")"), undefined);
    assert.deepEqual(
      macroDefinitionDirective("  # define LOG(...) printf(__VA_ARGS__)"),
      { name: "LOG", startCharacter: 11, endCharacter: 14 },
    );
  });

  it("distinguishes the definition name from a same-line replacement token", () => {
    const directive = macroDefinitionDirective("#define LOG_ALIAS LOG");
    assert.deepEqual(directive, {
      name: "LOG_ALIAS",
      startCharacter: 8,
      endCharacter: 17,
    });
    assert.notEqual(directive?.startCharacter, 18);
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

  it("keeps a stable key before an expanded target is resolved", () => {
    assert.match(
      macroCallerScopeKey({
        queryUri: "file:///fixture.c",
        queryPosition: { line: 2, character: 8 },
        name: "LOG_ALIAS",
        definitions: [],
      }),
      /LOG_ALIAS:unresolved$/,
    );
  });
});
