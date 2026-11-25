# Security Policy

## Supported version

Security fixes are applied to the latest packaged C Insight version. Older local VSIX builds are not maintained as separate release lines.

## Reporting

Do not report vulnerabilities in a public Issue or Discussion. Open the repository's [Security Advisories](https://github.com/H9elix/c-insight/security/advisories) page and select **Report a vulnerability**. GitHub private vulnerability reporting keeps the report visible only to the reporter, the maintainer, and explicitly invited security collaborators while a fix is prepared.

Do not include unrelated source code, credentials, proprietary paths, private macro values, or other sensitive project data. Include only the minimum reproducible evidence needed to assess the vulnerability.

For diagnostic data, first set `cInsight.diagnostics.reportRedaction` to `paths-and-defines`, then inspect the generated report before sharing it.

## Security boundaries

- C Insight launches the configured local or remote-host `clangd` executable.
- A workspace can influence clangd through source files, `.clangd`, and `compile_commands.json`; only open and trust workspaces you consider safe.
- C Insight does not execute compile commands from the compilation database, but clangd reads them to parse files.
- Text search launches only the bundled ripgrep executable without a shell, user ripgrep configuration or preprocessors. Webviews navigate known host-side result IDs; replacement requires a trusted writable workspace, a validated diff and explicit confirmation. Read-only result windows cannot apply edits.
- Export and workspace-session data are written only after explicit user or configured session actions and are subject to resource limits.
- Production and development dependencies are audited before release; generated third-party notices are checked by the standard quality gate.
