# 编译参数宏的构造与查询验证

## 结论与范围

`2026-10-18` 使用 C Insight `0.22.25` 的运行实现、隔离 VS Code `1.130.0`、Ubuntu clangd `20.1.2` 和 GCC `13.3.0` 实测：编译参数注入的宏能被正确识别，引用（References）能精确列出跨文件使用；但定义跳转、保留宏身份的调用者（Callers）和工作区符号搜索并非全部可用。原始 clangd 协议与 C Insight 分别验证，不用“引擎识别了值”代替“所有导航功能正常”。本次未测试 Microsoft C/C++ 或其他 clangd 版本。

这是一项测试和限制确认，记录为 [CI-REG-049](historical-issues.zh-CN.md#ci-reg-049)，关联源码宏的 031–033。没有修改插件运行逻辑，没有修复或发布新版本；也不把异常的定义位置冻结成未来必须维持的行为。

## 最小工程

工程位于 [test/fixtures/command-line-macros](../../test/fixtures/command-line-macros)，包含 [main.c](../../test/fixtures/command-line-macros/main.c)、[other.c](../../test/fixtures/command-line-macros/other.c) 和 [build.mjs](../../test/fixtures/command-line-macros/build.mjs)。三个宏只从编译命令传入，源码中没有它们的 `#define`：

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

脚本使用已有 `cc`，实际编译、链接并运行程序，同时把同一组编译参数写入子工程的 `build/compile_commands.json`。如需选择编译器，可设置 `CC` 为一个编译器可执行文件名或路径，不支持把额外参数混在 `CC` 字符串里。不需要安装 CMake，也不会修改其他工程。生成的数据库、目标文件、可执行文件和探测结果均被子工程 `.gitignore` 排除。

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

打开两个 `.c` 文件，分别在 `CI_BUILD_NUMBER`、`CI_BUILD_FEATURE`、`CI_BUILD_TRACE` 的使用处悬停，执行查找引用、显示传入调用和转到定义；再与 `SOURCE_TRACE` 及直接的 `trace_value` 比较。源码没有编译宏的 `#define`，因此不存在一个可供点击的源码定义入口；不要把头文件搜索路径问题与这一点混为一谈。

## 实测结果

| 查询符号 | 悬停 | 引用栏中的准确位置 | 定义查询 | 调用者 | 工作区符号搜索 |
| --- | --- | --- | --- | --- | --- |
| `CI_BUILD_NUMBER` | 显示宏和值 `7` | 5 处：`main.c` 4 处、`other.c` 1 处 | 此 clangd 构建错误返回 `main.c` 中 `trace_value` 的定义 | 无根、无调用点 | 0 项 |
| `CI_BUILD_FEATURE` | 显示宏和值 `1` | 2 处：两个文件的 `#if` 各 1 处 | 无结果 | 无根、无调用点 | 0 项 |
| `CI_BUILD_TRACE` | 显示宏展开为 `trace_value` | 仅该拼写的 1 处使用 | 返回展开后函数的定义，不是 `-D` 的配置位置 | 根为 `trace_value`，列出编译宏、源码宏和直接函数的 3 处调用，不保持宏自身范围 | 0 项 |
| `SOURCE_TRACE`（源码对照） | 显示源码宏 | 定义及直接使用各 1 处 | 正确返回源码 `#define` | 根为 `SOURCE_TRACE`，只列出它自己的 1 处使用 | 1 项 |
| `trace_value`（函数对照） | 显示函数 | 定义和三条调用路径 | 正确返回函数定义 | 3 处调用 | 1 项 |

引用结果受 `includeDeclarationInReferences` 设置影响；表中使用当前默认包含声明的设置。自动宿主验证将分组设为平铺，便于直接比较完整位置。悬停中的 `#define CI_BUILD_NUMBER 7` 是引擎生成的展示内容，不意味着源码中真的有这一行。

## 已确认与尚未确认的原因

- 编译与运行通过，悬停展示正确值，说明编译数据库和 `-D` 已生效；不是本次配置遗漏。
- 数值宏的无关定义位置由原始 clangd `textDocument/definition` 已经返回，VS Code 公共提供程序和 C Insight 直连定义命令结果一致，不能归因于预览或点击坐标。clangd 内部为何返回该目标尚未查明，不能外推为所有版本都如此。
- C Insight 目前通过可读取源码中的同名 `#define` 确认宏调用者身份。命令行宏没有这样的源码定义证据，因而数值/条件宏无法合成宏根，函数别名宏保留了引擎原始函数根。这是本次查明的插件覆盖边界，不能说它已支持所有编译宏的精确调用者。
- 工作区符号搜索是引擎索引查询，不是全文搜索。本环境没有把三个编译宏作为可定位的工作区符号返回；不能据此声称引擎没有识别宏或引用失效。

## 自动复现入口

### 2026-10-19：自动刷新与手动刷新的差异

用户补充：`main.c` 的 `#if CI_BUILD_FEATURE` 不自动刷新，手动刷新后只有引用有结果；下一行数值宏可自动刷新，但调用者仍为空。原先场景关闭了 `followCursor`，只测显式查询，因此不能把旧通过记录当作自动跟随也已通过。

新增[控制器诊断](../../test/e2e/suite/commandLineMacroAutoRefresh.ts)在真实 VS Code 宿主中调用同一 clangd 公共提供程序获取定义、声明、悬停、调用根和引用，执行实际 `ContextController` 的自动基础/详情路径，以受控 `ViewRegistry` 可见性捕获是否发布。表中引用和调用者窗口均设为可见，未模拟固定或编辑门控：

| 场景 | 上下文可见 | 自动路径是否发布新结果 | 最终引用 | 调用根 |
| --- | --- | --- | --- | --- |
| `CI_BUILD_FEATURE` 自动路径 | 否 | 否，详情引用请求也未发出 | 0 次新查询，不表示没有引用 | 0 |
| `CI_BUILD_NUMBER` 自动路径 | 否 | 是 | 5 | 0 |
| `CI_BUILD_FEATURE` 自动路径 | 是 | 是 | 2 | 0 |
| `CI_BUILD_FEATURE` 工具栏同入口手动刷新 | 否 | 是 | 2 | 0 |

原因分开记录：

1. `navigationDemand.ts` 在上下文隐藏时省略悬停和符号信息。条件宏的定义、声明和调用根均为空，`hasCursorSymbolEvidence` 因此得到假值；`shouldPreserveResultsForEmptyCursor` 在自动路径中保留旧内容并提前返回，引用详情没有机会执行。这是按需查询与“无符号不刷新”保护相互作用产生的假阴性，不是编译宏未生效，也不是硬编码跳过所有 `#if` 行。
2. 数值宏恰好收到前文已确认的无关函数定义位置，因此通过基础证据门控。它能刷新不代表定义正确，也不代表已经建立宏调用者根。
3. 上下文可见时，宏悬停足以提供符号证据，因而可以进入引用详情。测试适配器不提供 clangd 专用 `symbolInfo`，显式返回不可用；真实控制器仍会按原规则请求该项。此项证明现有悬停已经足以改变门控结果，不把适配器当作完整生产分析服务。
4. 手动场景调用和工具栏相同的 `controller.refresh(true)`，不是用另一种显式查询替代。它带有人工更新意图，绕过空符号保护，能查询引用；但没有宏根，所以调用者仍为空。这与此前宏身份依赖源码 `#define` 的边界是两个问题。

这次复现的是控制器路径与受控可见性，不是物理鼠标或真实布局事件的完整端到端测试。用户随后确认出现问题时上下文窗口已折叠或隐藏，与复现条件一致。还需在实际窗口中比较上下文展开后、关闭固定、离开后重新点选两行的结果；若上下文已可见仍不能刷新，应继续收集有效设置与实际请求，而非强行套用此条件。确认现象不等于验收修复，本次未修改运行行为，问题仍未修复。

本轮检查：含上述四种控制器诊断的独立扩展宿主断言通过，`npm run check` 再次通过。测试结束阶段一次输出流写入告警发生在断言和结果报告完成之后，宿主退出码为 0；它不作为本次宏刷新失败的证据，也未在本轮修改其运行实现。

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

编译集成测试另外移除全部 `-D` 执行负对照，确认相同源码无法正常编译；其构建输出位于独立临时目录，测试后删除。扩展宿主的正向断言核对宏悬停、全部准确引用、公共提供程序与 C Insight 定义映射一致，以及源码宏的单一调用者范围。它成功退出表示这些断言及采证完成，不表示表中的定义/调用者限制已修复。异常结果保留为观测数据，而不是强制必须返回错误目标的断言。

本次实际执行：编译、链接与运行、移除 `-D` 的编译负对照、原始协议探测，以及带上述断言的隔离扩展宿主测试均完成。`npm run check` 通过；禁用文件隔离计数时，296 项测试、71 个套件全部通过，无失败、取消或跳过；默认测试命令按 71 个测试文件汇总。文档、本地化与生产构建检查同样通过。Microsoft、不同版本 clangd、真实工程及物理 UI 点击仍未覆盖，不作通过声明。本次仅本地提交测试与文档，不打包、不推送、不发布。
