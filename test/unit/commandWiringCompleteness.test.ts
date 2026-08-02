import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const root = resolve(__dirname, "../../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function keyFor(id: string): string {
  return id.replace(/^cInsight\./, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.-]/g, "_")
    .toUpperCase();
}

describe("command wiring completeness", () => {
  it("registers every contributed command exactly once", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      contributes: { commands: Array<{ command: string }> };
    };
    const source = sourceFiles(join(root, "src"))
      .filter((path) => !path.endsWith("/ids.ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const { command } of manifest.contributes.commands) {
      const constant = `COMMANDS.${keyFor(command)}`;
      const registrations = [
        ...source.matchAll(new RegExp(`\\bregister\\(\\s*${constant.replace(".", "\\.")}(?![A-Z0-9_])`, "g")),
        ...source.matchAll(new RegExp(`\\bregister\\(\\s*["']${command.replaceAll(".", "\\.")}["']`, "g")),
        ...source.matchAll(new RegExp(`\\bregisterCommand\\(\\s*["']${command.replaceAll(".", "\\.")}["']`, "g")),
      ];
      assert.equal(registrations.length, 1, `${command} must have exactly one runtime registration`);
    }
  });
});
