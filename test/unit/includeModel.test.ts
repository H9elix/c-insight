import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  includeSearchPaths,
  parseIncludes,
  shellSplit,
} from "../../src/includeHierarchy/includeModel";

describe("include hierarchy model", () => {
  it("parses quoted and angled includes but ignores comments", () => {
    const source = [
      '#include "local.h"',
      " // #include <ignored.h>",
      "/* #include \"also-ignored.h\" */",
      " # include <system/header.h> // comment",
    ].join("\n");
    assert.deepEqual(parseIncludes(source), [
      {
        text: '#include "local.h"',
        target: "local.h",
        angled: false,
        line: 0,
      },
      {
        text: "# include <system/header.h> // comment",
        target: "system/header.h",
        angled: true,
        line: 3,
      },
    ]);
  });

  it("splits quoted compile commands and extracts include flags", () => {
    const args = shellSplit(
      "clang++ -I include -I'with space' -isystem /sdk -iquoteconfig main.cpp",
    );
    const paths = includeSearchPaths(args, "/work/build");
    assert.deepEqual(paths.user, [
      "/work/build/include",
      "/work/build/with space",
    ]);
    assert.deepEqual(paths.system, ["/sdk"]);
    assert.deepEqual(paths.quote, ["/work/build/config"]);
  });
});
