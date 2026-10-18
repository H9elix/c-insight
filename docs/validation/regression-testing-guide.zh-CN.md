# C Insight 历史问题驱动测试指南

本指南基于当前 `0.22.25` 代码、已有测试、更新日志与历次用户反馈整理，首次汇编日期为 `2026-10-17`。它是一份持续维护的测试指导，不是一次测试通过报告。具体缺陷、配置问题、行为约定和已知限制见[历史问题与回归案例库](historical-issues.zh-CN.md)，首批记录 `CI-REG-001` 至 `CI-REG-048`，随后增补编译参数宏场景 `CI-REG-049`。

本指南及案例库中的源码、测试和仓库规则链接面向 GitHub 或完整源码工作副本；VSIX 不包含测试目录和代理维护规则。通过已安装扩展阅读时，应从项目仓库打开相应源码，而不是假设测试文件已经随扩展安装。

## 1. 如何使用

1. 收到问题先按现象查案例库，复用已有编号；新问题建立新编号，先标注待复现或待定位。
2. 修复前保存能复现旧行为的最小步骤和证据；修复后用同一场景验证，不只检查最终界面有结果。
3. 按下表选择定向测试，再执行与改动风险相称的完整检查。补充新的自动断言，不把手工点过一次当成自动覆盖。
4. 临时包交付时给出本次问题编号、已执行结果和人工重点；用户确认后才能记录用户验收，再按授权发布。
5. 以后收到新的实际问题时，同步更新案例库；影响共性规则或选择范围时也更新本指南。维护要求已写入[仓库规则](../../AGENTS.md)和[贡献指南](../../CONTRIBUTING.md)。

案例库只陈述有记录支持的根因。早期启动失败等证据不足的报告保留未知项；Microsoft 原生崩溃、主题差异、未激活预处理分支等不能一律写成 C Insight 缺陷。已被证伪的预览假设必须保留纠错说明，避免重新引入无效补丁。

## 2. 测试层级与通过条件

| 层级 | 适合发现的问题 | 不能据此证明的内容 |
| --- | --- | --- |
| 纯模型单元测试 | 范围、分类、节点预算、去重、取消、缓存、历史和状态转换 | VS Code 真实事件顺序、鼠标手感或外部进程稳定性 |
| 静态接线与文档契约 | 命令唯一注册、共享入口、配置默认值、语言目录、源码调用约束 | 运行时查询成功、没有实际闪烁或没有后台请求 |
| 真实 clangd 协议集成 | 初始化和支持的协议方法 | 所有版本、工具链和大型工程都可用 |
| 隔离扩展宿主端到端测试（Extension Host E2E） | 编辑器事件、真实引擎、预览状态、树宿主动作、原生后退/前进 | 自动等同于真实硬件滚轮、侧键、所有主题和全部 Remote 环境 |
| FFmpeg 或实际嵌入式工程 | 编译配置、跨文件行为、真实索引和请求数量 | 单次耗时代表所有机器，或单一编译平台覆盖所有宏分支 |
| 人工 UI 验收 | 滚动闪烁、布局、固定按钮、主题、侧键和操作连续性 | 不记录环境就具有可重复性，或结果没变就说明没有重复查询 |

只有实际执行且结果符合断言时才标记通过。跳过、不可用、超时、外部引擎崩溃和待用户确认必须分别记录。当前基线曾通过的 `284` 项测试不是以后版本固定的测试数量，也不是案例库所有条目均已重新手工验证的声明。

## 3. 环境与证据准备

- 记录扩展版本、临时包完整文件名或提交、VS Code 版本、分析引擎及版本、主题、Local/WSL/SSH/容器、单文件夹或多根工作区。
- 记录有效设置，而不只保存某一个 `settings.json`：用户、远程、工作区、文件夹及语言专属设置可能同时影响结果。
- 检查编译数据库是否有目标 `.c/.cpp` 条目，包含目录、宏、生成头文件、目标架构和 sysroot 是否真实有效；不要仅因其他文件能分析就认为当前文件配置正确。
- 小夹具用于确定语义及事件顺序；FFmpeg 用于观察跨文件和规模效应。使用符号名和源码片段定位，行号只作参考，不能假设不同 FFmpeg 修订中的第 37/41/42/134 行内容相同。
- 同时准备冷索引与暖索引场景；慢速输入、快速切换和多窗口可见是独立维度，不能只测试空闲状态。
- 采集 C Insight、语言引擎输出、工程诊断和运行时计数，必要时附录屏、DOM 元素或令牌检查结果。公开记录先脱敏，不提交私有工程、完整编译命令中的秘密宏、个人路径、令牌或账号截图。
- 自动测试必须使用隔离用户数据和扩展目录；需要关闭文件、清理测试历史或切换引擎时，不操作用户正在使用的 VS Code 实例。

