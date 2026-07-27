# C Insight 0.9.2 使用手册

本文说明 C Insight 的安装要求、基本工作流程、各窗口的作用与更新逻辑、
状态栏、常用命令、编译数据库，以及所有可配置参数。

## 1. 运行要求

- VS Code 1.95 或更高版本。
- `clangd` 20 或更高版本。
- 当前主要支持本地 C/C++ 工程和单个工作区根目录。
- 实际工程强烈建议提供 `compile_commands.json`。

安装 VSIX 后，打开 C/C++ 工程并单击 Activity Bar 中的 **C Insight**
图标。扩展会启动独立的 clangd 进程，不依赖微软 C/C++ 插件提供语义
结果。

如果 clangd 不在 `PATH` 中，可设置：

```json
{
  "cInsight.clangd.path": "/usr/bin/clangd-20"
}
```

## 2. 推荐的首次使用流程

1. 打开工程目录。
2. 为工程生成 `compile_commands.json`。
3. 打开任意 `.c`、`.cc`、`.cpp` 或 `.cxx` 文件。
4. 查看底部 C Insight 状态栏是否为 Ready 或 Indexing。
5. 打开 C Insight 侧栏，将光标放在函数、变量或类型名称上。
6. 使用 Context、Code Preview、References、Callers 和 Callees 浏览关系。
7. 如果结果异常，单击底部状态栏进入 Project Diagnostics。

CMake 工程可使用：

```sh
cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
```

生成的文件通常是：

```text
build/compile_commands.json
```

## 3. 总体更新逻辑

C Insight 有两类查询。

### 3.1 自动光标跟随

当 `cInsight.followCursor` 为 `true` 时，光标停在 C/C++ 符号上会触发：

1. 等待 `cInsight.followCursorDelay`。
2. 查询符号身份、定义、声明、类型/签名和调用树根。
3. 立即更新 Context，并将定义或声明放入 Code Preview。
4. 再等待 `cInsight.followCursorDetailsDelay`。
5. 查询 References 和第一层 Caller/Callee 数量。

移动光标会取消尚未完成的旧查询，避免慢查询覆盖新结果。只有 C Insight
导航窗口可见时，才会继续加载代价较高的详情。

### 3.2 显式查询

以下操作属于显式查询：

- Find All References
- Show Incoming Calls
- Show Outgoing Calls
- Refresh

显式查询可以更新对应结果，即使 References 或 Call Hierarchy 已 Pin。
Pin 的主要作用是阻止普通光标移动替换结果，而不是完全禁止更新。

## 4. 各窗口说明

### 4.1 Context

Context 显示当前光标符号的摘要：

- 符号名
- 限定名，例如 `Namespace::Class::method`
- 类型或函数签名
- Definition
- Declaration
- References 数量
- Callers 数量
- Callees 数量
- 当前文件和行号

基础信息优先显示，References 和 Caller/Callee 数量可能稍后更新。查询期间
会显示 `References loading…`、`Callers loading…` 或 `Callees loading…`。

### Context Pin

标题栏 Pin 会暂停整个自动 Context 跟随链路，因此也会暂停由光标移动触发的
Code Preview、References、Callers 和 Callees 更新。

Pin 后仍可使用 Find All References、Show Incoming Calls、Show Outgoing
Calls 或 Refresh 显式查询。Pin/Unpin 按钮使用固定位置，切换时不会移动。

Context Pin 只在当前 VS Code 会话有效。

### 4.2 Code Preview

Code Preview 是共享源码预览窗口，可显示：

- Definition
- Declaration
- Reference
- Caller
- Callee Definition
- Callee Call Site

目标符号会突出显示，并显示目标前后的源码行。长代码行可以横向滚动，滚动条
位于预览代码区域底部。

### 鼠标操作

- 单击预览代码中的符号：继续在 Code Preview 中查看该符号的 Definition。
- 双击预览代码：在主编辑器中打开准确位置。
- 在 References、Callers、Callees 或 Document Symbols 中单击位置节点：
  更新 Code Preview，不主动移动主编辑器。
- 在位置节点的右键菜单中选择 Open Location：在主编辑器中打开。

### Code Preview 工具栏

- `←`：回到上一条预览历史。
- `→`：前进到下一条预览历史。
- `⌖`：Lock/Unlock Preview。
- `⧉`：复制选中的代码；没有选择时复制完整预览片段。
- `Path`：复制文件路径和行号。
- `↗`：在主编辑器中打开当前预览位置。

