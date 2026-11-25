# 文本搜索性能对照

关联 CI-REG-057。比较对象都是工作区全文搜索；使用只读 FFmpeg 或临时合成工程，不启动分析引擎，不修改实际工程。

## 1. 实际界面对照

```bash
npm run build
C_INSIGHT_TEXT_SEARCH_BENCHMARK_ROOT=/path/to/FFmpeg C_INSIGHT_VSCODE_EXECUTABLE_PATH=/path/to/test/code C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT=/tmp/search-ui.json xvfb-run -a node dist/test/e2e/runTextSearchUiBenchmark.js
```

入口在临时目录生成隔离工作区和用户数据，通过测试专用的本机 CDP 连接观察原生搜索与 C Insight 的实际渲染。原生使用搜索命令，C Insight 使用公开查询命令；没有提案 API 或私有搜索结果接口。查询范围统一为 `**/*.{c,h,cpp,hpp}`、不区分大小写、遵循相同排除设置，`search.maxResults` 为 20000。涵盖无命中、少量命中、大量命中、整词和正则五类；每类先预热，再交替次序测五轮。

首批时间取第一批结果的绘制帧，完成取实际进度条／查询状态完成标记，最终绘制取最后结果 DOM 变更后的动画帧。额外等待 150 ms 确认稳定，不把等待计入耗时。测试先收起其他栏目，让搜索结果区实际可见；首次打开成本单独记录。计时期间不并行构建或运行其他测试。

每项中位数要求 `C Insight <= max(native * 1.2, native + 100 ms)`，无命中不计算首批。默认严格检查；诊断时可设 `C_INSIGHT_SEARCH_UI_STRICT=0` 保留未达标数据。`C_INSIGHT_SEARCH_UI_NATIVE_ONLY=1` 只测原生、不激活扩展。聚合 JSON 不记录源码、片段或文件路径。纯策略断言见 `searchPerformanceModel.test.ts`。

合成千文件及未保存内容对照：

```bash
C_INSIGHT_TEXT_SEARCH_BENCHMARK_ROOT=synthetic C_INSIGHT_SEARCH_UI_DIRTY=1 C_INSIGHT_VSCODE_EXECUTABLE_PATH=/path/to/test/code C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT=/tmp/search-ui-synthetic.json xvfb-run -a node dist/test/e2e/runTextSearchUiBenchmark.js
```

此模式在临时工程创建 1000 个源码文件和一个缓冲区样本，内存编辑不保存。实际 FFmpeg 模式禁止启用此编辑选项。两种模式均断言没有提交分析引擎请求。

## 2. 原生迁移最终测量

`2026-11-25`，Linux、VS Code `1.130.0`，正式基线 `0.23.4` 的功能分支。只读 FFmpeg 五轮中位数，单位 ms；每格为“C Insight / 原生”：

| 查询 | 首批可见 | 搜索完成 | 最终绘制 |
| --- | --- | --- | --- |
| 不存在的合成标识符 | 不适用 | 18.4 / 23.7 | 42.7 / 34.4 |
| `avcodec_receive_frame` | 30.7 / 28.6 | 25.6 / 24.7 | 64.1 / 45.2 |
| `return`，20000 上限 | 29.9 / 134.8 | 186.6 / 162.7 | 227.6 / 207.3 |
| `avcodec_receive_frame`，整词 | 24.8 / 28.4 | 23.4 / 23.9 | 58.0 / 41.1 |
| `avcodec_(?:receive_frame|send_packet)`，正则 | 33.6 / 29.2 | 24.8 / 25.2 | 67.3 / 42.9 |

上述指标全部满足约定目标。原生结果可能在搜索完成后统一绘制，因此其首批时间可晚于完成时间。C Insight 普通栏目绘制前 200 个匹配，后台仍接收完整查询；两边的匹配上限相同。

首次打开本轮记录：原生搜索约 23.6 ms；C Insight 搜索约 553.0 ms，包含扩展首次激活和 Webview 初始化；20000 条结果的大窗口首次打开并绘制约 146.1 ms。这些是单次首开成本，不混入预热后的查询中位数。