## 4. 修改模块后应选择哪些历史场景

| 修改范围 | 优先复测案例 | 现有自动入口及补充验证 |
| --- | --- | --- |
| clangd 启动、客户端、日志 | 001–006 | `clangdArguments`、`navigationLanguageClient`、`clangdLog`、`clangdRecovery` 单测；协议集成和 clangd E2E |
| 提供程序冲突、配置、Remote、Microsoft | 006–010 | `providerConflictModel`、`microsoftProviderStatus`、`microsoftCallerFallback`；Microsoft E2E；WSL/SSH 设置写入仍需对应环境验证 |
| 预览定义、语义令牌与 HTML/CSS | 011–021、024 | `codePreview`、`previewColors`、`definitionLocation`、`previewClearGuard`、`previewOwnership`、`previewRange`；E2E 含受控 Webview 配色回归；主题、滚轮与空白双击人工检查 |
| 结果树、导航、固定、节点投影 | 022–028、043、048 | `treeLocationInteraction`、`treeLocationWiring`、`resultTreeClient`、`resultTreeModel`、`viewPin`、`editorNavigationWiring`；真实导航历史 E2E |
| 字段调用者、宏、引用分类 | 029–034、048–049 | `memberCallerScopeModel`、`memberCallerRepositoryWiring`、`macroCallerScopeModel`、`macroCallerRepositoryWiring`、`referenceModel`、`referenceExplorerWiring`；双引擎、宏仓库 E2E 与编译参数宏场景 |
| 自动刷新、资源、取消、包含层次 | 035–039 | `cursorRefreshModel`、`cursorSymbolEvidence`、`navigationDemand`、`requestScheduler`、`lruPromiseCache`、`includeModel`；计数、压力和按方向查询验证 |
| 会话、关系图、文档符号 | 040–042 | `graphSessionLifecycle`、`workspaceSession`、`callHierarchyViewState`、`documentSymbolFocusModel`；关闭/重开工程与切换引擎 |
| 文档、本地化、构建、发布 | 044–047 | 文档与本地化检查、`publicRepositoryContract`、`releaseNotesContract`、`cpptoolsExtensionPath`；Release 附件与隐私人工复核 |

表中的单测短名对应 `test/unit/<短名>.test.ts`。主 clangd E2E 位于 [suite/index.ts](../../test/e2e/suite/index.ts)，Microsoft 主回归位于 [microsoftEngine.ts](../../test/e2e/suite/microsoftEngine.ts)，真实工程回归位于 [ffmpegMicrosoft.ts](../../test/e2e/suite/ffmpegMicrosoft.ts)。案例库按条说明覆盖层级；同名测试文件存在不表示某个 UI 动作已有端到端覆盖。

共享导航、配置或状态所有权变更必须检查其他消费者，不能只验证最先报错的调用者窗口。例如，打开位置入口改变时应同时检查代码预览、被调用者、文档符号、历史、书签及关系图。

## 5. 执行命令

### 文档维护

```bash
npm run docs:commands:check
npm run docs:terms:check
npm run docs:prose:check
npm run docs:links:check
npm run release:notes:check
git diff --check
```

只整理测试指导且不改插件行为时，不为此提升正式版本或生成新 VSIX。命令目录没有变化时只检查，不需要重新生成目录。正文保持自然段，不为固定列宽插入换行；代码、列表和表格保留结构。

### 源码修改的基本检查

```bash
npm run check
```

可先编译后运行定向单测，例如预览与导航：

```bash
npm run compile
node --test dist/test/unit/codePreview.test.js dist/test/unit/previewOwnership.test.js dist/test/unit/editorNavigationWiring.test.js
```