### Lock Preview

Lock Preview 只阻止编辑器光标的自动更新。锁定后仍允许：

- 单击预览代码继续查看 Definition。
- 从 References、Callers 或 Callees 手动选择新位置。
- 使用预览历史、复制和打开操作。

Code Preview 使用轻量词法高亮，不保证与 VS Code 编辑器的完整语义颜色完全
一致。

### 4.3 References

References 显示当前符号的所有引用，并尝试分类为：

- Definition
- Declaration
- Function Call
- Read
- Write
- Read/Write
- Address
- Other Reference
- Macro 相关引用

分类优先使用 clangd Document Highlight，再结合保守的源码语法判断。对于
指针副作用、模板、重载运算符、宏展开等复杂情况，分类可能显示推断置信度，
而不会假装结果绝对准确。

### 分组方式

标题栏 Change Reference Grouping 提供：

| 值 | 含义 |
| --- | --- |
| `file` | 按文件分组 |
| `directory` | 按目录和文件分组 |
| `function` | 按引用所在函数分组 |
| `type` | 按 Definition、Call、Read、Write 等引用类型分组 |
| `flat` | 不分组，显示平铺列表 |

分组选择保存到工作区配置。

### 临时范围过滤

Change Reference Scope 提供：

| 范围 | 含义 |
| --- | --- |
| All | 所有未被排除的结果 |
| Workspace | 只显示当前工作区内文件 |
| Current Directory | 只显示活动文件同目录的结果 |
| Current File | 只显示活动文件中的结果 |

范围选择是当前会话中的临时状态，不写入配置。

### 搜索、分页和导出

- Filter References：匹配源码、文件名、路径或引用分类。
- Clear Reference Filter：清除搜索文本。
- Load More References：再加载一个 `pageSize`。
- Show All References：显示所有过滤后的引用。
- Copy Reference / Copy All References：复制单条或全部结果。
- Export References as Text/JSON：导出过滤后的结果。
- Open Reference List in Editor：在临时文本编辑器中打开列表。
- Expand/Collapse All Reference Groups：展开或折叠分组。

源码行和部分分类会在节点可见时延迟加载，以降低大型工程开销。搜索和导出
需要完整文本时会主动解析相关行。

### References Pin

References 有独立 Pin 状态。Pin 后：

- 光标移动不会替换当前 References。
- Find All References 或显式 Refresh 仍可替换结果。
- 搜索、分组、范围过滤、分页、导出和 Code Preview 仍可使用。

### 4.4 Callers

Callers 对应 clangd Incoming Calls，回答“哪些函数调用当前函数”。

树的根节点是当前函数。展开节点后加载它的上游调用者。函数节点下还会显示
具体 Call Site，包含调用次数、文件、行号和源码片段。

可能出现的标签：

- `direct recursion`：直接递归。
- `indirect recursion`：当前展开路径中形成间接递归。
- `duplicate`：同一函数已在树的其他位置出现。
- `No callers found`：在可靠条件下确认没有结果。
- `No callers found yet — results may be incomplete`：工程或索引条件受限。

### 4.5 Callees

Callees 对应 clangd Outgoing Calls，回答“当前函数调用了哪些函数”。

基本逻辑与 Callers 相同，但方向相反。函数节点指向被调用函数的 Definition，
Call Site 子节点指向调用发生的位置。

显式函数指针或成员函数指针调用可能标记为 `possible indirect call`。clangd
无法解析的运行时目标不会被 C Insight 猜测或伪造。

### Callers/Callees 共用 Pin

Callers 和 Callees 各自显示 Pin/Unpin 按钮，但共用一个 Call Hierarchy Pin
状态。任意一边切换后，另一边会同步。

Pin 后仍允许：

- 显式 Show Incoming/Outgoing Calls
- 展开节点或展开到指定深度
- 搜索已加载节点
- Find Caller/Callee Path
- 导出
- 选择节点更新 Code Preview

### 展开和安全限制

- 默认按需展开。
- Expand to Depth 可加载指定深度。
- Stop Call Hierarchy Expansion 可取消批量展开。
- `maximumDepth` 限制最大深度。
- `maximumNodes` 限制当前树创建的节点总数。
- Incoming 和 Outgoing 使用独立 LRU 缓存。
- 源码修改、clangd 重启或调用树配置变化会清空请求缓存。

