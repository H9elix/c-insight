# C Insight 第三阶段验收报告

## 0.20.1 请求调度复验

- 自动取消 5,000 个排队后台请求，内部队列最终为 0。
- 取消风暴结束后，交互请求能够按优先级正常启动。
- 穷举 32 种导航视图可见性组合；隐藏的 References、Callers 或 Callees 不产生
  各自的详情请求。
- 修复前已取消条目仍被内部队列引用；修复后取消回调立即移除对应条目。

## 0.20.2 双倍规模压力测试

在 2 倍基准规模下全部通过：200,000 条 References 分类 40.95 ms；40,000
节点 Graph 构建与快照 105.00 ms；20,000 节点、9.78 MB Hierarchy JSON 导出
31.31 ms；200,000 次 Code Preview 范围变化 4.26 ms；200,000 行 Include 扫描
108.00 ms；100,000 条历史会话按 1 MiB 上限降级至最新 20 条耗时 195.63 ms。

会话场景的瞬时堆增量约 93 MB，来源是刻意构造的 100,000 条输入及
`structuredClone`；实际 Navigation History 有更低的配置上限，因此本结果作为
极端边界观察值，不据此扩大生产缓存。

## 1. 验收范围

第三阶段 0.17.0–0.17.5 面向大型工程性能与可靠性，覆盖合成性能基线、语义请求
调度、大结果集资源保护、窗口状态一致性、运行时诊断和真实 FFmpeg 工程验收。

## 2. FFmpeg 环境

- 工程：`/home/user/projects/FFmpeg`
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

不传输出路径时，报告只写到标准输出。脚本只读取 FFmpeg 源码和编译数据库，不会
修改工程。

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

Outgoing Calls 返回空数组表示 clangd 对该 C 文件的静态调用图保持保守；请求成功
且没有 `-32601 method not found`，因此协议和 clangd 20 兼容性验收通过。此数量
不能推断整个 FFmpeg 工程没有调用关系。

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

合成基线仍按 10 万条 References、2 万节点图、1 万节点导出和 10 万次预览滚动
执行。FFmpeg 验收补充真实 clangd、编译数据库和 AST 查询，但不替代用户在 Remote
SSH 窗口中对实际交互流畅度的长期观察。

## 5. 结论与边界

第三阶段计划项均已实现，自动回归、合成基准和本机 FFmpeg 只读验收通过。运行时
队列、延迟、缓存与限制命中可通过 Project Diagnostics 查看并导出。

第四阶段功能仍按备忘录暂缓，包括 Code Preview 完整语义右键菜单、Include 条件
预处理增强、Type/Include 会话恢复、跨过程数据流和可选微软 C/C++ 引擎支持。
