# 编译参数宏的构造与查询验证

## 结论与范围

clangd 明确识别的编译参数宏可建立保留原始名称的调用者（Callers）根，通过该宏自身的引用（References）列出准确使用位置，包括 `#if`。自动刷新不依赖上下文（Context）可见；无源码定义的根位于所选使用处，宏展开函数的全部调用由显式命令查询。该修复已验收并纳入 `0.22.26`。定义跳转、自动代码预览选址和工作区符号索引仍有未解决项，见下方诊断记录。

问题记录为 [CI-REG-049](historical-issues.zh-CN.md#ci-reg-049)，关联源码宏的 031–033 及空符号保护 036。以下记录 clangd `20.1.2` 的基线、修复验证和复测方法；Microsoft C/C++ 与其他 clangd 版本待测。

当前测试工程另含[条件分支和函数式编译宏](#条件分支中的函数与编译宏展开函数)，用于比较宏值 `1`、`0` 时的函数调用者。原始两文件工程的条件宏有 2 处引用；加入 `conditional-calls.c` 后为 4 处，数值宏和函数别名宏仍为 5、1 处。

## 条件分支中的函数与编译宏展开函数

在 [conditional-calls.c](../../test/fixtures/command-line-macros/conditional-calls.c) 中构造两种情况：`#if CI_BUILD_FEATURE`、`#if !CI_BUILD_FEATURE` 中调用 `branch_target`；编译参数 `-DCI_BUILD_CALL(value)=compiler_macro_target(value)` 使 `CI_BUILD_CALL(5)` 调用 `compiler_macro_target`，另保留一次直接调用作为对照。构建脚本实际编译、链接、运行全部三个翻译单元。

从仓库根目录生成默认和禁用两套编译数据库：

```bash
node test/fixtures/command-line-macros/build.mjs
C_INSIGHT_MACRO_FEATURE=0 C_INSIGHT_MACRO_BUILD_DIR="$PWD/test/fixtures/command-line-macros/build-disabled" node test/fixtures/command-line-macros/build.mjs
```

两个目录均已忽略，不覆盖彼此。`C_INSIGHT_MACRO_FEATURE` 只接受 `0` 或 `1`，默认 `1`；`C_INSIGHT_MACRO_BUILD_DIR` 指定生成目录，默认当前测试工程的 `build`。这些是合成工程构建/测试脚本的环境变量，不是 C Insight 插件配置项。

`2026-10-21` 在 clangd `20.1.2` 上重新实测，以下均指 `conditional-calls.c` 的准确调用位置：

| 查询对象 | 宏值为 `1` | 宏值为 `0` |
| --- | --- | --- |
| 函数 `branch_target` 的调用者 | 第 14、25 行：`branch_target(1)`、`branch_target(4)` | 第 16、23 行：`branch_target(2)`、`branch_target(3)` |
| 函数 `compiler_macro_target` 的调用者 | 第 31 行的宏调用、第 36 行的直接调用 | 同左 |
| 宏 `CI_BUILD_CALL` 自身的调用者 | 仅第 31 行 `CI_BUILD_CALL(5)` | 同左 |
| 在该宏上执行“查询宏展开后函数的调用者” | 切换到 `compiler_macro_target`，显示第 31、36 行 | 同左 |

选择 `CI_BUILD_FEATURE` 时，调用者列出宏的使用位置（例如 `#if`）；选择 `branch_target` 时，查询该函数在当前生效分支中的调用。不同平台的分支分别通过各自编译配置分析。函数式 `-D` 宏保留宏自身范围，查询展开函数或点击显式按钮才显示函数的全部调用。

人工查看：用新 VS Code 窗口打开 `test/fixtures/command-line-macros` 文件夹，沿用下方设置中的 `compileCommandsDir: "build"`。在 `conditional-calls.c` 第 1 行点选 `branch_target` 并展开调用者，应看到第 14、25 行；第 6 行点选 `compiler_macro_target`，应看到第 31、36 行；第 31 行选择 `CI_BUILD_CALL`，默认只返回自身的一处使用。要看宏值为 `0` 的对照，把当前测试文件夹的 `cInsight.compileCommandsDir` 改为 `build-disabled` 后执行“C Insight：重启 clangd”，再检查第 16、23 行；完成后改回 `build` 并重启。

原始协议与隔离扩展宿主均有两套执行入口，在仓库根目录运行：

```bash
npm run probe:command-line-macros
C_INSIGHT_MACRO_FEATURE=0 C_INSIGHT_MACRO_BUILD_DIR="$PWD/test/fixtures/command-line-macros/build-disabled" npm run probe:command-line-macros

C_INSIGHT_VSCODE_EXECUTABLE_PATH=/path/to/test-vscode/code npm run test:e2e:command-line-macros
C_INSIGHT_MACRO_FEATURE=0 C_INSIGHT_MACRO_BUILD_DIR="$PWD/test/fixtures/command-line-macros/build-disabled" C_INSIGHT_VSCODE_EXECUTABLE_PATH=/path/to/test-vscode/code npm run test:e2e:command-line-macros
```

探针报告保存在各自生成目录的 `clangd-probe.json`、`c-insight-probe.json`。原始协议断言精确传入范围；[函数调用者宿主检查](../../test/e2e/suite/commandLineMacroFunctionCalls.ts)对比真实提供程序与树快照，核对名称、文件、行号、禁用分支排除和函数式宏默认/展开范围。默认配置还执行宏引用、宏别名与自动刷新回归；宏值为 `0` 的宿主执行函数调用者对照。物理鼠标、原生布局和真实业务工程按相同场景人工复核。

`2026-10-21` 执行结果：GCC `13.3.0` 两种宏值的编译、链接、运行和去除 `-D` 的负对照均通过；两套原始协议探测、VS Code `1.130.0` 隔离扩展宿主专项及 `npm run check` 通过。测试宿主曾受沙箱启动限制，改用获准的环境后通过。CI 配置已加入禁用分支专项；该轮仅修改测试、文档及 CI 接线。

## 0.22.26 修复与验收

沿用下述同一最小工程、clangd `20.1.2` 和 VS Code `1.130.0`：调用者根应分别显示 `CI_BUILD_FEATURE`、`CI_BUILD_NUMBER`、`CI_BUILD_TRACE`，首层分别有 2、5、1 个准确使用位置。两个源码文件的条件宏引用均保留；根本身锚定当前使用，因此根与某个子结果指向同一位置是预期，不表示重复调用边。`CI_BUILD_TRACE` 只有显式执行查询宏展开后函数的调用者，才切换为 `trace_value` 的三处函数调用。源码宏 `SOURCE_TRACE` 仍只列出自身一处使用。

宏身份优先读取已有定义结果中的源码证据，缺失时仅在 clangd 模式按需共享一次悬停，要求同名宏标题及定义展示同时匹配；不遍历编译数据库，不在准备根时查询全部引用。普通同名函数不新增隐藏上下文的悬停请求。所有导航隐藏时没有新查询；仅代码预览可见而基础证据为空时，可为标识符做一次悬停补查，但不查调用根或引用。调用者展开沿用已打开文档的函数映射，未打开候选保持准确位置，不批量打开文档。合成宏根不请求传出统计。

人工回归重点：在测试工程中关闭固定并隐藏上下文，离开后重新点击第 12 行条件宏、第 13 行数值宏和函数别名宏；调用者应自动更新且位置准确。再展开上下文重复，检查单击预览/双击导航、手动刷新及显式展开函数按钮。空白和慢速输入应保留旧结果，不触发额外查询。

`2026-10-20` 执行结果：`npm run check`、主 clangd 扩展宿主回归及编译宏专项通过；按非文件隔离计数为 299 项测试、71 个套件，全部通过。专项核对调用者子结果总数、全部位置及六种控制器场景，含全隐藏零查询。主回归覆盖源码宏、普通函数快速路径、悬停失败/取消、未打开文件与编辑/导航/预览行为。

同日用户验收 `c-insight-0.22.25-command-line-macro-callers-preview.vsix`，随后授权纳入 `0.22.26` 发布；未提供逐项人工结果。数值宏 `CI_BUILD_NUMBER` 的无关定义、条件宏的空定义及函数别名的展开目标，分别按下节诊断。

### 代码预览位置反馈：诊断中，未修复

`2026-10-20` 用户补充几个宏的代码预览位置不正确，尚未给出每个宏的实际预览文件/行号。重新运行原始协议探针后，clangd `20.1.2` 的结果与基线相同；当前代码的自动预览路径仍优先采用定义、声明，全部为空时才使用调用根位置。此前调用者修复只为调用者树统一宏使用锚点，并未将自动预览切到该锚点：

| 符号 | 重新探测的定义结果 | 当前预览路径的解释 |
| --- | --- | --- |
| `CI_BUILD_NUMBER` | 无关函数 `trace_value`，`main.c:5` | 若实际预览落在该处，可由同一个引擎错误结果被采用解释 |
| `CI_BUILD_TRACE` | 宏展开后的 `trace_value` 函数 | 是展开目标，不是宏自身定义；和数值宏的无关目标应分开处理 |
| `CI_BUILD_FEATURE` | 空 | 有合成调用根时回退当前使用锚点，按声明回退展示 |

上述结论来自原始协议复测和代码路径分析，真实预览 UI 待核对。请记录点选宏后的预览标题、文件和行号，并区分仅悬停、移动编辑器光标、锁定及显式结果预览；自动跟随由编辑器选区变化触发。

## 最小工程

工程位于 [test/fixtures/command-line-macros](../../test/fixtures/command-line-macros)，原始场景包含 [main.c](../../test/fixtures/command-line-macros/main.c)、[other.c](../../test/fixtures/command-line-macros/other.c) 和 [build.mjs](../../test/fixtures/command-line-macros/build.mjs)，当前另含上节的 `conditional-calls.c`。原始三个宏只从编译命令传入，源码中没有它们的 `#define`：

```text
-DCI_BUILD_FEATURE=1
-DCI_BUILD_NUMBER=7
-DCI_BUILD_TRACE=trace_value
```

`CI_BUILD_FEATURE` 控制两个文件中的条件分支，`CI_BUILD_NUMBER` 参与数值表达式，`CI_BUILD_TRACE` 展开成函数名。源码另有 `#define SOURCE_TRACE trace_value`，并保留直接调用 `trace_value`，用于区分“编译宏”“源码宏”和“实际函数”的结果范围。构建后的程序检查两个文件使用的值、条件分支及三条调用路径，正确时退出码为 0。

## 构建与手工查看

在 C Insight 仓库根目录运行：

```bash
node test/fixtures/command-line-macros/build.mjs
```

脚本使用已有 `cc`，实际编译、链接并运行程序，同时把同一组编译参数写入子工程的 `build/compile_commands.json`，当前覆盖三个翻译单元。如需选择编译器，可设置 `CC` 为一个编译器可执行文件名或路径，不支持把额外参数混在 `CC` 字符串里。不需要安装 CMake，也不会修改其他工程。生成的数据库、目标文件、可执行文件和探测结果均被子工程 `.gitignore` 排除。

然后在一个新 VS Code 窗口中打开 `test/fixtures/command-line-macros` 文件夹，而不是仓库根目录。在这个测试文件夹的 `.vscode/settings.json` 中合并：

```json
{
  "cInsight.engine": "clangd",
  "cInsight.clangd.path": "clangd-20",
  "cInsight.compileCommandsDir": "build",
  "cInsight.references.groupBy": "flat"
}
```

`build` 相对于当前打开的测试文件夹解析。若 clangd 20 的可执行文件名不同，请填写实际名字或路径；修改引擎后重新加载窗口。按现有冲突处理说明停用竞争分析提供程序，不要为本场景修改实际业务工程的全局配置。

打开 `main.c` 和 `other.c`，分别在 `CI_BUILD_NUMBER`、`CI_BUILD_FEATURE`、`CI_BUILD_TRACE` 的使用处悬停，执行查找引用、显示传入调用和转到定义；再与 `SOURCE_TRACE` 及直接的 `trace_value` 比较。编译宏来自 `-D`，源码中没有对应的 `#define`。

## 基线 0.22.25 实测结果（修复前）

`2026-10-18` 的原始协议及显式查询结果如下，当时尚无编译宏调用者修复：

| 查询符号 | 悬停 | 引用栏中的准确位置 | 定义查询 | 调用者 | 工作区符号搜索 |
| --- | --- | --- | --- | --- | --- |
| `CI_BUILD_NUMBER` | 显示宏和值 `7` | 5 处：`main.c` 4 处、`other.c` 1 处 | 此 clangd 构建错误返回 `main.c` 中 `trace_value` 的定义 | 无根、无调用点 | 0 项 |
| `CI_BUILD_FEATURE` | 显示宏和值 `1` | 2 处：两个文件的 `#if` 各 1 处 | 无结果 | 无根、无调用点 | 0 项 |
| `CI_BUILD_TRACE` | 显示宏展开为 `trace_value` | 仅该拼写的 1 处使用 | 返回展开后函数的定义，不是 `-D` 的配置位置 | 根为 `trace_value`，列出编译宏、源码宏和直接函数的 3 处调用，不保持宏自身范围 | 0 项 |
| `SOURCE_TRACE`（源码对照） | 显示源码宏 | 定义及直接使用各 1 处 | 正确返回源码 `#define` | 根为 `SOURCE_TRACE`，只列出它自己的 1 处使用 | 1 项 |
| `trace_value`（函数对照） | 显示函数 | 定义和三条调用路径 | 正确返回函数定义 | 3 处调用 | 1 项 |

引用结果受 `includeDeclarationInReferences` 设置影响；表中使用当前默认包含声明的设置。自动宿主验证将分组设为平铺，便于直接比较完整位置。悬停中的 `#define CI_BUILD_NUMBER 7` 是引擎生成的宏展示文本。

## 修复前已确认与尚未确认的原因

- 编译与运行通过，悬停展示正确值，说明编译数据库和 `-D` 已生效；不是本次配置遗漏。
- 数值宏的无关定义由原始 clangd `textDocument/definition` 返回，公共提供程序与 C Insight 直连定义结果一致，排除了预览和点击坐标假设；clangd 内部原因仍未查明。
- 基线实现通过可读取源码中的同名 `#define` 确认宏身份。命令行宏缺少这项证据，因而数值/条件宏无法合成宏根，函数别名宏保留了引擎原始函数根。
- 工作区符号搜索使用引擎索引，本环境没有收录这三个编译宏；悬停识别与引用查询正常。

## 自动复现入口

### 2026-10-19：自动刷新与手动刷新的差异

用户补充：`main.c` 的 `#if CI_BUILD_FEATURE` 不自动刷新，手动刷新后只有引用有结果；下一行数值宏可自动刷新，但调用者仍为空。原先测试关闭了 `followCursor`，因此追加自动跟随诊断。

新增[控制器诊断](../../test/e2e/suite/commandLineMacroAutoRefresh.ts)在真实 VS Code 宿主中调用同一 clangd 公共提供程序获取定义、声明、悬停、调用根和引用，执行实际 `ContextController` 的自动基础/详情路径，以受控 `ViewRegistry` 可见性捕获是否发布。表中引用和调用者窗口均设为可见，未模拟固定或编辑门控：

| 场景 | 上下文可见 | 自动路径是否发布新结果 | 最终引用 | 调用根 |
| --- | --- | --- | --- | --- |
| `CI_BUILD_FEATURE` 自动路径 | 否 | 否，详情引用请求也未发出 | 0 次新查询，不表示没有引用 | 0 |
| `CI_BUILD_NUMBER` 自动路径 | 否 | 是 | 5 | 0 |
| `CI_BUILD_FEATURE` 自动路径 | 是 | 是 | 2 | 0 |
| `CI_BUILD_FEATURE` 工具栏同入口手动刷新 | 否 | 是 | 2 | 0 |

原因分开记录：

1. `navigationDemand.ts` 在上下文隐藏时省略悬停和符号信息。条件宏的定义、声明和调用根均为空，`hasCursorSymbolEvidence` 因此得到假值；`shouldPreserveResultsForEmptyCursor` 在自动路径中保留旧内容并提前返回，引用详情没有机会执行。这是按需查询与“无符号不刷新”保护相互作用产生的假阴性，不是编译宏未生效，也不是硬编码跳过所有 `#if` 行。
2. 数值宏收到前文已确认的无关函数定义，因此通过基础证据门控，但仍缺少宏调用者根。
3. 上下文可见时，宏悬停提供符号证据，因而可以进入引用详情。测试适配器将 clangd 专用 `symbolInfo` 标记为不可用，保留控制器对该项的正常请求路径。
4. 手动场景调用和工具栏相同的 `controller.refresh(true)`，不是用另一种显式查询替代。它带有人工更新意图，绕过空符号保护，能查询引用；但没有宏根，所以调用者仍为空。这与此前宏身份依赖源码 `#define` 的边界是两个问题。

用户随后确认现场上下文已折叠或隐藏，展开后第 12 行能自动刷新，与控制器诊断一致。修复后的测试要求上下文隐藏/可见时都产生引用与宏调用根，并检查仅代码预览可见及全部导航隐藏两种情况。

修复前诊断的四种控制器场景和 `npm run check` 通过。宿主退出码为 0；结束阶段曾出现一次输出流写入告警。

### 执行命令

原始协议探测，不加载 VS Code：

```bash
npm run probe:command-line-macros
```

真正加载 C Insight，执行定义、引用树、调用者树和符号搜索的隔离扩展宿主测试：

```bash
C_INSIGHT_VSCODE_EXECUTABLE_PATH=/path/to/test-vscode/code npm run test:e2e:command-line-macros
```

后者复用现有隔离启动器，缺省使用测试 VS Code `1.130.0`，也可由环境变量指定已有测试程序。源码目录与编译库路径仅传给本机测试进程，不上传源码。生成的 `build/clangd-probe.json` 和 `build/c-insight-probe.json` 只保存本公开合成场景的文件名、位置和结果，不包含个人目录。

编译集成测试另外移除全部 `-D` 执行负对照，确认相同源码无法正常编译；其构建输出位于独立临时目录，测试后删除。扩展宿主的正向断言核对宏悬停、全部准确引用、公共提供程序与 C Insight 定义映射一致；本地修复后还核对编译宏完整调用者、显式展开函数的独立范围及源码宏对照。定义和搜索限制仍是观测数据，不要求未来继续返回错误目标。六种受控可见性路径检查悬停共享、仅预览不查关系及全部隐藏零查询；完整原生输入和布局仍需人工补测。

`2026-10-18` 基线执行：编译、链接与运行、移除 `-D` 的编译负对照、原始协议探测、显式查询的隔离扩展宿主测试及 `npm run check` 通过；按非文件隔离计数为 296 项测试、71 个套件。
