# C Insight 中文开发者手册

本文面向准备阅读、修改、测试或发布 C Insight 的开发者，内容与 `0.22.8` 源码结构对应。用户操作和配置参数请查看 `docs/user/user-guide.zh-CN.md`；交叉工具链边界请查看 `docs/user/cross-compilation.zh-CN.md`；历史规划与延期事项请查看 `docs/planning/roadmap.md`。完整分类见 `docs/README.md`。

## 1. 技术栈与运行边界

C Insight 是 TypeScript 编写的 VS Code 扩展，生产入口为 `src/extension.ts`，通过 esbuild 打包为单个 `dist/extension.js`。它支持两种分析引擎：

- **clangd**：扩展自行启动一个 clangd 进程，通过 `vscode-languageclient` 直接发送 LSP 请求，并将标准语言能力注册给 VS Code。
- **Microsoft C/C++ language service (cpptools)**：不启动或控制 cpptools 进程，而是调用 VS Code 公开的定义（Definition）、引用（References）、调用层次（Call Hierarchy）等提供程序（Provider） API。

扩展不会运行 CMake、编译器或工程构建命令。工作区不受信任时不得启动 clangd。包含层次（Include Hierarchy）只读取源码、编译数据库和工作区文件。

交叉编译工程仍由宿主机上的 clangd 解析：`compile_commands.json` 提供每个翻译单元的真实交叉编译参数，`cInsight.compileCommandsDir` 只选择数据库目录，`cInsight.clangd.arguments` 中的 `--query-driver` 只允许 clangd 查询受信任的编译器驱动。C Insight 不执行编译数据库中的命令，也不自行探测 sysroot；但 clangd 获准后可能执行匹配的 query driver。Microsoft 模式下，`cInsight.compileCommandsDir` 不会替 cpptools 配置数据库，工程还需通过 `c_cpp_properties.json` 或其配置提供程序配置 Microsoft IntelliSense。

核心依赖方向如下：

```text
VS Code 事件/命令
       │
       ▼
Controller / Explorer / View
       │
       ▼
Repository（缓存、懒加载、方向状态）
       │
       ▼
AnalysisService（调度、计时、统一结果）
       │
       ├── ClangdManager → NavigationLanguageClient → clangd
       └── MicrosoftSemanticProvider → VS Code Provider API → cpptools
```

纯数据规则应尽量放在模型（Model）或 `src/utils` 中，不依赖 `vscode`，以便单元测试。浏览器/提供程序（Explorer/Provider）负责 VS Code 状态和交互；仓库（Repository）负责可复用语义请求、缓存及原始协议对象。不要让 Webview 直接读取文件或请求语言服务。

## 2. 从激活到一次查询

1. `activate()` 创建输出通道、分析服务、仓库（Repository）、浏览器（Explorer）、视图（View）和诊断组件。
2. `runtimeInitialization.ts` 发布初始上下文键（Context Keys），并启动选定引擎。
3. `ViewLifecycle` 注册 TreeView 和代码预览（Code Preview） Webview，记录实时可见性。
4. `ContextController` 监听活动编辑器和光标，经过防抖后根据可见窗口生成查询需求。
5. `AnalysisService` 将请求交给 `RequestScheduler`，然后路由至 clangd 或 Microsoft 提供程序（Provider），并统一转换位置、符号和调用节点。
6. 返回结果携带查询 generation；过期 generation 的结果被丢弃，不能覆盖新光标。
7. `ViewRegistry` 将上下文、文档符号（Document Symbols）和调用关系分发给各自状态所有者；代码预览、引用（References）、调用者（Callers）/被调用者（Callees）分别执行自己的固定（Pin）/锁定（Lock）更新策略。

手动命令不受窗口可见性门控；自动光标查询必须按实际可见窗口按需执行。新增后台查询时，应同时考虑取消、generation、优先级、隐藏窗口和已过期（stale）状态。

## 3. 根目录文件

