# Microsoft C/C++ Provider 可行性探测

## 目的和结论边界

0.18.0 只验证将微软官方 C/C++ 扩展作为未来可选语义引擎的技术边界，不在
C Insight 运行时加入引擎开关，也不改变现有 clangd 行为。探测在独立 VS Code
Extension Host 中只加载 `ms-vscode.cpptools`，避免 clangd 或 C Insight 的同类
Provider 混入结果。

微软公开的 `vscode-cpptools-api` 面向构建系统扩展提供 IntelliSense
Configuration Provider；它不提供 Definition、References 或 Call Hierarchy 的
直接查询 API。因此可选引擎适配器只能通过 VS Code 标准 Provider 命令查询
语义结果。

## 复现方式

前置条件：Linux VS Code Extension Host、已安装的微软 C/C++ 扩展，以及本仓库
依赖。默认探测本机 Remote SSH 扩展目录中的 1.32.2；其他安装路径可通过环境
变量覆盖：

```bash
C_INSIGHT_CPPTOOLS_EXTENSION_PATH=/path/to/ms-vscode.cpptools \
  npm run probe:microsoft
```

如需复用已经下载的桌面测试运行时，可同时设置
`C_INSIGHT_VSCODE_EXECUTABLE_PATH=/path/to/code`；否则测试框架会按
`C_INSIGHT_VSCODE_TEST_VERSION`（默认 1.130.0）准备运行时。

测试工作区为 `test/fixtures/basic-cpp`。输出同时写入终端和
`/tmp/c-insight-microsoft-provider-probe.json`。JSON 使用
`c-insight.microsoft-provider-probe`、版本 `1`，包含 VS Code/扩展版本、隔离
状态、每种查询的可用性、结果数、去重位置数和耗时。

## 探测范围

探测调用以下 VS Code 公共命令：

- Definition、Declaration、References 和 Hover；
- Document Highlights、Document Symbols 和 Workspace Symbols；
- Signature Help；
- Call Hierarchy prepare、incoming calls 和 outgoing calls；
- Document Semantic Tokens 及其 legend；
- 已注册命令中是否存在可供扩展调用的 `vscode.*` Type Hierarchy 命令。

Definition 和 References 是最低通过条件；References 会等待微软后台索引最多
60 秒。其余项目记录能力，不因空结果直接判定整个探测失败。

## 0.18.0 实测结果

2026-08-01 在 VS Code 1.130.0、Microsoft C/C++ 1.32.2、Linux x64 的隔离
Extension Host 中运行通过，且确认 C Insight 未被加载。最终原始报告随扩展保存
为 \`docs/microsoft-provider-probe-result.json\`。

| 能力 | 可用 | 结果摘要 |
| --- | --- | --- |
| Definition / Declaration | 是 | 各 1 个唯一位置 |
| References | 是 | 2 个结果、2 个唯一位置 |
| Hover / Signature Help | 是 | 各 1 个结果 |
| Document Highlights | 是 | 2 个结果；本样例均为 Text，未给出 Read/Write |
| Document / Workspace Symbols | 是 | 各 2 个结果 |
| Call Hierarchy | 是 | prepare 1、incoming 1、outgoing 2 |
| Semantic Tokens | 是 | 14 个 token、23 种 token type |
| 公共 Type Hierarchy 命令 | 否 | 只有 \`editor.*\` UI 内部命令，没有 \`vscode.*\` Provider 命令 |

这些数字只用于证明公共 Provider 通路可工作，不是性能承诺；首次 Definition
包含微软引擎启动成本，约 1.4 秒，后续小样例查询多为数毫秒，References 和
Incoming Calls 约 0.4 秒。

## 已确认的 API 约束

- C Insight 无法通过公开接口指定“只调用微软 Provider”。当多个 C/C++ 语义
  扩展同时注册时，VS Code 标准命令可能聚合多个 Provider 的结果。因此生产
  接入需要检测冲突，并明确建议每个工作区只启用一个 C/C++ 语义引擎。
- 标准 `execute*Provider` 命令不允许调用方传入用于中途取消 Provider 请求的
  `CancellationToken`。C Insight 可丢弃过期结果、取消尚未派发的任务，但不能
  保证终止微软扩展内部已经开始的查询。
- VS Code 公共命令文档没有 Type Hierarchy 对应的执行命令。即使编辑器 UI 或
  某个扩展存在内部命令，也不能作为稳定适配接口依赖。
- Document Highlights 可提供 Read/Write 类型，但微软引擎不会暴露 clangd 的
  原始 LSP 证据；现有 References 高级分类必须按实际返回能力降级并标注来源。
- C Insight 不能管理微软扩展的语言服务器进程，也不能复用 clangd 专用的
  索引进度、compile command、重启和日志逻辑。

## 生产接入建议

后续 0.18.1 若继续实施，应先抽象统一语义引擎接口，再增加显式选择的
`microsoft` 适配器。第一批只覆盖 Definition、References、Hover、Symbols 和
Call Hierarchy；Type Hierarchy、clangd 状态/索引诊断及依赖 clangd 扩展协议的
功能应显示为不支持，而不是静默伪造结果。默认引擎仍为 clangd，且配置变更后
应提示 Reload Window。

本探测不是微软扩展兼容性承诺。每次提高最低支持版本或微软扩展改变 Provider
行为时，都应重新运行探测并保留报告。
