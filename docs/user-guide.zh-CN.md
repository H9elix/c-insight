# C Insight 0.13.0 使用手册

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
2. 根据当前实际可见的窗口计算需要的请求。
3. 只查询这些窗口显示内容所需的基础信息。
4. 如果 References 或 Context 与调用窗口需要详情，再等待
   `cInsight.followCursorDetailsDelay` 后查询。

移动光标会取消尚未完成的旧查询，避免慢查询覆盖新结果。Context、Code
Preview、References、Callers 和 Callees 全部隐藏时，不执行自动光标语义查询。

窗口独立调度规则：

| 可见窗口 | 自动查询 |
| --- | --- |
| 仅 Context | Definition、Declaration、Call Root、Hover、Symbol Info；关系数量显示为未查询 |
| 仅 Code Preview | Definition |
| References | Definition、Declaration、Call Root、References |
| Callers | Call Root；展开节点时才查询 Incoming Calls |
| Callees | Call Root；展开节点时才查询 Outgoing Calls |
| Context + Callers | 额外查询第一层 Caller 数量 |
| Context + Callees | 额外查询第一层 Callee 数量 |
| 全部隐藏 | 不执行自动光标语义请求 |

Document Symbols 也使用独立可见性：窗口隐藏时不查询；打开窗口时立即查询当前
活动文件。clangd 后台索引、Project Diagnostics、书签文本重定位、会话自动
保存和用户主动执行的命令不受窗口隐藏影响。

### 3.2 显式查询

以下操作属于显式查询：

- Find All References
- Show Incoming Calls
- Show Outgoing Calls
- Refresh

显式查询可以更新对应结果，即使 References 或 Call Hierarchy 已 Pin。
Pin 的主要作用是阻止普通光标移动替换结果，而不是完全禁止更新。

## 4. 各窗口说明

Callers、Callees、Supertypes、Subtypes、Includes 和 Included By 的标题栏
采用统一顺序：Show、Expand to Depth、Search Loaded、Stop Expansion，再
显示该关系特有的操作。Text、JSON、Mermaid 导出统一位于 `...` 溢出菜单。
某个窗口不支持的关系特有功能不会显示，例如只有 Callers/Callees 提供 Find
Path。

批量展开被取消、达到 `maximumDepth` 或达到 `maximumNodes` 后，对应窗口顶部
会显示状态行，并指出需要调整的配置。取消不会清除已经加载的节点。位于绝对
深度上限的终端节点会附加 `max depth`，用于区别“没有下级关系”和“因安全上限
不再查询”。

六个层级窗口共用同一套 Text、JSON 和 Mermaid 导出格式，导出只读取已经加载
的节点，不触发隐藏查询。JSON 顶层包含 `schemaVersion`、`relation`、
`direction`、`edgeDirection` 和 `roots`；节点统一包含 `name`、
`description`、`uri`、可选的 `sourceUri`/`line`、`states` 和 `children`。
`states` 会规范化记录 duplicate、cycle、recursion、maximum-depth、
maximum-nodes、cancelled 和 possible-indirect-call 等状态。Mermaid 箭头始终
表示真实语义方向，而不是窗口树的视觉父子方向。

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

默认情况下，向上或向下滚动到预览边缘会继续加载同一文件的源码上下文，直到
文件开头或结尾。新增代码行直接插入现有预览，不会重建整个窗口；向上插入以及
达到行数上限后裁剪远端代码时，会保留当前可见代码和横向滚动位置。被裁剪的
代码不是永久丢失，滚回对应方向时会再次加载。

### 鼠标操作

- 单击预览代码中的符号：继续在 Code Preview 中查看该符号的 Definition。
- 鼠标停在 clangd 识别为可导航的函数、变量、类型、成员或宏等符号上时，光标
  会变成手形；关键字、运算符、字面量和注释仍显示文本光标。
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

Code Preview 默认通过 VS Code Document Semantic Tokens 命令复用当前 C/C++
文档已注册的语义令牌提供器。使用 C Insight 自带 clangd 时，函数、方法、变量、
参数、类型、命名空间和宏等分类来自同一 clangd；关键字、字符串、数字和注释等
未被语义令牌覆盖的区间继续使用轻量词法高亮。语义请求暂不可用时会自动退回
纯词法高亮，不影响预览和导航。