### 真实引擎与规模检查

```bash
npm run test:e2e:xvfb
npm run test:e2e:microsoft
npm run benchmark
```

Linux 无桌面环境使用现有 Xvfb 入口；有桌面时也可以运行 `npm run test:e2e`。E2E 启动器默认使用指定版本的独立测试 VS Code，需要已有运行时或网络下载；可用 `C_INSIGHT_VSCODE_EXECUTABLE_PATH` 指定兼容的本地测试程序。Microsoft 用例还需要 cpptools，可用 `C_INSIGHT_CPPTOOLS_EXTENSION_PATH` 指定已安装路径。不要为了运行测试随意修改实际工作窗口的引擎设置。

真实工程只在明确纳入范围时运行：

```bash
C_INSIGHT_FFMPEG_ROOT=/path/to/FFmpeg C_INSIGHT_FFMPEG_CLANGD=/path/to/clangd-20 npm run acceptance:ffmpeg -- /tmp/c-insight-ffmpeg-acceptance.json
C_INSIGHT_FFMPEG_WORKSPACE=/path/to/FFmpeg npm run test:e2e:ffmpeg:microsoft
```

`acceptance:ffmpeg` 是只读协议验收；Microsoft 的真实工程 E2E 应使用启动器创建的隔离测试实例。命令不会替项目生成正确的编译数据库。环境、数据和索引不同，不设置“所有查询必须少于某个固定秒数”这样的跨机器门槛。

发布前还要执行联网的 `npm audit --audit-level=low`。网络失败不等于发现漏洞，也不等于审计通过；不得通过关闭 TLS 校验或忽略错误来完成发布。

编译参数注入宏的独立场景见[验证说明](command-line-macros.zh-CN.md)。`npm run probe:command-line-macros` 构建并直接查询 clangd，`npm run test:e2e:command-line-macros` 在独立 VS Code 中查询 C Insight；均需要已有 `cc`，不安装新构建工具。后者不是默认主 E2E 的组成部分，需按范围单独运行。正向引用断言通过不意味着已知的定义/宏调用者限制已经修复。

## 6. 高频问题人工冒烟清单

每次影响公共交互时至少选择相关项；正式发布验证与本次改动相邻的场景。下面是通过条件，不代表本次已经执行。

1. 启动与跨文件：打开 C 文件，分别选择本地函数、跨文件函数、宏和字段；确认预览、引用及可见方向的调用树符合引擎能力，没有竞争服务误用或持续初始化失败。
2. 预览超时：语义着色迟到时，源码仍能在配置等待上限后用词法回退显示，不能只因为定义已返回就宣布预览正常。
3. 显式选择优先：选择符号后立即点它的调用点，再等待迟到详情；代码预览不得弹回原定义，其他窗口可继续完成各自查询。
4. 滚动：新预览首次向上/下滚轮立即生效，长行横向滚动条始终可用；预加载、后续详情及定义升级不闪回初始位置。
5. 预览样式与空白：普通代码没有灰色圆角覆盖层；目标标记仍正确；双击代码、行尾、行号附近及代码区空白都定位到有效行并保留预览。
6. 树操作：单击名称只预览，双击或 Enter 只打开编辑器而不改变展开状态；箭头、左右键只处理分支。双击不立即重刷随光标窗口，主动移到其他位置后才恢复。
7. 原生历史：先在目标文件远处停留并关闭，再从源文件跳入；侧键后退一次直达源位置，前进一次直达目标；已打开文件和同文件跳转同样成立。
8. 固定：引用独立固定、调用者与被调用者共享固定；浏览其他符号不重复查询或重绘固定引用，显式动作仍可执行，源修改允许标记过期，反复固定不累计状态行。
9. 源码宏：宏别名默认只返回该拼写的直接引用；定义名、数值宏、表达式宏和替换文本均能查询；只有显式按钮才切换到展开后函数。仅由编译参数 `-D` 注入的宏另查 049，核对识别、引用及已知导航边界，不能把源码宏通过外推为完整支持。
10. 字段：成员分类关闭时走原始完整结果路径；开启时保留同一变量、其他路径和无法确认三组，不隐藏不确定候选，也不批量打开候选文件。
11. 光标与编辑：空白不清空已有结果；慢速输入前三个字符和持续输入都不触发额外的光标自动语义查询；随后鼠标或方向键主动移动仍能恢复跟随。
12. 可见性与状态：隐藏或折叠窗口不触发其光标查询，独立查询包含/被包含方向；关闭关系图后重开工作区不能恢复它；未关闭的受支持会话状态按配置恢复。
13. 主题与布局：中文/英文、明暗主题、长行、多面板布局及文档符号中心指示正常；不要把主题颜色不同或显示“编辑器中心”当成语义查询失败。固定配色还需检查三种模式、类别覆盖/非法值回退、锁定时热更新不重置滚动和隐藏后应用新配置，详见[配色验收](code-preview-fixed-colors.zh-CN.md)。
14. 配置与交付：在对应 WSL/SSH 或多根环境核对配置写入位置；确认临时包、版本、提交和日志来自同一构建。发布按先主干 CI、后版本 Tag 的顺序执行，并下载正式附件验校验和。
15. 引用分组展开：所有非平铺分组都遵守 `cInsight.references.autoExpandGroups`，默认关闭；运行时切换不额外查询，平铺与手动全部展开/折叠不回归。

