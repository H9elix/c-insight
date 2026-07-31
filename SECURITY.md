# Security Policy

## Supported version

Security fixes are applied to the latest packaged C Insight version. Older
local VSIX builds are not maintained as separate release lines.

## Reporting

C Insight does not yet have a public repository or dedicated private security
address. Until one is established, contact developer `youjinchun` through the
channel from which the extension was distributed. Do not place source code,
credentials, proprietary paths, private macro values, or undisclosed
vulnerability details in a public discussion.

For diagnostic data, first set `cInsight.diagnostics.reportRedaction` to
`paths-and-defines`, then inspect the generated report before sharing it.

## Security boundaries

- C Insight launches the configured local or remote-host `clangd` executable.
- A workspace can influence clangd through source files, `.clangd`, and
  `compile_commands.json`; only open and trust workspaces you consider safe.
- C Insight does not execute compile commands from the compilation database,
  but clangd reads them to parse files.
- Export and workspace-session data are written only after explicit user or
  configured session actions and are subject to resource limits.