Webview 不能直接复用编辑器渲染器，也不能读取主题最终合成后的全部
`semanticTokenColors`，因此 Code Preview 使用当前主题公开的 VS Code 颜色变量
映射语义类别。符号分类与编辑器一致，但极少数主题中的具体颜色和字体样式可能
不完全相同。

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

### 范围过滤

Change Reference Scope 提供：

| 范围 | 含义 |
| --- | --- |
| All | 所有未被排除的结果 |
| Workspace | 只显示当前工作区内文件 |
| Current Directory | 只显示活动文件同目录的结果 |
| Current File | 只显示活动文件中的结果 |

范围选择不写入 VS Code 工作区配置。启用 Workspace Session Restore 时，它会
保存在 C Insight 工作区浏览快照中，并在重新打开同一工作区后恢复；关闭会话
恢复时，它只保留到当前扩展运行结束。

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

References 搜索文本和当前已显示数量与范围过滤相同：不写入工作区配置，但启用
Workspace Session Restore 时会随工作区浏览快照恢复。

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
  Caller、Callee 或 Code Preview 来源过滤；启用会话恢复时保存该过滤条件。
- Clear Navigation History：清空当前工作区已加载的历史。

Code Preview 的 Back/Forward 使用同一历史游标。从旧记录返回后执行新的显式
导航，会丢弃原有的 Forward 分支，形成新的导航路径。

默认启用 `cInsight.session.persistNavigationHistory` 时，历史记录、当前游标和
过滤条件会写入工作区浏览快照，并在重新打开同一工作区后恢复。关闭该配置后，
Navigation History 只保留在当前扩展运行期。需要作为长期工程资料独立保存的
位置仍建议加入 Bookmarks。

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
- Filter Bookmarks：按名称、分组、文件路径或原始符号筛选；Clear Bookmark
  Filter 恢复全部结果。
- Sort Bookmarks：按名称、文件路径、源码位置、创建时间或最近更新时间排序。
  排序方式按工作区保存。

### 导入、导出和分组管理

Export Bookmarks 将全部书签保存为带格式名和版本号的 JSON。分组节点右键选择
Export Bookmarks 时只导出该分组。

Import Bookmarks 校验 JSON 格式后提供两种方式：

- Append and Update：保留当前数据；文件和起始位置相同的记录更新已有书签。
- Replace All：确认后删除当前全部书签，再载入文件。

导入文件内部的重复位置只保留最后一项，并在结果消息中报告。目标文件不存在的
书签会保留但标记为 stale。格式不支持、字段错误或 JSON 损坏时不会修改现有
书签。

分组节点右键操作：

- Rename or Merge Bookmark Group：输入新名称；名称已存在时合并两个分组。
- Export Bookmarks：仅导出该分组。
- Delete Bookmark Group：确认后删除分组及其全部书签。

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
- Filter Workspace Symbol Types：选择需要显示的符号类型。它不写入工作区
  配置，但启用 Workspace Session Restore 时会随浏览快照恢复。
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
- 编译器、显式语言和 `-std` 标准
- `-I`、`-isystem` 和 `-iquote` Include 路径
- `-D` 宏、`-include` 强制包含和 `@response` 文件
- clangd 错误和警告数量
- 缺失头文件数量
- 当前文件的具体 diagnostics

标题栏提供：

- Refresh Project Diagnostics
- Show clangd Log
- Select Compilation Database
- Restart Background Indexing
- Copy Project Diagnostics Report
- Export Project Diagnostics as JSON

命令面板还可执行 **Export Project Diagnostics as Text**。复制和导出报告包含
clangd 状态/版本、索引状态、编译数据库、当前文件命令拆解、Fallback Flags
以及当前文件 diagnostics。JSON 使用带 `schemaVersion` 的结构化格式，适合
脚本处理或提交问题；文本格式适合直接粘贴。

