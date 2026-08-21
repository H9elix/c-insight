import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { resolveCpptoolsExtensionPath } from "../e2e/cpptoolsExtensionPath";

describe("cpptools extension path", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("honors an explicit installation path", () => {
    assert.equal(
      resolveCpptoolsExtensionPath("/custom/cpptools", "/unused"),
      "/custom/cpptools",
    );
  });

  it("discovers the newest installed cpptools version", () => {
    const root = mkdtempSync(path.join(tmpdir(), "c-insight-cpptools-"));
    temporaryDirectories.push(root);
    for (const version of ["1.9.0", "1.32.2", "1.33.8"]) {
      const directory = path.join(root, `ms-vscode.cpptools-${version}-linux-x64`);
      mkdirSync(directory);
      writeFileSync(path.join(directory, "package.json"), "{}");
    }
    mkdirSync(path.join(root, "ms-vscode.cpptools-extension-pack-1.5.1"));

    assert.match(
      resolveCpptoolsExtensionPath(undefined, root),
      /ms-vscode\.cpptools-1\.33\.8-linux-x64$/,
    );
  });

  it("reports how to override a missing installation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "c-insight-cpptools-"));
    temporaryDirectories.push(root);
    assert.throws(
      () => resolveCpptoolsExtensionPath(undefined, root),
      /C_INSIGHT_CPPTOOLS_EXTENSION_PATH/,
    );
  });
});
