# C Insight 文档索引

本文档集对应 C Insight `0.22.25`，包含统一自绘结果树的操作、布局和维护说明；正式发布记录以 `releases/` 和更新日志为准。文档按用途分为以下五类；源码、Issue 与发布包位于 [GitHub 仓库](https://github.com/H9elix/c-insight)。项目的简明介绍、核心工作流和快速开始见 [English README](../README.md) 或[简体中文 README](../README.zh-CN.md)。

`0.22.23` 包含已完成临时包验收的宏调用者维护修复：补齐无函数调用根的宏及跨文件引用，默认仍只查询宏自身的直接引用，手动操作才切换到展开后的函数。

`0.22.24` 包含已完成临时包验收的编辑器导航历史修复：源码打开与目标定位合并为同一次操作，鼠标侧键或原生后退/前进不再停留于文件临时恢复的旧光标位置；既有合法历史保持不变。

`0.22.25` 增加已验收的固定深浅预览配色、独立类别颜色覆盖和纯样式热更新；中英文用户手册列出全部默认颜色及 `settings.json` 示例。历史问题测试指导与案例库同步纳入维护。

## 用户文档 `user/`

- [中文用户手册](user/user-guide.zh-CN.md)：完整中文使用手册、窗口逻辑、命令和配置参考。
- [English user guide](user/user-guide.en.md)：英文使用说明。
- [交叉编译与嵌入式工程配置](user/cross-compilation.zh-CN.md)：中文的交叉工具链、编译数据库、sysroot 和双引擎配置说明。
- [Cross-compilation and embedded projects](user/cross-compilation.en.md)：English cross-toolchain, compilation database, sysroot, and engine guidance.

## 开发维护 `development/`

- [中文开发者手册](development/developer-guide.zh-CN.md)：包含源码文件职责、状态所有权、测试与发布流程。
- [架构说明](development/architecture.md)：核心架构、数据流、信任边界和架构守卫。
- [自绘结果树交互与维护](development/custom-result-trees.zh-CN.md)：改造范围、操作规则、视图分组、维护边界与重点回归项目；已纳入 `0.22.22`。

## 规划设计 `planning/`

- [路线图与备忘录](planning/roadmap.md)：已完成阶段、延期功能和备忘录。
- [关系图设计与实施记录](planning/relationship-graph-plan.zh-CN.md)：已在 `0.12.0`–`0.12.8` 完成的 Relationship Graph 历史设计与实施记录。

## 测试验收 `validation/`

- [历史问题驱动测试指南](validation/regression-testing-guide.zh-CN.md)：按修改范围选择测试、自动与人工边界、高频冒烟清单，以及以后收到问题时的持续登记流程。
- [历史问题与回归案例库](validation/historical-issues.zh-CN.md)：当前 49 条稳定编号场景，首批 48 条后新增编译参数宏 049；包含历史现象、已确认与未确认的原因、复现预期及实际测试入口，新反馈在此增补。
- [代码预览固定配色使用与验证](validation/code-preview-fixed-colors.zh-CN.md)：已纳入 `0.22.25` 的深浅预设、完整默认颜色、自定义配置、校验边界和验收记录。
- [编译参数宏的构造与查询验证](validation/command-line-macros.zh-CN.md)：仅通过 `-D` 注入宏的可编译 C 工程、原始协议和 C Insight 实测，区分已可用的识别/引用与尚未覆盖的定义/调用者路径；关联 `CI-REG-049`。
- [编辑器跳转历史修复验证](validation/editor-navigation-history.zh-CN.md)：关闭文件旧光标产生多余后退站点的复现、修复边界、双引擎回归及用户验收记录；修复纳入 `0.22.24`。
- [性能基准](validation/performance-baseline.zh-CN.md)：当前基准场景、执行方法和带日期的实测快照。
- [第三阶段验收报告](validation/third-phase-acceptance.zh-CN.md)：`0.17.x`/`0.20.x` 性能与可靠性阶段的历史验收证据。
- [Microsoft 提供程序探测说明](validation/microsoft-provider-probe.zh-CN.md)：`0.18.0` 隔离探测方法、后续生产接入状态与公开 API 边界。
- [Microsoft 提供程序探测结果](validation/microsoft-provider-probe-result.json)：`2026-07-31` 生成的不可变原始探测快照。
- [Microsoft 引擎验收报告](validation/microsoft-engine-acceptance.zh-CN.md)：`0.18.x` Microsoft C/C++ 引擎的历史阶段验收报告。

## 版本发布 `releases/`

- [C Insight 0.22.25 发布说明](releases/v0.22.25.md)：与 GitHub Release 正文一致的当前版本中英双语功能、验证、安装和校验说明；同目录保留旧版本发布记录。

每个 `package.json` 版本必须存在对应的 `releases/v<version>.md`。质量门会验证版本、必需章节和占位符，Tag 发布工作流直接使用该文件作为 GitHub Release 正文。

用户行为和配置以用户手册为准；源码维护以开发者手册及实际代码为准；带日期或版本的验收数字只代表记录中的环境；规划文档中的延期项目不表示已经实现。