对于源文件，`compile_commands.json` 中路径完全匹配的条目标记为 `direct`。
头文件通常没有独立条目，clangd 会根据其内部 HeaderIncluderCache 等信息推断
命令；C Insight 会优先查找同目录同名源文件，再选择同目录源文件作为
`inferred-candidate`。这个候选项用于诊断 Include 路径和宏，不代表 C Insight
能够确认 clangd 最终选择了它。没有直接条目或候选条目时标记为 `fallback`，
并显示 `cInsight.fallbackFlags`。

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

### 4.11 Workspace Session Restore

直接通过 **Open Folder** 打开的 FFmpeg 等目录就是 VS Code 单文件夹工作区，
不需要 `.code-workspace` 文件。C Insight 使用 VS Code `workspaceState` 为每个
文件夹或多根工作区隔离保存浏览快照。

默认每五秒自动保存，并在正常关闭时再次保存：

- Navigation History 的记录、当前游标和过滤条件。
- Code Preview 当前目标及 Lock 状态。
- References 的搜索、范围和已显示数量；分组本来就由工作区配置保存。
- Symbol Search 最近查询和符号类型过滤。
- Callers/Callees 的根位置，以及两个窗口分别已经加载的最大深度。
- Relationship Graph 的版本化静态图快照、当前选择、关系过滤、折叠节点和
  缩放/平移位置。

当前快照仍不保存 Supertypes/Subtypes 或 Includes/Included By 树的根、已加载深度
和展开状态。关闭或重新加载窗口后，需要显式重新执行对应的 Show 命令；此项已
列入备忘录，暂不实现，以避免打开大型工程时因 Included By 恢复而意外启动
反向索引扫描。

重新打开相同工作区后，轻量状态直接恢复。调用关系不会直接信任旧节点，而是用
保存的位置重新请求 clangd，再展开到上次加载深度，并标记为从上一会话恢复。
因此源码或编译数据库变化后不会把旧调用结果伪装成最新结果。当前实现恢复最大
深度，不保证逐个节点的折叠状态完全相同。

Relationship Graph 恢复采用不同策略：直接显示上次保存的静态节点和边，不在
恢复阶段请求 clangd、解析 Include 或建立 Included By 索引。恢复的函数和类型
节点不保存 clangd opaque item；用户明确继续展开时，C Insight 才按保存的位置
重新执行 prepare，并给节点加入 `revalidated` 状态。文件节点同样只有在明确
展开时才读取关系。

只有 VS Code 退出或 Reload Window 时仍然打开的 Relationship Graph 才会在下次
启动时恢复。用户主动关闭 Graph 标签页会立即从工作区会话快照中清除关系图，
之后关闭并重新打开 VS Code 不会再次出现已关闭的 Graph。

恢复前会检查根文件是否仍然存在；根文件缺失时跳过整张图。其他文件若之后删除，
会在用户预览或打开时标记 `missing` 并显示警告。关系图快照具有独立 schema
版本和严格大小限制；格式不兼容或内容损坏时只丢弃关系图部分，不影响其他会话
状态。节点或边过多时保存为仅含根节点的降级快照，避免 workspaceState 过大。

命令面板提供：

- **Restore Previous Workspace Session**：手动再次应用已保存快照；即使关闭
  自动恢复也可以使用。
- **Clear Saved Workspace Session**：删除快照，并暂停当前窗口的自动保存，
  下次打开工作区时从空状态开始。

仅打开一个源码文件且没有打开文件夹时，不具备稳定的工程工作区作用域，不建议
依赖会话恢复。

### 三类状态保存机制

| 机制 | 示例 | 重启后行为 |
| --- | --- | --- |
| VS Code 工作区配置 | References 分组、Symbol Search 分组、书签排序方式、深度和节点限制 | 始终由 VS Code 为该工作区保存 |
| C Insight Workspace Session 快照 | Navigation History、Code Preview、References 搜索/范围/分页、Symbol Search 查询/类型过滤、调用树根和加载深度、Relationship Graph 静态快照与画布状态 | `cInsight.session.restore` 启用且快照未过期时恢复 |
| 仅当前扩展运行期 | Type/Include Hierarchy 树、Bookmarks 当前过滤文本、临时加载缓存、未写入快照的交互状态 | 关闭或重新加载窗口后清除 |

