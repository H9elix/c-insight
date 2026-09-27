import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface CommandContribution {
  command: string;
  icon?: string;
}

interface ViewTitleMenu {
  command: string;
  group?: string;
}

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  contributes: {
    commands: CommandContribution[];
    menus: { "view/title": ViewTitleMenu[] };
  };
};

describe("view title icon contract", () => {
  it("gives every primary view-title action a Theme Icon", () => {
    const commands = new Map(
      manifest.contributes.commands.map((command) => [
        command.command,
        command,
      ]),
    );
    const primaryActions = manifest.contributes.menus["view/title"].filter(
      (item) => item.group === "navigation" ||
        item.group?.startsWith("navigation@"),
    );

    for (const action of primaryActions) {
      const contribution = commands.get(action.command);
      assert.ok(contribution, `Missing command contribution: ${action.command}`);
      assert.match(
        contribution.icon ?? "",
        /^\$\([a-z0-9-]+\)$/,
        `Primary view-title action falls back to text: ${action.command}`,
      );
    }
  });
});
