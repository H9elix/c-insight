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

GitHub Release 与 Marketplace 是两个发布目标。Release 成功后会自动触发下一节所述 Marketplace 发布任务，上传同一批平台包及 Universal，不重新打包。商城会根据安装目标选择平台包；WSL／SSH 根据远程扩展宿主的平台选择，而不是桌面操作系统。平台分发机制见 [VS Code 官方发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions)。

## 5. Marketplace 可信身份认证

`.github/workflows/marketplace-publish.yml` 的界面名称为 **Marketplace publishing**。从 `main` 手动触发时只运行认证任务：申请 GitHub OIDC 身份，向 Marketplace 交换 H9elix 的短期凭据，再通过 `vsce verify-pat H9elix` 只读检查发布者访问。名称中的 `verify-pat` 是工具通用验证入口，此处使用临时 OIDC 凭据，不创建或保存长期 PAT。手动认证与自动上传为两个独立任务。

在 Marketplace 发布者 H9elix 的 **Trusted Publishing → Create** 中填写：

| 字段 | 值 |
| --- | --- |
| Policy name | `C Insight GitHub Actions` |
| Repository owner | `H9elix` |
| Repository | `c-insight` |
| Workflow | `marketplace-publish.yml` |
| Environment | 留空 |

Workflow 只填写文件名，不填写 `.github/workflows/` 前缀；Environment 对应 GitHub 的命名部署环境，不是操作系统。策略建立后，将同名工作流推送到 `main`，在 GitHub **Actions → Marketplace publishing → Run workflow** 中选择 `main` 运行只读认证。也可在具备仓库 Actions 写入权限的终端执行：

```bash
gh workflow run marketplace-publish.yml --ref main --repo H9elix/c-insight
```

手动认证成功日志显示 `Trusted Publishing authentication and publisher access verified for H9elix. No extension was uploaded.`，表示可信凭据交换和发布者访问已通过。验证命令 `npm run marketplace:auth:check` 必须在授权的 GitHub Actions 中运行，不能用 WSL 本地环境模拟真实认证。

凭据只在该次任务的进程内存和子进程环境中使用，不写入文件、GitHub Secrets 或命令参数；日志先屏蔽短期凭据，并只保留安全的失败阶段与 HTTP 状态。`scripts/verify-marketplace-auth.mjs` 复用锁定的 `@vscode/vsce@4.1.0` 内部 OIDC 交换入口，升级该依赖时需审查适配器。交换请求必须包含 `api-version=7.2-preview.1` 并使用 FederatedToken 认证头，向 GitHub 请求身份时仍使用 Bearer；旧版发布工具的同类 HTTP 400 见 [CI-REG-046](../validation/historical-issues.zh-CN.md#ci-reg-046)。`marketplaceAuthentication.test.ts` 覆盖真实 SDK 的合成请求、仓库／分支／工作流校验、只读命令、凭据隔离、日志脱敏及失败传播。政策配置和短期凭据机制见[微软可信发布说明](https://developer.microsoft.com/blog/trusted-publishing-visual-studio-marketplace/)。

## 6. GitHub Release 后自动发布到 Marketplace

`Marketplace publishing` 通过 `workflow_run` 监听 **Release** 工作流成功完成，不依赖 `release.published` 事件。GitHub 默认令牌创建的 Release 通常不会再次触发普通事件工作流；`workflow_run` 可接续完成任务，并使用默认分支的可信工作流身份，沿用现有的 `marketplace-publish.yml` 策略。见 [GitHub 事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)和[工作流触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。

自动任务从 `main` 检出发布脚本，不执行触发方提供的代码。脚本仅接受本仓库 `.github/workflows/release.yml` 的成功标签推送，要求运行提交与当前稳定版本 Tag 一致且属于主干历史，再读取已公开的非草稿、非预发布 Release。8 个包及 `SHA256SUMS` 下载后必须通过平台、版本、发布者、CRC、原生程序、权限和完整校验和检查，之后才交换短期凭据并上传。

上传复用一份短期凭据，在进程环境中传给 `vsce publish --packagePath`，不放入参数或文件；子进程不接收 GitHub API 和 OIDC 请求凭据。平台来自每个文件的 VSIX 元数据，不重新构建。Marketplace 完成验证及分发后，内置扩展管理器会匹配宿主平台。

若部分上传失败，在对应 **Marketplace publishing** 运行中选择 **Re-run failed jobs**，同版本已存在的目标会跳过，补传其余目标。若主干版本已经前进，旧版本重跑会因提交／版本不一致而停止，应先按具体运行核对，不降低守卫。GitHub Release 发布成功不等于商城已经可下载，发布交付仍需分别核对 Actions 上传结果与商城实际版本。

`marketplacePublication.test.ts` 覆盖可信上下文、成功运行与 Tag 绑定、正式附件清单及 URL、先校验后取凭据、全平台命令、环境隔离和脱敏失败。真实上传仅在获授权的发布中执行。
