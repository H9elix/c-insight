# C Insight 文档索引

本文档集对应 C Insight `0.22.16`。文档按用途分为以下四类；源码、Issue 与发布包位于 [GitHub 仓库](https://github.com/H9elix/c-insight)。

## 用户文档 `user/`

- [中文用户手册](user/user-guide.zh-CN.md)：完整中文使用手册、窗口逻辑、命令和配置参考。
- [English user guide](user/user-guide.en.md)：英文使用说明。
- [交叉编译与嵌入式工程配置](user/cross-compilation.zh-CN.md)：中文的交叉工具链、编译数据库、sysroot 和双引擎配置说明。
- [Cross-compilation and embedded projects](user/cross-compilation.en.md)：English cross-toolchain, compilation database, sysroot, and engine guidance.

## 开发维护 `development/`

- [中文开发者手册](development/developer-guide.zh-CN.md)：包含源码文件职责、状态所有权、测试与发布流程。
- [架构说明](development/architecture.md)：核心架构、数据流、信任边界和架构守卫。

## 规划设计 `planning/`

- [路线图与备忘录](planning/roadmap.md)：已完成阶段、延期功能和备忘录。
- [关系图设计与实施记录](planning/relationship-graph-plan.zh-CN.md)：已在 `0.12.0`–`0.12.8` 完成的 Relationship Graph 历史设计与实施记录。

## 测试验收 `validation/`

- [性能基准](validation/performance-baseline.zh-CN.md)：当前基准场景、执行方法和带日期的实测快照。
- [第三阶段验收报告](validation/third-phase-acceptance.zh-CN.md)：`0.17.x`/`0.20.x` 性能与可靠性阶段的历史验收证据。
- [Microsoft 提供程序探测说明](validation/microsoft-provider-probe.zh-CN.md)：`0.18.0` 隔离探测方法、后续生产接入状态与公开 API 边界。
- [Microsoft 提供程序探测结果](validation/microsoft-provider-probe-result.json)：`2026-07-31` 生成的不可变原始探测快照。
- [Microsoft 引擎验收报告](validation/microsoft-engine-acceptance.zh-CN.md)：`0.18.x` Microsoft C/C++ 引擎的历史阶段验收报告。

用户行为和配置以用户手册为准；源码维护以开发者手册及实际代码为准；带日期或版本的验收数字只代表记录中的环境；规划文档中的延期项目不表示已经实现。