### Search Loaded Callers/Callees

只搜索已经加载到内存中的树节点，不会为了搜索偷偷展开整棵调用树。选择搜索
结果会在树中定位该节点。

### Find Caller/Callee Path

从当前根节点沿调用关系搜索到目标函数名或限定名片段：

- Caller Path 沿 Incoming 方向搜索。
- Callee Path 沿 Outgoing 方向搜索。
- 避免同一路径内的循环。
- 受独立的深度、路径数量和访问节点数量限制。
- 选择找到的路径后，在 Code Preview 中预览目标 Definition。

### 导出

可导出当前已经加载的树：

- Text
- JSON
- Mermaid `.mmd`
- 包含 Mermaid fenced code block 的 Markdown `.md`

导出不会触发隐藏的自动展开。

### 4.6 Navigation History

Navigation History 记录当前 VS Code 会话中的显式导航：

- Definition
- Declaration
- Reference
- Caller
- Callee
- 在 Code Preview 内单击符号继续查看 Definition

普通编辑器光标跟随不会写入历史，避免快速移动光标产生大量无意义记录。
连续相同位置、模式和来源的记录默认合并。

历史按时间倒序显示，最新记录位于顶部。当前共享历史游标会标记为
`current`。

- 单击记录：在 Code Preview 中重新预览，不会再次写入历史。
- 右键选择 Open Location：在主编辑器中打开。
- Filter Navigation History：按 Definition、Declaration、Reference、
  Caller、Callee 或 Code Preview 来源临时过滤。
- Clear Navigation History：清空当前会话历史。

Code Preview 的 Back/Forward 使用同一历史游标。从旧记录返回后执行新的显式
导航，会丢弃原有的 Forward 分支，形成新的导航路径。

历史不会跨 VS Code 会话持久化；需要长期保存的位置将在后续书签功能中处理。

### 4.7 Bookmarks

Bookmarks 用于长期保存重要符号或源码位置，并按工作区持久化。关闭并重新打开
VS Code 后，当前工作区的书签仍会恢复。

添加方式：

- 单击 Bookmarks 标题栏的 Bookmark Current Symbol，保存活动编辑器光标下的
  符号。
- 在 References、Callers、Callees、Document Symbols、Navigation History
  等位置节点上右键，选择 Add Bookmark。

添加时会读取目标位置的真实标识符。相同文件和起始位置已经存在书签时，不会
重复创建，而是更新已有记录。新书签默认进入 `General` 分组。

书签操作：

- 单击：在 Code Preview 中预览，并进入 Navigation History。
- 右键 Open Location：在主编辑器中打开。
- Rename Bookmark：只修改显示名称，不修改用于重定位的原始符号。
- Change Bookmark Group：移动到已有分组，或创建新分组。
- Delete Bookmark：确认后删除。
- Refresh Bookmarks：重新检查并尝试定位全部书签。

源码修改后，相关书签会立即显示 `stale`。停止编辑约 500 ms 后，C Insight
使用添加书签时保存的标识符，在原位置附近寻找最近的完整单词：

- 找到后更新位置并清除 stale。
- 找不到、文件无法读取或书签没有有效标识符时，保留原位置和 stale。

这种重定位是保守的文本级恢复，并不等同于永久符号 ID。文件中存在多个同名
符号时，会选择距离旧位置最近的一个。

### 4.8 Symbol Search

Symbol Search 用于在整个工作区查找 clangd 已索引的函数、变量、类型、方法、
枚举、宏等符号。单击标题栏 Search 按钮后，输入内容会以防抖方式发送
`workspace/symbol` 请求；较旧的请求不会覆盖较新的结果。

搜索选择器关闭后，结果仍保留在 Symbol Search 窗口：

- 单击结果：以 Definition 模式在 Code Preview 中预览，并写入 Navigation
  History。
- 右键 Open Location：在主编辑器打开。
- 右键 Add Bookmark：保存到 Bookmarks。
- Filter Workspace Symbol Types：临时选择需要显示的符号类型。
- Group Workspace Symbols：按 Symbol Type、File、Directory 分组或不分组。
- Refresh：重新执行上一次查询。
- Clear：清空查询和结果。

结果完整性取决于 clangd 后台索引。索引或工程配置异常只通过统一状态栏提示，
不会在 Symbol Search 内重复显示可靠性警告。

