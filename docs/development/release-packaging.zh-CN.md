# 平台专用包与 Universal 发布

## 1. 发布附件与平台选择

每次正式发布生成下列 8 个 VSIX，使用同一份源码、版本和功能配置：

| 文件名中的平台 | 安装目标 | 内置搜索程序目录 |
| --- | --- | --- |
| `win32-x64` | Windows x64 | `win32-x64` |
| `win32-arm64` | Windows ARM64 | `win32-arm64` |
| `linux-x64` | Linux x64，包括对应 WSL／SSH 宿主 | `linux-x64` |
| `linux-arm64` | Linux ARM64 | `linux-arm64` |
| `linux-armhf` | Linux 32 位 ARM | `linux-arm` |
| `darwin-x64` | macOS Intel | `darwin-x64` |
| `darwin-arm64` | macOS Apple Silicon | `darwin-arm64` |
| `universal` | 使用已有跨平台资源的通用安装包 | 全部 12 种资源 |

文件名统一为 `c-insight-<version>-<platform>.vsix`。所有 VSIX 的 SHA-256 放在同一个 `SHA256SUMS` 中。平台专用包写入 VS Code 官方 `TargetPlatform` 元数据，并且只包含对应搜索程序；Universal 不设置平台限制。`linux-armhf` 是发布目标名称，而运行时的 `process.arch` 是 `arm`，所以包内必须保留 `linux-arm/rg` 路径。

Universal 保留当前锁定依赖中的 Darwin、Linux 和 Windows 全部 12 份资源，包括没有独立发布目标的架构。它不额外提供纯浏览器版扩展、Alpine 专用二进制或新的分析引擎能力。具体可安装平台以 VS Code 与内置程序的系统要求为准。

按扩展实际运行的宿主选包，而不是按显示界面的电脑选包：Windows 本地开发使用 Windows 包，Windows 连接 x64 WSL 使用 `linux-x64`，SSH 连接 ARM64 Linux 使用 `linux-arm64`。无平台后缀的 `c-insight-<version>.vsix` 是本地通用打包命令的产物，也保留完整资源。

## 2. 构建命令

```bash
npm ci
npm run package:release
npm run package:release:verify
```

`package:release` 先执行一次完整 `npm run check`，再生成并核验附件；默认写入 `.cache/release-packages/<version>/`。`package:release:verify` 不重新构建，独立检查已经生成或下载到该目录的附件。两个命令均可通过 `--out-dir` 指定另一目录。

交付临时包时使用可区分的目录和文件后缀，不改变正式版本：

```bash
npm run package:release -- --out-dir .cache/release-packages/platform-preview --suffix platform-packages-preview
npm run package:release:verify -- --out-dir .cache/release-packages/platform-preview --suffix platform-packages-preview
```

已有完整构建和质量门结果时，CI 直接执行 `node scripts/package-release.mjs`，避免为每个平台重复跑测试。单个本地通用包仍可执行 `npm run package`。

## 3. 打包与校验约束

`release-targets.mjs` 是平台、原生程序清单和命名规则的唯一来源。打包器通过 `@vscode/vsce` 的公开 API 获取生产文件清单，将公共资源复制到临时目录，再逐个平台放入对应的原生程序。它不删除或改写工作副本的 `dist/ripgrep`，不把 `node_modules`、录屏、未列入生产清单的文件和本地缓存带入 VSIX。开发依赖 `jszip` 仅用于构建检查，不进入扩展运行时。

每个归档完成后检查：

1. 8 个文件名及版本、发布者和安装目标正确，Universal 不带目标限制。
2. ZIP 内容通过 CRC 校验，生产入口、匹配线程、图标字体、说明文件和许可证完整。
3. 专用包只有对应的一份搜索程序，Universal 保留全部 12 份；每份程序与锁定依赖的 SHA-256 一致，非 Windows 程序保留执行权限。
4. 所有包的公共内容一致，原生许可证与依赖原文一致。
5. `SHA256SUMS` 恰好覆盖所有 VSIX，无缺项、重复或不匹配；输出目录中的无关 VSIX 会使检查失败，而不是被自动删除。

`test/unit/releasePackaging.test.ts` 使用隔离合成资源生成真实 VSIX，覆盖目标映射和临时命名、工作副本保留、额外或损坏的搜索程序、丢失的资源与权限、错误平台标记、公共内容变化和校验清单不完整等情况。普通 CI 另外使用真实生产资源生成全套附件。

## 4. 发布与安装验收

先推送 `main` 并等待 CI 成功，再推送带注释的版本 Tag。Release 工作流重跑审计和质量门，生成 8 个 VSIX、核验全部附件，再一次性附加到 GitHub Release。下载全部附件后执行独立校验；在 Linux 上也可对下载目录运行 `sha256sum -c SHA256SUMS`。不要把生成的 VSIX 或校验文件提交到 Git。

归档检查可在一台构建机完成，但不代表已经执行其他操作系统的程序。发布前后按可用环境检查：安装匹配宿主的平台包，执行一次工作区搜索、结果预览和替换撤销；再用同版本 Universal 验证相同路径。Linux 包需在解压后执行内置 `rg --version`，WSL／SSH 场景确认实际安装位置。Windows、macOS 与 ARM 的真实执行和安装检查需在对应系统完成。

GitHub Release 与 Marketplace 是两个发布目标。此流程只发布 GitHub 附件；后续向 Marketplace 上传时应上传同版本的各平台包及 Universal，使用文件内的平台元数据。平台分发机制见 [VS Code 官方发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions)。
