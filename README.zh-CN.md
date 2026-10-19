# C Insight

[![CI](https://github.com/H9elix/c-insight/actions/workflows/ci.yml/badge.svg)](https://github.com/H9elix/c-insight/actions/workflows/ci.yml) [![最新版本](https://img.shields.io/github/v/release/H9elix/c-insight)](https://github.com/H9elix/c-insight/releases/latest) [![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

C Insight 是一款在 VS Code 中提供 Source Insight 风格 C/C++ 源码浏览体验的扩展。它把定义、源码预览、引用、调用者、被调用者、符号和工程关系持续显示在一起，让你在分析代码时不必反复替换主编辑器中的文件和位置。

**[Read the English README](README.md)** · [中文用户手册](docs/user/user-guide.zh-CN.md) · [English user guide](docs/user/user-guide.en.md) · [最新版本](https://github.com/H9elix/c-insight/releases/latest)

C Insight 默认把语义分析委托给自身管理的 `clangd` 进程，也可以在明确选择后使用已安装的 Microsoft C/C++ language service (cpptools)。它是源码导航和可视化层，不负责代替编译器、构建系统，也不会替你生成 `compile_commands.json`。

`0.22.26` 修复 clangd 编译参数宏的调用者：数值宏、条件宏和函数别名宏保留自身准确使用位置，包括 `#if`；上下文隐藏时也能自动刷新，只有显式操作才切换为展开后函数的调用者。本次不修复引擎返回的编译宏定义/代码预览位置。详见[发布说明](docs/releases/v0.22.26.md)及[验证与已知边界](docs/validation/command-line-macros.zh-CN.md)。此前的固定深浅预览配色仍可使用，[默认颜色及 settings.json 示例](docs/user/user-guide.zh-CN.md#code-preview-default-colors)见用户手册。

![文档符号、上下文、代码预览、调用者和引用同时可见的 C Insight 工作区](.github/readme-assets/overview.png)

## 为什么使用 C Insight？

`0.22.24` 修复了从代码预览、调用者等结果打开源码后，编辑器后退/前进多停留一次的问题：新的跳转不再把文件临时恢复的旧位置加入历史，也不会清空原有记录。更新内容见[发布说明](docs/releases/v0.22.24.md)。

从 `0.22.22` 起，结果窗口使用统一自绘树：单击预览，双击跳转编辑器并保持树状态，左侧箭头独立控制展开/折叠。调用者、被调用者及其他结果窗口采用相同交互。更新内容见[发布说明](docs/releases/v0.22.22.md)，范围与维护边界见[自绘结果树说明](docs/development/custom-result-trees.zh-CN.md)。

VS Code 已经提供“转到定义”和“查找所有引用”等命令。C Insight 把这些一次性查询组织成持续可见的源码浏览工作区：主编辑器可以保留你正在阅读的代码，相关定义、准确调用位置、引用和源码片段则显示在专用窗口中。

| 阅读代码时的需求 | C Insight 持续提供的内容 |
| --- | --- |
| 查看符号但不想丢失当前编辑位置 | 带语义着色并优先显示定义的共享代码预览 |
| 理解符号在哪里以及如何被使用 | 可分类、分组、搜索和分页的引用 |
| 跟踪控制流 | 保留准确调用位置的调用者与被调用者树 |
| 查看代码结构 | 文档符号、工作区符号搜索、类型层次和包含层次 |
| 查看超出单棵树的关系 | 调用、类型和文件关系图 |
| 回到先前的分析过程 | 预览历史、导航历史、书签、固定状态和工作区会话恢复 |

## 核心工作流程

### 不离开当前位置也能查看代码

主动把编辑器光标移动到 C/C++ 符号上，上下文和代码预览会自动更新；引用以及第一层调用详情会等光标稳定后再查询。光标在同一标识符内部移动、输入文字或者移到没有符号的位置时，不会反复丢弃或重新查询当前分析结果。

单击普通源码结果会在代码预览中显示其准确位置；在配置的双击间隔内再次激活同一结果，则会在编辑器中打开。代码预览会在显示前准备目标上下文，并在接近已加载边界时提前加载，使第一次滚动立即生效。显式选择、滚轮或指针交互会在迟到的上下文详情和定义升级期间保持稳定，直到你主动移动编辑器光标或执行显式刷新。

![从编辑器符号经过代码预览查看定义、引用和准确源码位置](.github/readme-assets/core-navigation.gif)

### 查看每一个调用位置

调用者和被调用者会把语义父节点返回的每个调用位置直接显示出来。同一函数中的重复调用仍然是各自可导航的结果，只有同一语义关系中最早的调用位置负责展开下一层。选择某个调用位置时，代码预览显示的是实际调用行，而不只是调用者函数的定义。

当选中的源码拼写是一个会展开为函数的宏时，调用者会保留宏本身的身份，只列出这个宏的准确使用位置，不会静默切换为展开后函数的全部调用者；光标位于宏使用处或 `#define` 定义名上时均可获得该结果。需要查询展开目标时，可点击调用者标题栏中的**查询宏展开后函数的调用者（Show Expanded Function Callers）**按钮，或在宏根节点的右键菜单中执行同一命令；从定义处执行时，只在此刻通过实际使用位置按需解析展开目标。

`0.22.23` 还补齐了没有可调用根节点的数值宏、表达式宏及其他宏替换文本中的引用。未打开文件里的宏引用会保留准确可导航位置，不会为了查找所属函数而批量加载 AST；单个文件的符号查询失败也不会再中断整个宏查询。更新内容见[发布说明](docs/releases/v0.22.23.md)。

![选择不同调用者结果并预览每一个准确调用位置](.github/readme-assets/call-hierarchy.gif)

### 使用关系图浏览工程

可以为函数打开调用图，为 C++ 类或结构体打开类型图，也可以为活动源码或头文件打开文件图。关系图支持按需展开、搜索已加载节点、预览选中结果、折叠分支、添加书签，以及导出 Text、JSON 或 Mermaid。

![打开并展开交互式调用关系图](.github/readme-assets/relationship-graph.gif)

## 包含哪些功能？

| 功能区域 | 主要能力 |
| --- | --- |
| 上下文和代码预览 | 符号身份、签名、定义/声明证据、语义源码着色、缓冲式增量滚动、异步更新稳定性、前进/后退、锁定、复制和编辑器导航 |
| 引用浏览器 | 定义/声明/调用/读取/写入/地址分类，文件/目录/函数/类型分组，范围和证据筛选，延迟源码片段、分页、固定和导出 |
| 调用层次 | 准确传入/传出调用位置、懒加载多层展开、递归处理、已加载树搜索、有界路径搜索、固定、会话恢复和导出 |
| 类型和包含层次 | C++ 父类型/子类型以及正向包含文件/反向被包含关系，并提供懒加载展开、循环处理、搜索、限制和导出 |
| 符号和导航 | 带编辑器中心高亮的文档符号、搜索框常驻的工作区符号搜索、导航历史、分组书签和失效位置重定位 |
| 工程感知 | 编译数据库检测和选择、活动编译命令拆分、诊断、clangd 生命周期和恢复、索引进度、运行时计数器和统一可靠性状态 |

详细行为、全部命令以及完整配置表位于[中文用户手册](docs/user/user-guide.zh-CN.md)和 [English user guide](docs/user/user-guide.en.md)。

## 快速开始

### 1. 安装

从[最新 GitHub Release](https://github.com/H9elix/c-insight/releases/latest) 下载 `c-insight-<version>.vsix` 和 `SHA256SUMS`，校验后在 VS Code 中运行 **扩展：从 VSIX 安装...**。

### 2. 选择分析引擎

| 引擎 | 定位 | 建议 |
| --- | --- | --- |
| 托管 clangd | 默认引擎，使用完整的 C Insight 协议路径 | 推荐；完整调用层次建议使用 clangd 20 或更高版本 |
| Microsoft C/C++ language service (cpptools) | 通过 `cInsight.engine` 明确选择后启用 | 适合已经依赖 cpptools 的工程；性能和可用证据可能与 clangd 不同 |

修改 `cInsight.engine` 后需要执行 **开发人员：重新加载窗口**。C Insight 会在更改工作区范围配置前报告已知的活动语义提供程序冲突。

### 3. 提供真实工程配置

真实工程强烈建议提供 `compile_commands.json`。使用 CMake 时可以运行：

```sh
cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
```

C Insight 会搜索工作区根目录和常见构建目录，也可以执行 **C Insight：选择编译数据库**。交叉编译器、sysroot、生成头文件、平台宏和多平台构建目录仍然必须由真实构建配置描述，具体方法见[交叉编译指南](docs/user/cross-compilation.zh-CN.md)。

### 4. 开始浏览

1. 打开 C/C++ 文件夹或工作区，在活动栏中选择 C Insight 图标。
2. 把光标放在函数、变量、类型、成员或宏上。
3. 展开引用、调用者或被调用者，也可以从编辑器右键菜单执行相应命令。
4. 单击结果进行预览，双击同一结果则在编辑器中打开。

## 交互规则

- **单击：**在不移动编辑器的情况下预览准确源码位置。
- **双击：**在编辑器中打开同一结果。
- **打开位置：**跳过预览步骤，立即在编辑器中打开。
- **固定上下文或引用：**阻止对应窗口被光标自动替换；显式命令仍然可以替换结果。
- **固定调用层次：**调用者和被调用者各自显示按钮，但共享同一个同步固定状态。
- **锁定代码预览：**阻止编辑器光标跟随，同时保留预览内部的显式浏览能力。
- **输入文字或移到空白位置：**保留现有导航结果，不发起或发布空的自动查询。

层次展开采用懒加载并受安全上限约束。每个方向拥有独立的深度和节点预算，取消操作会保留已经加载的节点。隐藏的导航窗口不会仅因为编辑器光标移动就查询与其相关的语义详情。

## 工程状态与可靠性

工程诊断显示所选引擎、检测到的编译数据库、活动源文件编译命令、包含路径、宏定义、诊断、索引状态和运行时性能计数器。底部状态栏是全局可靠性信息的唯一位置；选择它可以查看工程证据缺失、提供程序冲突、索引进度或引擎可用性。

托管 clangd 意外退出时，C Insight 会进行有界自动恢复，并在重复崩溃时停止重启循环。发生相关源码编辑、引擎重启、配置变化或新一轮索引时，现有结果会继续保留并标记为已过期。

## 隐私与资源占用

- C Insight 不包含遥测，也不会上传源代码。
- 源文件和工程元数据只在本地用于导航、预览、诊断、导出和会话恢复。
- 语义工作按需执行；在提供程序允许时可以取消，并受到结果数、深度、节点、缓存和导出上限约束。
- 同时启用多个 C/C++ 语义扩展可能产生重复索引或重复导航提供程序；C Insight 会报告已知冲突，并尽可能只修改工作区范围的设置。

数据边界见 [PRIVACY.md](PRIVACY.md)，漏洞报告方法见 [SECURITY.md](SECURITY.md)。

## 运行要求与能力边界

- VS Code 1.95 或更高版本。
- `PATH` 中存在 clangd 20 或更高版本，也可以通过 `cInsight.clangd.path` 配置，或者明确选择 Microsoft C/C++ language service。
- 真实工程需要正确的编译数据库或等价的回退参数，才能得到可靠结果。
- 当前版本支持一个本地工作区根目录。
- 静态分析无法完整解析所有函数指针、运行时分派目标、宏展开、生成源码、模板实例化或未激活条件编译分支。
- 当所选提供程序没有暴露足够的语义证据时，引用读写和成员实例分类会保持保守判断。

## 文档

- [English README](README.md)
- [中文用户手册](docs/user/user-guide.zh-CN.md)
- [English user guide](docs/user/user-guide.en.md)
- [交叉编译与嵌入式工程配置](docs/user/cross-compilation.zh-CN.md)
- [Cross-compilation and embedded projects](docs/user/cross-compilation.en.md)
- [中文开发者手册](docs/development/developer-guide.zh-CN.md)
- [架构说明](docs/development/architecture.md)
- [历史问题驱动测试指南与回归案例](docs/validation/regression-testing-guide.zh-CN.md)
- [文档索引](docs/README.md)
- [版本化发布说明](docs/releases/)

## 开发与维护

```sh
npm ci
npm run check
npm run test:e2e:xvfb
```

在 VS Code 中打开本仓库并运行 `Run C Insight` 启动配置，即可使用 `test/fixtures/basic-cpp` 启动扩展开发宿主。贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

- 开发者和维护者：`H9elix`
- 许可证：MIT
- 源码和问题：[github.com/H9elix/c-insight](https://github.com/H9elix/c-insight)
- 查看已安装版本：运行 **C Insight：关于**
