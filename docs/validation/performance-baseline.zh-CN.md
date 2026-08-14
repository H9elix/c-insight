# C Insight 大型工程性能基线

本基线用于比较代码修改前后的核心模型性能，不代替真实 clangd、Remote SSH、磁盘和 VS Code UI 验收。

## 执行

```bash
npm run benchmark
```

默认输出一个 `c-insight.performance-baseline` 版本 1 的 JSON 报告，并在任一场景超过宽松回归预算时返回非零退出码。

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
| `include-directive-scan` | 100,000 行 | Include 注释过滤和指令提取 |
| `workspace-session-bounding` | 50,000 条历史 | 会话 UTF-8 计量和确定性降级 |

每个场景记录耗时、预算、预算结论、近似堆变化和结果计数。堆变化受 V8 GC 时机影响，只用于趋势比较，不作为硬预算。

## 解释边界

- 预算故意宽松，用于发现数量级退化，不用于比较不同机器的绝对快慢。
- 脚本不启动 clangd，不读取 FFmpeg，也不打开 VS Code。
- clangd 请求、索引、磁盘、Extension Host 和 UI 响应将在后续真实工作区基线中单独记录。
- 报告包含 Node、平台、架构、CPU 数量和总内存，便于比较运行环境。

## 2026-08-02 基线（0.20.0）

环境：Linux x64、Node.js 24.16.0、20 个逻辑 CPU、约 8 GB 内存；真实工程为 `/home/user/projects/FFmpeg`，使用工程根目录的 `compile_commands.json` 和 clangd 20.1.2。数值为单次自动验收样本，主要用于同机回归，不作为跨机器承诺。

### 核心模型

| 场景 | 规模 | 耗时 | 宽松预算 | 结果 |
| --- | ---: | ---: | ---: | --- |
| References 分类 | 100,000 | 24.96 ms | 1,500 ms | 通过 |
| Graph 构建与快照 | 20,000 节点 | 56.87 ms | 2,000 ms | 通过 |
| Hierarchy JSON 导出 | 10,000 节点 / 4.63 MB | 14.84 ms | 1,500 ms | 通过 |
| Code Preview 范围滚动 | 100,000 次 | 2.75 ms | 750 ms | 通过 |

### FFmpeg + clangd 20

| 请求 | 耗时 | 结果 |
| --- | ---: | --- |
| initialize | 33.15 ms | clangd 20.1.2，能力协商成功 |
| Document Symbols | 54.61 ms | 33 个顶层结果 |
| Definition | 0.62 ms | 1 个结果 |
| References | 0.41 ms | 1 个结果 |
| Prepare Call Hierarchy | 0.26 ms | `noise_init` |
| Outgoing Calls | 0.25 ms | 合法空结果 |
| Hover | 0.67 ms | 可用 |

对应自动命令：

```bash
npm run benchmark
C_INSIGHT_FFMPEG_ROOT=/home/user/projects/FFmpeg \
C_INSIGHT_FFMPEG_CLANGD=/usr/bin/clangd-20 \
npm run acceptance:ffmpeg -- /tmp/c-insight-ffmpeg-acceptance.json
```