Bookmarks 数据本身使用独立的 `workspaceState` 持久化，不依赖 Workspace
Session；表中的“Bookmarks 当前过滤文本”仅指过滤输入，不是书签内容。

### 4.12 Supertypes 与 Subtypes

这两个窗口使用 clangd 的标准 Type Hierarchy 协议，主要面向 C++：

- Supertypes：当前类或结构体继承、实现的父类型。
- Subtypes：继承当前类型的派生类型。

把光标放在类或结构体名称上，通过编辑器右键菜单或命令面板执行 **Show
Supertypes** 或 **Show Subtypes**。一次查询会为两个窗口建立同一个根，随后
分别按需请求父类型和派生类型。

窗口行为：

- 展开节点：懒加载下一层关系。
- 单击节点：以 Definition 模式更新 Code Preview，并写入 Navigation History。
- 右键 Open Location：在主编辑器打开。
- 右键 Add Bookmark：保存类型位置。
- Search Loaded Supertypes/Subtypes：只搜索当前已经加载的节点。
- Expand to Depth：批量加载指定深度。
- Stop Type Hierarchy Expansion：取消正在进行的批量展开。
- 窗口 `...` 菜单可导出 Text、JSON 或 Mermaid。

树会检测递归和重复节点，并受最大深度及最大节点数限制。源码变化、clangd
重启或 Type Hierarchy 配置变化后，已有结果显示 stale，需要重新执行 Show
Supertypes/Subtypes。当前树不写入 Workspace Session，重开工作区后需要重新
查询。普通 C 代码没有类继承关系，通常不会返回结果。

### 4.13 Includes 与 Included By

这两个窗口显示文件级包含关系：

- Includes：当前文件直接或间接包含了哪些文件。
- Included By：工作区内哪些文件直接或间接包含当前文件。

把当前编辑器置于 C/C++ 源文件或头文件，通过编辑器右键菜单或命令面板执行
**Show Includes** 或 **Show Included By**。Show Includes 只更新 Includes，
Show Included By 只更新 Included By；两个窗口可保留不同根文件和不同的已
展开树。

两个窗口的标题栏都有常显查询按钮；尚未查询时，也可以直接单击窗口内的提示
行。若当前活动编辑器不是本地 C/C++ 文件，命令会显示明确警告。

Includes 只在展开节点时读取文件，解析 `#include "..."` 和
`#include <...>`。解析顺序综合当前文件目录、`compile_commands.json` 中的
`-iquote`、`-I`、`-isystem`、工作区根目录及常见系统目录。无法解析的 include
仍以 `unresolved` 显示，并在悬停中说明搜索失败。

Included By 需要反向查找，因此首次展开时才扫描工作区 C/C++ 文件并建立内存
索引；仅打开或折叠窗口、未执行查询时不会扫描。索引建立后，文件创建、修改和
删除会增量更新；编译数据库或相关配置变化会使结果 stale。

首次扫描会显示可取消的通知进度，包含已处理文件数和总文件数。取消后不会把
部分扫描结果当作完整索引；下次展开会重新建立。扫描完成后，后续展开复用索引，
不再显示进度。如果发现的文件数超过 `workspaceFileLimit`，C Insight 会警告
Included By 结果可能不完整。

反向索引先在隔离的临时数据中构建，完整扫描结束后才一次性发布。扫描期间发生
的源码创建、修改或删除会在发布前补入；若编译数据库、include 配置或分析状态
使索引失效，旧扫描会被取消且不能覆盖新结果。因此窗口不会使用半成品或已经
过期的 Included By 索引。

窗口行为：

- 展开节点：懒加载下一层，不预先加载整棵树。
- 单击节点：在 Code Preview 显示产生关系的 `#include` 源码行。
- 右键 Open Location：打开被包含文件；未解析节点打开 include 所在源码行。
- 右键 Add Bookmark：保存已解析文件。
- Search Loaded Includes/Included By：只搜索已加载节点。
- Expand to Depth：在限制范围内批量展开，可用各窗口自己的 Stop Expansion
  取消；不会停止另一个方向的展开。
- `...` 菜单可导出 Text、JSON 或 Mermaid；Mermaid 箭头始终表示
  “包含者 → 被包含者”。

