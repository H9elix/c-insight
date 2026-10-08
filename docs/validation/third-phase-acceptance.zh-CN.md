# C Insight 第三阶段验收报告

> 文档性质：历史阶段验收证据。本文记录 `0.17.x` 与 `0.20.0`–`0.20.5` 的环境和结果；当前 `0.22.15` 继续运行相同质量门，但后续功能行为应以当前用户手册、源码和最新测试为准。历史机器上的工作副本路径已泛化为 `/path/to/FFmpeg`，不改变验收内容。

## 0.20.5 最终结论

2026-08-02 完成 0.20.0–0.20.5 的第三阶段复验：45 个自动测试入口、代码检查、本地化与 ID 一致性检查、生产构建、合成性能基准、真实 FFmpeg/clangd 验收和 Extension Host 耐久测试全部通过。Microsoft Provider 隔离探针、基本工程 E2E 和真实 FFmpeg E2E 已在 0.20.4 通过。

本阶段发现并修复了一个真实缺陷：尚未开始的请求被取消后，调度器统计虽不再显示该请求，但队列数组仍保留其引用；0.20.1 起取消回调会立即移除条目。最终 E2E 还为每个进程使用独立的用户数据和扩展目录，测试可与用户正在运行的 VS Code 并行，不再竞争实例锁。未发现其他可复现的生产代码回归。

最终基准全部低于保护预算：10 万条 References 分类 24.42 ms、2 万节点关系图 53.16 ms、1 万节点 JSON 导出 15.01 ms、10 万次预览范围变化 2.86 ms、10 万行 Include 扫描 50.09 ms、5 万条会话输入裁剪 111.22 ms。真实 FFmpeg/clangd 20 初始化 30.52 ms，Document Symbols 52.21 ms，其余代表性语义查询均低于 1 ms。

## 0.20.1 请求调度复验

- 自动取消 5,000 个排队后台请求，内部队列最终为 0。
- 取消风暴结束后，交互请求能够按优先级正常启动。
- 穷举 32 种导航视图可见性组合；隐藏的 References、Callers 或 Callees 不产生各自的详情请求。
- 修复前已取消条目仍被内部队列引用；修复后取消回调立即移除对应条目。

## 0.20.2 双倍规模压力测试

在 2 倍基准规模下全部通过：200,000 条 References 分类 40.95 ms；40,000 节点 Graph 构建与快照 105.00 ms；20,000 节点、9.78 MB Hierarchy JSON 导出 31.31 ms；200,000 次 Code Preview 范围变化 4.26 ms；200,000 行 Include 扫描 108.00 ms；100,000 条历史会话按 1 MiB 上限降级至最新 20 条耗时 195.63 ms。

会话场景的瞬时堆增量约 93 MB，来源是刻意构造的 100,000 条输入及 `structuredClone`；实际 Navigation History 有更低的配置上限，因此本结果作为极端边界观察值，不据此扩大生产缓存。

## 0.20.3 资源生命周期复验

- Extension Host 内连续触发 1,000 次光标移动，随后 Definition 和 References Provider 仍返回有效结果。
- 连续执行 100 轮 References 与 Call Hierarchy Pin/Unpin，再继续执行 Graph、Preview 和层级命令，验证事件与命令生命周期未失效。
- LRU 缓存在 100,000 个不同键和每 10,000 次一次清空的循环中始终不超过 128 条；最终 clear 后大小和统计均归零。

## 0.20.4 双引擎复验

- clangd Extension Host E2E、Microsoft Provider 隔离探针、C Insight Microsoft 模式 E2E 和真实 FFmpeg Microsoft E2E 全部退出码为 0。
- Microsoft C/C++ 1.32.2 未发生 SIGSEGV；FFmpeg 测试继续使用 References-based Callers 避开已知原生 Incoming Calls 风险路径。
- Microsoft 冷 Definition 和 References 延迟明显高于 clangd 基线，属于已知 Provider 性能差异，现有用户提示与诊断计时继续保留。

## 1. 验收范围

第三阶段原始实现 0.17.0–0.17.5 面向大型工程性能与可靠性；0.20.0–0.20.5 对其进行专项复验和加固。范围覆盖合成性能基线、语义请求调度、大结果集资源保护、窗口状态一致性、运行时诊断以及 clangd/Microsoft 双引擎的真实工程验收。

## 2. FFmpeg 环境

- 工程：`/path/to/FFmpeg`（历史机器路径已泛化）
- 编译数据库：工程根目录 `compile_commands.json`，约 2 MiB
- clangd：`/usr/bin/clangd-20`，Ubuntu clangd 20.1.2
- 代表文件：`libavcodec/bsf/noise.c`
- 编译命令验证：`clangd-20 --check` 成功，无错误退出

这些路径是本次验收环境记录，不是插件运行要求。可通过环境变量在其他机器指定：

```bash
C_INSIGHT_FFMPEG_ROOT=/path/to/FFmpeg \
C_INSIGHT_FFMPEG_CLANGD=/path/to/clangd-20 \
npm run acceptance:ffmpeg -- /tmp/c-insight-ffmpeg-acceptance.json
```

不传输出路径时，报告只写到标准输出。脚本只读取 FFmpeg 源码和编译数据库，不会修改工程。

## 3. 真实语义查询结果

2026-07-31 的版本 1 验收报告通过：

| 场景 | 结果 | 本次耗时 |
| --- | --- | ---: |
| clangd 初始化与能力协商 | 通过，Call/Type Hierarchy、References 等能力可用 | 50.85 ms |
| Document Symbols | 33 个顶层结果 | 47.21 ms |
| Definition | 1 个结果 | 0.41 ms |
| References | 1 个结果 | 0.37 ms |
| Prepare Call Hierarchy | 根为 `noise_init` | 0.20 ms |
| Outgoing Calls | 请求成功、返回合法数组；本文件为 0 个静态目标 | 0.39 ms |
| Hover | 内容可用 | 0.61 ms |

Outgoing Calls 返回空数组表示 clangd 对该 C 文件的静态调用图保持保守；请求成功且没有 `-32601 method not found`，因此协议和 clangd 20 兼容性验收通过。此数量不能推断整个 FFmpeg 工程没有调用关系。

## 4. 自动回归门槛

发布前必须全部通过：

```bash
npm test
npm run lint
npm run benchmark
npm run acceptance:ffmpeg
npm run package
xvfb-run -a npm run test:e2e
```

合成基线仍按 10 万条 References、2 万节点图、1 万节点导出和 10 万次预览滚动执行。FFmpeg 验收补充真实 clangd、编译数据库和 AST 查询，但不替代用户在 Remote SSH 窗口中对实际交互流畅度的长期观察。

## 5. 结论与边界

第三阶段计划项均已实现，自动回归、合成基准和本机 FFmpeg 只读验收通过。运行时队列、延迟、缓存与限制命中可通过 Project Diagnostics 查看并导出。

第四阶段功能仍按备忘录暂缓，包括 Code Preview 完整语义右键菜单、Include 条件预处理增强、Type/Include 会话恢复和跨过程数据流。微软 C/C++ 引擎的公开 Provider 适配已在 0.18.x 实现，其私有能力和无法通过稳定 API 提供的功能不纳入当前范围。