### 4.9 Document Symbols

Document Symbols 显示活动文件的 clangd Document Symbols：

- 函数
- 方法
- 类型
- 变量
- 其他 clangd 返回的符号

支持 clangd 的层级结构。选择符号会更新 Code Preview。切换活动文件或修改
当前文件后会重新查询。

命令 **Search Workspace Symbols** 会打开 Symbol Search 的实时搜索选择器。

### 4.10 Project Diagnostics

Project Diagnostics 用于排查“为什么导航结果不准确或不可用”，显示：

- clangd 生命周期状态
- clangd 可执行文件
- clangd 版本
- Background Index 状态、进度和最后更新时间
- `compile_commands.json` 路径、来源和条目数
- 当前文件的编译命令
- 当前文件的编译工作目录
- clangd 错误和警告数量
- 缺失头文件数量
- 当前文件的具体 diagnostics

标题栏提供：

- Refresh Project Diagnostics
- Show clangd Log
- Select Compilation Database
- Restart Background Indexing

命令面板还提供 **Use Automatic Compilation Database Detection**，用于清除
手动选择并恢复自动发现。

### 编译数据库自动发现顺序

当 `cInsight.compileCommandsDir` 为空时：

1. 工作区根目录。
2. `build`。
3. `Build`。
4. `out`。
5. `out/build`。
6. `cmake-build-debug`。
7. `cmake-build-release`。
8. `_build`。
9. 工作区内其他 `compile_commands.json` 候选。

选中的目录会通过 `--compile-commands-dir` 传给 clangd。数据库变化后，C
Insight 会延迟约 750 ms，询问是否重启 clangd 以重新加载全部编译命令。

## 5. 底部可靠性状态栏

底部状态栏是全局可靠性警告的唯一显示位置：

| 显示 | 含义 |
| --- | --- |
| `C Insight` | clangd 和工程配置处于可靠状态 |
| `C Insight: Indexing N%` | 后台索引进行中，工作区结果可能暂不完整 |
| `C Insight: N issues` | 分析可用，但存在工程配置或头文件问题 |
| `C Insight unavailable` | clangd 未就绪或启动失败 |

悬停可查看全部原因；单击打开 Project Diagnostics。

可靠性综合判断：

- clangd 是否 Ready
- 后台索引是否进行中
- 是否找到编译数据库
- 当前源文件是否有编译命令
- 当前文件是否有缺失头文件

## 6. Pin、Lock、可靠性与 stale 的区别

| 状态 | 作用 |
| --- | --- |
| Context Pin | 暂停整个自动光标跟随链路 |
| References Pin | 只阻止自动替换 References |
| Call Hierarchy Pin | 同时阻止自动替换 Callers 和 Callees |
| Code Preview Lock | 只阻止编辑器光标自动替换预览 |
| Reliability | 表示当前工程条件可能影响新查询的完整性 |
| stale | 表示窗口里的结果生成后，相关环境又发生了变化 |

以下情况会标记结果 stale：

- 活动源文件修改
- clangd 重启
- 后台索引重新开始
- 分析配置变化
- 当前编译数据库变化

旧结果不会被删除，仍可预览、搜索和导出。重新执行对应的 References 或 Call
Hierarchy 查询后清除 stale。

## 7. 快捷键与编辑器菜单

| 操作 | 快捷键 |
| --- | --- |
| Go to Definition | `F12` |
| Find All References | `Shift+F12` |

C/C++ 编辑器右键菜单还提供：

- Go to Definition
- Find All References
- Show Incoming Calls
- Show Outgoing Calls

## 8. 输出窗口与日志

### C Insight

记录扩展自身的重要状态，例如：

- clangd 定位和启动
- clangd 生命周期
- 查询失败
- 慢查询
- 编译数据库选择

### C Insight: clangd

记录语言客户端与 clangd 的日志。clangd 按惯例将普通信息也写入 stderr，C
Insight 会根据 clangd 的 `I`、`W`、`E`、`V` 前缀重新分类：

- `I[...]`：Info，不是错误。
- `W[...]`：Warning。
- `E[...]`：Error。
- `V[...]`：Trace/Verbose。

因此类似 `textDocument/hover`、`prepareCallHierarchy`、`Built preamble`、
`ASTWorker building file` 的普通信息不需要当作故障。真正的 `error:`、
连接关闭或进程启动失败才需要重点检查。