节点会标记 workspace header、workspace source、system、external、
unresolved，并检测 cycle 和 duplicate。系统头默认不显示，以避免树过大；
可通过配置启用。条件编译分支按文本解析，C Insight 不运行预处理器，因此结果
代表源码中可见的 include 指令，不保证某个具体构建配置一定启用。

Includes/Included By 当前不写入 Workspace Session，重开工作区后需要重新
查询；因此不会仅因会话恢复就在后台建立 Included By 反向索引。

### 4.14 Relationship Graph

在本地 C/C++ 文件中通过编辑器右键菜单或命令面板执行 **Show Relationship
Graph**，会在编辑器区域旁边打开综合关系图标签页。光标位于函数或方法时，
0.12.8 会先尝试使用标准 Call Hierarchy 建立函数根；光标位于 C++ class、
struct 或 interface 时，使用标准 Type Hierarchy 建立类型根。两者都不可用时
退回活动文件根，可继续展开 Includes 或 Included By。

需要明确查看文件包含关系时，建议执行 **Show File Relationship Graph**。该命令
忽略光标下的函数或类型，直接以活动 C/C++ 源码或头文件作为文件根。

当前可用操作：

- 鼠标滚轮缩放，拖动画布平移。
- Fit：把当前图适配到可视区域。
- Reset Layout：恢复默认缩放和位置。
- Collapse Branch：隐藏当前节点向远离根方向延伸的已加载分支；只改变画布
  可见性，不删除节点、关系或查询缓存。
- Expand Branch：重新显示当前节点已折叠的分支，不会重新查询 clangd 或文件。
- Call、Inheritance、Include、Definition：过滤对应边。Call 使用
  蓝色实线、Inheritance 使用紫色虚线、Include 使用绿色
  点线、Definition 使用橙色点划线；循环或递归关系使用错误色强调，工具栏中
  始终显示图例。
- Expand Callers：为当前选中函数加载直接调用者。
- Expand Callees：为当前选中函数加载直接被调用函数。
- 当根或选中节点为类型时，上述两个按钮自动显示为 Expand Supertypes 和
  Expand Subtypes，分别加载直接基类和直接派生类。
- 当根或选中节点为文件时，按钮自动显示为 Expand Included By 和 Expand
  Includes。前者查询哪些文件包含当前文件，后者解析当前文件包含了哪些文件。
- Expand to Depth：从当前选中函数开始，同时逐层加载 Callers 和 Callees；
  从类型节点执行时同时加载 Supertypes 和 Subtypes，从文件节点执行时同时加载
  Included By 和 Includes。输入值表示相对选中节点的展开层数，并受
  `maximumDepth`、节点和边上限约束。
- Stop：取消当前准备或展开请求；已加载节点继续保留。
- Search：在已加载节点中按名称、详情和路径搜索，选择后居中并更新 Code Preview。
- Export：把当前已加载图导出为 Text、JSON 或 Mermaid；也可从命令面板分别
  执行三个 Export Relationship Graph 命令。
- 单击节点：更新 Code Preview。
- 双击节点：在主编辑器打开文件。
- 右键节点：可展开 Callers/Callees、展开到指定深度、加入 Bookmarks、打开位置
  或把节点居中。
- 源码、clangd、编译数据库或图配置变化后显示 stale。

节点底部状态：

- `expandable`：可以继续查询关系。
- `expanded`：至少一个方向已经查询；再次展开会使用已加载结果或共享缓存。
- `duplicate`：相同语义实体从其他路径再次到达并合并到该节点。
- `cycle`：节点参与当前已发现的递归或循环关系。
- `unresolved`：Include 目标未能解析，不能继续展开。
- `collapsed`：分支仅在画布中隐藏，数据仍然保留。
- `revalidated`：从静态会话恢复后，已按当前位置重新取得 clangd 节点。
- `missing`：保存的位置对应文件已经不存在，不能预览或继续导航。

综合关系操作位于节点右键菜单，且都需要用户明确执行：

- `Add Defining File`：函数或类型节点添加其定义所在源码/头文件，生成
  `File → Symbol` Definition 边。新增文件节点可继续 Expand Includes 或
  Expand Included By。
