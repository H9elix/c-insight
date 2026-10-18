import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

test("command-line macro fixture compiles only with its build-provided definitions", async () => {
  const build = await mkdtemp(path.join(os.tmpdir(), "c-insight-build-macros-"));
  const root = path.resolve("test/fixtures/command-line-macros");
  try {
    const result = spawnSync(process.execPath, [path.join(root, "build.mjs")], {
      env: { ...process.env, C_INSIGHT_MACRO_BUILD_DIR: build }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    const database: Array<{ file: string; directory: string; arguments: string[] }> = JSON.parse(
      await readFile(path.join(build, "compile_commands.json"), "utf8"),
    );
    assert.equal(database.length, 2);
    for (const entry of database) {
      assert.equal(entry.directory, root);
      for (const flag of ["-DCI_BUILD_FEATURE=1", "-DCI_BUILD_NUMBER=7", "-DCI_BUILD_TRACE=trace_value"]) {
        assert(entry.arguments.includes(flag));
      }
      assert.doesNotMatch(await readFile(entry.file, "utf8"), /^\s*#\s*define\s+CI_BUILD_/m);
    }
    const [main] = database;
    const withoutDefinitions = spawnSync(main.arguments[0], main.arguments.slice(1).filter(arg => !arg.startsWith("-D")), {
      cwd: main.directory, encoding: "utf8",
    });
    assert.notEqual(withoutDefinitions.status, 0, "The negative control unexpectedly compiled without -D flags");
    assert.match(withoutDefinitions.stderr, /CI_BUILD_(NUMBER|TRACE)/);
  } finally {
    await rm(build, { recursive: true, force: true });
  }
});