| 文件 | 职责 |
| --- | --- |
| `package.json` | 扩展清单、命令/菜单/视图/配置贡献、激活事件、依赖、版本和 npm 脚本。用户可见配置的默认值以此为准。 |
| `package.nls.json` | 扩展清单英文文本。 |
| `package.nls.zh-cn.json` | 扩展清单简体中文文本，键必须与英文文件同步。 |
| `package-lock.json` | npm 依赖锁定；版本发布时根包版本应与 `package.json` 一致。 |
| `tsconfig.json` | TypeScript 编译选项和 `src`/`test` 输出规则。 |
| `eslint.config.mjs` | TypeScript ESLint 规则。 |
| `README.md` | 仓库首页、功能摘要、安装和文档入口。 |
| `CHANGELOG.md` | 每个发布版本的用户可感知改动。 |
| `CONTRIBUTING.md` | 贡献流程和基本质量要求。 |
| `SECURITY.md` | 漏洞报告渠道和安全边界。 |
| `PRIVACY.md` | 数据读取、网络和遥测说明。 |
| `LICENSE` | MIT 许可证。 |
| `media/c-insight.svg` | Activity Bar 容器图标。 |

`dist/`、`.vscode-test/` 和 `*.vsix` 是构建或测试产物，不是源代码。不要手工修改 `dist/extension.js`。

## 4. `src` 源码目录

### 4.1 激活、配置与公共类型

| 文件 | 管理的功能 |
| --- | --- |
| `src/extension.ts` | 扩展组合根；构造服务、连接事件、恢复工作区会话（Workspace Session）、注册命令与配置监听，并实现 `activate/deactivate`。这里不应继续堆积具体业务规则。 |
| `src/activation/runtimeInitialization.ts` | 初始上下文键（Context Keys）、分析引擎启动以及首次提供程序（Provider）状态处理。 |
| `src/configuration/configuration.ts` | 读取 C Insight 配置、默认值转换和 C/C++ 文档判断。新增配置需先更新 manifest，再在这里提供类型化读取。 |
| `src/models/types.ts` | 跨模块共享的基础类型：引擎状态、位置、符号上下文、调用节点和视图更新意图。 |
| `src/ids.ts` | 从 `package.json` 生成的命令、视图、内部命令和上下文 Key 常量。必须运行生成脚本，不应手工编辑。 |

### 4.2 分析引擎层 `src/analysis`

| 文件 | 管理的功能 |
| --- | --- |
| `analysisEngine.ts` | `clangd`/`microsoft` 引擎类型和当前配置读取。 |
| `analysisService.ts` | 所有语义查询的统一入口；负责引擎路由、请求调度、取消、结果标准化、请求计时和错误类型。UI 不应绕过它直接调用语言服务。 |
| `requestScheduler.ts` | interactive/normal/background 优先级、总并发、后台并发、同键合并、排队取消和统计。 |
| `microsoftSemanticProvider.ts` | 将 VS Code 公开命令/提供程序（Provider）结果适配为内部类型；管理提供程序激活等待与不可用错误。 |
| `microsoftProviderStatus.ts` | 获取当前 cpptools 可用性，并在配置冲突时采用失败关闭（fail closed）策略。 |
| `microsoftProviderStatusModel.ts` | 纯状态判定：扩展缺失、未激活、IntelliSense disabled、提供程序冲突或可用。 |
| `providerConflictModel.ts` | 已知 clangd/cpptools 提供程序冲突识别和扩展 ID 常量。 |
| `enginePresentation.ts` | 引擎正式名称、状态栏和编译数据库变更操作的展示文案模型。 |

新增一种引擎时，优先扩展 `AnalysisService` 的稳定接口，而不是在每个 Explorer 中添加引擎分支。引擎不支持的能力应显式抛出 `UnsupportedEngineFeatureError`，不能返回伪造的空结果。

### 4.3 clangd 生命周期层 `src/clangd`

