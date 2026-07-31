# C Insight 大型工程性能基线

本基线用于比较代码修改前后的核心模型性能，不代替真实 clangd、Remote SSH、
磁盘和 VS Code UI 验收。

## 执行

```bash
npm run benchmark
```

默认输出一个 `c-insight.performance-baseline` 版本 1 的 JSON 报告，并在任一
场景超过宽松回归预算时返回非零退出码。

需要保存纯 JSON 文件时，先编译再直接运行脚本：

```bash
npm run compile
node scripts/benchmark-large-workspace.mjs --output /tmp/c-insight-performance.json
```

只观察结果、不因预算失败退出：

```bash
C_INSIGHT_BENCHMARK_STRICT=0 npm run benchmark
```

通过 `C_INSIGHT_BENCHMARK_SCALE` 可按比例放大数据量和预算：

```bash
C_INSIGHT_BENCHMARK_SCALE=2 npm run benchmark
```

## 当前场景

| 场景 | 默认规模 | 主要覆盖 |
| --- | ---: | --- |
| `reference-classification` | 100,000 条 | References 规则、证据对象和分类分配 |
| `relationship-graph-build-snapshot` | 20,000 节点 | 稳定 ID、节点/边写入和快照 |
| `hierarchy-json-export` | 10,000 节点 | 结构化层级及统计 JSON 导出 |
| `preview-range-scroll` | 100,000 次 | Code Preview 双向增量范围计算 |

每个场景记录耗时、预算、预算结论、近似堆变化和结果计数。堆变化受 V8 GC
时机影响，只用于趋势比较，不作为硬预算。

## 解释边界

- 预算故意宽松，用于发现数量级退化，不用于比较不同机器的绝对快慢。
- 脚本不启动 clangd，不读取 FFmpeg，也不打开 VS Code。
- clangd 请求、索引、磁盘、Extension Host 和 UI 响应将在后续真实工作区基线中
  单独记录。
- 报告包含 Node、平台、架构、CPU 数量和总内存，便于比较运行环境。
