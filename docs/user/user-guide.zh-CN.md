# C Insight 使用手册

本文对应 C Insight `0.22.13`，说明安装要求、基本工作流程、各窗口的作用与更新逻辑、状态栏、常用命令、编译数据库，以及所有可配置参数。源码、Issue 和 Release 位于 [GitHub 仓库](https://github.com/H9elix/c-insight)；交叉编译和嵌入式工程另有[专项配置指南](cross-compilation.zh-CN.md)。

### 界面语言

C Insight 使用 VS Code 官方本地化机制，界面语言自动跟随 VS Code 的显示语言：

- VS Code 使用简体中文（`zh-cn`）时，C Insight 使用简体中文；
- VS Code 使用英文或尚未提供翻译的语言时，C Insight 回退到英文；
- 在命令面板执行 **Configure Display Language（配置显示语言）** 并重新加载窗口，即可切换语言；C Insight 不单独提供语言设置。

命令、视图名称、欢迎操作和配置说明由 VS Code 在扩展激活前完成本地化；通知、树节点、状态栏和自定义 Webview 等运行时内容由扩展的语言资源提供。函数名、文件路径、命令 ID、配置 ID、JSON 字段和 clangd/cpptools 原始日志不会被翻译。

## 1. 运行要求

- VS Code 1.95 或更高版本。
- 使用默认引擎时需要 `clangd` 20 或更高版本；使用微软引擎时需要在相同的 Local/Remote 扩展宿主中安装 Microsoft C/C++（`ms-vscode.cpptools`）。
- 当前主要支持本地 C/C++ 工程和单个工作区根目录。
- 实际工程强烈建议提供 `compile_commands.json`。

开发者与维护者为 `you_jinchun`，许可证为 MIT。公开源码和 Issue 位于 `https://github.com/H9elix/c-insight`；安全漏洞应通过仓库 Security 页面私密报告，不得创建公开 Issue。C Insight 不包含遥测，也不会把源码上传到 C Insight 服务；完整边界见随扩展提供的 `PRIVACY.md` 与 `SECURITY.md`。

命令面板执行 **C Insight: About** 可查看或复制插件版本、开发者、分析引擎、许可证、VS Code/平台/Remote 类型和隐私摘要，也可直接打开本使用手册。

安装 VSIX 后，打开 C/C++ 工程并单击 Activity Bar 中的 **C Insight** 图标。默认模式会启动独立的 clangd 进程；也可显式选择已安装的微软 C/C++ 提供程序（Provider）。两种模式不会同时由 C Insight 启动。

如果 clangd 不在 `PATH` 中，可设置：

```json
{
  "cInsight.clangd.path": "/usr/bin/clangd-20"
}
```

要使用微软 C/C++ 引擎，先确认 Microsoft C/C++ 扩展安装在 C Insight 所在的同一个扩展宿主中；Remote SSH 场景必须安装在远端。然后在工作区设置中写入：

```json
{
  "cInsight.engine": "microsoft"
}
```

执行 **Developer: Reload Window** 后生效。微软模式不会启动 C Insight 自带的 clangd；定义（Definition）、声明（Declaration）、引用（References）、悬停信息（Hover）、签名帮助（Signature Help）、文档符号（Document Symbols）/工作区符号（Workspace Symbols）、调用者（Callers）、被调用者（Callees）和代码预览（Code Preview）语义令牌通过 VS Code 公共提供程序命令获得。包含文件（Includes）/被包含关系（Included By）仍由 C Insight 自己解析文件。

该模式第一次成功启用时会显示一次提示，说明 **Microsoft C/C++ language service (cpptools)** 是 C Insight 的语义分析提供方，并且它的性能和查询结果可能与 clangd 不同。提示状态保存在当前 VS Code 扩展宿主的全局状态中，后续启动不再重复弹出；本地和远程扩展宿主的状态彼此独立。

### 提供程序（Provider）冲突与最小影响配置

C Insight 只把实际启用的语言服务视为冲突，而不只判断扩展是否已激活：

- `ms-vscode.cpptools` 已激活，但当前资源的 `C_Cpp.intelliSenseEngine` 为 `disabled` 时，不视为冲突。
- `llvm-vs-code-extensions.vscode-clangd` 已激活，但当前资源的 `clangd.enable` 为 `false` 时，不视为冲突。

因此，`C_Cpp.intelliSenseEngine=disabled` 只关闭 Microsoft IntelliSense，不能关闭 LLVM clangd 扩展。C Insight 使用自带 clangd 引擎时若 LLVM clangd 也启用，仍会正确提示该扩展可能造成重复导航和索引。

冲突提示提供 **Disable for This Workspace**、**Open Settings** 和 **Ignore for Workspace**。快捷关闭不会修改本地或远程的全局用户设置，而是使用 VS Code 的 Workspace 作用域。LLVM 扩展将 `clangd.enable` 声明为窗口级设置，VS Code 不允许把它写入 Workspace Folder，因此不能进一步缩小到多根工作区中的单个根目录：

- 单文件夹本地、WSL 或 SSH 窗口写入该工程的 `.vscode/settings.json`。
- 多根窗口写入共享 `.code-workspace` 的 `settings`。
- 没有工作区文件夹时不提供快捷关闭，只提供 Open Settings。

确认消息会显示实际目标 URI 或说明多根影响范围。操作按冲突类型设置 `C_Cpp.intelliSenseEngine=disabled` 或 `clangd.enable=false`，全部成功后才提示 Reload Window；失败时显示错误并提供 Open Workspace Settings。工作区设置可能被 Git 跟踪并影响使用该工程的其他成员，确认前应留意设置文件变更。

Microsoft 引擎启动检查若确认 LLVM clangd 仍启用，不会再同时弹出普通提供程序警告和通用启动失败，而只显示一条专用错误。选择 **Disable LLVM clangd for This Workspace** 会按上述目标写入 `clangd.enable=false`、记录原值并提示 Reload Window。这个设置只关闭 LLVM clangd 扩展的语言服务；Microsoft 模式本来就不会启动 C Insight 自己管理的 clangd，也不会删除系统中的 clangd 可执行文件。其他 Microsoft 启动失败仍打开对应的 Microsoft C/C++ 设置，不会建议无关的 clangd 修改。

反向场景同样处理：当 `cInsight.engine=clangd`、活动编辑器是 C/C++，并且 cpptools 扩展在当前扩展宿主可用且有效 `C_Cpp.intelliSenseEngine` 不是 `disabled` 时，C Insight 会提示关闭当前 Workspace 的 Microsoft IntelliSense。检测不再依赖 cpptools 是否已经完成 `isActive` 切换，因此不会遗漏两个扩展同时响应 `onLanguage` 的启动时序；它也不会为了检测而主动激活 cpptools。活动编辑器、相关设置或扩展列表变化后会重新检查，同一组冲突在当前会话内不会重复弹窗。确认关闭会写入：

```json
"C_Cpp.intelliSenseEngine": "disabled"
```

C Insight 的 clangd 模式核心定义（Definition）、引用（References）和调用层次（Call Hierarchy）请求直接发给自管 clangd；但编辑器导航、补全、诊断以及通过 VS Code 提供程序获取的预览语义令牌仍可能被其他已启用提供程序影响，因此仍建议关闭竞争服务。

快捷关闭会在当前工作区状态中记录原来的目标层级值。执行 **C Insight: 恢复提供程序设置（Restore Provider Settings）** 时，只有仍保持 C Insight 写入值的设置才会恢复；用户之后手动修改过的设置会跳过，避免覆盖新选择。恢复后同样需要 Reload Window。恢复写入失败的记录会保留，以便修正环境后重试。

微软模式的明确限制：

- 类型层次（Type Hierarchy）暂不可用，因为 VS Code 没有公开稳定的类型层次提供程序执行命令；窗口会显示查询失败原因，不会伪造结果。
- 不显示 clangd 版本、进程日志或 clangd 后台索引进度；微软扩展的进程和索引生命周期由该扩展管理。
- VS Code 提供程序命令不能指定某个提供程序。请不要再启用其他会注册 C/C++ 语义提供程序的扩展，以免结果被聚合。
- 已派发给微软提供程序的查询没有公开的中途取消参数。C Insight 仍会取消排队请求并丢弃过期结果，但不能保证终止微软扩展内部已经开始的工作。
- 引用的 Read/Write 证据取决于文档突出显示（Document Highlights）；若微软提供程序只返回 Text，C Insight 会使用保守的语法推断并降低证据强度。

Microsoft 模式会在 **工程诊断（Project Diagnostics） → Microsoft C/C++ language service (cpptools) → 引用和代码预览证据（References and Code Preview evidence）** 中区分以下阶段：

- `definition/declaration/references.queries`、`.locations`、`.empty`、`.failed`、`.cancelled`：提供程序查询及其原始结果。
- `references.postProcessing.completed`、`.outputLocations`、`.failed`：C Insight 排除定义/声明位置后的引用后处理；因此可以区分提供程序无结果与 C Insight 后处理失败。
- `semanticTokens.completed`、`.empty`、`.timeout`、`.failed`：代码预览语义令牌提供程序的结果。
- `semanticTokens.postProcessingFailed`：令牌已返回，但 C Insight 解码失败。
- `lexicalFallback`：语义令牌为空、超时或失败后，预览已改用词法着色。

这些值是当前扩展宿主进程中的累计运行证据，也包含在工程诊断的文本/JSON 报告 `runtime.counters` 中；它们不是工作区静态索引总量。

## 2. 推荐的首次使用流程

1. 打开工程目录。
2. 为工程生成 `compile_commands.json`。
3. 打开任意 `.c`、`.cc`、`.cpp` 或 `.cxx` 文件。
4. 查看底部 C Insight 状态栏是否为准备就绪（Ready）或正在索引（Indexing）。
5. 打开 C Insight 侧栏，将光标放在函数、变量或类型名称上。
6. 使用上下文（Context）、代码预览（Code Preview）、引用（References）、调用者（Callers）和被调用者（Callees）浏览关系。
7. 如果结果异常，单击底部状态栏进入工程诊断（Project Diagnostics）。

CMake 工程可使用：

```sh
cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
```

生成的文件通常是：

```text
build/compile_commands.json
```

交叉编译工程必须使用真实目标工具链生成数据库；目标架构、sysroot、query driver、Remote 路径和 Microsoft 模式的独立配置见[交叉编译与嵌入式工程配置](cross-compilation.zh-CN.md)。

## 3. 总体更新逻辑

C Insight 有两类查询。

### 3.1 自动光标跟随

当 `cInsight.followCursor` 为 `true` 时，光标停在 C/C++ 符号上会触发：

1. 等待 `cInsight.followCursorDelay`。
2. 根据当前实际可见的窗口计算需要的请求。
3. 只查询这些窗口显示内容所需的基础信息。
4. 如果引用（References）或上下文（Context）与调用窗口需要详情，再等待 `cInsight.followCursorDetailsDelay` 后查询。

移动光标会取消尚未完成的旧查询，避免慢查询覆盖新结果。上下文、代码预览（Code Preview）、引用、调用者（Callers）和被调用者（Callees）全部隐藏时，不执行自动光标语义查询。

自动基础查询的定义（Definition）、声明（Declaration）、Call Root、悬停信息（Hover）和 Symbol Info 全部为空时，当前位置视为没有可导航符号。此时保留已有的上下文（Context）、代码预览、引用（References）、调用者和被调用者结果，不再显示空位置提示，也不会继续发起该位置的延迟引用或调用数量详情查询。切换到非 C/C++ 编辑器仍按原逻辑清空导航结果。

窗口独立调度规则：

| 可见窗口 | 自动查询 |
| --- | --- |
| 仅上下文 | 定义（Definition）、声明（Declaration）、Call Root、悬停信息（Hover）、Symbol Info；关系数量显示为未查询 |
| 仅代码预览（Code Preview） | 定义 |
| 引用 | 定义、声明、Call Root、引用 |
| 调用者 | Call Root；展开节点时才查询传入调用（Incoming Calls） |
| 被调用者 | Call Root；展开节点时才查询传出调用（Outgoing Calls） |
| 上下文 + 调用者 | 额外查询第一层调用者（Caller）数量 |
| 上下文 + 被调用者 | 额外查询第一层被调用者（Callee）数量 |
| 全部隐藏 | 不执行自动光标语义请求 |

文档符号（Document Symbols）也使用独立可见性：窗口隐藏时不查询；打开窗口时立即查询当前活动文件。clangd 后台索引、工程诊断（Project Diagnostics）、书签文本重定位、会话自动保存和用户主动执行的命令不受窗口隐藏影响。

### 3.2 显式查询

以下操作属于显式查询：

- 查找所有引用（Find All References）
- 显示传入调用（Show Incoming Calls）
- 显示传出调用（Show Outgoing Calls）
- 刷新（Refresh）

显式查询可以更新对应结果，即使引用（References）或调用层次（Call Hierarchy）已固定（Pin）。固定的主要作用是阻止普通光标移动替换结果，而不是完全禁止更新。

显式查询不受无符号位置保护：如果用户在空白或其他无符号位置主动执行刷新、查找所有引用或显示传入/传出调用，对应窗口仍会显示该位置的实际空结果。这一区分保证普通光标移动不会破坏浏览上下文，同时保留用户主动确认当前位置的能力。

## 4. 各窗口说明

标题栏主要操作使用紧凑的 VS Code 主题图标（Theme Icon）；悬停图标可查看本地化的完整命令名称，命令面板也保留完整文字。上下文、代码预览、引用、调用者、被调用者和文档符号共用刷新图标，清除书签筛选使用清除图标，不再显示占据一行的文字按钮。

调用者（Callers）、被调用者（Callees）、父类型（Supertypes）、子类型（Subtypes）、包含文件（Includes）和被包含关系（Included By）的标题栏采用统一顺序：显示（Show）、展开到指定深度（Expand to Depth）、搜索已加载内容（Search Loaded）、停止展开（Stop Expansion），再显示该关系特有的操作。Text、JSON、Mermaid 导出统一位于 `...` 溢出菜单并保留文字名称。某个窗口不支持的关系特有功能不会显示，例如只有调用者/被调用者提供路径查找（Find Path）。

批量展开被取消、达到 `maximumDepth` 或达到 `maximumNodes` 后，对应窗口顶部会显示状态行，并指出需要调整的配置。取消不会清除已经加载的节点。位于绝对深度上限的终端节点会附加 `max depth`，用于区别“没有下级关系”和“因安全上限不再查询”。

六个层级窗口共用同一套 Text、JSON 和 Mermaid 导出格式，导出只读取已经加载的节点，不触发隐藏查询。JSON 顶层包含 `schemaVersion`、`relation`、`direction`、`edgeDirection` 和 `roots`；节点统一包含 `name`、`description`、`uri`、可选的 `sourceUri`/`line`、`states` 和 `children`。`states` 会规范化记录 duplicate、cycle、recursion、maximum-depth、maximum-nodes、cancelled 和 possible-indirect-call 等状态。Mermaid 箭头始终表示真实语义方向，而不是窗口树的视觉父子方向。

### 4.1 上下文（Context）

上下文显示当前光标符号的摘要：

- 符号名
- 限定名，例如 `Namespace::Class::method`
- 类型或函数签名
- 定义（Definition）
- 声明（Declaration）
- 引用（References）数量
- 调用者（Callers）数量
- 被调用者（Callees）数量
- 当前文件和行号

基础信息优先显示，引用和调用者（Caller）/被调用者（Callee）数量可能稍后更新。查询期间会显示 `References loading…`、`Callers loading…` 或 `Callees loading…`。

### 上下文（Context）固定（Pin）

标题栏固定会暂停整个自动上下文跟随链路，因此也会暂停由光标移动触发的代码预览（Code Preview）、引用（References）、调用者（Callers）和被调用者（Callees）更新。

文档符号（Document Symbols）按函数、方法、变量、字段、结构体、类、枚举、命名空间等符号类型显示不同的 VS Code 主题图标；图标颜色随当前颜色主题自动变化。

固定后仍可使用查找所有引用（Find All References）、显示传入调用（Show Incoming Calls）、显示传出调用（Show Outgoing Calls）或刷新（Refresh）显式查询。固定/取消固定（Unpin）按钮使用固定位置，切换时不会移动。

上下文固定只在当前 VS Code 会话有效。

### 4.2 代码预览（Code Preview）

代码预览是共享源码预览窗口，可显示：

- 定义（Definition）
- 声明（Declaration）
- 引用（Reference）
- 调用者（Caller）
- 被调用者（Callee）定义
- 被调用者调用位置（Call Site）

光标跟随可调用符号时，C Insight 会同时比较分析引擎返回的定义（Definition）与声明（Declaration），优先预览不等于声明的函数实现位置。若索引尚未提供实现，代码预览先以声明模式显示提供程序位置；clangd 后台索引完成后会执行一次仅包含定义和声明的升级查询，Microsoft 模式还会在 2 秒和 10 秒进行最多两次同类重试。移动光标会取消旧重试；锁定代码预览或固定上下文时不会自动替换当前内容。外部库只有声明时会继续保留声明回退，不伪造定义。

目标符号或范围会精确突出显示，并显示目标前后的源码行；淡蓝色整行背景表示当前定位行。每一行源码使用 HTML `<code>` 元素承载，但 C Insight 会显式清除 VS Code Webview 为预格式文本提供的灰色背景、内边距和圆角，不会再让普通代码行看起来被透明框覆盖。长代码行可以横向滚动，滚动条位于预览代码区域底部。

默认情况下，向上或向下滚动到预览边缘会继续加载同一文件的源码上下文，直到文件开头或结尾。新增代码行直接插入现有预览，不会重建整个窗口；向上插入以及达到行数上限后裁剪远端代码时，会保留当前可见代码和横向滚动位置。被裁剪的代码不是永久丢失，滚回对应方向时会再次加载。

预览底部状态行显示当前加载行范围、文件总行数、加载方向以及是否已到文件开头/结尾。快速连续滚动时只保留一个正在执行的请求，并合并等待中的最新方向。返回先前的代码预览历史目标时，默认恢复该目标的已加载范围、垂直锚点和横向位置；源码修改后会清除该文件的旧滚动位置。

### 鼠标操作

- 单击预览代码中的符号：继续在代码预览（Code Preview）中查看该符号的定义（Definition）。
- 鼠标停在 clangd 识别为可导航的函数、变量、类型、成员或宏等符号上时，光标会变成手形；关键字、运算符、字面量和注释仍显示文本光标。
- 双击预览代码或代码区空白：在主编辑器中打开对应位置；行尾、行号区域或已加载代码上下方的空白会定位到对应或最近的已加载行。该跳转引起编辑器切换时会保留当前预览，不会因为落点暂时没有可解析符号而立即清空。
- 在上下文（Context）、引用（References）、调用者（Callers）、被调用者（Callees）、类型/包含层次、导航历史（Navigation History）、书签（Bookmarks）、符号结果和工程诊断（Project Diagnostics）中单击源码位置节点：更新代码预览，不主动移动主编辑器。
- 双击同一源码位置节点：在主编辑器中打开代码预览所显示的同一位置并居中。文档符号（Document Symbols）也遵循此规则；具有子项的节点仍通过左侧展开箭头展开。双击本身不会让上下文、代码预览、引用、调用者或被调用者跟随新编辑器光标刷新；使用鼠标或键盘将编辑器光标移动到其他位置后，才恢复现有的随光标刷新。文档符号和工程诊断仍会立即跟随活动文件。
- 在位置节点的右键菜单中选择打开位置（Open Location）：在主编辑器中打开。

VS Code 的公共 TreeView API 不提供原生双击事件，因此 C Insight 将同一节点在 `cInsight.navigation.doubleClickInterval` 时间内的第二次激活识别为双击；快速连续按两次 Enter 也会产生相同行为。第一次激活始终立即更新代码预览，不会等待双击超时。只有统一树位置双击使用上述延迟跟随规则；打开位置、转到定义、代码预览内打开和关系图导航仍保持原有的立即跟随行为。

### 代码预览（Code Preview）工具栏

- `←`：回到上一条预览历史。
- `→`：前进到下一条预览历史。
- `⌖`：锁定/解锁预览（Lock/Unlock Preview）。
- `⧉`：复制选中的代码；没有选择时复制完整预览片段。
- `Path`：复制文件路径和行号。
- `↗`：在主编辑器中打开当前预览位置。

### 锁定预览（Lock Preview）

锁定预览只阻止编辑器光标的自动更新。锁定后仍允许：

- 单击预览代码继续查看定义（Definition）。
- 从引用（References）、调用者（Callers）或被调用者（Callees）手动选择新位置。
- 使用预览历史、复制和打开操作。

代码预览（Code Preview）默认通过 VS Code Document 语义令牌（Semantic Tokens）命令复用当前 C/C++ 文档已注册的语义令牌提供器。使用 C Insight 自带 clangd 时，函数、方法、变量、参数、类型、命名空间和宏等分类来自同一 clangd；关键字、字符串、数字和注释等未被语义令牌覆盖的区间继续使用轻量词法高亮。语义请求暂不可用时会自动退回纯词法高亮，不影响预览和导航。语义令牌提供器超过 `cInsight.codePreview.semanticTokenTimeout` 仍未返回时也会执行相同回退，避免大型跨文件目标的着色请求阻塞定义预览。

Webview 不能直接复用编辑器渲染器，也不能读取主题最终合成后的全部 `semanticTokenColors`，因此代码预览使用当前主题公开的 VS Code 颜色变量映射语义类别。符号分类与编辑器一致，但极少数主题中的具体颜色和字体样式可能不完全相同。

### 4.3 引用（References）

引用显示当前符号的所有引用，并尝试分类为：

- 定义（Definition）
- 声明（Declaration）
- Function Call
- Read
- Write
- Read/Write
- Address
- Other 引用（Reference）
- Macro 相关引用

分类优先使用当前分析引擎提供的 Document Highlight，再结合保守的源码语法判断。对于指针副作用、模板、重载运算符、宏展开等复杂情况，分类可能显示推断置信度，而不会假装结果绝对准确。

每条已解析的引用都带有可追溯的分类证据。将鼠标悬停在引用节点上可查看：

- Classification：最终分类结论。
- Confidence：`Semantic`、`Syntax`、`Inferred` 或 `Unknown`。
- Evidence source：`clangd-result`、`clangd-highlight`、`source-syntax`、`clangd-signature`、`symbol-metadata` 或 `fallback`。
- Rule：稳定的规则标识，例如 `access.highlight-read`。
- Summary：该规则为何得出当前结论的说明。

其中三个以 `clangd-` 开头的来源名是为保持已有导出兼容而保留的稳定内部标识；在 Microsoft 模式下，其说明分别代表当前分析引擎的语义结果、Document Highlight 和签名帮助（Signature Help），并不表示后台又启动了 clangd。文本导出使用紧凑的 `来源:规则` 形式；JSON 导出在 `classification.evidence` 中保留完整的 `source`、`rule` 和 `summary`，便于脚本审计或后续分析。一个宏引用可能同时包含“宏来源”和“读写类型”两条证据。

对于指针和 C++ 引用参数，C Insight 额外区分：

- `Read · Pointee Write`：读取指针值，但写入的是所指对象，不表示指针变量本身被赋值。直接的 `*pointer = ...` 或 `pointer->field = ...` 使用语法置信度。
- `Read/Write · Reference Write (inferred)`：当前分析引擎的签名帮助表明实参对应可变 `T&` 参数，调用可能通过引用修改对象。
- `Read · Pointee Write (inferred)`：实参对应可变 `T*` 参数，参数类型允许被调函数修改所指对象。

`const T&`、`const T*` 和 `T&&` 不会被上述保守规则标成可变副作用。参数类型只说明“允许修改”，不能证明函数体一定发生写入，因此跨调用点结果使用 `Inferred`。

C++ 重载运算符的调用位置通常只显示 `+`、`[]`、`()` 等符号，并不存在普通函数名。查询符号由当前分析引擎标识为 `operator...`，且引用范围与对应运算符 token 匹配时，引用会显示 `Function Call (inferred)`，证据规则为 `role.overloaded-operator-call`。这不会把同一行中无关的标点当成该运算符调用。

### 模板与宏来源

C Insight 会检查当前分析引擎返回的定义（Definition）和声明（Declaration）：

- 定义行为 `#define` 时，引用证据 `macro.symbol` 的 `origin` 指向宏定义的 URI、行和列。
- 定义或声明附近存在 `template <...>` 时，结果增加 `Template` 标签，并以 `template.declaration` 记录模板声明来源。
- 位于预处理指令本身的引用仍额外记录 `macro.directive`。

悬停提示会显示 `Origin`；文本导出采用 `来源:规则@Origin`，JSON 则在每条 evidence 的 `origin` 字段保存来源。该分析说明符号从哪个声明产生，不尝试完整重建编译器的宏展开栈或每个模板实例化步骤。

### 分组方式

标题栏 Change 引用（Reference） Grouping 提供：

| 值 | 含义 |
| --- | --- |
| `file` | 按文件分组 |
| `directory` | 按目录和文件分组 |
| `function` | 按引用所在函数分组 |
| `type` | 按定义（Definition）、Call、Read、Write 等引用类型分组 |
| `confidence` | 按 Semantic、Syntax、Inferred、Unknown 置信度分组 |
| `evidence` | 按最终分类规则的证据来源分组 |
| `flat` | 不分组，显示平铺列表 |

分组选择保存到工作区配置。`cInsight.references.autoExpandGroups` 控制文件、目录、函数、引用类型、置信度和证据来源模式是否在生成结果时自动展开全部分组，默认值为 `false`，即默认折叠；`flat` 模式没有分组节点。切换该设置会立即重新发布当前引用树，只显示已经生成的引用子项，不会产生额外的 clangd 或 Microsoft C/C++ language service (cpptools) 查询。用户仍可执行展开/折叠所有引用分组（Expand/Collapse All Reference Groups）临时改变当前树。

### 范围过滤

Change 引用（Reference） Scope 提供：

| 范围 | 含义 |
| --- | --- |
| All | 所有未被排除的结果 |
| Workspace | 只显示当前工作区内文件 |
| Current Directory | 只显示活动文件同目录的结果 |
| Current File | 只显示活动文件中的结果 |

范围选择不写入 VS Code 工作区配置。启用工作区会话恢复（Workspace Session Restore）时，它会保存在 C Insight 工作区浏览快照中，并在重新打开同一工作区后恢复；关闭会话恢复时，它只保留到当前扩展运行结束。

### 搜索、分页和导出

- Filter 引用（References）：匹配源码、文件名、路径或引用分类。
- Filter 引用 by Confidence or Evidence：只保留指定置信度或包含指定证据来源的引用；选择 All classifications 可清除该过滤。
- Clear 引用（Reference） Filter：清除搜索文本。
- Load More 引用：再加载一个 `pageSize`。
- 显示全部引用（Show All References）：显示所有过滤后的引用。
- Copy 引用 / Copy All 引用：复制单条或全部结果。
- Export 引用 as Text/JSON：导出过滤后的结果。
- Open 引用 List in Editor：在临时文本编辑器中打开列表。
- Expand/Collapse All 引用 Groups：展开或折叠分组。

源码行和部分分类会在节点可见时延迟加载，以降低大型工程开销。搜索和导出需要完整文本时会主动解析相关行。

文本导出首行记录结果数、分组、范围和证据过滤条件。JSON 使用 `c-insight.references`、版本 `1` 的导出结构，包含生成时间、活动过滤条件、结果总数和 `references` 数组；每条结果保留完整 classification/evidence，适合后续脚本处理。

引用搜索文本和当前已显示数量与范围过滤相同：不写入工作区配置，但启用工作区会话恢复（Workspace Session Restore）时会随工作区浏览快照恢复。

### 引用（References）固定（Pin）

引用有独立固定状态。固定后：

- 光标移动不会替换当前引用。
- 查找所有引用（Find All References）或显式刷新（Refresh）仍可替换结果。
- 搜索、分组、范围过滤、分页、导出和代码预览（Code Preview）仍可使用。

### 4.4 调用者（Callers）

调用者回答“哪些函数调用当前函数”。clangd 模式使用传入调用（Incoming Calls）；Microsoft 模式默认使用引用（References）和每个引用位置的文档符号（Document Symbols）推导其外层函数，避免部分 cpptools 版本在原生传入调用中发生进程崩溃。

树的根节点优先定位到当前函数的实现。C Insight 只替换根节点的显示与预览位置，后续传入调用（Incoming Calls）仍使用提供程序原始调用层次（Call Hierarchy）项及其不透明 `data`，避免因修改查询身份导致展开失败。索引暂未提供实现时，根节点显示“声明回退”；找到实现后只更新根位置，不清空已经加载的子树、缓存或展开路径。调用者与被调用者使用同一个规范化根位置。

展开节点后，子节点最前面显示当前被展开函数的全部独立声明，随后把上游调用者的每一个调用位置（Call Site）按文件、行和列的源码顺序直接显示为一行。声明必须与已经识别出的函数实现位置不同；若定义（Definition）和声明（Declaration）提供程序（Provider）都返回同一个位置，C Insight 还会使用原始调用层次（Call Hierarchy）项的位置判断它是否只是定义。没有独立声明的函数不会生成一个伪装成声明的定义行。

例如 `report` 在 `add` 中调用两次、在 `main` 中调用三次时，展开 `report` 会先显示 `report` 的独立声明（若存在），再直接得到两个 `add` 和三个 `main` 调用点。不会再为 `add` 和 `main` 追加不可展开的定义叶节点。继续展开规范 `add` 调用点时，才会在这一层最前面显示 `add` 自身的独立声明，然后查询调用 `add` 的函数。声明和调用点均遵循单击预览、双击打开。

当光标位于 `st->codecpar`、`(st)->codecpar` 或 `object.member` 这类通过简单变量直接访问的字段（Field）或属性（Property）时，调用者会追踪所选基变量的声明。通过同一变量产生的直接访问显示在“当前变量（Selected variable）”分组中；通过其他可识别变量访问同名成员的位置会被排除；`get_stream()->codecpar`、数组基表达式、强制转换和链式成员等无法可靠归属到简单变量的表达式，则保留在后面的“无法确定变量实例（Variable instance could not be determined）”分组中。两个分组之间有明确的状态分隔行。

该行为是保守的直接访问分类，不执行别名或指针指向分析。例如 `alias = st; alias->codecpar` 不会被推断为 `st` 的访问。调用关系图（Call Relationship Graph）的边状态、关系图会话恢复以及 Text/JSON/Mermaid 导出保留同一分类。Microsoft 模式下，如果 cpptools 没有为字段返回调用层次（Call Hierarchy）根，C Insight 会从定义（Definition）构造“基于引用的成员（References-based member）”根并使用安全的基于引用路径，随后仍应用相同的变量实例筛选。

默认情况下，新调用者根会自动展开一层，因此调用者窗口可见时会直接显示第一层调用点。只有当前可见的调用方向会自动查询；被调用者窗口隐藏时不会因为调用者展开而附带查询被调用者。将 `cInsight.callHierarchy.defaultDepth` 设为 `0` 可恢复为只显示折叠根节点。

同一语义调用者只有源码位置最早的调用点带展开箭头，用于懒加载该函数的上一层调用者，其余同名调用点是可预览、可打开但不继续查询的叶节点。这样既保留所有调用证据，也不会因为同一个函数内有多处调用而重复执行下一层语义查询。若提供程序没有返回调用位置范围，C Insight 会保留一个标记为“调用位置不可用”的定义位置回退节点。

Microsoft 引用回退结果会显示“基于引用（References-based）”提示。它属于近似结果：普通直接调用通常可以识别，但宏展开、函数指针以及提供程序（Provider）未返回的引用可能缺失。可将 `cInsight.microsoft.callersMode` 改为 `native` 使用 cpptools 原生传入调用（已知对部分跨文件符号存在崩溃风险），或设为 `disabled` 禁用。因此该模式查询为空时不会把提供程序没有提供足够证据误报成“确认没有调用者”：

- 引用查询没有返回调用证据时显示 `No callers found by Microsoft 引用 query — results may be incomplete`。
- 引用已返回位置，但无法映射到外层函数时显示找到的引用数量以及 `enclosing caller functions could not be identified`。这通常表示提供程序的文档符号缺失、范围或类型不兼容，而不表示没有调用者。

上述证据会按已经查询过的调用者节点累计显示在 **工程诊断（Project Diagnostics） → Microsoft C/C++ language service (cpptools) → 调用者 evidence (loaded nodes)** 中，包括 Queried nodes、引用、Mapped references、Unmapped references 和调用者（Caller） functions。复制或导出的工程诊断文本/JSON 也包含同一组数据。刷新或修改调用层次（Call Hierarchy）配置导致查询缓存失效时，这些计数会从零重新累计；它不是整个工作区的静态索引总量。0.18.8 还兼容 cpptools 将 C 函数以扁平 `Interface` 类型返回的情况：仅当符号名具有函数参数列表且其完整源码范围包含引用位置时，才将其识别为外层调用函数，避免误把真正的接口或类型符号当作调用者。

可能出现的标签：

- `direct recursion`：直接递归。
- `indirect recursion`：当前展开路径中形成间接递归。
- `duplicate`：同一函数已在树的其他位置出现。
- `No callers found`：在可靠条件下确认没有结果。
- `No callers found yet — results may be incomplete`：工程或索引条件受限。

### 4.5 被调用者（Callees）

被调用者回答“当前函数调用了哪些函数”。Microsoft 模式使用 cpptools 原生传出调用（Outgoing Calls），当前没有推测性回退。已经展开查询过的节点会累计显示在 **工程诊断（Project Diagnostics） → Microsoft C/C++ language service (cpptools) → 被调用者 evidence (loaded nodes)** 中：

- `Queried nodes`：实际派发过原生传出调用的不同节点数；缓存命中不重复计数。
- `Successful`、`Failed`、`Cancelled`：最后一次节点查询的结果分类。
- `Empty results`：成功返回但没有被调用者（Callee）的节点数；它与失败分开统计。
- `Callee functions`：成功查询返回的被调用者数量总和。
- `Average duration`、`Maximum duration`：这些节点查询的平均和最长耗时。

同一证据也写入工程诊断文本/JSON 报告；调用层次（Call Hierarchy）缓存失效时清零。这里统计的是当前缓存周期内已加载节点，不代表整个工作区的全部被调用者。

### 4.6 Microsoft 调用层次（Microsoft Call Hierarchy）交互一致性

调用者（Callers）与被调用者（Callees）继续共用固定（Pin）状态：固定后光标移动不会替换两棵树，但显式执行显示传入/传出调用（Show Incoming/Outgoing Calls）或刷新（Refresh）仍允许更新到当前符号。0.18.14 的真实 FFmpeg Extension Host 回归覆盖了固定、自动更新阻止、固定状态下手动刷新和取消固定（Unpin）。“Microsoft 调用者：基于引用（Microsoft Callers: References-based）”是调用者的模式状态行，不是查询数据。0.18.15 为它增加独立身份；每次固定/取消固定重建临时状态行前都会移除旧实例，因此连续切换不会产生多行 Microsoft 调用者，也不会把原来的 Pinned 行错误转换成它。

展开到指定深度（Expand to Depth）对两个方向分别查询和缓存；incoming/outgoing 缓存彼此独立。已加载深度和精确展开路径继续写入工作区会话（Workspace Session）。分析配置、调用层次（Call Hierarchy）配置或源码变化触发失效时会停止展开并清空两个方向的请求缓存及 Microsoft 查询证据。若展开期间恰好发生树根刷新，已经成功加载的数据和精确展开路径仍会保留；界面节点的 `reveal` 属于尽力展示，不会再反向导致语义查询失败。

搜索已加载的调用者/被调用者（Search Loaded Callers/Callees）只搜索已经加载进树的可导航节点，不触发新提供程序（Provider）查询；调用者搜索包含已经加载的声明行，同名函数的不同调用位置仍作为不同结果并定位到各自行。声明行不是调用关系，不参与 `maximumNodes` 的调用点预算、深度、递归、路径、会话展开状态或 Text/JSON/Mermaid 语义导出。调用导出继续保留重复调用点的 URI 和行号。查找调用者/被调用者路径（Find Caller/Callee Path）仍按语义函数关系搜索，不会因为调用点或声明行而重复遍历同一关系。

### 4.7 Microsoft 请求与资源控制

显式显示传入调用（Show Incoming Calls）或显示传出调用（Show Outgoing Calls）属于方向限定请求，只准备当前函数的调用层次（Call Hierarchy）根，不再附带执行无关的引用（References）查询；如果引用窗口已有结果，也不会因这次未请求引用而被清空。真正展开调用者（Callers）时，基于引用（References-based）模式仍会为被展开节点按需查询引用。

每个实际展开的调用者语义节点还会并行请求一次定义（Definition）和声明（Declaration），并按 `cInsight.callHierarchy.cacheSize` 使用同一容量上限的独立 LRU 缓存。根节点复用光标上下文已经取得的位置，避免重复请求；隐藏、未展开、重复且不可展开或达到最大深度的节点不会查询声明。声明请求失败不会隐藏已经取得的调用者；调用者查询失败时，已经成功取得的声明仍可导航。达到调用点节点预算后，声明不计入预算，手动展开已有规范节点仍可看到声明和限制提示。cpptools 的浏览数据库尚未就绪时可能暂时返回空字段引用；C Insight 不缓存这种 Microsoft 成员字段空结果。显式执行显示传入调用（Show Incoming Calls）或刷新（Refresh）也会先使现有调用层次缓存失效，再发起新的提供程序（Provider）查询。

光标跟随继续分为 `followCursorDelay` 基础防抖和 `followCursorDetailsDelay` 详情延迟。0.18.16 的真实 FFmpeg 回归会在所有导航窗口可见时连续移动光标 20 次，要求最终最多产生一个有界语义查询周期、引用最多一次、定义（Definition）最多两次（基础定义加引用排除定义的后处理），并且调度队列最终无 active/queued 任务。多窗口峰值并发、取消、按方法耗时和调用层次缓存命中仍可在工程诊断（Project Diagnostics）的 Runtime performance 中查看。

被调用者（Callees）对应 clangd 传出调用（Outgoing Calls），回答“当前函数调用了哪些函数”。

基本逻辑与调用者相同，但方向相反。展开当前函数后，每一次传出调用直接显示为被调用函数名称相同但源码位置不同的调用点节点；单击或双击均以调用发生的位置为目标，而不是被调用函数的定义。每个语义被调用者只有最早调用点可以继续展开其下一级被调用者；如需查看定义，可在代码预览（Code Preview）中单击该符号，或使用转到定义（Go to Definition）。

被调用者窗口可见时，新根同样默认自动展开一层并直接显示第一层调用点；调用者窗口隐藏时不会附带查询调用者。显式执行显示传入调用（Show Incoming Calls）或显示传出调用（Show Outgoing Calls）时，仅自动展开命令对应的方向。

显式函数指针或成员函数指针调用可能标记为 `possible indirect call`。clangd 无法解析的运行时目标不会被 C Insight 猜测或伪造。

展开被调用者节点时，C Insight 还会在对应函数体中查找明确的 `(*callback)(...)`、`(object.*handler)(...)` 和 `(pointer->*handler)(...)` 语法。如果 clangd 的传出调用没有包含该位置，则添加可导航的 `Unresolved indirect call` 节点，说明其为函数指针或成员函数指针以及 `syntax evidence`。该节点只证明“这里存在显式间接调用”，不会猜测运行时目标。

扫描会忽略注释、字符串和字符字面量，并限制为函数体前 2000 行；只有用户展开对应被调用者节点时才执行，不会在隐藏窗口或未展开节点上后台扫描。

### 调用者（Callers）/被调用者（Callees）共用固定（Pin）

调用者和被调用者各自显示固定/取消固定（Unpin）按钮，但共用一个调用层次（Call Hierarchy）固定状态。任意一边切换后，另一边会同步。

固定后仍允许：

- 显式显示传入/传出调用（Show Incoming/Outgoing Calls）
- 展开节点或展开到指定深度
- 搜索已加载节点
- 查找调用者/被调用者路径（Find Caller/Callee Path）
- 导出
- 选择节点更新代码预览（Code Preview）

### 展开和安全限制

- 默认按需展开。
- 展开到指定深度（Expand to Depth）可加载指定深度。
- 停止调用层次展开（Stop Call Hierarchy Expansion）可取消批量展开。
- `maximumDepth` 限制语义函数关系的最大展开深度；同一层的多个调用点不额外增加语义深度。
- `maximumNodes` 限制当前树创建的节点总数，每一个平铺调用点均计为一个节点；调用者和被调用者仍分别计算预算。
- Incoming 和 Outgoing 使用独立 LRU 缓存。
- 源码修改、clangd 重启或调用树配置变化会清空请求缓存。

启用工作区会话恢复（Workspace Session Restore）时，调用者（Callers）和被调用者（Callees）分别保存实际展开的节点路径。重新打开工作区后，只重新查询并展开这些分支；已折叠分支及其后代不会因为树中其他位置曾达到更深层级而被恢复。每个方向最多保存 500 条稳定路径，恢复查询仍受 `maximumDepth` 和 `maximumNodes` 约束。旧版本只保存最大深度的快照仍可按原方式恢复。

### 搜索已加载的调用者/被调用者（Search Loaded Callers/Callees）

只搜索已经加载到内存中的调用点节点，不会为了搜索偷偷展开整棵调用树。同名函数的不同调用位置分别出现，选择结果会在树中定位到对应调用行。

### 查找调用者/被调用者路径（Find Caller/Callee Path）

从当前根节点沿调用关系搜索到目标函数名或限定名片段：

- 调用者（Caller） Path 沿 Incoming 方向搜索。
- 被调用者（Callee） Path 沿 Outgoing 方向搜索。
- 避免同一路径内的循环。
- 受独立的深度、路径数量和访问节点数量限制。
- 选择找到的路径后，在代码预览（Code Preview）中预览目标定义（Definition）。

### 导出

可导出当前已经加载的树：

- Text
- JSON
- Mermaid `.mmd`
- 包含 Mermaid fenced code block 的 Markdown `.md`

导出不会触发隐藏的自动展开。

### 4.8 导航历史（Navigation History）

导航历史记录当前 VS Code 会话中的显式导航：

- 定义（Definition）
- 声明（Declaration）
- 引用（Reference）
- 调用者（Caller）
- 被调用者（Callee）
- 在代码预览（Code Preview）内单击符号继续查看定义

普通编辑器光标跟随不会写入历史，避免快速移动光标产生大量无意义记录。连续相同位置、模式和来源的记录默认合并。

历史按时间倒序显示，最新记录位于顶部。当前共享历史游标会标记为 `current`。

- 单击记录：在代码预览中重新预览，不会再次写入历史。
- 双击记录：在主编辑器中打开同一位置，并保留该记录为当前历史游标。
- 右键选择打开位置（Open Location）：在主编辑器中打开。
- Filter 导航历史：按定义、声明、引用、调用者、被调用者或代码预览来源过滤；启用会话恢复时保存该过滤条件。
- Clear 导航历史：清空当前工作区已加载的历史。

代码预览的 Back/Forward 使用同一历史游标。从旧记录返回后执行新的显式导航，会丢弃原有的 Forward 分支，形成新的导航路径。

默认启用 `cInsight.session.persistNavigationHistory` 时，历史记录、当前游标和过滤条件会写入工作区浏览快照，并在重新打开同一工作区后恢复。关闭该配置后，导航历史只保留在当前扩展运行期。需要作为长期工程资料独立保存的位置仍建议加入书签（Bookmarks）。

### 4.9 书签（Bookmarks）

书签用于长期保存重要符号或源码位置，并按工作区持久化。关闭并重新打开 VS Code 后，当前工作区的书签仍会恢复。

添加方式：

- 单击书签标题栏的 Bookmark Current Symbol，保存活动编辑器光标下的符号。
- 在引用（References）、调用者（Callers）、被调用者（Callees）、文档符号（Document Symbols）、导航历史（Navigation History）等位置节点上右键，选择 Add Bookmark。

添加时会读取目标位置的真实标识符。相同文件和起始位置已经存在书签时，不会重复创建，而是更新已有记录。新书签默认进入 `General` 分组。

书签操作：

- 单击：在代码预览（Code Preview）中预览，并进入导航历史。
- 双击：在主编辑器中打开同一书签位置。
- 右键打开位置（Open Location）：在主编辑器中打开。
- Rename Bookmark：只修改显示名称，不修改用于重定位的原始符号。
- Change Bookmark Group：移动到已有分组，或创建新分组。
- Delete Bookmark：确认后删除。
- 刷新（Refresh）书签：重新检查并尝试定位全部书签。
- Filter 书签：按名称、分组、文件路径或原始符号筛选；Clear Bookmark Filter 恢复全部结果。
- Sort 书签：按名称、文件路径、源码位置、创建时间或最近更新时间排序。排序方式按工作区保存。

### 导入、导出和分组管理

Export 书签（Bookmarks）将全部书签保存为带格式名和版本号的 JSON。分组节点右键选择 Export 书签时只导出该分组。

Import 书签校验 JSON 格式后提供两种方式：

- Append and Update：保留当前数据；文件和起始位置相同的记录更新已有书签。
- Replace All：确认后删除当前全部书签，再载入文件。

导入文件内部的重复位置只保留最后一项，并在结果消息中报告。目标文件不存在的书签会保留但标记为已过期（stale）。格式不支持、字段错误或 JSON 损坏时不会修改现有书签。

分组节点右键操作：

- Rename or Merge Bookmark Group：输入新名称；名称已存在时合并两个分组。
- Export 书签：仅导出该分组。
- Delete Bookmark Group：确认后删除分组及其全部书签。

源码修改后，相关书签会立即显示 `stale`。停止编辑约 500 ms 后，C Insight 使用添加书签时保存的标识符，在原位置附近寻找最近的完整单词：

- 找到后更新位置并清除已过期。
- 找不到、文件无法读取或书签没有有效标识符时，保留原位置和已过期。

这种重定位是保守的文本级恢复，并不等同于永久符号 ID。文件中存在多个同名符号时，会选择距离旧位置最近的一个。

### 4.10 符号搜索（Symbol Search）

符号搜索用于在整个工作区查找当前分析引擎已索引的函数、变量、类型、方法、枚举、宏等符号。搜索输入框永久保留在窗口顶部，结果在下方独立滚动，因此浏览长结果列表时无需滚回底部或顶部重新输入。直接输入文字，或单击标题栏搜索（Search）按钮聚焦已有输入框；内容会以防抖方式发送工作区符号（Workspace Symbols）请求，较旧的请求不会覆盖较新的结果。

查询和结果始终保留在符号搜索窗口：

- 单击结果：以定义（Definition）模式在代码预览（Code Preview）中预览，并写入导航历史（Navigation History）。
- 双击结果：在主编辑器中打开同一符号位置。
- 右键打开位置（Open Location）：在主编辑器打开。
- 右键选择添加书签（Add Bookmark）：保存到书签（Bookmarks）。
- Filter Workspace Symbol Types：选择需要显示的符号类型。它不写入工作区配置，但启用工作区会话恢复（Workspace Session Restore）时会随浏览快照恢复。
- Group 工作区符号（Workspace Symbols）：按 Symbol Type、File、Directory 分组或不分组。
- 刷新（Refresh）：重新执行上一次查询。
- Clear：清空查询和结果。

结果完整性取决于当前分析引擎的工作区索引。索引或工程配置异常只通过统一状态栏提示，不会在符号搜索内重复显示可靠性警告。

### 4.11 文档符号（Document Symbols）

文档符号显示当前分析引擎返回的活动文件符号：

- 函数
- 方法
- 类型
- 变量
- 其他提供程序（Provider）返回的符号

支持提供程序（Provider）返回的层级结构。单击符号名称会以定义（Definition）模式更新代码预览；双击在主编辑器中打开并定位。具有子项的节点仍可通过展开箭头展开。切换活动文件或修改当前文件后会重新查询。

命令 **Search 工作区符号（Workspace Symbols）** 会打开符号搜索（Symbol Search）的实时搜索选择器。

### 4.12 工程诊断（Project Diagnostics）

工程诊断用于排查“为什么导航结果不准确或不可用”，显示：

- 当前分析引擎及其生命周期状态
- clangd 模式下的可执行文件、版本、Background Index 状态和进度
- Microsoft 模式下的扩展版本、`C_Cpp.intelliSenseEngine` 有效值、`verified`/`ambiguous`/`disabled`/`unavailable` 状态及已知提供程序（Provider）冲突
- `compile_commands.json` 路径、来源和条目数
- 当前文件的编译命令
- 当前文件的编译工作目录
- 编译器、显式语言和 `-std` 标准
- `-I`、`-isystem` 和 `-iquote` Include 路径
- `-D` 宏、`-include` 强制包含和 `@response` 文件
- Language diagnostics 错误和警告数量及来源
- 缺失头文件数量
- 当前文件的具体 diagnostics

标题栏提供：

- 刷新工程诊断（Refresh Project Diagnostics）
- 显示 clangd 日志（Show clangd Log）
- Select Compilation Database
- Restart Background 正在索引（Indexing）
- Copy 工程诊断 Report
- Export 工程诊断 as JSON

命令面板还可执行 **Export 工程诊断 as Text**。复制和导出报告包含引擎状态；clangd 状态/版本或 Microsoft C/C++ language service (cpptools) 证据；索引状态、编译数据库、当前文件命令拆解、回退配置以及当前文件 diagnostics。JSON 使用带 `schemaVersion` 的结构化格式，适合脚本处理或提交问题；文本格式适合直接粘贴。

对于源文件，`compile_commands.json` 中路径完全匹配的条目标记为 `direct`。头文件通常没有独立条目，clangd 会根据其内部 HeaderIncluderCache 等信息推断命令；C Insight 会优先查找同目录同名源文件，再选择同目录源文件作为 `inferred-candidate`。这个候选项用于诊断 Include 路径和宏，不代表 C Insight 能够确认 clangd 最终选择了它。没有直接条目或候选条目时标记为 `fallback`；clangd 模式显示 `cInsight.fallbackFlags`，Microsoft 模式说明当前文件使用 `C_Cpp.default.*` 或 `c_cpp_properties.json` 基础配置。

Microsoft 模式要求 `C_Cpp.intelliSenseEngine` 的当前资源有效值为 `default`。值为 `disabled` 或 `Tag Parser` 时拒绝进入 ready；发现已激活的 LLVM clangd 等已知竞争提供程序时标记为 `ambiguous` 并拒绝语义查询。`verified` 只表示未发现已知冲突，因为 VS Code 公共命令仍不返回每条结果的提供程序身份。

工程诊断中的具体错误/警告单击时在代码预览中显示对应范围，双击时在编辑器中打开。编译数据库路径和头文件候选源文件也可以单击打开。缺少编译数据库时提供选择入口；Fallback Flags 可直接打开相应设置；索引分组提供重启后台索引入口。

命令面板还提供 **Use Automatic Compilation Database Detection**，用于清除手动选择并恢复自动发现。

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

选中的目录会通过 `--compile-commands-dir` 传给 clangd。数据库变化后，C Insight 会延迟约 750 ms，询问是否重启 clangd 以重新加载全部编译命令。

### 4.13 工作区会话恢复（Workspace Session Restore）

直接通过 **Open Folder** 打开的 FFmpeg 等目录就是 VS Code 单文件夹工作区，不需要 `.code-workspace` 文件。C Insight 使用 VS Code `workspaceState` 为每个文件夹或多根工作区隔离保存浏览快照。

默认每五秒自动保存，并在正常关闭时再次保存：

- 导航历史（Navigation History）的记录、当前游标和过滤条件。
- 代码预览（Code Preview）当前目标及锁定（Lock）状态。
- 引用（References）的搜索、范围和已显示数量；分组本来就由工作区配置保存。
- 符号搜索（Symbol Search）最近查询和符号类型过滤。
- 调用者（Callers）/被调用者（Callees）的根位置、两个窗口的最大已加载深度，以及分别实际展开的稳定节点路径。
- 关系图（Relationship Graph）的版本化静态图快照、当前选择、关系过滤、折叠节点和缩放/平移位置。

自动保存、面板关闭和 VS Code 退出产生的保存请求会按顺序写入，较早的异步写入不会覆盖较新的关闭状态。启动恢复期间显示可取消进度；Navigation 导航历史（Navigation History）、搜索状态、关系图、调用层次（Call Hierarchy）和代码预览分步恢复，某一部分失败不会阻止其他部分。取消会在当前步骤结束后阻止后续步骤，并保留已经恢复的状态。

当前快照仍不保存父类型（Supertypes）/子类型（Subtypes）或包含文件（Includes）/被包含关系（Included By）树的根、已加载深度和展开状态。关闭或重新加载窗口后，需要显式重新执行对应的显示（Show）命令；此项已列入备忘录，暂不实现，以避免打开大型工程时因被包含关系恢复而意外启动反向索引扫描。

重新打开相同工作区后，轻量状态直接恢复。调用关系不会直接信任旧节点，而是用保存的位置重新请求 clangd，再沿保存的稳定节点路径重新查询实际展开过的分支，并标记为从上一会话恢复。因此源码或编译数据库变化后不会把旧调用结果伪装成最新结果。对于 0.15.0 以前保存的快照，仍以最大已加载深度作为兼容恢复方式。

启动时会先完成或取消会话恢复，再启动编辑器光标自动跟随，避免恢复结果立刻被启动光标查询覆盖。保存的 `file:` 或 Remote SSH URI 会通过 VS Code `workspace.fs` 检查；远程连接恢复后仍可继续恢复，位置不可访问或文件已删除时只跳过对应代码预览、调用层次或关系图（Graph）部分并记录原因。

关系图恢复采用不同策略：直接显示上次保存的静态节点和边，不在恢复阶段请求 clangd、解析 Include 或建立被包含关系索引。恢复的函数和类型节点不保存 clangd opaque item；用户明确继续展开时，C Insight 才按保存的位置重新执行 prepare，并给节点加入 `revalidated` 状态。文件节点同样只有在明确展开时才读取关系。

只有 VS Code 退出或 Reload Window 时仍然打开的关系图才会在下次启动时恢复。用户主动关闭关系图（Graph）标签页会立即从工作区会话快照中清除关系图，之后关闭并重新打开 VS Code 不会再次出现已关闭的关系图。

恢复前会检查根文件是否仍然存在；根文件缺失时跳过整张图。其他文件若之后删除，会在用户预览或打开时标记 `missing` 并显示警告。关系图快照具有独立 schema 版本和严格大小限制；格式不兼容或内容损坏时只丢弃关系图部分，不影响其他会话状态。节点或边过多时保存为仅含根节点的降级快照，避免 workspaceState 过大。

命令面板提供：

- **Restore Previous 工作区会话（Workspace Session）**：手动再次应用已保存快照；即使关闭自动恢复也可以使用。
- **Clear Saved 工作区会话**：删除快照，并暂停当前窗口的自动保存，下次打开工作区时从空状态开始。

仅打开一个源码文件且没有打开文件夹时，不具备稳定的工程工作区作用域，不建议依赖会话恢复。

### 三类状态保存机制

| 机制 | 示例 | 重启后行为 |
| --- | --- | --- |
| VS Code 工作区配置 | 引用（References）分组、符号搜索（Symbol Search）分组、书签排序方式、深度和节点限制 | 始终由 VS Code 为该工作区保存 |
| C Insight 工作区会话（Workspace Session）快照 | 导航历史（Navigation History）、代码预览（Code Preview）、引用搜索/范围/分页、符号搜索查询/类型过滤、调用树根和加载深度、关系图（Relationship Graph）静态快照与画布状态 | `cInsight.session.restore` 启用且快照未过期时恢复 |
| 仅当前扩展运行期 | 类型/包含层次（Type/Include Hierarchy）树、书签（Bookmarks）当前过滤文本、临时加载缓存、未写入快照的交互状态 | 关闭或重新加载窗口后清除 |

书签数据本身使用独立的 `workspaceState` 持久化，不依赖工作区会话；表中的“书签当前过滤文本”仅指过滤输入，不是书签内容。

### 4.14 父类型（Supertypes）与子类型（Subtypes）

这两个窗口使用 clangd 的标准类型层次（Type Hierarchy）协议，主要面向 C++：

- 父类型：当前类或结构体继承、实现的父类型。
- 子类型：继承当前类型的派生类型。

把光标放在类或结构体名称上，通过编辑器右键菜单或命令面板执行 **显示父类型（Show Supertypes）** 或 **显示子类型（Show Subtypes）**。一次查询会为两个窗口建立同一个根，随后分别按需请求父类型和派生类型。

窗口行为：

- 展开节点：懒加载下一层关系。
- 单击节点：以定义（Definition）模式更新代码预览（Code Preview），并写入导航历史（Navigation History）。
- 双击节点：在主编辑器中打开同一类型位置。
- 右键打开位置（Open Location）：在主编辑器打开。
- 右键 Add Bookmark：保存类型位置。
- 搜索已加载内容（Search Loaded）父类型/子类型：先按 Class/Struct/Interface 等类型种类和 queried/supertype/subtype 关系过滤，再用输入框搜索名称、关系、文件或路径。结果显示继承深度和完整已加载路径；选择后定位原树节点。
- 展开到指定深度（Expand to Depth）：批量加载指定深度。
- Stop 类型层次 Expansion：取消正在进行的批量展开。
- 窗口 `...` 菜单可导出 Text、JSON 或 Mermaid。

每个类型节点会显示 Class、Struct、Interface 或 Type 种类。将鼠标悬停到节点可查看：

- `queried-type`、`direct-supertype` 或 `direct-subtype` 关系。
- 关系来自 `textDocument/prepareTypeHierarchy`、`typeHierarchy/supertypes` 或 `typeHierarchy/subtypes`。
- `semantic` 置信度，表示关系由 clangd 语义协议直接返回。
- 完整声明文件、行、列以及 clangd detail。
- 重复节点表示相同稳定类型身份已在树中其他位置加载；cycle 节点表示相同身份出现在当前祖先路径中。两者会说明停止继续展开的原因。

JSON 导出的每个类型节点包含 `kind`、`relationship` 和结构化 `evidence`；Text 导出在节点后以花括号附加同等信息。Mermaid 仍保持简洁标签，并始终使用 “父类型 → 子类型”的语义方向。

搜索只遍历当前已经加载的节点，不会调用 clangd，也不会展开隐藏分支。同一类型通过不同继承路径出现时保留为不同搜索结果，路径信息用于区分具体位置。

类型层次导出还包含当前已加载子图的统计：

- `loadedNodes` 和 `maximumLoadedDepth`。
- 尚未展开的 `unexpandedNodes`。
- Class、Struct、Interface 等 `kinds` 计数。
- queried/supertype/subtype `relationships` 计数。
- duplicate、cycle、maximum-depth、maximum-nodes 等 `states` 计数。
- `truncatedBy.maximumDepth` 和 `truncatedBy.maximumNodes` 独立标志。

JSON 将统计放在顶层 `summary`；Text 使用 `# Summary` 首行；Mermaid 使用 `%% Summary` 注释，因此不改变图的节点标签或边方向。统计只反映当前已加载子图，不会为了导出展开节点或产生新的 clangd 请求。

树会检测递归和重复节点，并受最大深度及最大节点数限制。源码变化、clangd 重启或类型层次配置变化后，已有结果显示已过期（stale），需要重新执行“显示父类型/子类型”。当前树不写入工作区会话（Workspace Session），重开工作区后需要重新查询。普通 C 代码没有类继承关系，通常不会返回结果。

### 4.15 包含文件（Includes）与被包含关系（Included By）

这两个窗口显示文件级包含关系：

- 包含文件：当前文件直接或间接包含了哪些文件。
- 被包含关系：工作区内哪些文件直接或间接包含当前文件。

把当前编辑器置于 C/C++ 源文件或头文件，通过编辑器右键菜单或命令面板执行 **显示包含文件（Show Includes）** 或 **显示被包含关系（Show Included By）**。显示包含文件只更新包含文件，显示被包含关系只更新被包含关系；两个窗口可保留不同根文件和不同的已展开树。

两个窗口的标题栏都有常显查询按钮；尚未查询时，也可以直接单击窗口内的提示行。若当前活动编辑器不是本地 C/C++ 文件，命令会显示明确警告。

包含文件只在展开节点时读取文件，解析 `#include "..."` 和 `#include <...>`。解析顺序综合当前文件目录、`compile_commands.json` 中的 `-iquote`、`-I`、`-isystem`、工作区根目录及常见系统目录。无法解析的 include 仍以 `unresolved` 显示，并在悬停中说明搜索失败。

被包含关系需要反向查找，因此首次展开时才扫描工作区 C/C++ 文件并建立内存索引；仅打开或折叠窗口、未执行查询时不会扫描。索引建立后，文件创建、修改和删除会增量更新；编译数据库或相关配置变化会使结果已过期（stale）。

首次扫描会显示可取消的通知进度，包含已处理文件数和总文件数。取消后不会把部分扫描结果当作完整索引；下次展开会重新建立。扫描完成后，后续展开复用索引，不再显示进度。如果发现的文件数超过 `workspaceFileLimit`，C Insight 会警告被包含关系结果可能不完整。

反向索引先在隔离的临时数据中构建，完整扫描结束后才一次性发布。扫描期间发生的源码创建、修改或删除会在发布前补入；若编译数据库、include 配置或分析状态使索引失效，旧扫描会被取消且不能覆盖新结果。因此窗口不会使用半成品或已经过期的被包含关系索引。

窗口行为：

- 展开节点：懒加载下一层，不预先加载整棵树。
- 单击节点：在代码预览（Code Preview）显示产生关系的 `#include` 源码行。
- 双击节点：在主编辑器中打开代码预览所显示的同一 `#include` 关系行。
- 右键打开位置（Open Location）：打开被包含文件；未解析节点打开 include 所在源码行。
- 右键 Add Bookmark：保存已解析文件。
- 搜索已加载内容（Search Loaded）包含文件/被包含关系：只搜索已加载节点。
- 展开到指定深度（Expand to Depth）：在限制范围内批量展开，可用各窗口自己的停止展开（Stop Expansion）取消；不会停止另一个方向的展开。
- `...` 菜单可导出 Text、JSON 或 Mermaid；Mermaid 箭头始终表示 “包含者 → 被包含者”。

节点会标记 workspace header、workspace source、system、external、unresolved，并检测 cycle 和 duplicate。系统头默认不显示，以避免树过大；可通过配置启用。条件编译分支按文本解析，C Insight 不运行预处理器，因此结果代表源码中可见的 include 指令，不保证某个具体构建配置一定启用。

包含文件/被包含关系当前不写入工作区会话（Workspace Session），重开工作区后需要重新查询；因此不会仅因会话恢复就在后台建立被包含关系反向索引。

### 4.16 关系图（Relationship Graph）

在 C/C++ 文件中通过编辑器右键菜单或命令面板执行 **显示关系图（Show Relationship Graph）**，会在编辑器区域旁边打开综合关系图标签页。光标位于函数或方法时，会先尝试使用标准调用层次（Call Hierarchy）建立函数根；光标位于 C++ class、struct 或 interface 时，使用标准类型层次（Type Hierarchy）建立类型根。两者都不可用时退回活动文件根，可继续展开包含文件（Includes）或被包含关系（Included By）。

需要明确查看文件包含关系时，建议执行 **显示文件关系图（Show File Relationship Graph）**。该命令忽略光标下的函数或类型，直接以活动 C/C++ 源码或头文件作为文件根。

当前可用操作：

- 鼠标滚轮缩放，拖动画布平移。
- Fit：把当前图适配到可视区域。
- Reset Layout：恢复默认缩放和位置。
- Collapse Branch：隐藏当前节点向远离根方向延伸的已加载分支；只改变画布可见性，不删除节点、关系或查询缓存。
- Expand Branch：重新显示当前节点已折叠的分支，不会重新查询语义引擎或文件。
- Call、Inheritance、Include、定义（Definition）：过滤对应边。Call 使用蓝色实线、Inheritance 使用紫色虚线、Include 使用绿色点线、定义使用橙色点划线；循环或递归关系使用错误色强调，工具栏中始终显示图例。
- 展开调用者（Expand Callers）：为当前选中函数加载直接调用者。
- 展开被调用者（Expand Callees）：为当前选中函数加载直接被调用函数。
- 当根或选中节点为类型时，上述两个按钮自动显示为 Expand 父类型（Supertypes）和 Expand 子类型（Subtypes），分别加载直接基类和直接派生类。
- 当根或选中节点为文件时，按钮自动显示为 Expand 被包含关系和 Expand 包含文件。前者查询哪些文件包含当前文件，后者解析当前文件包含了哪些文件。
- 展开到指定深度（Expand to Depth）：从当前选中函数开始，同时逐层加载调用者和被调用者；从类型节点执行时同时加载父类型和子类型，从文件节点执行时同时加载被包含关系和包含文件。输入值表示相对选中节点的展开层数，并受 `maximumDepth`、节点和边上限约束。
- Stop：取消当前准备或展开请求；已加载节点继续保留。
- 搜索（Search）：在已加载节点中按名称、详情和路径搜索，选择后居中并更新代码预览（Code Preview）。
- Export：把当前已加载图导出为 Text、JSON 或 Mermaid；也可从命令面板分别执行三个 Export 关系图命令。
- 单击节点：更新代码预览。
- 双击节点：在主编辑器打开文件。
- 右键节点：可展开调用者/被调用者、展开到指定深度、加入书签（Bookmarks）、打开位置或把节点居中。
- 源码、clangd、编译数据库或图配置变化后显示已过期（stale）。

节点底部状态：

- `expandable`：可以继续查询关系。
- `expanded`：至少一个方向已经查询；再次展开会使用已加载结果或共享缓存。
- `duplicate`：相同语义实体从其他路径再次到达并合并到该节点。
- `cycle`：节点参与当前已发现的递归或循环关系。
- `unresolved`：Include 目标未能解析，不能继续展开。
- `collapsed`：分支仅在画布中隐藏，数据仍然保留。
- `revalidated`：从静态会话恢复后，已按当前位置重新取得当前语义引擎节点。
- `missing`：保存的位置对应文件已经不存在，不能预览或继续导航。

综合关系操作位于节点右键菜单，且都需要用户明确执行：

- `Add Defining File`：函数或类型节点添加其定义所在源码/头文件，生成 `File → Symbol` 定义边。新增文件节点可继续 Expand 包含文件或 Expand 被包含关系。
- `Add Type Members`：类型节点读取已知文档符号，并通过 clangd 为可调用成员准备调用层次节点，生成 `Type → Member` 定义边。新增成员可继续 Expand 调用者/被调用者；可用 Stop 取消，已经加入的成员继续保留。
- `Add Containing Type`：函数/方法节点添加包含它的 C++ 类型，生成 `Type → Member` 定义边。对于类外实现，会尝试从 `Type::method` 限定名定位类型。

由此可在一张图中从函数连接到文件、从文件展开 Include、从方法连接到类型、再从类型展开继承或其他成员。跨关系操作不会随节点选择、普通展开、搜索或导出自动执行，并统一受 `maximumDepth`、`maximumNodes` 和 `maximumEdges` 限制。定义过滤只隐藏归属边，不删除其两端节点；折叠、搜索、统计和导出继续适用于混合图，导出格式使用 `defines` 作为该关系的稳定名称。

状态栏以“可见数/已加载总数”显示节点与边。例如 `12/20 nodes · 9/16 edges` 表示当前因关系过滤或分支折叠只显示部分内容。关系过滤不会删除数据，导出仍针对完整的已加载图。

图使用有严格 CSP 的 SVG Webview。文件读取、位置验证和导航都在扩展宿主中执行；Webview 不读取本地文件，也不直接请求 clangd。隐藏或未打开图时不会产生关系查询。调用者/被调用者树与图共享有界 Incoming/Outgoing 请求缓存，父类型/子类型树与图也共享类型层次请求缓存；包含文件/被包含关系（Included By）树与图共享 include resolver、正向结果缓存和反向索引。图的节点和展开状态不会替换原有树。

调用边始终表示调用者（Caller） → 被调用者（Callee）。相同函数会合并成一个节点；形成回路的边标记 direct-recursion 或 indirect-recursion。`defaultDepth=1` 时显式显示（Show）会加载根的第一层调用者和被调用者；设为 0 时只准备根。选择任意已加载函数后仍可按需继续展开，直到达到深度、节点或边上限。默认分层布局把调用者放在根左侧、被调用者放在根右侧；画布状态文字会报告展开进行中、取消、失败或达到资源上限。继承边始终表示 Supertype → Subtype，基类位于类型根左侧，派生类位于右侧；重复类型会合并，循环继承关系具有与调用图相同的防无限展开处理。类型查询只在显式打开类型图或展开类型节点时执行，隐藏或未打开关系图不会产生查询。

Include 边始终表示 Includer → Included，即“包含者 → 被包含文件”。包含者位于左侧，被包含文件位于右侧；无法解析的 include 会显示为 unresolved 节点并指向原始 `#include` 行。系统头仍由 `relationshipGraph.includeSystemHeaders` 控制。打开文件图、展开包含文件、搜索、过滤和导出都不会建立被包含关系反向索引；只有明确执行 Expand 被包含关系，或从文件节点明确执行双向展开到指定深度，才会扫描工作区。取消扫描不会发布不完整索引。

键盘操作：

- `Tab`：依次进入工具栏按钮和图节点。
- 方向键：从当前节点移动到空间上最近的对应方向节点。
- `Enter`：在代码预览预览当前节点。
- `Shift+Enter`：在主编辑器打开当前节点。
- `Space`：折叠或展开当前节点的已加载分支。
- `Shift+F10`：打开节点操作菜单。
- 画布聚焦时按 `F`：Fit；`+` / `-`：缩放。

建立新图根时会自动执行一次 Fit。后续展开不会自动改变缩放和平移，已有节点位置也尽量保持不变；需要重新查看全图时手动执行 Fit。

大型图的画布使用视口虚拟化：语义模型仍保留全部已加载节点和边，但 SVG DOM 只创建当前可视区域及其周边缓冲区中的元素。平移到其他区域时按动画帧增量复用、加入或移除 SVG 元素；这不会改变统计、搜索、折叠或导出结果。连续的展开消息、拖拽、缩放和窗口尺寸变化会合并到每个浏览器动画帧最多一次渲染。

状态文字的悬停提示显示最近一次画布渲染耗时和实际渲染的视口节点数。单次渲染超过 50 ms 时，C Insight 输出窗口会记录节流后的 `Slow 关系图 render` 诊断；同类提示五秒内最多记录一次。关闭关系图标签页时会取消展开并释放该图的宿主模型、布局位置和 Webview SVG 缓存。

## 5. 底部可靠性状态栏

底部状态栏是全局可靠性警告的唯一显示位置：

| 显示 | 含义 |
| --- | --- |
| `C Insight` | clangd 和工程配置处于可靠状态 |
| `C Insight: Indexing N%` | 后台索引进行中，工作区结果可能暂不完整 |
| `C Insight: N issues` | 分析可用，但存在工程配置或头文件问题 |
| `C Insight unavailable` | clangd 未就绪或启动失败 |

悬停可查看全部原因；单击打开工程诊断（Project Diagnostics）。

可靠性综合判断：

- clangd 是否准备就绪（Ready）
- 后台索引是否进行中
- 是否找到编译数据库
- 当前源文件是否有编译命令
- 当前文件是否有缺失头文件

## 6. 固定（Pin）、锁定（Lock）、可靠性与已过期（stale）的区别

| 状态 | 作用 |
| --- | --- |
| 上下文（Context）固定 | 暂停整个自动光标跟随链路 |
| 引用（References）固定 | 只阻止自动替换引用 |
| 调用层次（Call Hierarchy）固定 | 同时阻止自动替换调用者（Callers）和被调用者（Callees） |
| 代码预览（Code Preview）锁定 | 只阻止编辑器光标自动替换预览 |
| Reliability | 表示当前工程条件可能影响新查询的完整性 |
| 已过期 | 表示窗口里的结果生成后，相关环境又发生了变化 |

以下情况会标记结果已过期：

- 活动源文件修改
- clangd 重启
- 后台索引重新开始
- 分析配置变化
- 当前编译数据库变化

旧结果不会被删除，仍可预览、搜索和导出。重新执行对应的引用或调用层次查询后清除已过期。

活动 `compile_commands.json` 发生变化时，clangd 模式会询问是否重启 clangd 以重新载入全部编译命令；Microsoft 模式不会启动或重启 clangd，而是在结果仍然已过期时提供 **Reload Window**。Microsoft C/C++ 是否实际读取该数据库，仍取决于其自身的 `compileCommands` 等配置。

## 7. 快捷键与编辑器菜单

| 操作 | 快捷键 |
| --- | --- |
| Go to 定义（Definition） | `F12` |
| 查找所有引用（Find All References） | `Shift+F12` |

C/C++ 编辑器右键菜单还提供：

- Go to 定义
- 查找所有引用
- 显示传入调用（Show Incoming Calls）
- 显示传出调用（Show Outgoing Calls）

## 8. 输出窗口与日志

### 窗口内状态提示

引用（References）、调用者（Callers）、被调用者（Callees）、类型层次（Type Hierarchy）和包含层次（Include Hierarchy）使用统一的状态语义：

| 状态 | 图标/表现 | 含义与后续操作 |
| --- | --- | --- |
| 空闲（Idle） | 信息图标 | 尚未查询；按提示放置光标、打开窗口或执行显示/查找（Show/Find）命令 |
| 加载中（Loading） | 旋转图标 | 查询正在进行 |
| 空结果（Empty） | 信息图标 | 查询完成但没有结果，或可靠性受限时暂未找到结果 |
| 已取消（Cancelled） | 禁止图标 | 操作已取消；已加载的层级节点仍可使用 |
| 已过期（Stale） | 历史图标 | 结果早于源码或配置变化，需要重新执行对应查询 |
| 结果受限（Limited） | 警告图标 | 达到显示、深度或节点上限；当前已加载结果仍然有效 |
| 错误（Error） | 错误图标 | 查询失败；简短结论显示为主标签，具体错误放在描述和 Tooltip |

固定（Pin）状态不是查询状态，会继续使用独立的 pinned 图标。可靠性总览仍只集中显示在下方 C Insight 状态栏；各结果窗口不会重复完整工程可靠性警告。

### C Insight

记录扩展自身的重要状态，例如：

- clangd 定位和启动
- clangd 生命周期
- 查询失败
- 慢查询
- 编译数据库选择

### C Insight: clangd

记录语言客户端与 clangd 的日志。clangd 按惯例将普通信息也写入 stderr，C Insight 会根据 clangd 的 `I`、`W`、`E`、`V` 前缀重新分类：

- `I[...]`：Info，不是错误。
- `W[...]`：Warning。
- `E[...]`：错误（Error）。
- `V[...]`：Trace/Verbose。

因此类似 `textDocument/hover`、`prepareCallHierarchy`、`Built preamble`、`ASTWorker building file` 的普通信息不需要当作故障。真正的 `error:`、连接关闭或进程启动失败才需要重点检查。

托管的 clangd 意外退出时，C Insight 会在三分钟滑动窗口内自动重启最多四次。每次重启前，后台索引进度会复位，依赖 clangd 的现有结果会按原有机制标记为已过期（stale）；新进程进入就绪（Ready）后重新同步已打开文档。三分钟内第 5 次退出会停止自动重启，避免持续崩溃和拉起进程；此时先检查 **C Insight: clangd**，再明确执行 **C Insight: Restart clangd**，人工重启会建立新的恢复预算。

`Server process exited with signal SIGSEGV` 表示首要故障是 clangd 进程自身崩溃。其后的 `write EPIPE`、`Cannot call write after a stream was destroyed` 和 `textDocument/didOpen failed` 是待发送文档同步写入已关闭管道的次生现象，不是多次独立崩溃。C Insight 会把同一轮重复堆栈压缩为一条传输关闭诊断并自动恢复连接，但无法在插件内部修复导致 `SIGSEGV` 的 clangd 缺陷；定位根因仍需保留崩溃前的请求、文件、编译命令、clangd 版本和可用的 core/backtrace。

### 运行时性能（Runtime Performance）诊断

工程诊断（Project Diagnostics）的 `Runtime performance` 分组提供当前扩展会话的只读快照：

- 语义请求的 active、queued、peak active 数量；
- submitted、completed、failed、coalesced 和排队期间取消数量；
- 已实际发送请求的平均、最大耗时以及超过 1000 ms 的慢请求数量；
- 最近一次慢请求的方法名和耗时；
- 引用（References）显示/批量输出限制命中、被省略记录数、过大导出拒绝次数；
- 引用详情缓存当前条目数和 LRU 淘汰次数；
- 当前生效的请求并发、引用显示/缓存及导出资源上限。

计数从当前 Extension Host 会话启动时开始累计，重载窗口后清零；它们不包含 clangd 自身进程的内存或内部索引队列。执行刷新（Refresh）工程诊断可取得最新快照。复制或导出的 Text/JSON 工程诊断报告包含相同的 `runtime` 数据；它只含方法名、数量和耗时，不记录源码、符号名或请求参数。

工程诊断顶部的 `Extension information` 折叠分组显示插件版本、开发者、许可证、VS Code、Node、操作系统架构、Local/Remote 类型和 Production/Development/Test 运行模式。这些信息也会进入复制或导出的诊断报告，便于确认问题环境。

## 9. 全部配置参数

可在 VS Code Settings UI 搜索 `C Insight`，或直接编辑工作区 `.vscode/settings.json`。

### 9.1 clangd 与工程配置

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.engine` | string | `"clangd"` | `"clangd"`、`"microsoft"` | 选择语义分析引擎；修改后必须 Reload Window |
| `cInsight.microsoft.callersMode` | string | `"references"` | `"references"`、`"native"`、`"disabled"` | Microsoft 模式的调用者（Callers）展开实现：引用（References）近似回退、cpptools 原生传入调用（Incoming Calls）或禁用；不影响 clangd |
| `cInsight.clangd.path` | string | `""` | 可执行文件路径 | 空值从 `PATH` 自动寻找 `clangd-22`、`clangd-21`、`clangd-20`、`clangd`；明确路径用于固定版本 |
| `cInsight.clangd.arguments` | string[] | `[]` | 任意 clangd CLI 参数数组 | 附加在 C Insight 管理参数之后；错误或重复参数可能导致 clangd 启动失败 |
| `cInsight.clangd.logLevel` | string | `"info"` | `"error"`、`"info"`、`"verbose"` | 控制传给 clangd 的日志等级 |
| `cInsight.compileCommandsDir` | string | `""` | 目录路径 | 指定包含 `compile_commands.json` 的目录；相对路径按第一个工作区根解析，空值启用自动发现；不展开 `${workspaceFolder}` |
| `cInsight.fallbackFlags` | string[] | `["-std=c++17"]` | 编译参数数组 | 当前文件没有编译命令时，通过 clangd initialization options 使用的后备参数 |
| `cInsight.backgroundIndex` | boolean | `true` | `true` / `false` | 启用或关闭 clangd `--background-index` |

`cInsight.engine` 变化会提示 Reload Window。其余 clangd 配置只在 clangd 模式生效并触发 clangd 重启；`clangd.arguments` 中不需要添加 `--stdio`。`--query-driver` 属于这里，但 `--sysroot`、`--target`、`-mcpu`、`-I` 和 `-D` 属于每个文件的编译参数，不能作为 clangd 服务参数直接加入。C Insight 默认管理：

```text
--background-index
--clang-tidy=0
--completion-style=detailed
--header-insertion=never
--log=<配置值>
--compile-commands-dir=<发现或配置的目录>
```

诊断报告脱敏配置不会重启 clangd：

| 配置 | 类型 | 默认值 | 可用值 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.diagnostics.reportRedaction` | string | `"none"` | `"none"`、`"paths"`、`"paths-and-defines"` | 复制和导出报告时不脱敏、隐藏路径，或同时隐藏路径、宏定义与 Fallback Flags |

### 9.2 自动光标跟随

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.followCursor` | boolean | `true` | `true` / `false` | 是否根据编辑器光标自动查询上下文（Context） |
| `cInsight.followCursorDelay` | number | `200` | 50–2000 ms | 光标停稳后开始基础查询的延迟 |
| `cInsight.followCursorDetailsDelay` | number | `600` | 200–5000 ms | 基础查询完成后，加载引用（References）和第一层调用数量前的额外空闲延迟 |
| `cInsight.navigation.doubleClickInterval` | number | `500` | 150–2000 ms | 同一源码位置树结果连续两次激活时，被识别为双击并在编辑器中打开的最大间隔 |

大型工程可适当提高两个延迟，减少快速移动光标时的无效 clangd 请求。

### 9.3 代码预览（Code Preview）

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.codePreview.linesBefore` | number | `6` | 0–100 | 目标行之前显示的源码行数 |
| `cInsight.codePreview.linesAfter` | number | `8` | 0–100 | 目标行之后显示的源码行数 |
| `cInsight.codePreview.semanticHighlighting` | boolean | `true` | `true` / `false` | 是否使用当前 VS Code 语义令牌提供器着色符号；关闭后只使用词法高亮 |
| `cInsight.codePreview.semanticTokenTimeout` | number | `1500` | 100–10000 | 等待语义令牌的最长毫秒数；超时后立即使用词法高亮显示，不阻塞预览导航 |
| `cInsight.codePreview.semanticTokenCacheSize` | number | `32` | 1–256 | 内存中最多保留的按文档及其版本区分的语义令牌结果数 |
| `cInsight.codePreview.semanticTokenCacheMaximumMegabytes` | number | `16` | 1–256 | 已完成语义令牌缓存允许占用的近似总内存 MiB；与条目数限制同时生效 |
| `cInsight.codePreview.incrementalLoading` | boolean | `true` | `true` / `false` | 滚动到代码预览上下边缘时是否继续加载源码 |
| `cInsight.codePreview.loadBatchLines` | number | `50` | 10–500 | 每次向上或向下增量加载的源码行数 |
| `cInsight.codePreview.maximumLoadedLines` | number | `1000` | 50–10000 | 代码预览 DOM 同时保留的最大源码行数；超过后裁剪远离滚动方向的一端 |
| `cInsight.codePreview.restoreScrollPositions` | boolean | `true` | `true` / `false` | 返回之前的预览目标时是否恢复加载范围及水平/垂直滚动位置 |
| `cInsight.codePreview.maximumScrollPositions` | number | `100` | 10–1000 | 当前扩展会话最多保留的预览目标滚动位置数 |

修改后会清空语义令牌缓存并重新渲染当前代码预览。源码发生变化时，对应文档的缓存会失效；切换颜色主题时，可见的代码预览会重新渲染。

### 9.4 引用（References）

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.references.pageSize` | number | `200` | 25–5000 | 每次添加到树中的引用数量 |
| `cInsight.references.maximumDisplayedResults` | number | `10000` | 100–100000 | 引用树中同时物化的最大结果数；显示全部（Show All）也受此限制 |
| `cInsight.references.detailRequestCacheSize` | number | `2000` | 100–50000 | Document Highlight 与签名帮助（Signature Help）两类详情请求各自保留的 LRU 缓存条目上限 |
| `cInsight.references.groupBy` | string | `"file"` | `"file"`、`"directory"`、`"function"`、`"type"`、`"confidence"`、`"evidence"`、`"flat"` | 引用的持久化分组方式 |
| `cInsight.references.autoExpandGroups` | boolean | `false` | `true` / `false` | 分组引用结果发布时是否自动展开全部分组；修改后立即应用到当前引用树，不重新执行语义查询 |
| `cInsight.includeDeclarationInReferences` | boolean | `true` | `true` / `false` | 请求引用时是否包含声明（Declaration） |
| `cInsight.includeSystemReferences` | boolean | `false` | `true` / `false` | 是否保留 `/usr/include` 和 `/usr/local/include` 下的引用 |
| `cInsight.exclude` | string[] | `["/build/", "/generated/", "/third_party/"]` | 路径片段数组 | 只要标准化后的结果路径包含任一片段，就从引用结果中过滤 |

`exclude` 是简单路径片段匹配，不是 glob。需要 Windows 兼容时，建议使用 `/` 形式的片段，因为内部会先将反斜杠转换为 `/`。

引用初始只物化 `pageSize` 条，加载更多（Load More）分页增加，显示全部（Show All）最多显示 `maximumDisplayedResults` 条。过滤仍针对完整查询结果。Copy All、Open Result List 和文件导出受 9.14 的记录数限制；文件导出显示可取消进度，超限的省略数量写入文本头或 JSON 的 `omitted` 字段。

### 9.5 导航历史（Navigation History）

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.history.maximumEntries` | number | `200` | 20–2000 | 当前 VS Code 会话中保留的最大导航记录数；超出后删除最旧记录 |
| `cInsight.history.mergeConsecutiveDuplicates` | boolean | `true` | `true` / `false` | 是否合并位置、模式和来源完全相同的连续记录 |

修改后立即调整当前已加载的导航历史（History）；降低容量会删除最旧的超额记录。是否跨重启恢复由 `cInsight.session.persistNavigationHistory` 控制。

### 9.6 符号搜索（Symbol Search）

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.symbolSearch.groupBy` | string | `"type"` | `"type"`、`"file"`、`"directory"`、`"flat"` | 符号搜索的工作区持久化分组方式 |
| `cInsight.symbolSearch.maximumResults` | number | `500` | 25–5000 | 每次查询最多显示的结果数 |
| `cInsight.symbolSearch.debounce` | number | `250` | 100–2000 ms | 停止输入后向当前分析引擎发送工作区符号查询的延迟 |

符号类型过滤不写入 VS Code 配置，但会在启用工作区会话恢复（Workspace Session Restore）时随工作区浏览快照恢复；分组配置始终保存在当前工作区。大型工程中可增加 `debounce` 或降低 `maximumResults`，减少刷新开销。

### 9.7 书签（Bookmarks）

| 配置 | 类型 | 默认值 | 可用值 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.bookmarks.sortBy` | string | `"updated"` | `"name"`、`"path"`、`"position"`、`"created"`、`"updated"` | 每个书签分组内的持久化排序方式 |

书签过滤条件是临时视图状态，不会写入工作区配置，也不会修改或删除书签。

### 9.8 调用层次（Call Hierarchy）

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.callHierarchy.defaultDepth` | number | `1` | 0–10 | 新根节点自动展开深度；默认展开第一层，0 表示保持折叠 |
| `cInsight.callHierarchy.maximumDepth` | number | `10` | 1–50 | 手动或自动展开允许的最大深度 |
| `cInsight.callHierarchy.maximumNodes` | number | `2000` | 100–50000 | 调用者（Callers）与被调用者（Callees）每棵树各自允许创建的最大节点数 |
| `cInsight.callHierarchy.cacheSize` | number | `500` | 10–10000 | Incoming 和 Outgoing 各自缓存的函数请求上限 |
| `cInsight.callHierarchy.pathSearchMaximumDepth` | number | `8` | 1–50 | 调用者（Caller）/被调用者（Callee） Path 最大边深度 |
| `cInsight.callHierarchy.pathSearchMaximumPaths` | number | `20` | 1–500 | 单次路径搜索最多返回的匹配路径数 |
| `cInsight.callHierarchy.pathSearchMaximumNodes` | number | `2000` | 100–50000 | 单次路径搜索最多访问的语义节点数 |

修改调用层次配置会清除调用请求缓存，并触发刷新。

### 9.9 工作区会话（Workspace Session）

| 配置 | 类型 | 默认值 | 可用值/范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.session.restore` | boolean | `true` | `true` / `false` | 是否自动保存并恢复当前工作区浏览快照 |
| `cInsight.session.persistNavigationHistory` | boolean | `true` | `true` / `false` | 是否在快照中保存导航历史（Navigation History） |
| `cInsight.session.restoreCallHierarchy` | boolean | `true` | `true` / `false` | 是否重新查询并恢复调用者（Callers）/被调用者（Callees）根和加载深度 |
| `cInsight.session.restoreRelationshipGraph` | boolean | `true` | `true` / `false` | 是否无查询地恢复退出时仍打开的关系图（Relationship Graph）静态快照 |
| `cInsight.session.relationshipGraphMaximumSnapshotNodes` | number | `1000` | 50–2000 | 会话最多保存的关系图节点数；超过时降级为仅保存根节点 |
| `cInsight.session.maximumSnapshotKilobytes` | number | `2048` | 64–8192 | 整个工作区会话序列化后的最大 KiB；超限时依次丢弃关系图（Graph）、裁剪旧导航历史（History），再丢弃次要浏览状态 |
| `cInsight.session.maximumAgeDays` | number | `30` | 1–365 | 超过此天数的快照自动忽略 |

关闭 `restore` 会同时停止自动保存与自动恢复，但仍可使用手动 Restore 命令读取已有快照。书签（Bookmarks）使用独立的持久化数据，不受这些配置影响。

### 9.10 类型层次（Type Hierarchy）

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.typeHierarchy.defaultDepth` | number | `0` | 0–10 | 新类型根自动展开的层数；0 保持折叠 |
| `cInsight.typeHierarchy.maximumDepth` | number | `10` | 1–50 | 手动或自动展开允许的最大深度 |
| `cInsight.typeHierarchy.maximumNodes` | number | `2000` | 100–50000 | 父类型（Supertypes）与子类型（Subtypes）每棵树各自允许加载的最大节点数 |

修改上述配置会清除类型层级请求缓存，并将当前结果标记为已过期（stale）。

### 9.11 包含层次（Include Hierarchy）

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.includeHierarchy.defaultDepth` | number | `0` | 0–10 | 新文件根自动展开层数；0 保持折叠 |
| `cInsight.includeHierarchy.maximumDepth` | number | `10` | 1–50 | 手动或自动展开允许的最大深度 |
| `cInsight.includeHierarchy.maximumNodes` | number | `5000` | 100–50000 | 每棵包含树各自允许加载的节点上限 |
| `cInsight.includeHierarchy.includeSystemHeaders` | boolean | `false` | `true` / `false` | 是否显示并继续展开系统头文件 |
| `cInsight.includeHierarchy.workspaceFileLimit` | number | `20000` | 100–200000 | 被包含关系（Included By）首次建索引最多扫描的源码/头文件数 |

修改这些配置会清除 include 解析及反向索引缓存，并将当前结果标记为已过期（stale）。`workspaceFileLimit` 是安全上限；达到上限时被包含关系结果可能不完整。

### 9.12 关系图（Relationship Graph）

| 配置 | 类型 | 默认值 | 范围/可用值 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.relationshipGraph.defaultDepth` | number | `1` | 0–1 | 新函数或类型根是否加载第一层关系；0 只保留根 |
| `cInsight.relationshipGraph.maximumDepth` | number | `10` | 1–50 | 图中单条关系路径允许的最大深度 |
| `cInsight.relationshipGraph.maximumNodes` | number | `500` | 50–10000 | 当前图保留的最大语义节点数 |
| `cInsight.relationshipGraph.maximumEdges` | number | `1000` | 100–50000 | 当前图保留的最大语义边数 |
| `cInsight.relationshipGraph.layout` | string | `"layered"` | `"layered"` | 图布局策略；当前仅提供分层布局 |
| `cInsight.relationshipGraph.includeSystemHeaders` | boolean | `false` | `true` / `false` | 是否允许已解析的系统头进入 Include Graph |

上述限制和布局已经同时用于 Call、Type、Include 以及混合关系图；系统头开关控制 Include Graph 是否接纳已解析的系统头。修改关系图配置会把当前图标记为已过期（stale），后续显式扩展使用新值。

### 9.13 语义请求调度

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.analysis.maximumConcurrentRequests` | number | `8` | 1–64 | C Insight 同时运行的语义引擎请求总数上限 |
| `cInsight.analysis.maximumBackgroundRequests` | number | `2` | 1–16 | 总上限内允许并发运行的 Document Highlight、文档符号（Document Symbols）等后台详情请求数 |
| `cInsight.analysis.slowRequestThreshold` | number | `1000` | 100–60000 | 语义查询被计入并输出为慢查询的耗时阈值，单位为毫秒；同时适用于 clangd 和 Microsoft C/C++ language service (cpptools) |

调度器按 Interactive、Normal、Background 三档排队。定义（Definition）、悬停信息（Hover）和层级 Prepare 等交互请求优先于已排队的普通/后台工作；已开始的 LSP 请求不会被强制抢占。使用同一取消令牌、方法和参数的相同请求共享底层 Promise；不同取消作用域不会错误合并。排队期间取消的请求不会发送给分析引擎。这些配置在下一次请求进入调度器时生效。

PROJECT DIAGNOSTICS 的 `Runtime performance` 会显示最近一次语义请求、按方法汇总的次数/平均值/最大值/失败/取消数量。Microsoft 模式还会单独显示提供程序（Provider）激活耗时，从而区分扩展启动等待与定义、引用（References）、调用者（Callers）等查询自身的耗时。统计仅保存在当前 Extension Host 会话，不上传源码或遥测数据。

### 9.14 导出资源限制

| 配置 | 类型 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- | --- |
| `cInsight.export.maximumResults` | number | `50000` | 1000–500000 | 引用（References）单次导出、Copy All 或 Open Result List 最多处理的记录数；超出部分会明确报告 |
| `cInsight.export.maximumMegabytes` | number | `64` | 1–1024 MiB | 引用、Call、Type、包含层次（Include Hierarchy）和关系图（Relationship Graph）文件导出的最大 UTF-8 编码大小；超限时不写文件 |

大小限制在内容生成后、文件写入前检查，避免把过大的结果写入磁盘。引用生成文本或 JSON 时可在通知进度中取消；其他层级本身已有节点上限，统一使用最终编码大小保护。

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
  "cInsight.callHierarchy.defaultDepth": 1,
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

Fallback flags 适合简单工程或临时文件，不能完整替代每个源文件不同参数的 `compile_commands.json`。

## 11. 交叉编译与嵌入式工程

推荐 clangd 模式继续使用真实交叉编译命令，而不是为代码浏览重新手写一套 Include Path。最小工作区配置示例：

```json
{
  "cInsight.engine": "clangd",
  "cInsight.clangd.path": "/usr/bin/clangd-20",
  "cInsight.compileCommandsDir": "build",
  "cInsight.clangd.arguments": [
    "--query-driver=/opt/arm-gnu/bin/arm-none-eabi-gcc,/opt/arm-gnu/bin/arm-none-eabi-g++"
  ]
}
```

`compile_commands.json` 应记录交叉编译器、工作目录、目标 CPU/ABI、sysroot、显式 include、宏和生成头文件。`--query-driver` 只允许 clangd 执行可信驱动以提取目标和系统头路径；它不会替数据库选择编译器。该允许列表应使用明确的工具链绝对路径，避免匹配工作区或不可信目录。

嵌入式 Linux 的 `--sysroot` 是源文件编译参数，应出现在数据库或 `.clangd` 的 `CompileFlags` 中，不能直接写进 `cInsight.clangd.arguments`。工具链已经内置目标搜索规则时不必重复指定；应以 `-dumpmachine` 和 `-E -v` 的实际目标及 C/C++ 头文件搜索路径为判断依据。

Microsoft 模式还必须在 `c_cpp_properties.json` 中配置 `compileCommands`、`compilerPath` 和必要的 `compilerArgs`；`cInsight.compileCommandsDir` 不会替 cpptools 选择数据库。完整的裸机、嵌入式 Linux、sysroot、CMake、Remote 和验证示例见[交叉编译与嵌入式工程配置](cross-compilation.zh-CN.md)。

## 12. 常见问题

### 状态栏显示结果受限（Limited）

单击状态栏打开工程诊断（Project Diagnostics），优先检查：

1. 是否找到编译数据库。
2. 当前源文件是否有 compile command。
3. 是否有缺失头文件。
4. 后台索引是否仍在进行。

### 定义（Definition）有结果，但引用（References）或调用者（Callers）不完整

定义常可由当前翻译单元直接获得，而跨文件引用和调用关系更依赖编译数据库与后台索引。等待正在索引（Indexing）完成，并确认当前文件有正确的编译命令。

### 调用者（Callers）/被调用者（Callees）显示已过期（stale）

已有结果生成后，源码、clangd、索引、配置或编译数据库发生了变化。结果仍可使用，但可能过期。运行显示传入调用（Show Incoming Calls）、显示传出调用（Show Outgoing Calls）或刷新（Refresh）获得新结果。

### 被调用者（Callees）查询不支持

C Insight 的传出调用层次（Outgoing Call Hierarchy）要求 clangd 20 或更高版本。检查工程诊断（Project Diagnostics）中显示的 clangd 版本和实际可执行文件。

### clangd 出现 `SIGSEGV`、`EPIPE` 或连接关闭

先在 **C Insight: clangd** 中向前查找第一条 `Server process exited` 或 clangd 自身错误。`SIGSEGV` 是进程崩溃，紧随其后的 `EPIPE`、流已销毁和 `didOpen failed` 通常只是同一次退出的连锁反应。C Insight 会自动重启四次；短时间第 5 次崩溃后停止并显示失败（Failed），防止崩溃循环。此时保存崩溃前日志，确认实际 clangd 路径/版本和触发文件的编译命令，必要时收集 core/backtrace；处理根因后执行 **C Insight: Restart clangd**。不要仅根据重复的 `didOpen failed` 判断发生了多次独立错误。

### 与其他 C/C++ 扩展同时启用

同时运行官方 clangd 扩展或微软 C/C++ 扩展，可能产生重复语言提供者和重复索引。C Insight 会过滤会产生全局命令冲突的 clangd execute-command 功能，但仍建议只保留实际需要的语义引擎。

## 13. 第二阶段语义增强与兼容性

0.14.0–0.16.3 完成了第二阶段：

- 引用（References）：分类结论、置信度、稳定规则和来源证据；指针/引用参数副作用、重载运算符、模板和宏来源；证据过滤、分组及版本化导出。
- 调用层次（Call Hierarchy）：调用者（Callers）/被调用者（Callees）精确分支恢复；显式函数指针和成员函数指针调用的语法证据与未解析节点。
- 类型层次（Type Hierarchy）：关系和 clangd 方法证据；类型、声明、路径、深度及 duplicate/cycle 说明；本地过滤搜索和带统计的导出。

兼容性约定：

- 工作区会话（Workspace Session）格式仍为版本 `1`。0.15.0 以前没有逐节点路径的调用层次快照继续按最大已加载深度恢复。
- 通用 Hierarchy JSON 仍为 `schemaVersion: 1`。新增的 `summary`、`kind`、`relationship` 和 `evidence` 均为附加字段；旧的必要字段和边方向未改变。
- 引用 JSON 使用独立的 `c-insight.references` 版本 `1` 格式。
- 类型/包含层次（Type/Include Hierarchy）仍不写入工作区会话，符合此前备忘录决定。

## 14. 当前限制

第四阶段候选功能目前整体暂缓，仅保留在备忘录中，不属于当前实施计划，包括代码预览（Code Preview）完整语义右键菜单、包含文件（Include）条件预处理与 query-driver 内建路径增强、类型/包含会话恢复（Type/Include Session Restore）以及跨过程数据流。Microsoft C/C++ 引擎已经是显式可选的生产适配器，具备配置/冲突验证、引擎诊断、按查询类型划分的性能证据、串行且按窗口需求触发的调用层次（Call Hierarchy）、基于引用（References-based）的安全调用者（Callers）和原生被调用者（Callees）。由于 cpptools 是独立的原生进程，C Insight 可以降低并发压力和避免复用失效对象，但无法捕获或修复其内部 SIGSEGV；若仍发生，应将 cpptools 输出的调用栈提交到 Microsoft vscode-cpptools 问题跟踪器。类型层次（Type Hierarchy）、索引进度和 clangd 专用协议证据仍受公开提供程序 API 边界限制，详见 Microsoft 验收文档。

- 支持 Local、WSL、Remote SSH 和直接打开文件夹，但部分相对配置和自动数据库选择以第一个工作区根目录为基准；多根工程应显式选择数据库并核对作用域。
- 代码预览复用编辑器的语义令牌分类，但 Webview 的主题颜色映射可能与编辑器最终合成颜色存在细微差异。
- 静态调用树无法完整解析运行时多态、所有函数指针、宏生成调用和动态分派。
- 引用（References）对跨过程指针目标、完整模板实例化链和编译器宏展开栈保持保守；推断结果会显示证据和置信度。
- clangd 标准索引进度只提供已完成/总数和百分比，不提供当前索引文件名。
- 包含层次（Include Hierarchy）不执行编译器或预处理器；clangd 从 query driver 内部取得但未写入数据库的系统路径、宏生成的 include 和条件编译的真实启用状态可能无法完整还原。

### 大型工程性能基线

源码仓库提供 `npm run benchmark`，用于运行 10 万条引用（References）分类、2 万节点关系图、1 万节点层级 JSON 导出和 10 万次代码预览（Code Preview）范围滚动。输出为 `c-insight.performance-baseline` 版本 1 的 JSON，包含运行环境、耗时、宽松回归预算、近似堆变化和结果计数。完整命令、缩放和报告落盘方式见随扩展打包的 `docs/validation/performance-baseline.zh-CN.md`。

该基线只验证宿主侧核心模型，不启动 clangd，也不替代 FFmpeg、Remote SSH、磁盘和 VS Code UI 的真实工程验收。

### FFmpeg 真实工程验收

源码仓库提供 `npm run acceptance:ffmpeg`，以只读方式检查显式环境变量 `C_INSIGHT_FFMPEG_ROOT` 指定的 FFmpeg 工作副本及其根目录编译数据库；`C_INSIGHT_FFMPEG_CLANGD` 未设置时使用 `clangd-20`。可把可选的第一个命令行参数作为 JSON 报告输出位置。该命令验证初始化、文档符号（Document Symbols）、定义（Definition）、引用（References）、调用层次（Call Hierarchy）方法兼容性和悬停信息（Hover）。详细的第三阶段环境、实测结果及边界见 `docs/validation/third-phase-acceptance.zh-CN.md`。

clangd 对某个 C 函数返回空传出调用（Outgoing Calls）仍可能是合法的保守结果；验收重点是请求成功并返回数组，而不是强制猜测静态目标。

Microsoft 模式的 Extension Host 与真实 FFmpeg 验收命令分别为 `npm run test:e2e:microsoft` 和 `npm run test:e2e:ffmpeg:microsoft`。后者覆盖跨文件代码预览（Code Preview）、基于引用（References-based）的调用者（Callers）、原生被调用者（Callees）、固定（Pin）/取消固定（Unpin）、懒加载、缓存和资源证据；完整环境、结果及公开 API 边界见 `docs/validation/microsoft-engine-acceptance.zh-CN.md`。

所有 Extension Host 测试都使用进程级隔离的临时用户数据与扩展目录，因此可以在日常 VS Code 已打开时运行，不会读取或改写用户配置，也不会与现有窗口竞争实例锁。第三阶段最终复验结果见 `docs/validation/third-phase-acceptance.zh-CN.md`。

## 15. 功能与窗口矩阵

| 功能/窗口 | 数据来源 | 自动更新 | 固定（Pin）/锁定（Lock） | 搜索 | 展开 | 导出 | 代码预览（Code Preview） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 上下文（Context） | 当前分析引擎的定义（Definition）、声明（Declaration）、悬停信息（Hover） | 可见且 Follow Cursor 启用时 | 独立固定 | — | — | — | 自动更新；位置节点单击预览、双击打开 |
| 代码预览 | 文档源码、VS Code 语义令牌（Semantic Tokens） | 跟随上下文或显式选择 | 独立锁定 | 单击符号继续定义 | 双向滚动加载源码 | 复制代码/路径 | 本窗口 |
| 引用（References） | 当前分析引擎的引用、Highlight、Signature 与证据化语法分类 | 仅窗口可见时查询详情 | 独立固定 | 文本、置信度、证据来源 | 分页；按类型、证据、置信度等分组 | 自描述 Text、版本化 JSON、列表 | 单击预览；双击打开 |
| 调用者（Callers） | clangd 传入调用层次（Incoming Call Hierarchy）；Microsoft 模式默认使用基于引用（References-based）的近似结果 | 仅窗口可见时查询 | 与被调用者（Callees）共用固定 | 已加载节点搜索、调用者路径（Caller Path） | 懒加载、按深度展开 | Text、JSON、Mermaid | 单击预览；双击打开 |
| 被调用者 | 当前分析引擎的传出调用层次（Outgoing Call Hierarchy） | 仅窗口可见时查询 | 与调用者共用固定 | 已加载节点搜索、被调用者路径（Callee Path） | 懒加载、按深度展开 | Text、JSON、Mermaid | 单击定义/调用点预览；双击打开 |
| 导航历史（Navigation History） | 所有显式/预览导航事件 | 导航时写入 | — | 来源过滤 | — | — | 单击恢复预览；双击打开 |
| 书签（Bookmarks） | 用户保存的位置与标识符 | 文档修改后尝试重定位 | — | 支持 | 分组 | JSON 导入/导出 | 单击预览；双击打开 |
| 符号搜索（Symbol Search） | 当前分析引擎的工作区符号（Workspace Symbols） | 显式查询 | — | 查询文本与类型过滤 | 分组 | — | 单击预览；双击打开 |
| 文档符号（Document Symbols） | 当前分析引擎的文档符号 | 窗口可见且活动文档变化时 | — | — | 提供程序（Provider）层级 | — | 单击预览；双击打开 |
| 工程诊断（Project Diagnostics） | 引擎/提供程序状态、索引、数据库、编译命令和 Language diagnostics | 状态或活动文件变化时 | — | — | 诊断分组 | Text、JSON、剪贴板 | 源码诊断单击预览；双击打开 |
| 父类型（Supertypes）/子类型（Subtypes） | clangd 类型层次（Type Hierarchy）与关系证据 | 显式触发 | — | 按类型/关系过滤已加载节点，显示深度和路径 | 懒加载、按深度展开 | 含统计 Text/JSON/Mermaid | 单击预览；双击打开 |
| 包含文件（Includes）/被包含关系（Included By） | 源码解析、编译命令 Include 路径、反向索引 | 显式触发；文件变化增量失效 | — | 已加载节点搜索 | 懒加载、按深度展开 | Text、JSON、Mermaid | 单击/双击关系行；右键打开目标 |
| 关系图（Relationship Graph） | Call、Type、Include 与定义关系仓库 | 只在显式扩展时查询 | 面板生命周期 | 已加载图搜索 | 多关系、有界扩展 | Text、JSON、Mermaid | 单击预览；双击打开 |

`—` 表示该能力不适用于对应窗口，而不是功能异常。

## 16. 状态持久化与配置生效矩阵

### 16.1 状态保存位置

| 状态 | 保存位置 | 作用域 | 重启后 |
| --- | --- | --- | --- |
| 引用（References）、符号搜索（Symbol Search）分组和书签排序 | VS Code Workspace Settings | 当前文件夹或 `.code-workspace` | 保留 |
| 书签（Bookmarks）内容、标签和分组 | VS Code `workspaceState` | 当前工作区 | 保留 |
| 导航历史（Navigation History）、代码预览（Code Preview）、引用搜索状态、调用层次（Call Hierarchy）、打开的关系图（Graph） | C Insight 工作区会话（Workspace Session）快照 | 当前工作区 | 按会话（Session）配置恢复 |
| 代码预览各目标滚动位置 | 扩展进程内有界 LRU | 当前窗口运行期 | 不跨重启 |
| 上下文（Context）、引用、调用者（Callers）/被调用者（Callees）固定（Pin） | 扩展进程内状态 | 当前窗口运行期 | 不保留 |
| 代码预览锁定（Lock） | 工作区会话快照 | 当前工作区 | 启用恢复时保留 |
| 类型/包含层次（Type/Include Hierarchy）根和展开状态 | 扩展进程内状态 | 当前窗口运行期 | 不恢复 |
| 关系图（Relationship Graph）画布状态 | 关系图（Graph）会话快照 | 当前工作区 | 仅退出时面板仍打开才恢复 |

### 16.2 配置变更的生效方式

| 配置类别 | 生效方式 |
| --- | --- |
| `cInsight.clangd.*`、`compileCommandsDir`、`fallbackFlags`、`backgroundIndex` | 重启 clangd，相关结果标记已过期（stale）并清理相应缓存 |
| `cInsight.codePreview.*` | 清除语义令牌缓存并重新渲染当前预览；滚动容量对后续记录生效 |
| `cInsight.analysis.*` | 下一次语义请求进入调度器时更新总并发和后台并发上限 |
| `cInsight.references.*` | 下次查询/分组/分页时生效；分组立即刷新当前树 |
| `cInsight.export.*` | 下一次批量输出或文件导出时生效；不会改变当前已加载的树或图 |
| `cInsight.callHierarchy.*` | 清除调用请求缓存、标记结果已过期，并在后续查询或展开时生效 |
| `cInsight.typeHierarchy.*` | 清除类型请求缓存并标记结果已过期 |
| `cInsight.includeHierarchy.*` | 使 Include 仓库失效；后续显式查询重新解析或建立索引 |
| `cInsight.relationshipGraph.*` | 当前图标记已过期；后续显式扩展和重新打开的 Call/Type/Include/混合图使用新布局、系统头与资源限制 |
| `cInsight.session.*` | 后续自动保存和下次恢复生效；关闭 Restore 会停止新的自动保存 |
| `cInsight.diagnostics.reportRedaction` | 下一次复制或导出报告时生效，不修改当前诊断树 |
| 导航历史（History）、书签（Bookmarks）、符号搜索（Symbol Search）配置 | 对当前模型立即重新排序、过滤、分组或裁剪 |

<!-- GENERATED COMMAND REFERENCE START -->

## 17. 完整命令参考

本节由 `package.json` 自动生成。所有命令都可以通过命令面板调用；表中额外列出标题栏、编辑器右键菜单、树节点右键菜单和默认快捷键入口。窗口当前状态不满足 `when` 条件时，相应菜单按钮可能隐藏。

| 命令 | Command ID | 入口 |
| --- | --- | --- |
| 关于 | `cInsight.about` | 命令面板 |
| 显示关系图 | `cInsight.relationshipGraph.show` | 命令面板；编辑器右键菜单 |
| 显示文件关系图 | `cInsight.relationshipGraph.showFile` | 命令面板；编辑器右键菜单 |
| 将关系图导出为文本 | `cInsight.relationshipGraph.exportText` | 命令面板 |
| 将关系图导出为 JSON | `cInsight.relationshipGraph.exportJson` | 命令面板 |
| 将关系图导出为 Mermaid | `cInsight.relationshipGraph.exportMermaid` | 命令面板 |
| 转到定义 | `cInsight.goToDefinition` | 命令面板；编辑器右键菜单；快捷键 `f12` |
| 查找所有引用 | `cInsight.findReferences` | 命令面板；编辑器右键菜单；快捷键 `shift+f12` |
| 显示传入调用 | `cInsight.showIncomingCalls` | 命令面板；编辑器右键菜单；调用者标题栏 |
| 显示传出调用 | `cInsight.showOutgoingCalls` | 命令面板；编辑器右键菜单；被调用者标题栏 |
| 固定上下文 | `cInsight.pinContext` | 命令面板；上下文标题栏 |
| 取消固定上下文 | `cInsight.unpinContext` | 命令面板；上下文标题栏 |
| 固定引用 | `cInsight.pinReferences` | 命令面板；引用标题栏 |
| 取消固定引用 | `cInsight.unpinReferences` | 命令面板；引用标题栏 |
| 固定调用者和被调用者 | `cInsight.pinCallHierarchy` | 命令面板；调用者标题栏；被调用者标题栏 |
| 取消固定调用者和被调用者 | `cInsight.unpinCallHierarchy` | 命令面板；调用者标题栏；被调用者标题栏 |
| 刷新 | `cInsight.refresh` | 命令面板；窗口标题栏 |
| 重启 clangd | `cInsight.restartClangd` | 命令面板 |
| 恢复提供程序设置 | `cInsight.restoreProviderSettings` | 命令面板 |
| 刷新工程诊断 | `cInsight.diagnostics.refresh` | 命令面板；工程诊断标题栏 |
| 打开工程诊断 | `cInsight.openProjectDiagnostics` | 命令面板 |
| 显示 clangd 日志 | `cInsight.diagnostics.showClangdLog` | 命令面板；工程诊断标题栏 |
| 复制工程诊断报告 | `cInsight.diagnostics.copyReport` | 命令面板；工程诊断标题栏 |
| 将工程诊断导出为文本 | `cInsight.diagnostics.exportText` | 命令面板 |
| 将工程诊断导出为 JSON | `cInsight.diagnostics.exportJson` | 命令面板；工程诊断标题栏 |
| 重启后台索引 | `cInsight.index.refresh` | 命令面板；工程诊断标题栏 |
| 选择编译数据库 | `cInsight.diagnostics.selectCompilationDatabase` | 命令面板；工程诊断标题栏 |
| 使用自动检测编译数据库 | `cInsight.diagnostics.clearCompilationDatabase` | 命令面板 |
| 打开位置 | `cInsight.openLocation` | 命令面板；树节点右键菜单 |
| 搜索工作区符号 | `cInsight.searchSymbols` | 命令面板；符号搜索标题栏 |
| 刷新工作区符号搜索 | `cInsight.symbolSearch.refresh` | 命令面板；符号搜索标题栏 |
| 清除工作区符号搜索 | `cInsight.symbolSearch.clear` | 命令面板；符号搜索标题栏 |
| 分组工作区符号 | `cInsight.symbolSearch.groupBy` | 命令面板；符号搜索标题栏 |
| 筛选工作区符号类型 | `cInsight.symbolSearch.filterKinds` | 命令面板；符号搜索标题栏 |
| 筛选导航历史 | `cInsight.history.filter` | 命令面板；导航历史标题栏 |
| 清除导航历史 | `cInsight.history.clear` | 命令面板；导航历史标题栏 |
| 为以下符号添加书签：当前符号 | `cInsight.bookmarks.addCurrent` | 命令面板；编辑器右键菜单；书签标题栏 |
| 添加书签 | `cInsight.bookmarks.add` | 命令面板；树节点右键菜单 |
| 重命名书签 | `cInsight.bookmarks.rename` | 命令面板；树节点右键菜单 |
| 更改书签分组 | `cInsight.bookmarks.changeGroup` | 命令面板；树节点右键菜单 |
| 删除书签 | `cInsight.bookmarks.delete` | 命令面板；树节点右键菜单 |
| 刷新书签 | `cInsight.bookmarks.refresh` | 命令面板；书签标题栏 |
| 筛选书签 | `cInsight.bookmarks.search` | 命令面板；书签标题栏 |
| 清除书签筛选 | `cInsight.bookmarks.clearSearch` | 命令面板；书签标题栏 |
| 排序书签 | `cInsight.bookmarks.sort` | 命令面板；书签标题栏 |
| 导入书签 | `cInsight.bookmarks.import` | 命令面板；书签标题栏 |
| 导出书签 | `cInsight.bookmarks.export` | 命令面板；书签标题栏；树节点右键菜单 |
| 重命名或合并书签分组 | `cInsight.bookmarks.renameGroup` | 命令面板；树节点右键菜单 |
| 删除书签分组 | `cInsight.bookmarks.deleteGroup` | 命令面板；树节点右键菜单 |
| 恢复上一次工作区会话 | `cInsight.session.restore` | 命令面板 |
| 清除已保存的工作区会话 | `cInsight.session.clear` | 命令面板 |
| 筛选引用 | `cInsight.references.search` | 命令面板；引用标题栏 |
| 清除引用筛选 | `cInsight.references.clearSearch` | 命令面板 |
| 更改引用分组方式 | `cInsight.references.groupBy` | 命令面板；引用标题栏 |
| 更改引用范围 | `cInsight.references.scope` | 命令面板；引用标题栏 |
| 按可信度或证据筛选引用 | `cInsight.references.filterEvidence` | 命令面板；引用标题栏 |
| 加载更多引用 | `cInsight.references.loadMore` | 命令面板 |
| 显示全部引用 | `cInsight.references.showAll` | 命令面板 |
| 复制引用 | `cInsight.references.copy` | 命令面板；树节点右键菜单 |
| 复制全部引用 | `cInsight.references.copyAll` | 命令面板 |
| 将引用导出为文本 | `cInsight.references.exportText` | 命令面板 |
| 将引用导出为 JSON | `cInsight.references.exportJson` | 命令面板 |
| 打开编辑器中的引用列表 | `cInsight.references.openList` | 命令面板 |
| 展开所有引用分组 | `cInsight.references.expandAll` | 命令面板 |
| 折叠所有引用分组 | `cInsight.references.collapseAll` | 命令面板 |
| 按深度展开调用者 | `cInsight.callers.expandToDepth` | 命令面板；调用者标题栏 |
| 按深度展开被调用者 | `cInsight.callees.expandToDepth` | 命令面板；被调用者标题栏 |
| 停止调用层次展开 | `cInsight.callHierarchy.stopExpansion` | 命令面板；调用者标题栏；被调用者标题栏 |
| 搜索已加载的调用者 | `cInsight.callers.search` | 命令面板；调用者标题栏 |
| 搜索已加载的被调用者 | `cInsight.callees.search` | 命令面板；被调用者标题栏 |
| 将调用者导出为文本 | `cInsight.callers.exportText` | 命令面板；调用者标题栏 |
| 将调用者导出为 JSON | `cInsight.callers.exportJson` | 命令面板；调用者标题栏 |
| 将被调用者导出为文本 | `cInsight.callees.exportText` | 命令面板；被调用者标题栏 |
| 将被调用者导出为 JSON | `cInsight.callees.exportJson` | 命令面板；被调用者标题栏 |
| 查找调用者路径 | `cInsight.callers.findPath` | 命令面板；调用者标题栏 |
| 查找被调用者路径 | `cInsight.callees.findPath` | 命令面板；被调用者标题栏 |
| 将调用者导出为 Mermaid | `cInsight.callers.exportMermaid` | 命令面板；调用者标题栏 |
| 将被调用者导出为 Mermaid | `cInsight.callees.exportMermaid` | 命令面板；被调用者标题栏 |
| 显示父类型 | `cInsight.typeHierarchy.showSupertypes` | 命令面板；编辑器右键菜单；父类型标题栏 |
| 显示子类型 | `cInsight.typeHierarchy.showSubtypes` | 命令面板；编辑器右键菜单；子类型标题栏 |
| 按深度展开父类型 | `cInsight.supertypes.expandToDepth` | 命令面板；父类型标题栏 |
| 按深度展开子类型 | `cInsight.subtypes.expandToDepth` | 命令面板；子类型标题栏 |
| 停止类型层次展开 | `cInsight.typeHierarchy.stopExpansion` | 命令面板；父类型标题栏 |
| 搜索已加载的父类型 | `cInsight.supertypes.search` | 命令面板；父类型标题栏 |
| 搜索已加载的子类型 | `cInsight.subtypes.search` | 命令面板；子类型标题栏 |
| 将父类型导出为文本 | `cInsight.supertypes.exportText` | 命令面板；父类型标题栏 |
| 将父类型导出为 JSON | `cInsight.supertypes.exportJson` | 命令面板；父类型标题栏 |
| 将父类型导出为 Mermaid | `cInsight.supertypes.exportMermaid` | 命令面板；父类型标题栏 |
| 将子类型导出为文本 | `cInsight.subtypes.exportText` | 命令面板；子类型标题栏 |
| 将子类型导出为 JSON | `cInsight.subtypes.exportJson` | 命令面板；子类型标题栏 |
| 将子类型导出为 Mermaid | `cInsight.subtypes.exportMermaid` | 命令面板；子类型标题栏 |
| 显示包含文件 | `cInsight.includeHierarchy.showIncludes` | 命令面板；编辑器右键菜单；包含文件标题栏 |
| 显示被包含关系 | `cInsight.includeHierarchy.showIncludedBy` | 命令面板；编辑器右键菜单；被包含关系标题栏 |
| 按深度展开包含文件 | `cInsight.includes.expandToDepth` | 命令面板；包含文件标题栏 |
| 按深度展开被包含关系 | `cInsight.includedBy.expandToDepth` | 命令面板；被包含关系标题栏 |
| 停止包含文件展开 | `cInsight.includes.stopExpansion` | 命令面板；包含文件标题栏 |
| 停止被包含关系展开 | `cInsight.includedBy.stopExpansion` | 命令面板；被包含关系标题栏 |
| 搜索已加载的包含文件 | `cInsight.includes.search` | 命令面板；包含文件标题栏 |
| 搜索已加载的被包含关系 | `cInsight.includedBy.search` | 命令面板；被包含关系标题栏 |
| 将包含文件导出为文本 | `cInsight.includes.exportText` | 命令面板；包含文件标题栏 |
| 将包含文件导出为 JSON | `cInsight.includes.exportJson` | 命令面板；包含文件标题栏 |
| 将包含文件导出为 Mermaid | `cInsight.includes.exportMermaid` | 命令面板；包含文件标题栏 |
| 将被包含关系导出为文本 | `cInsight.includedBy.exportText` | 命令面板；被包含关系标题栏 |
| 将被包含关系导出为 JSON | `cInsight.includedBy.exportJson` | 命令面板；被包含关系标题栏 |
| 将被包含关系导出为 Mermaid | `cInsight.includedBy.exportMermaid` | 命令面板；被包含关系标题栏 |

<!-- GENERATED COMMAND REFERENCE END -->