- `Add Type Members`：类型节点读取已知文档符号，并通过 clangd 为可调用成员
  准备 Call Hierarchy 节点，生成 `Type → Member` Definition 边。新增成员可
  继续 Expand Callers/Callees；可用 Stop 取消，已经加入的成员继续保留。
- `Add Containing Type`：函数/方法节点添加包含它的 C++ 类型，生成
  `Type → Member` Definition 边。对于类外实现，会尝试从 `Type::method`
  限定名定位类型。

由此可在一张图中从函数连接到文件、从文件展开 Include、从方法连接到类型、
再从类型展开继承或其他成员。跨关系操作不会随节点选择、普通展开、搜索或导出
自动执行，并统一受 `maximumDepth`、`maximumNodes` 和 `maximumEdges` 限制。
Definition 过滤只隐藏归属边，不删除其两端节点；折叠、搜索、统计和导出继续
适用于混合图，导出格式使用 `defines` 作为该关系的稳定名称。

状态栏以“可见数/已加载总数”显示节点与边。例如 `12/20 nodes · 9/16
edges` 表示当前因关系过滤或分支折叠只显示部分内容。关系过滤不会删除数据，
导出仍针对完整的已加载图。

图使用有严格 CSP 的 SVG Webview。文件读取、位置验证和导航都在扩展宿主中
执行；Webview 不读取本地文件，也不直接请求 clangd。隐藏或未打开图时不会
产生关系查询。Callers/Callees 树与图共享有界 Incoming/Outgoing 请求缓存，
Supertypes/Subtypes 树与图也共享 Type Hierarchy 请求缓存；Includes/Included
By 树与图共享 include resolver、正向结果缓存和反向索引。图的节点和展开状态
不会替换原有树。

调用边始终表示 Caller → Callee。相同函数会合并成一个节点；形成回路的边标记
direct-recursion 或 indirect-recursion。`defaultDepth=1` 时显式 Show 会加载
根的第一层 Callers 和 Callees；设为 0 时只准备根。选择任意已加载函数后仍可
按需继续展开，直到达到深度、节点或边上限。默认分层布局把调用者放在根左侧、
被调用者放在根右侧；画布状态文字会报告展开进行中、取消、失败或达到资源上限。
继承边始终表示 Supertype → Subtype，基类位于类型根左侧，派生类位于右侧；
重复类型会合并，循环继承关系具有与调用图相同的防无限展开处理。类型查询只在
显式打开类型图或展开类型节点时执行，隐藏或未打开关系图不会产生查询。

Include 边始终表示 Includer → Included，即“包含者 → 被包含文件”。包含者位于
左侧，被包含文件位于右侧；无法解析的 include 会显示为 unresolved 节点并指向
原始 `#include` 行。系统头仍由 `relationshipGraph.includeSystemHeaders` 控制。
打开文件图、展开 Includes、搜索、过滤和导出都不会建立 Included By 反向索引；
只有明确执行 Expand Included By，或从文件节点明确执行双向 Expand to Depth，
才会扫描工作区。取消扫描不会发布不完整索引。

键盘操作：

- `Tab`：依次进入工具栏按钮和图节点。
- 方向键：从当前节点移动到空间上最近的对应方向节点。
- `Enter`：在 Code Preview 预览当前节点。
- `Shift+Enter`：在主编辑器打开当前节点。
- `Space`：折叠或展开当前节点的已加载分支。
- `Shift+F10`：打开节点操作菜单。
- 画布聚焦时按 `F`：Fit；`+` / `-`：缩放。

建立新图根时会自动执行一次 Fit。后续展开不会自动改变缩放和平移，已有节点
位置也尽量保持不变；需要重新查看全图时手动执行 Fit。

大型图的画布使用视口虚拟化：语义模型仍保留全部已加载节点和边，但 SVG DOM
只创建当前可视区域及其周边缓冲区中的元素。平移到其他区域时按动画帧增量复用、
加入或移除 SVG 元素；这不会改变统计、搜索、折叠或导出结果。连续的展开消息、
拖拽、缩放和窗口尺寸变化会合并到每个浏览器动画帧最多一次渲染。

