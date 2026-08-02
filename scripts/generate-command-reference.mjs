import { readFileSync, writeFileSync } from "node:fs";

const packagePath = new URL("../package.json", import.meta.url);
const messagesPath = new URL("../package.nls.zh-cn.json", import.meta.url);
const guidePath = new URL("../docs/user-guide.zh-CN.md", import.meta.url);
const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
const messages = JSON.parse(readFileSync(messagesPath, "utf8"));
const guide = readFileSync(guidePath, "utf8");
const startMarker = "<!-- GENERATED COMMAND REFERENCE START -->";
const endMarker = "<!-- GENERATED COMMAND REFERENCE END -->";
const views = new Map(
  Object.values(manifest.contributes?.views ?? {})
    .flat()
    .map((view) => [view.id, resolveMessage(view.name)]),
);
const menuLocations = new Map([
  ["editor/context", "编辑器右键菜单"],
  ["view/title", "窗口标题栏"],
  ["view/item/context", "树节点右键菜单"],
]);
const entries = new Map(
  (manifest.contributes?.commands ?? []).map((command) => [
    command.command,
    new Set(["命令面板"]),
  ]),
);

for (const [menu, items] of Object.entries(manifest.contributes?.menus ?? {})) {
  for (const item of items) {
    const locations = entries.get(item.command);
    if (!locations) {
      continue;
    }
    const viewId = /\bview\s*==\s*([A-Za-z0-9_.-]+)/.exec(
      item.when ?? "",
    )?.[1];
    const viewName = viewId ? views.get(viewId) : undefined;
    locations.add(
      viewName
        ? `${viewName} ${menu === "view/title" ? "标题栏" : "节点右键菜单"}`
        : menuLocations.get(menu) ?? menu,
    );
  }
}
for (const binding of manifest.contributes?.keybindings ?? []) {
  entries.get(binding.command)?.add(`快捷键 \`${binding.key}\``);
}

const escapeCell = (value) =>
  String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const rows = (manifest.contributes?.commands ?? []).map((command) => {
  const title = resolveMessage(command.title).replace(/^C Insight[：:]\s*/, "");
  const locations = [...(entries.get(command.command) ?? [])].join("；");
  return `| ${escapeCell(title)} | \`${command.command}\` | ${escapeCell(locations)} |`;
});
const generated = `${startMarker}

## 15. 完整命令参考

本节由 \`package.json\` 自动生成。所有命令都可以通过命令面板调用；表中额外列出
标题栏、编辑器右键菜单、树节点右键菜单和默认快捷键入口。窗口当前状态不满足
\`when\` 条件时，相应菜单按钮可能隐藏。

| 命令 | Command ID | 入口 |
| --- | --- | --- |
${rows.join("\n")}

${endMarker}`;

const start = guide.indexOf(startMarker);
const end = guide.indexOf(endMarker);
let next;
if (start >= 0 && end >= start) {
  next =
    guide.slice(0, start).trimEnd() +
    "\n\n" +
    generated +
    guide.slice(end + endMarker.length);
} else {
  next = `${guide.trimEnd()}\n\n${generated}\n`;
}
writeFileSync(guidePath, next);

function resolveMessage(value) {
  const match = /^%(.+)%$/.exec(value);
  return match ? messages[match[1]] ?? value : value;
}
