# C Insight Microsoft C/C++ 引擎阶段验收报告

> 文档性质：历史验收证据。本文记录 `0.18.x` 接入及 `0.20.4` 复验环境，不表示当前每台机器都具有相同版本、耗时或结果数量。当前 `0.22.6` 仍保持相同公开 Provider 边界；后续的统一单击/双击导航、调用点平铺、实现优先根位置和调用者声明行属于 C Insight 展示层增强，不改变 cpptools API 能力。

## 1. 验收范围

本报告验收 0.18.0–0.18.18 的可选 Microsoft C/C++ language service (cpptools) 接入。clangd 仍是默认引擎；Microsoft 模式只使用 VS Code 公开的 Provider 命令，不依赖 cpptools 私有命令。

验收覆盖配置切换、Provider 激活、Definition、Declaration、References、Hover、Document/Workspace Symbols、Code Preview、References-based Callers、原生 Callees、Pin/Unpin、显式刷新、懒加载、缓存、诊断证据和请求资源边界。

## 2. 验收环境

- 日期：2026-08-01
- VS Code Extension Host：1.130.0
- Microsoft C/C++：1.32.2，扩展标识 `ms-vscode.cpptools`
- 代表工程：`/home/user/projects/FFmpeg`
- 代表文件：`tools/decode_simple.c`
- Callers 模式：`references`（避免已确认的 cpptools 原生 Incoming Calls 崩溃路径）

这些版本和路径只是本次验收记录，不是插件的固定运行要求。可通过 `C_INSIGHT_VSCODE_EXECUTABLE_PATH`、`C_INSIGHT_CPPTOOLS_EXTENSION_PATH` 和 `C_INSIGHT_FFMPEG_WORKSPACE` 指定其他环境。

## 3. 自动验收命令

```bash
npm test
npm run lint
npm run benchmark
npm run test:e2e:microsoft
npm run test:e2e:ffmpeg:microsoft
npm run package
```

Microsoft Extension Host 测试需要能够启动 Electron；受限容器中可能需要在沙箱外运行。cpptools 启动时可能访问 Marketplace 检查版本，网络失败会输出警告，但只要 Provider 正常激活且测试以退出码 0 结束，就不构成语义验收失败。

## 4. 真实 FFmpeg 结果

0.18.17 代码基线上的 2026-08-01 验收通过：

| 场景 | 结果 |
| --- | --- |
| 跨文件 Definition / Code Preview | `avcodec_receive_frame` 正确定位到 `libavcodec/avcodec.h` |
| References-based Callers | 2 个节点完成查询；3 个引用全部映射，得到 2 个 caller functions |
| 原生 Callees | 1 个节点成功；0 失败、0 取消、0 空结果，返回 2 个 callees |
| 双向懒加载 | Callers/Callees 均展开到深度 1，展开路径进入会话证据 |
| 缓存 | Incoming/Outgoing 分离计数，重复 Outgoing 查询命中缓存 |
| Pin/Unpin | 共享 Call Hierarchy Pin 状态一致；重复切换不会累积状态行 |
| 快速光标移动 | 请求合并/取消后队列清空，无残留活动工作 |
| Extension Host | 正常退出，退出码 0 |

耗时取决于 cpptools 索引状态和工程规模。本次初始化阶段的 Definition、Declaration 和 Hover 曾超过 1 秒；稳定后查询明显更快。这与用户观察到 Microsoft 模式通常比 clangd 慢相符，不表示查询失败。Project Diagnostics 的按方法耗时、慢查询、失败、取消、Callers/Callees 证据应作为具体工程上的判断依据。

## 5. 已确认边界

- Type Hierarchy 暂不可用：VS Code 没有公开可执行的稳定 Provider 命令。
- Callers 默认使用 References-based 近似结果。它可能漏掉 Provider 未返回的引用；“No callers found”不能证明程序中绝对没有调用者。
- Callees 使用公开 Call Hierarchy Outgoing Calls；其完整性由 cpptools 决定。
- VS Code Provider 命令不能指定唯一提供者。Microsoft 模式下应避免同时启用其他 C/C++ 语义 Provider。
- 已派发给 Provider 的任务不能通过公开 API 强制中止；C Insight 会取消排队任务并丢弃过期结果。
- Microsoft C/C++ 的索引进度和内部数据库不通过公开 Provider API 暴露。

## 6. 结论

Microsoft C/C++ 引擎已达到可选生产模式的阶段验收条件：核心导航、预览、安全 Callers、原生 Callees、状态交互、诊断和资源控制均有自动化及真实 FFmpeg 证据。它不承诺与 clangd 结果或性能完全一致，也不替代 clangd 默认模式。

后续 Microsoft 功能扩展仍遵守公开 API 边界；在没有稳定公开接口时，不使用私有 cpptools 命令模拟 clangd 专属能力。

## 7. 2026-08-02 复验（0.20.4）

VS Code 1.130.0 与 Microsoft C/C++ 1.32.2 环境重新执行 Provider 探针、基础 Microsoft 引擎 E2E 和真实 FFmpeg E2E，三者均以退出码 0 结束，未发生 cpptools 崩溃。隔离探针中冷 Definition 1,381.05 ms、References 405.60 ms、Incoming Calls 404.51 ms；Declaration 3.58 ms、Outgoing Calls 4.25 ms、Document Symbols 0.53 ms、Semantic Tokens 0.97 ms。该结果继续证明首次跨文件查询可能显著慢于 clangd，但 Provider 稳定后轻量查询正常。

同日 clangd 20.1.2 的 FFmpeg 自动验收也通过；Document Symbols 54.61 ms、Definition 0.62 ms、References 0.41 ms。两组数字的进程热度和目标不同，不用于严格横向排名，只用于确认双引擎均可用及 Microsoft 冷查询提示仍然必要。
