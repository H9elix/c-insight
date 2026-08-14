import { readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const startMarker = "<!-- GENERATED COMMAND REFERENCE START -->";
const endMarker = "<!-- GENERATED COMMAND REFERENCE END -->";
const checkOnly = process.argv.includes("--check");

const guides = [
  {
    path: new URL("../docs/user/user-guide.zh-CN.md", import.meta.url),
    messagesPath: new URL("../package.nls.zh-cn.json", import.meta.url),
    heading: "## 15. 完整命令参考",
    introduction:
      "本节由 `package.json` 自动生成。所有命令都可以通过命令面板调用；表中额外列出标题栏、编辑器右键菜单、树节点右键菜单和默认快捷键入口。窗口当前状态不满足 " +
      "`when` 条件时，相应菜单按钮可能隐藏。",
    columns: ["命令", "Command ID", "入口"],
    palette: "命令面板",
    shortcut: "快捷键",
    separator: "；",
    menuLocations: new Map([
      ["editor/context", "编辑器右键菜单"],
      ["view/title", "窗口标题栏"],
      ["view/item/context", "树节点右键菜单"],
    ]),
    viewMenu: (name, menu) =>
      `${name}${menu === "view/title" ? "标题栏" : "节点右键菜单"}`,
  },
  {
    path: new URL("../docs/user/user-guide.en.md", import.meta.url),
    messagesPath: new URL("../package.nls.json", import.meta.url),
    heading: "## Complete command reference",
    introduction:
      "This section is generated from `package.json`. Every command is available from the Command Palette; the table also lists view-title, editor-context, tree-item, and default-keybinding entry points. An entry can be hidden when its `when` condition " +
      "does not match the current UI state.",
    columns: ["Command", "Command ID", "Entry points"],
    palette: "Command Palette",
    shortcut: "Keybinding",
    separator: "; ",
    menuLocations: new Map([
      ["editor/context", "Editor context menu"],
      ["view/title", "View title"],
      ["view/item/context", "Tree item context menu"],
    ]),
    viewMenu: (name, menu) =>
      `${name} ${menu === "view/title" ? "title" : "item context menu"}`,
  },
];

for (const guide of guides) generateReference(guide);

function generateReference(options) {
  const messages = JSON.parse(readFileSync(options.messagesPath, "utf8"));
  const source = readFileSync(options.path, "utf8");
  const views = new Map(
    Object.values(manifest.contributes?.views ?? {})
      .flat()
      .map((view) => [view.id, resolveMessage(view.name, messages)]),
  );
  const entries = new Map(
    (manifest.contributes?.commands ?? []).map((command) => [
      command.command,
      new Set([options.palette]),
    ]),
  );

  for (const [menu, items] of Object.entries(manifest.contributes?.menus ?? {})) {
    for (const item of items) {
      const locations = entries.get(item.command);
      if (!locations) continue;
      const viewId = /\bview\s*==\s*([A-Za-z0-9_.-]+)/.exec(item.when ?? "")?.[1];
      const viewName = viewId ? views.get(viewId) : undefined;
      locations.add(
        viewName
          ? options.viewMenu(viewName, menu)
          : options.menuLocations.get(menu) ?? menu,
      );
    }
  }
  for (const binding of manifest.contributes?.keybindings ?? []) {
    entries.get(binding.command)?.add(`${options.shortcut} \`${binding.key}\``);
  }

  const rows = (manifest.contributes?.commands ?? []).map((command) => {
    const title = resolveMessage(command.title, messages).replace(/^C Insight[：:]\s*/, "");
    const locations = [...(entries.get(command.command) ?? [])].join(options.separator);
    return `| ${escapeCell(title)} | \`${command.command}\` | ${escapeCell(locations)} |`;
  });
  const generated = `${startMarker}

${options.heading}

${options.introduction}

| ${options.columns.join(" | ")} |
| --- | --- | --- |
${rows.join("\n")}

${endMarker}`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  const next =
    start >= 0 && end >= start
      ? source.slice(0, start).trimEnd() +
        "\n\n" +
        generated +
        source.slice(end + endMarker.length)
      : `${source.trimEnd()}\n\n${generated}\n`;
  if (checkOnly && next !== source) {
    console.error(`${options.path.pathname} command reference is stale; run npm run docs:commands.`);
    process.exitCode = 1;
  } else if (!checkOnly) {
    writeFileSync(options.path, next);
  }
}

function resolveMessage(value, messages) {
  const match = /^%(.+)%$/.exec(value);
  return match ? messages[match[1]] ?? value : value;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