合成千文件与未保存缓冲区五类查询也通过同一目标；大量结果完成约 `116.7 / 158.0 ms`、最终绘制约 `159.2 / 203.2 ms`。该结果只代表记录环境；实际 WSL／SSH 工程按同一入口和规则复测。

## 3. 性能诊断结论

旧原生预筛选方案仍在 JavaScript 中枚举路径、分批启动进程、读取命中文件并再次匹配。迁移后直接消费原生 JSON 匹配流，不再做第二次全文匹配。宿主保留源内容、UTF-16 位置和替换哈希核对，命中文件最多 8 个并发读取；取消时终止原生进程，并等待在途校验结束。不再为已取消的文件发布结果。

工作区／文件夹搜索中，已保存的打开文件共用磁盘查询，不为每个编辑器文档另起进程；只有未保存缓冲区需要原生标准输入查询以覆盖磁盘。当前文件和打开文件范围仍直接查询相应文档。专项宿主断言已保存文档不增加原生进程数，并继续验证内存新增匹配和替换撤销。

首次实际界面对照中，大量结果的串行校验仍需约 375.1 ms，同轮原生约 163.4 ms，未达标。有界并发及移除已弃用单文件大小限制所需的 stat 后，后续五轮降到约 208.9 ms，最终交付构建约 186.6 ms；内容／位置核对未删除。

最初探针以原生停止按钮识别完成，但该按钮只在慢查询出现；改用进度条标记。另一次测试布局把 C Insight 挤到没有可见结果区，导致动画帧测量不可用；调整隔离布局后重新采样。失败日志保留在本地，不计为性能通过样本。

## 4. 完整位置与分段诊断

```bash
C_INSIGHT_TEXT_SEARCH_BENCHMARK_ROOT=/path/to/FFmpeg C_INSIGHT_TEXT_SEARCH_CASE_SENSITIVE=0 C_INSIGHT_VSCODE_EXECUTABLE_PATH=/path/to/test/code xvfb-run -a node dist/test/e2e/runTextSearchBenchmark.js
```

此入口不激活扩展，按候选清单比较原生查询的完整文件及 UTF-16 位置。`C_INSIGHT_BENCHMARK_RG` 可指定独立对照程序，`C_INSIGHT_TEXT_SEARCH_BENCHMARK_OUTPUT` 保存聚合结果。未截断查询比较完整位置；截断查询只比较数量及部分状态，避免并发顺序差异。当前默认保留 20000 个匹配；旧的强制 JavaScript 对照选项已移除。

`SearchDiagnostics` 按需记录读取、解码、结果回调、首批和总耗时。并发阶段累计时间有重叠，不能求和当作墙钟时间；扫描计数由原生摘要提供，提前取消时只有已报告部分。独立原生程序的扫描时间不含宿主校验与界面，不能作为整体加速倍数。

## 5. 既往基线

`2026-11-24`，4614 个候选文件，约 69.3 MB，旧 JavaScript 管线及第一次原生预筛选复测：

| 查询 | 原 JavaScript 两次总耗时 | 预筛选两次总耗时 | 原始 ripgrep 两次扫描 |
| --- | --- | --- | --- |
| 不存在的合成标识符 | 3068 / 2450 ms | 379 / 196 ms | 18 / 17 ms |
| `avcodec_receive_frame`，66 条 | 2342 / 2378 ms | 262 / 225 ms | 18 / 17 ms |
| `return`，旧 10000 上限 | 434 / 431 ms | 214 / 197 ms | 35 / 31 ms |

这些是历史纯后端记录，不含实际工作窗口绘制，且使用旧结果上限，不能直接替代本轮界面验收。旧管线候选枚举、逐文件读取及线程传输的分段证据保存在 CI-REG-057；现行查询规则和操作见[用户手册](../user/user-guide.zh-CN.md#view-text-search)。
