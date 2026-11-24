# 文本搜索性能对照

关联 CI-REG-057。两边均为工作区全文搜索；基准使用只读 FFmpeg 源码及同一份候选文件清单，不启动 C Insight 分析引擎，不写入被测工程。

## 执行方法

```bash
npm run build
C_INSIGHT_TEXT_SEARCH_BENCHMARK_ROOT=/path/to/FFmpeg C_INSIGHT_VSCODE_EXECUTABLE_PATH=/path/to/test/code xvfb-run -a node dist/test/e2e/runTextSearchBenchmark.js
```

启动器只在临时目录写隔离工作区和用户数据。可用 `C_INSIGHT_BENCHMARK_RG` 指定对照二进制，`C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT` 保存聚合 JSON。报告不保存源码、匹配片段或文件路径。候选范围为 `**/*.{c,h,cpp,hpp}`，区分大小写、字面量匹配，最多保留 10000 个匹配。原始 ripgrep 按相同候选清单搜索；该纯后端时间不包含清单生成、哈希校验和 Webview，不能当作用户界面整体加速倍数。达到上限时只比较截断状态和数量，不要求不同并发顺序保留同一组结果。

`SearchDiagnostics` 仅按需收集枚举、stat、读取、解码、匹配等待、宿主结果回调、首批结果和总耗时。并发通道的累计阶段时间存在重叠，不能相加当作墙钟时间。未清空系统缓存，首次和重复读取不称为严格冷／热缓存测试。

## 优化前基线

`2026-11-24`，Linux、VS Code `1.130.0`，4614 个候选文件，约 69.3 MB 源码；旧 JavaScript 管线和系统 ripgrep `15.2.0` 在同一宿主中测量：

| 查询 | 匹配数 | 旧管线两次总耗时 | 原始 ripgrep 两次扫描耗时 |
| --- | --- | --- | --- |
| 不存在的合成标识符 | 0 | 3068 / 2450 ms | 22 / 20 ms |
| `avcodec_receive_frame` | 66 | 2342 / 2378 ms | 19 / 18 ms |
| `return` | 10000，截断 | 434 / 431 ms | 22 / 22 ms |

独立生成候选清单约需 183–407 ms。少量命中查询的一轮累计 stat 约 1199 ms、读取约 2143 ms、匹配等待约 770 ms；墙钟总耗时约 2342 ms。该证据支持优先减少逐文件 API 往返和无命中文件的全文解码／线程复制，而非仅增加匹配线程。

## 正确性与人工对照

优化后对同一集合复测无命中、少量命中及达到上限；未截断时核对每个文件和 UTF-16 位置。补充未保存文档覆盖、包含／排除规则、编码、Unicode 整词、正则回退、二进制、文件大小、取消、只读与替换冲突。真实工作区还需比较首批可见结果和界面稳定时间；原始子进程扫描速度不能替代 Webview 性能验收。