状态文字的悬停提示显示最近一次画布渲染耗时和实际渲染的视口节点数。单次渲染
超过 50 ms 时，C Insight 输出窗口会记录节流后的 `Slow Relationship Graph
render` 诊断；同类提示五秒内最多记录一次。关闭 Relationship Graph 标签页时
会取消展开并释放该图的宿主模型、布局位置和 Webview SVG 缓存。

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
| `cInsight.codePreview.semanticHighlighting` | boolean | `true` | `true` / `false` | 是否使用当前 VS Code 语义令牌提供器着色符号；关闭后只使用词法高亮 |
| `cInsight.codePreview.semanticTokenCacheSize` | number | `32` | 1–256 | 内存中最多保留的按文档及其版本区分的语义令牌结果数 |
| `cInsight.codePreview.incrementalLoading` | boolean | `true` | `true` / `false` | 滚动到 Code Preview 上下边缘时是否继续加载源码 |
| `cInsight.codePreview.loadBatchLines` | number | `50` | 10–500 | 每次向上或向下增量加载的源码行数 |
| `cInsight.codePreview.maximumLoadedLines` | number | `1000` | 50–10000 | Code Preview DOM 同时保留的最大源码行数；超过后裁剪远离滚动方向的一端 |

修改后会清空语义令牌缓存并重新渲染当前 Code Preview。源码发生变化时，对应
文档的缓存会失效；切换颜色主题时，可见的 Code Preview 会重新渲染。

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

修改后立即调整当前已加载的 History；降低容量会删除最旧的超额记录。是否跨
重启恢复由 `cInsight.session.persistNavigationHistory` 控制。

### 9.6 Symbol Search

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.symbolSearch.groupBy` | string | `"type"` | `"type"`、`"file"`、`"directory"`、`"flat"` | Symbol Search 的工作区持久化分组方式 |
| `cInsight.symbolSearch.maximumResults` | number | `500` | 25–5000 | 每次查询最多显示的结果数 |
| `cInsight.symbolSearch.debounce` | number | `250` | 100–2000 ms | 停止输入后发送 clangd 查询的延迟 |

符号类型过滤不写入 VS Code 配置，但会在启用 Workspace Session Restore 时随
工作区浏览快照恢复；分组配置始终保存在当前工作区。大型工程中可增加
`debounce` 或降低 `maximumResults`，减少刷新开销。

### 9.7 Bookmarks

| 配置 | 类型 | 默认值 | 可用值 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.bookmarks.sortBy` | string | `"updated"` | `"name"`、`"path"`、`"position"`、`"created"`、`"updated"` | 每个书签分组内的持久化排序方式 |

书签过滤条件是临时视图状态，不会写入工作区配置，也不会修改或删除书签。

### 9.8 Call Hierarchy

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.callHierarchy.defaultDepth` | number | `0` | 0–10 | 新根节点自动展开深度；0 表示保持折叠 |
| `cInsight.callHierarchy.maximumDepth` | number | `10` | 1–50 | 手动或自动展开允许的最大深度 |
| `cInsight.callHierarchy.maximumNodes` | number | `2000` | 100–50000 | Callers 与 Callees 每棵树各自允许创建的最大节点数 |
| `cInsight.callHierarchy.cacheSize` | number | `500` | 10–10000 | Incoming 和 Outgoing 各自缓存的函数请求上限 |
| `cInsight.callHierarchy.pathSearchMaximumDepth` | number | `8` | 1–50 | Caller/Callee Path 最大边深度 |
| `cInsight.callHierarchy.pathSearchMaximumPaths` | number | `20` | 1–500 | 单次路径搜索最多返回的匹配路径数 |
| `cInsight.callHierarchy.pathSearchMaximumNodes` | number | `2000` | 100–50000 | 单次路径搜索最多访问的语义节点数 |

修改 Call Hierarchy 配置会清除调用请求缓存，并触发刷新。

### 9.9 Workspace Session

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.session.restore` | boolean | `true` | `true` / `false` | 是否自动保存并恢复当前工作区浏览快照 |
| `cInsight.session.persistNavigationHistory` | boolean | `true` | `true` / `false` | 是否在快照中保存 Navigation History |
| `cInsight.session.restoreCallHierarchy` | boolean | `true` | `true` / `false` | 是否重新查询并恢复 Callers/Callees 根和加载深度 |
| `cInsight.session.restoreRelationshipGraph` | boolean | `true` | `true` / `false` | 是否无查询地恢复退出时仍打开的 Relationship Graph 静态快照 |
| `cInsight.session.relationshipGraphMaximumSnapshotNodes` | number | `1000` | 50–2000 | 会话最多保存的关系图节点数；超过时降级为仅保存根节点 |
| `cInsight.session.maximumAgeDays` | number | `30` | 1–365 | 超过此天数的快照自动忽略 |