预览自身历史、C Insight 导航历史和 VS Code 原生后退/前进是不同系统，必须说明操作的是哪一套。隐藏 C Insight 窗口不要求 clangd 的后台索引完全停止；源码编辑也仍可能触发文档符号重绘、预览局部更新及语言引擎自身同步，不得把它们都当成光标语义查询泄漏。

## 7. 新问题登记模板与维护流程

新条目复制以下结构，编号取当前最大值加一；同一问题继续补证据而不是覆盖最初现象。首次登记不知道的内容写“未知/待确认”，不要编造。

```text
编号：CI-REG-NNN
标题：可搜索的现象描述
首次记录日期 / 来源：用户反馈、日志或可复现提交
环境 / 构建：引擎、VS Code、扩展版本或临时包、Remote、有效配置
性质：插件缺陷 / 外部引擎 / 配置 / 行为约定 / 已知限制
状态：待复现 / 已复现待定位 / 已定位待修复 / 修复待自动验证 / 待用户验收 / 用户已验收 / 已发布 / 已知限制
复现步骤：最小输入、入口、动作顺序、是否冷索引、可见/固定窗口
预期与实际：包括准确位置、次数、顺序或范围，不只写“正常/异常”
证据：脱敏日志、截图/录屏、请求计数、仓库测试或提交
定位：已确认根因；仍待验证的假设；已证伪方向
回归：自动测试路径与断言；必须人工验证的部分
本次执行：命令、日期、构建、实际结果；跳过与原因
验收与发布：用户确认及正式版本；未授权则保持未发布
关联：其他问题编号、相关模块及文档
```

维护顺序为：登记报告 → 最小复现 → 补失败断言或说明无法自动化 → 修复及相邻场景回归 → 临时包与重点测试 → 用户验收 → 按授权发布。外部原因或暂时无法复现时，保留条目和可执行的后续采证步骤，不以“没有结果”直接关闭。

新增条目后检查编号不重复、引用的测试文件真实存在、自动化覆盖表述不过度承诺，必要时把共性场景提升到第 6 节。将运行记录追加为带日期的证据，不篡改旧日志、旧 Release 或历史测量。收到纯功能咨询时可完善相关案例的解释，但不得虚构新缺陷或未经用户要求启动延期功能。

## 8. 相关依据

- [更新日志](../../CHANGELOG.md)：版本变化与历史修复线索，不以旧版本中间策略代替当前实现。
- [中文用户手册](../user/user-guide.zh-CN.md)：当前功能、配置和交互的判定依据。
- [开发者手册](../development/developer-guide.zh-CN.md)与[架构](../development/architecture.md)：模块所有权、取消、缓存及状态规则。
- [自绘树交互指导](../development/custom-result-trees.zh-CN.md)：分支与导航分离、面板布局和浏览器边界。
- [编辑器导航历史验证](editor-navigation-history.zh-CN.md)、[性能基线](performance-baseline.zh-CN.md)和[Microsoft 引擎验收](microsoft-engine-acceptance.zh-CN.md)：对应环境中的详细证据，不替代本次重测。