## 9. 全部配置参数

可在 VS Code Settings UI 搜索 `C Insight`，或直接编辑工作区
`.vscode/settings.json`。

### 9.1 clangd 与工程配置

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.clangd.path` | string | `""` | 可执行文件路径 | 空值从 `PATH` 自动寻找 `clangd-22`、`clangd-21`、`clangd-20`、`clangd`；明确路径用于固定版本 |
| `cInsight.clangd.arguments` | string[] | `[]` | 任意 clangd CLI 参数数组 | 附加在 C Insight 管理参数之后；错误或重复参数可能导致 clangd 启动失败 |
| `cInsight.clangd.logLevel` | string | `"info"` | `"error"`、`"info"`、`"verbose"` | 控制传给 clangd 的日志等级 |
| `cInsight.compileCommandsDir` | string | `""` | 目录路径 | 指定包含 `compile_commands.json` 的目录；空值启用自动发现 |
| `cInsight.fallbackFlags` | string[] | `["-std=c++17"]` | 编译参数数组 | 当前文件没有编译命令时，通过 clangd initialization options 使用的后备参数 |
| `cInsight.backgroundIndex` | boolean | `true` | `true` / `false` | 启用或关闭 clangd `--background-index` |

上述配置变化会重启 clangd。`clangd.arguments` 中不需要添加 `--stdio`。
C Insight 默认管理：

```text
--background-index
--clang-tidy=0
--completion-style=detailed
--header-insertion=never
--log=<配置值>
--compile-commands-dir=<发现或配置的目录>
```

### 9.2 自动光标跟随

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.followCursor` | boolean | `true` | `true` / `false` | 是否根据编辑器光标自动查询 Context |
| `cInsight.followCursorDelay` | number | `200` | 50–2000 ms | 光标停稳后开始基础查询的延迟 |
| `cInsight.followCursorDetailsDelay` | number | `600` | 200–5000 ms | 基础查询完成后，加载 References 和第一层调用数量前的额外空闲延迟 |

大型工程可适当提高两个延迟，减少快速移动光标时的无效 clangd 请求。

### 9.3 Code Preview

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.codePreview.linesBefore` | number | `6` | 0–100 | 目标行之前显示的源码行数 |
| `cInsight.codePreview.linesAfter` | number | `8` | 0–100 | 目标行之后显示的源码行数 |

修改后会重新渲染当前 Code Preview。

### 9.4 References

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.references.pageSize` | number | `200` | 25–5000 | 每次添加到树中的引用数量 |
| `cInsight.references.groupBy` | string | `"file"` | `"file"`、`"directory"`、`"function"`、`"type"`、`"flat"` | References 的持久化分组方式 |
| `cInsight.includeDeclarationInReferences` | boolean | `true` | `true` / `false` | 请求 References 时是否包含 Declaration |
| `cInsight.includeSystemReferences` | boolean | `false` | `true` / `false` | 是否保留 `/usr/include` 和 `/usr/local/include` 下的引用 |
| `cInsight.exclude` | string[] | `["/build/", "/generated/", "/third_party/"]` | 路径片段数组 | 只要标准化后的结果路径包含任一片段，就从 References 结果中过滤 |

`exclude` 是简单路径片段匹配，不是 glob。需要 Windows 兼容时，建议使用 `/`
形式的片段，因为内部会先将反斜杠转换为 `/`。

### 9.5 Navigation History

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.history.maximumEntries` | number | `200` | 20–2000 | 当前 VS Code 会话中保留的最大导航记录数；超出后删除最旧记录 |
| `cInsight.history.mergeConsecutiveDuplicates` | boolean | `true` | `true` / `false` | 是否合并位置、模式和来源完全相同的连续记录 |

修改后立即调整当前会话中的 History；降低容量会删除最旧的超额记录。

### 9.6 Symbol Search

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.symbolSearch.groupBy` | string | `"type"` | `"type"`、`"file"`、`"directory"`、`"flat"` | Symbol Search 的工作区持久化分组方式 |
| `cInsight.symbolSearch.maximumResults` | number | `500` | 25–5000 | 每次查询最多显示的结果数 |
| `cInsight.symbolSearch.debounce` | number | `250` | 100–2000 ms | 停止输入后发送 clangd 查询的延迟 |