| 文件 | 管理的功能 |
| --- | --- |
| `clangdManager.ts` | 定位、启动、重启和停止一个 clangd；持有客户端状态、配置变化、索引进度、编译数据库目录和意外退出后的有界恢复接线。 |
| `clangdRecovery.ts` | 维护三分钟滑动窗口内最多四次的自动重启预算，并识别 `EPIPE`/流已销毁等进程退出后的次生传输错误。 |
| `navigationLanguageClient.ts` | `LanguageClient` 子类及 clangd 导航连接行为；同一轮断连只保留一条简洁传输诊断，连接重新运行后恢复正常记录。 |
| `languageClientFeatureFilter.ts` | 过滤会造成全局命令冲突的执行命令功能（Execute Command feature），同时保留文档同步和导航提供程序（Provider）。 |
| `clangdLocator.ts` | 配置路径、PATH 和常见安装位置中的 clangd 探测及版本检查。 |
| `clangdArguments.ts` | 组合受管理参数、编译数据库目录和用户自定义参数。启动进程不经过 shell。 |
| `compilationDatabase.ts` | 自动发现、路径排名、显式选择和发现缓存失效。 |
| `indexProgress.ts` | 解析 clangd `$/progress` 信息，维护后台索引的已完成数、总数和百分比状态。 |
| `clangdLog.ts` | 将 clangd 日志写入 VS Code LogOutputChannel。 |
| `clangdLogClassifier.ts` | 将 clangd 的 `I/E/V` 前缀和多行续行映射为正确日志级别，避免普通协议日志被误报为错误。 |

### 4.4 光标上下文 `src/context`

| 文件 | 管理的功能 |
| --- | --- |
| `contextController.ts` | 编辑器/光标防抖、generation、取消源、树双击后的随光标抑制、轻量与延迟详情查询、可靠性计算及结果分发。 |
| `navigationDemand.ts` | 根据各导航窗口可见性和引擎能力，纯函数计算定义（Definition）、悬停信息（Hover）、引用（References）、调用者（Callers）、被调用者（Callees）等需求。 |

修改自动刷新行为时必须补充 `navigationDemand.test.ts`，证明隐藏窗口不会意外请求。

### 4.5 视图与代码预览（Code Preview） `src/views`

| 文件 | 管理的功能 |
| --- | --- |
| `viewLifecycle.ts` | TreeView/Webview 注册、可见性事件、查找与统一释放，是 VS Code 视图资源的唯一所有者。 |
| `viewRegistry.ts` | 上下文（Context）、文档符号（Document Symbols）、调用者（Callers）/被调用者（Callees）的协调与展示；连接各独立 Explorer。它不是引用（References）固定（Pin）或 VS Code 资源的所有者。 |
| `treeNode.ts` | 通用树节点结构、状态节点和 `MutableTreeProvider`；为带源码位置的普通节点绑定统一激活命令和窗口作用域。 |
| `codePreviewProvider.ts` | 代码预览 Webview、CSP、源码加载、语义着色、可点击符号、单/双击导航、历史、增量滚动、锁定（Lock），以及源码 `<code>` 元素的宿主预格式样式重置。 |
| `sourceHighlight.ts` | C/C++ 词法回退高亮、语义令牌（Semantic Tokens）解码、HTML 转义及精确目标范围叠加。 |
| `sourceLineCache.ts` | 引用和预览所需源码行的有界缓存。 |
| `previewRange.ts` | 向上/向下加载、范围裁剪和恢复的纯算法。 |
| `previewHistory.ts` | 代码预览前进/后退和有界记录。 |
| `previewClearGuard.ts` | 从预览打开编辑器期间阻止活动编辑器事件立即清空预览。 |
| `referenceExplorer.ts` | 引用结果、固定、已过期（stale）、可靠性、分页、搜索、分组、分组初始展开状态、证据过滤、选择和会话状态的唯一所有者。非平铺分组的子项已在内存中，展开不产生额外语义请求。 |
| `referenceModel.ts` | 定义（Definition）/声明（Declaration）/Call/Read/Write/Read-Write/Address/Macro 等分类及证据、置信度和语法推断。 |
| `callHierarchyViewState.ts` | 调用者/被调用者共享固定、固定符号和已过期状态；方向树及缓存仍保持独立。 |

Webview 消息必须使用可判别动作类型，并在扩展宿主重新验证 URI、行号、字符和节点身份。所有源码内容进入 HTML 前必须转义。

### 4.6 调用层次（Call Hierarchy） `src/callHierarchy`

