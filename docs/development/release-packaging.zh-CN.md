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

## 5. Marketplace 可信身份认证

`.github/workflows/marketplace-publish.yml` 的界面名称为 **Marketplace authentication**，仅接受从 `main` 手动触发。它申请 GitHub OIDC 身份，向 Marketplace 交换 H9elix 的短期凭据，再通过 `vsce verify-pat H9elix` 进行只读的发布者访问检查。名称中的 `verify-pat` 是工具通用验证入口，此处使用的是临时 OIDC 凭据，不创建或保存长期 PAT。工作流不包含 VSIX 上传命令，不响应版本标签、GitHub Release 或普通推送。

在 Marketplace 发布者 H9elix 的 **Trusted Publishing → Create** 中填写：

| 字段 | 值 |
| --- | --- |
| Policy name | `C Insight GitHub Actions` |
| Repository owner | `H9elix` |
| Repository | `c-insight` |
| Workflow | `marketplace-publish.yml` |
| Environment | 留空 |

Workflow 只填写文件名，不填写 `.github/workflows/` 前缀；Environment 对应 GitHub 的命名部署环境，不是操作系统。策略建立后，将同名工作流推送到 `main`，在 GitHub **Actions → Marketplace authentication → Run workflow** 中选择 `main` 运行。也可在具备仓库 Actions 写入权限的终端执行：

```bash
gh workflow run marketplace-publish.yml --ref main --repo H9elix/c-insight
```

成功日志和任务摘要显示 `Trusted Publishing authentication and publisher access verified for H9elix. No extension was uploaded.`，表示可信凭据交换和发布者访问已通过；真正的包上传仍需单独授权和配置。验证命令 `npm run marketplace:auth:check` 必须在授权的 GitHub Actions 中运行，不能用 WSL 本地环境模拟真实认证。

凭据只在该次任务的进程内存和子进程环境中使用，不写入文件、GitHub Secrets 或命令参数；日志先屏蔽短期凭据，并只保留安全的失败阶段与 HTTP 状态。`scripts/verify-marketplace-auth.mjs` 复用锁定的 `@vscode/vsce@4.1.0` 内部 OIDC 交换入口，升级该依赖时需审查适配器。交换请求必须包含 `api-version=7.2-preview.1` 并使用 FederatedToken 认证头，向 GitHub 请求身份时仍使用 Bearer；旧版发布工具的同类 HTTP 400 见 [CI-REG-046](../validation/historical-issues.zh-CN.md#ci-reg-046)。`marketplaceAuthentication.test.ts` 覆盖真实 SDK 的合成请求、仓库／分支／工作流校验、只读命令、凭据隔离、日志脱敏及失败传播。政策配置和短期凭据机制见[微软可信发布说明](https://developer.microsoft.com/blog/trusted-publishing-visual-studio-marketplace/)。