符号类型过滤是临时视图状态；分组配置保存在当前工作区。大型工程中可增加
`debounce` 或降低 `maximumResults`，减少刷新开销。

### 9.7 Call Hierarchy

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.callHierarchy.defaultDepth` | number | `0` | 0–10 | 新根节点自动展开深度；0 表示保持折叠 |
| `cInsight.callHierarchy.maximumDepth` | number | `10` | 1–50 | 手动或自动展开允许的最大深度 |
| `cInsight.callHierarchy.maximumNodes` | number | `2000` | 100–50000 | 当前调用树允许创建的最大节点数 |
| `cInsight.callHierarchy.cacheSize` | number | `500` | 10–10000 | Incoming 和 Outgoing 各自缓存的函数请求上限 |
| `cInsight.callHierarchy.pathSearchMaximumDepth` | number | `8` | 1–50 | Caller/Callee Path 最大边深度 |
| `cInsight.callHierarchy.pathSearchMaximumPaths` | number | `20` | 1–500 | 单次路径搜索最多返回的匹配路径数 |
| `cInsight.callHierarchy.pathSearchMaximumNodes` | number | `2000` | 100–50000 | 单次路径搜索最多访问的语义节点数 |

修改 Call Hierarchy 配置会清除调用请求缓存，并触发刷新。

## 10. 配置示例

### 常规 CMake 工程

```json
{
  "cInsight.clangd.path": "/usr/bin/clangd-20",
  "cInsight.backgroundIndex": true,
  "cInsight.compileCommandsDir": "build",
  "cInsight.followCursorDelay": 200,
  "cInsight.followCursorDetailsDelay": 600
}
```

### 大型工程

```json
{
  "cInsight.clangd.path": "/usr/bin/clangd-20",
  "cInsight.backgroundIndex": true,
  "cInsight.followCursorDelay": 350,
  "cInsight.followCursorDetailsDelay": 1000,
  "cInsight.references.pageSize": 300,
  "cInsight.callHierarchy.defaultDepth": 0,
  "cInsight.callHierarchy.maximumDepth": 8,
  "cInsight.callHierarchy.maximumNodes": 3000,
  "cInsight.callHierarchy.cacheSize": 1000,
  "cInsight.exclude": [
    "/build/",
    "/generated/",
    "/third_party/"
  ]
}
```

### 没有编译数据库的简单工程

```json
{
  "cInsight.fallbackFlags": [
    "-std=c17",
    "-Iinclude",
    "-DDEBUG"
  ],
  "cInsight.backgroundIndex": true
}
```

Fallback flags 适合简单工程或临时文件，不能完整替代每个源文件不同参数的
`compile_commands.json`。

## 11. 常见问题

### 状态栏显示 Limited

单击状态栏打开 Project Diagnostics，优先检查：

1. 是否找到编译数据库。
2. 当前源文件是否有 compile command。
3. 是否有缺失头文件。
4. 后台索引是否仍在进行。

### Definition 有结果，但 References 或 Callers 不完整

Definition 常可由当前翻译单元直接获得，而跨文件 References 和调用关系更依赖
编译数据库与后台索引。等待 Indexing 完成，并确认当前文件有正确的编译命令。

### Callers/Callees 显示 stale

已有结果生成后，源码、clangd、索引、配置或编译数据库发生了变化。结果仍可
使用，但可能过期。运行 Show Incoming Calls、Show Outgoing Calls 或 Refresh
获得新结果。

### Callees 查询不支持

C Insight 的 Outgoing Call Hierarchy 要求 clangd 20 或更高版本。检查 Project
Diagnostics 中显示的 clangd 版本和实际可执行文件。

### 与其他 C/C++ 扩展同时启用

同时运行官方 clangd 扩展或微软 C/C++ 扩展，可能产生重复语言提供者和重复
索引。C Insight 会过滤会产生全局命令冲突的 clangd execute-command 功能，
但仍建议只保留实际需要的语义引擎。

## 12. 当前限制

- 主要面向单个本地工作区根目录。
- Code Preview 的高亮不是 VS Code 编辑器完整语义渲染。
- 静态调用树无法完整解析运行时多态、所有函数指针、宏生成调用和动态分派。
- References Read/Write 分类对复杂指针副作用、模板和重载运算符保持保守。
- clangd 标准索引进度只提供已完成/总数和百分比，不提供当前索引文件名。