| 文件 | 管理的功能 |
| --- | --- |
| `callHierarchyRepository.ts` | 调用层次根准备、传入/传出（Incoming/Outgoing）懒查询、方向独立 LRU、展开节点的定义/声明位置缓存、Microsoft 安全调用者（Callers）回退和被调用者（Callees）证据。树和关系图共用此仓库。 |
| `callOccurrenceModel.ts` | 将语义调用关系及其 `fromRanges` 投影为按源码位置排序的调用点，去除完全重复范围，并把每组最早调用点标记为唯一规范展开点。它是无 VS Code 依赖的纯模型。 |
| `microsoftCallerFallbackModel.ts` | 将引用（References）映射到最内层可调用文档符号（Document Symbol），形成保守的基于引用（References-based）调用者。 |
| `microsoftCalleeEvidenceModel.ts` | 汇总 Microsoft 原生传出调用（Outgoing Calls）的成功、空、失败、取消和耗时证据。 |

clangd 的 `CallHierarchyItem.data` 是后续请求所需的不透明数据，不能只保存显示字段后重建对象。Microsoft 传入调用（Incoming Calls）曾触发 cpptools 原生崩溃，因此安全回退（fallback）路径不能未经实测替换为原生调用。

调用者（Callers）/被调用者（Callees）树不会为一个语义函数建立额外的“函数 → 调用位置”层。`ViewRegistry` 将投影结果直接物化为调用点节点；只有规范调用点持有 `callPath` 和下一层加载器，其他同名调用点只负责代码预览（Code Preview）和编辑器导航。展开调用者规范节点时，`ViewRegistry` 在调用点前插入当前语义函数的独立声明；声明行没有 `callKey`，搜索可包含它，但批量展开、深度、预算、路径、会话与语义导出必须忽略它。根节点的显示定义位置和补充声明位置都不能写回 `CallHierarchyItem`，否则会破坏 clangd 的不透明 `data` 查询身份。

### 4.7 类型层次（Type Hierarchy） `src/typeHierarchy`

| 文件 | 管理的功能 |
| --- | --- |
| `typeHierarchyRepository.ts` | prepare/supertypes/subtypes 请求、方向独立缓存和不透明条目（opaque item）保存，供树与关系图共用。 |
| `typeHierarchyExplorer.ts` | 父类型（Supertypes）/子类型（Subtypes）树、懒加载、搜索、过滤、展开深度、限制状态和导出。 |

### 4.8 包含层次（Include Hierarchy） `src/includeHierarchy`

| 文件 | 管理的功能 |
| --- | --- |
| `includeModel.ts` | 解析 `#include`、shell 风格编译命令和 `-iquote/-I/-isystem` 搜索路径。 |
| `includeResolver.ts` | 根据引用方式和搜索路径解析用户头、系统头及未解析原因。 |
| `reverseIncludeIndex.ts` | 被包含关系（Included By）的按需工作区反向索引、进度、取消、generation 和文件增量更新。 |
| `includeHierarchyRepository.ts` | 正向（forward）缓存、共享解析器（resolver）和唯一反向索引（reverse index）；树和关系图共用。 |
| `includeHierarchyExplorer.ts` | 包含文件（Includes）/被包含关系两棵独立树、懒加载、搜索、深度展开、限制状态和导出。 |

普通包含文件或包含关系图（Include Graph）不应隐式建立反向索引；只有明确的被包含关系操作可以调用 `incoming`。扫描结果必须完整且 generation 仍有效后才能原子发布。

### 4.9 关系图（Relationship Graph） `src/relationshipGraph`

| 文件 | 管理的功能 |
| --- | --- |
| `graphModel.ts` | 稳定节点/边 ID、有界图模型、语义方向和 Text/JSON/Mermaid 导出。 |
| `relationshipGraphPanel.ts` | 编辑区 WebviewPanel、SVG 交互、调用/类型/包含/定义（Call/Type/Include/Definition）图准备与展开、搜索、过滤、导航、书签、会话和资源释放。 |
| `graphSessionLifecycle.ts` | 区分用户关闭面板与扩展关闭，决定图会话是否保留。 |