关闭 `restore` 会同时停止自动保存与自动恢复，但仍可使用手动 Restore 命令读取
已有快照。Bookmarks 使用独立的持久化数据，不受这些配置影响。

### 9.10 Type Hierarchy

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.typeHierarchy.defaultDepth` | number | `0` | 0–10 | 新类型根自动展开的层数；0 保持折叠 |
| `cInsight.typeHierarchy.maximumDepth` | number | `10` | 1–50 | 手动或自动展开允许的最大深度 |
| `cInsight.typeHierarchy.maximumNodes` | number | `2000` | 100–50000 | Supertypes 与 Subtypes 每棵树各自允许加载的最大节点数 |

修改上述配置会清除类型层级请求缓存，并将当前结果标记为 stale。

### 9.11 Include Hierarchy

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.includeHierarchy.defaultDepth` | number | `0` | 0–10 | 新文件根自动展开层数；0 保持折叠 |
| `cInsight.includeHierarchy.maximumDepth` | number | `10` | 1–50 | 手动或自动展开允许的最大深度 |
| `cInsight.includeHierarchy.maximumNodes` | number | `5000` | 100–50000 | 每棵包含树各自允许加载的节点上限 |
| `cInsight.includeHierarchy.includeSystemHeaders` | boolean | `false` | `true` / `false` | 是否显示并继续展开系统头文件 |
| `cInsight.includeHierarchy.workspaceFileLimit` | number | `20000` | 100–200000 | Included By 首次建索引最多扫描的源码/头文件数 |

修改这些配置会清除 include 解析及反向索引缓存，并将当前结果标记为 stale。
`workspaceFileLimit` 是安全上限；达到上限时 Included By 结果可能不完整。

### 9.12 Relationship Graph

| 配置 | 类型 | 默认值 | 范围/可用值 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.relationshipGraph.defaultDepth` | number | `1` | 0–1 | 新函数或类型根是否加载第一层关系；0 只保留根 |
| `cInsight.relationshipGraph.maximumDepth` | number | `10` | 1–50 | 图中单条关系路径允许的最大深度 |
| `cInsight.relationshipGraph.maximumNodes` | number | `500` | 50–10000 | 当前图保留的最大语义节点数 |
| `cInsight.relationshipGraph.maximumEdges` | number | `1000` | 100–50000 | 当前图保留的最大语义边数 |
| `cInsight.relationshipGraph.layout` | string | `"layered"` | `"layered"` | 图布局策略；基础版本仅提供分层布局 |
| `cInsight.relationshipGraph.includeSystemHeaders` | boolean | `false` | `true` / `false` | 是否允许已解析的系统头进入 Include Graph |

`defaultDepth`、`maximumDepth`、`maximumNodes` 和 `maximumEdges` 已用于 Call
Graph。布局和系统头开关要到后续 Type/Include Adapter 接入后才完整参与查询。

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
- Code Preview 复用编辑器的语义令牌分类，但 Webview 的主题颜色映射可能与
  编辑器最终合成颜色存在细微差异。
- 静态调用树无法完整解析运行时多态、所有函数指针、宏生成调用和动态分派。
- References Read/Write 分类对复杂指针副作用、模板和重载运算符保持保守。
- clangd 标准索引进度只提供已完成/总数和百分比，不提供当前索引文件名。
- Include Hierarchy 不执行编译器或预处理器；编译器隐式平台头路径、宏生成的
  include 和条件编译的真实启用状态可能无法完整还原。
