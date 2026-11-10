# C Insight 文档索引

本文档集对应 C Insight `0.22.27`，按用途分为以下五类。项目介绍和快速开始见 [English README](../README.md) 或[简体中文 README](../README.zh-CN.md)；源码、Issue 与发布包位于 [GitHub 仓库](https://github.com/H9elix/c-insight)。

## 用户文档 `user/`

`0.22.27` 新增工程文件窗口：平铺文件清单、实时搜索、排序、活动文件高亮、居中跟随及独立锁定。见[使用说明](user/user-guide.zh-CN.md#417-工程文件project-files)及[专项验证](validation/project-files.zh-CN.md)。

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
- [工程文件验证](validation/project-files.zh-CN.md)：文件清单、筛选、排序、焦点跟随、独立锁定和居中定位的自动覆盖与人工检查。
- [代码预览固定配色使用与验证](validation/code-preview-fixed-colors.zh-CN.md)：已纳入 `0.22.25` 的深浅预设、完整默认颜色、自定义配置、校验边界和验收记录。
- [编译参数宏的构造与查询验证](validation/command-line-macros.zh-CN.md)：仅通过 `-D` 注入宏的可编译 C 工程、原始协议和 C Insight 实测，含宏值 `1`、`0` 的生效分支函数调用者与函数式编译宏展开对照；区分已验收的识别、引用及宏调用者与未修复的定义/自动预览边界，关联 `CI-REG-049`。
- [编辑器跳转历史修复验证](validation/editor-navigation-history.zh-CN.md)：关闭文件旧光标产生多余后退站点的复现、修复边界、双引擎回归及用户验收记录；修复纳入 `0.22.24`。
- [性能基准](validation/performance-baseline.zh-CN.md)：当前基准场景、执行方法和带日期的实测快照。
- [第三阶段验收报告](validation/third-phase-acceptance.zh-CN.md)：`0.17.x`/`0.20.x` 性能与可靠性阶段的历史验收证据。
- [Microsoft 提供程序探测说明](validation/microsoft-provider-probe.zh-CN.md)：`0.18.0` 隔离探测方法、后续生产接入状态与公开 API 边界。
- [Microsoft 提供程序探测结果](validation/microsoft-provider-probe-result.json)：`2026-07-31` 生成的不可变原始探测快照。
- [Microsoft 引擎验收报告](validation/microsoft-engine-acceptance.zh-CN.md)：`0.18.x` Microsoft C/C++ 引擎的历史阶段验收报告。

## 版本发布 `releases/`

- [C Insight 0.22.27 发布说明](releases/v0.22.27.md)：与 GitHub Release 正文一致的中英双语功能更新；同目录保留旧版本发布记录。

每个 `package.json` 版本必须存在对应的 `releases/v<version>.md`。质量门检查版本、中英双语、比较链接和未完成占位符，Tag 发布工作流直接使用该文件作为 GitHub Release 正文。

用户行为和配置以用户手册为准；源码维护以开发者手册及实际代码为准；带日期或版本的验收数字只代表记录中的环境；规划文档中的延期项目不表示已经实现。