语义边方向固定为调用者（Caller）→被调用者（Callee）、Supertype→Subtype、Includer→Included、Owner→Defined Entity。屏幕上的父子方向不得反向污染导出语义。

### 4.10 工作区工具（Workspace Tools）

| 文件 | 管理的功能 |
| --- | --- |
| `history/navigationHistoryModel.ts` | 历史记录、游标、前进/后退、分支截断、合并、上限和来源分类。 |
| `history/navigationHistoryExplorer.ts` | 导航历史树视图（History TreeView）、过滤、选择/打开和代码预览（Code Preview）共享游标。 |
| `bookmarks/bookmarkModel.ts` | 书签分组、排序、过滤、重命名、去重、导入导出和符号重定位算法。 |
| `bookmarks/bookmarkExplorer.ts` | workspaceState 持久化、TreeView、文件访问和命令交互。 |
| `symbols/symbolSearchModel.ts` | 工作区符号（Workspace Symbols）的过滤、类型/文件/目录分组和结果上限。 |
| `symbols/symbolSearchExplorer.ts` | 符号搜索（Symbol Search）的 Webview View 提供程序、防抖查询、generation、分组/过滤、统一导航和会话状态；文件读取与命令执行仍由扩展宿主持有。 |
| `symbols/symbolSearchWebview.ts` | 顶部常驻搜索框、独立滚动结果区、严格 CSP、HTML 属性转义及入站消息白名单；动态符号文字仅通过 DOM `textContent` 写入。 |
| `symbols/symbolPresentation.ts` | 文档/工作区符号（Document/Workspace Symbols）的“大纲”（Outline）风格 ThemeIcon 映射。 |

### 4.11 会话 `src/session`

| 文件 | 管理的功能 |
| --- | --- |
| `workspaceSessionModel.ts` | 版本化快照类型、解析校验、字节预算降级、跨引擎语义状态隔离。 |
| `workspaceSession.ts` | workspaceState 读写、串行保存、定时自动保存和关闭时最终保存。 |

快照只保存可稳定重建的数据，不保存 clangd opaque item。新增 section 时必须定义：格式版本、尺寸上限、无效数据处理、跨引擎策略、URI 可用性检查和恢复取消点。

### 4.12 诊断 `src/diagnostics`

| 文件 | 管理的功能 |
| --- | --- |
| `analysisReliability.ts` | 根据引擎、索引、编译数据库和文件编译命令形成可靠性等级与问题。 |
| `reliabilityStatusPresentation.ts` | 将可靠性映射为状态栏文本、颜色、严重级别和 tooltip。 |
| `reliabilityStatusBar.ts` | 状态栏生命周期和更新。 |
| `projectDiagnosticsModel.ts` | 编译命令拆解、缺头文件识别、结构化报告、脱敏和文本输出。 |
| `projectDiagnostics.ts` | 工程诊断（Project Diagnostics）树、VS Code diagnostics 收集、引擎状态、提供程序（Provider）证据及报告导出。 |
| `runtimeDiagnostics.ts` | 进程内计数器和 gauges，包括调度、缓存、查询和图渲染指标；不上传遥测。 |

可靠性警告统一通过底部状态栏呈现，结果树只显示自身状态，避免多个窗口重复警告。

### 4.13 命令层 `src/commands`

| 文件 | 管理的功能 |
| --- | --- |
| `registerCommands.ts` | 命令组合根，只注入各组需要的依赖。 |
| `commandRegistrar.ts` | 类型化命令注册函数签名。 |
| `navigationCommands.ts` | 定义（Definition）/声明（Declaration）、统一树位置单击/双击、预览和打开位置等导航命令。 |
| `referenceCommands.ts` | 引用（References）查询、刷新、固定（Pin）、过滤、分组、分页和导出。 |
| `callHierarchyCommands.ts` | Incoming/Outgoing、刷新、固定、展开、路径搜索和导出。 |
| `hierarchyCommands.ts` | 类型/包含层次（Type/Include Hierarchy）的显示、刷新、展开、搜索、过滤和导出。 |
| `workspaceToolCommands.ts` | History、书签（Bookmarks）、符号搜索（Symbol Search）和工作区会话（Workspace Session）命令。 |
| `diagnosticCommands.ts` | 工程诊断（Project Diagnostics）、编译数据库选择、复制/导出报告和索引操作。 |
| `extensionControlCommands.ts` | About、引擎控制、提供程序（Provider）冲突处理和扩展级刷新。 |

