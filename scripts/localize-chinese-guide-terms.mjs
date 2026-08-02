import { readFileSync, writeFileSync } from "node:fs";

const guides = [
  new URL("../docs/user/user-guide.zh-CN.md", import.meta.url),
  new URL("../docs/development/developer-guide.zh-CN.md", import.meta.url),
];
const terms = new Map([
  ["Search Loaded Callers/Callees", "搜索已加载的调用者/被调用者"],
  ["Find Caller/Callee Path", "查找调用者/被调用者路径"],
  ["Workspace Session Restore", "工作区会话恢复"],
  ["Microsoft Call Hierarchy", "Microsoft 调用层次"],
  ["Incoming Call Hierarchy", "传入调用层次"],
  ["Outgoing Call Hierarchy", "传出调用层次"],
  ["Type/Include Hierarchy", "类型/包含层次"],
  ["References-based", "基于引用"],
  ["Find All References", "查找所有引用"],
  ["Show Incoming Calls", "显示传入调用"],
  ["Show Outgoing Calls", "显示传出调用"],
  ["Restore Provider Settings", "恢复提供程序设置"],
  ["Navigation History", "导航历史"],
  ["Document Symbols", "文档符号"],
  ["Project Diagnostics", "工程诊断"],
  ["Relationship Graph", "关系图"],
  ["Workspace Session", "工作区会话"],
  ["Workspace Symbols", "工作区符号"],
  ["Document Highlights", "文档突出显示"],
  ["Semantic Tokens", "语义令牌"],
  ["Signature Help", "签名帮助"],
  ["Code Preview", "代码预览"],
  ["Type Hierarchy", "类型层次"],
  ["Include Hierarchy", "包含层次"],
  ["Call Hierarchy", "调用层次"],
  ["Symbol Search", "符号搜索"],
  ["Incoming Calls", "传入调用"],
  ["Outgoing Calls", "传出调用"],
  ["Included By", "被包含关系"],
  ["Lock Preview", "锁定预览"],
  ["Unlock Preview", "解锁预览"],
  ["Open Location", "打开位置"],
  ["Expand to Depth", "展开到指定深度"],
  ["Search Loaded", "搜索已加载内容"],
  ["Stop Expansion", "停止展开"],
  ["Call Site", "调用位置"],
  ["Runtime Performance", "运行时性能"],
  ["Supertypes", "父类型"],
  ["Subtypes", "子类型"],
  ["References", "引用"],
  ["Callers", "调用者"],
  ["Callees", "被调用者"],
  ["Bookmarks", "书签"],
  ["Includes", "包含文件"],
  ["Declaration", "声明"],
  ["Definition", "定义"],
  ["Provider", "提供程序"],
  ["Context", "上下文"],
  ["Reference", "引用"],
  ["Caller", "调用者"],
  ["Callee", "被调用者"],
  ["Unpin", "取消固定"],
  ["Pin", "固定"],
  ["Lock", "锁定"],
  ["Refresh", "刷新"],
  ["Ready", "准备就绪"],
  ["Indexing", "正在索引"],
  ["Hover", "悬停信息"],
  ["Cancelled", "已取消"],
  ["Loading", "加载中"],
  ["Limited", "结果受限"],
  ["Failed", "失败"],
  ["Stale", "已过期"],
  ["Error", "错误"],
  ["Empty", "空结果"],
  ["Idle", "空闲"],
  ["stale", "已过期"],
]);

const escaped = [...terms.keys()]
  .sort((left, right) => right.length - left.length)
  .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const pattern = new RegExp(`(?<![A-Za-z])(${escaped.join("|")})(?![A-Za-z])`, "g");

for (const guide of guides) {
  let inFence = false;
  let seen = new Set();
  const input = readFileSync(guide, "utf8");
  const output = input
    .split("\n")
    .map((line) => {
      if (/^```/.test(line.trim())) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      if (/^#{2,4}\s/.test(line)) seen = new Set();
      return line
        .split(/(`[^`]*`)/g)
        .map((part, index) => {
          if (index % 2 === 1) return part;
          const localized = part.replace(pattern, (english, _capture, offset) => {
            const chinese = terms.get(english);
            if (!chinese) return english;
            const prefix = part.slice(0, offset);
            const insideAnnotation = prefix.lastIndexOf("（") > prefix.lastIndexOf("）");
            if (insideAnnotation) {
              seen.add(english);
              return english;
            }
            if (seen.has(english)) return chinese;
            seen.add(english);
            return `${chinese}（${english}）`;
          });
          return localized.replace(/([\p{Script=Han}）]) (?=[\p{Script=Han}（])/gu, "$1");
        })
        .join("");
    })
    .join("\n");

  if (process.argv.includes("--check")) {
    if (output !== input) {
      console.error(`${guide.pathname} terminology is not normalized; run npm run docs:terms.`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(guide, output);
  }
}