新增命令的顺序是：修改 `package.json` contribution → 更新 NLS → 运行 `npm run ids:generate` → 在唯一一个命令组注册 → 更新中英文用户手册。自动测试会要求每个 manifest 命令恰好有一个注册位置。

### 4.14 通用工具 `src/utils`

| 文件 | 管理的功能 |
| --- | --- |
| `callHierarchy.ts` | 调用节点稳定键、递归判断和显式函数/成员函数指针调用语法证据。 |
| `callPath.ts` | 有深度、路径数和访问节点上限的调用路径搜索。 |
| `typeHierarchy.ts` | 类型稳定键、递归、关系证据、过滤和 Mermaid 方向。 |
| `definitionLocation.ts` | 比较定义（Definition）、声明（Declaration）与提供程序位置，选择实现优先的展示位置并保留声明回退证据。 |
| `hierarchyTreeState.ts` | 每个方向独立的节点数、重复集合和剩余预算。 |
| `hierarchyExpansion.ts` | 展开停止原因及统一提示。 |
| `hierarchyExport.ts` | 调用/类型/包含（Call/Type/Include）通用的版本化 Text/JSON/Mermaid 导出模型。 |
| `lruPromiseCache.ts` | 可合并进行中 Promise、失败不留存的有界 LRU。 |
| `exportBudget.ts` | 按 UTF-8 字节限制编码导出，防止超大副本长期驻留。 |
| `exportWriter.ts` | VS Code 文件选择和受预算保护的导出写入。 |
| `mermaid.ts` | Mermaid 标签转义和调用边渲染。 |
| `viewPin.ts` | 固定（Pin）状态下自动/手动更新的统一纯策略。 |
| `cursorFollowSuppression.ts` | 记录树双击的编辑器目标，过滤程序化编辑器/选区事件，并在鼠标或键盘移动到其他位置时恢复随光标刷新。 |
| `treeLocationInteraction.ts` | 将同一窗口、同一稳定节点在配置时间内的两次激活分类为单击预览或双击打开；不持有 VS Code 资源。 |
| `viewStatusModel.ts` | 空闲（Idle）、加载中（Loading）、空结果（Empty）、已取消（Cancelled）、已过期（Stale）、结果受限（Limited）、失败（Failed）的纯展示模型。 |

## 5. 本地化

运行时字符串使用 `vscode.l10n.t()`，源文作为英文 key，由以下文件提供目录：

- `l10n/bundle.l10n.json`：英文运行时目录。
- `l10n/bundle.l10n.zh-cn.json`：简体中文运行时目录。
- `package.nls*.json`：仅用于 manifest 的命令、视图和配置文本。

修改运行时文本后运行 `npm run l10n:export`，翻译新增中文条目，再运行 `npm run l10n:check`。不要只改一个语言目录。

中文界面文案遵循以下约定：

- “显示”用于在现有视图中呈现语义结果；“打开”用于进入编辑器、面板、文件或设置。
- “清除”用于删除搜索条件、历史或已保存状态；“重置”用于恢复布局或参数默认值。
- 尚未产生的用户数据使用“暂无”；查询完成但没有命中使用“未找到”。
- 引擎或功能无法提供能力使用“不可用”；请求发生异常使用“查询失败”。
- 中文与 `clangd`、`JSON`、`Mermaid` 等拉丁文字术语之间保留一个半角空格，命令 ID、配置键和协议字段保持原样。

## 6. 脚本与自动生成内容

| 文件/命令 | 用途 |
| --- | --- |
| `scripts/check-localization.mjs` / `npm run l10n:check` | 检查运行时目录、manifest NLS 和引用键同步。 |
| `scripts/generate-id-registry.mjs` / `npm run ids:generate` | 从 manifest 生成 `src/ids.ts`；`ids:check` 只检查漂移。 |
| `scripts/generate-command-reference.mjs` / `npm run docs:commands` | 从 manifest 同步生成中英文用户手册命令参考段落；`docs:commands:check` 检查漂移。 |
| `scripts/localize-chinese-guide-terms.mjs` / `npm run docs:terms` | 按小节统一中文用户手册中的界面术语；首次出现保留英文括注，并跳过代码段；`docs:terms:check` 在质量门中检查漂移。 |
| `scripts/format-markdown-prose.mjs` / `npm run docs:prose` | 合并 `docs/` 普通段落和列表项中不合时宜的硬换行，同时保留标题、表格、代码块和其他 Markdown 结构；`docs:prose:check` 防止格式回退。 |
| `scripts/check-document-links.mjs` / `npm run docs:links:check` | 检查仓库内 Markdown 本地链接的目标是否存在；标准质量门会自动执行。 |
| `scripts/benchmark-large-workspace.mjs` / `npm run benchmark` | 运行大规模纯模型基准和预算门槛。 |
| `scripts/acceptance-ffmpeg.mjs` / `npm run acceptance:ffmpeg` | 只读启动真实 clangd，验证 FFmpeg 编译数据库及代表性 LSP 查询。 |

## 7. 测试结构

### 7.1 单元测试

`test/unit/*.test.ts` 与纯 Model/Utils 一一对应。新增规则至少覆盖：正常结果、空结果、取消/限制、重复/递归、异常输入和兼容旧格式。重要架构守卫包括：

- `commandWiringCompleteness.test.ts`：命令 contribution 与唯一注册点一致。
- `documentationCompleteness.test.ts`：配置、命令和视图全部出现在用户手册。
- `localizationManifest.test.ts`：中英文 manifest 文本完整。
- `secondPhaseCompatibility.test.ts`：旧会话和导出格式保持兼容。

### 7.2 集成与 E2E

- `test/integration/clangdHandshake.test.ts`：真实 clangd 初始化及调用层次（Call Hierarchy）协议。
- `test/fixtures/basic-cpp/`：隔离的最小 CMake/C++ 工程和编译 flags。
- `test/e2e/runTest.ts` + `suite/index.ts`：C Insight/clangd Extension Host 主回归。
- `runMicrosoftProbe.ts` + `suite/microsoftProviderProbe.ts`：只加载 cpptools，探测公开提供程序（Provider）能力。
- `runMicrosoftEngineTest.ts` + `suite/microsoftEngine.ts`：最小工程 Microsoft 模式回归。
- `runFfmpegMicrosoftTest.ts` + `suite/ffmpegMicrosoft.ts`：真实 FFmpeg Microsoft 模式回归。
- `testLaunchArgs.ts`：为每个 Extension Host 分配独立临时用户数据和扩展目录，避免修改用户配置或争抢实例锁。

E2E 默认需要图形环境；无桌面环境使用 `xvfb-run`。Microsoft 测试还需要安装对应 cpptools 扩展，可通过环境变量覆盖扩展和 VS Code 路径。

## 8. 常用开发流程

```bash
npm install
npm run compile
npm run lint
npm test
npm run check
```

`npm run check` 依次执行 lint、测试、本地化检查、ID 漂移检查、中英文命令参考、中文术语、正文换行、文档链接检查和生产构建，是每次提交前的最低门槛。涉及性能或真实引擎时追加：

```bash
npm run benchmark
npm run acceptance:ffmpeg
xvfb-run -a npm run test:e2e
npm run probe:microsoft
npm run test:e2e:microsoft
npm run test:e2e:ffmpeg:microsoft
```

发布包使用：

```bash
npm run package
```

该命令会再次执行完整 `check`，然后生成 `c-insight-<version>.vsix`。

## 9. 修改不同功能时从哪里开始

| 需求 | 首要入口 | 通常还需修改 |
| --- | --- | --- |
| 新增语义查询 | `analysisService.ts` | 引擎适配器、调度、浏览器（Explorer）、诊断和测试 |
| 修改光标自动刷新 | `contextController.ts` | `navigationDemand.ts`、可见性测试 |
| 修改引用（References）分类 | `referenceModel.ts` | `referenceExplorer.ts`、导出、用户手册和单测 |
| 修改调用者（Callers）/被调用者（Callees） | `callOccurrenceModel.ts`、`callHierarchyRepository.ts`、`viewRegistry.ts` | 调用点排序与规范节点、固定（Pin）状态、层级工具、关系图（Graph）和会话兼容 |
| 修改类型/包含（Type/Include） | 对应仓库（Repository）和浏览器（Explorer） | 通用层级状态/导出、关系图、缓存失效 |
| 修改代码预览（Code Preview） | `codePreviewProvider.ts` | highlight/range/history/clear guard、CSP 与 E2E |
| 修改关系图（Graph） | `relationshipGraphPanel.ts` | `graphModel.ts`、会话模型（session model）、资源释放测试 |
| 新增配置 | `package.json` | NLS、configuration、用户手册配置表和文档测试 |
| 新增命令 | manifest + 对应 command group | IDs 生成、NLS、菜单、用户手册和命令审计 |
| 修改持久化 | `workspaceSessionModel.ts` | 字节预算、解析兼容、恢复顺序和旧版本测试 |

## 10. 状态所有权与维护约束

- `ClangdManager` 唯一拥有 C Insight 启动的 clangd 进程。
- `AnalysisService` 唯一拥有跨引擎查询路由、调度和请求计时。
- `ViewLifecycle` 唯一拥有 VS Code TreeView/Webview 注册与释放。
- `ReferenceExplorer` 唯一拥有引用（References）固定（Pin）和结果状态。
- `CallHierarchyViewState` 唯一拥有调用者（Callers）/被调用者（Callees）共享固定状态。
- `CodePreviewProvider` 唯一拥有 Preview 锁定（Lock）、历史和渲染状态。
- 各仓库（Repository）唯一拥有对应语义请求缓存；关系图（Graph）和树必须共享仓库。
- `WorkspaceSessionManager` 唯一负责串行保存，不能从多个事件直接并发写 workspaceState。
- `RelationshipGraphPanel` 的宿主模型是语义真相；Webview 只拥有画布布局、缩放、折叠和选择。

如果一个改动需要在两个类中同步维护同一布尔状态，通常说明所有权划分出现问题，应先抽取单一状态对象，而不是增加双向事件同步。

## 11. 安全、性能和兼容性检查表

提交前确认：

1. 用户输入、源码和提供程序（Provider）返回值进入 HTML/Mermaid 前已经转义。
2. Webview 动作在扩展宿主重新验证，不能携带任意本地路径执行操作。
3. 新查询支持取消，旧 generation 不会覆盖新结果。
4. 隐藏视图不会触发不需要的自动查询或被包含关系（Included By）扫描。
5. 缓存有尺寸上限，失败 Promise 不被保留，配置/编辑/引擎变化会正确失效。
6. 大量结果受 `maximumNodes`、`maximumDepth`、分页或导出字节预算保护。
7. 固定（Pin）/锁定（Lock）阻止自动更新，但明确的用户命令仍按既定策略生效。
8. 新快照字段向后兼容；无法兼容的 section 单独丢弃，不破坏整个会话。
9. Microsoft 模式只使用公开 API；不依赖未经声明的 cpptools 私有命令。
10. 工作区不受信任时不启动外部进程；进程启动不经过 shell。

## 12. 文档维护规则

- 用户行为或配置变化：更新中英文用户手册、README 摘要和 CHANGELOG。
- 交叉工具链、编译数据库或引擎边界变化：同步更新中英文交叉编译指南以及两份用户手册中的入口说明。
- 架构或文件职责变化：更新本文及 `docs/development/architecture.md`。
- 延期或完成计划项：更新 `docs/planning/roadmap.md`，删除已经过时的备忘描述。
- 性能门槛变化：更新 `docs/validation/performance-baseline.zh-CN.md`。
- 引擎能力或验收变化：更新对应 Microsoft/第三阶段验收文档。
- 每次发布同步提升 `package.json` 与 `package-lock.json` 版本，并重新打包 VSIX。
