# Privacy

C Insight is developed by `youjinchun` and does not implement telemetry,
analytics, advertising, account tracking, or automatic source-code upload.

Semantic analysis is performed by the `clangd` process running in the same
local, SSH, WSL, or container extension environment as C Insight. The extension
passes document content and language requests to that process through LSP.
C Insight itself does not send those requests to an external C Insight service.

Project Diagnostics reports may contain filesystem paths, compile commands,
include paths, macro definitions, diagnostics, software versions, and aggregate
runtime counters. Before copying or exporting a report, configure
`cInsight.diagnostics.reportRedaction` as needed and inspect the result.

Workspace Session Restore stores bounded browsing state in VS Code workspace
storage. Bookmarks are also stored in VS Code workspace storage. Explicit
exports are written to the location selected by the user.

VS Code, Remote extensions, clangd, the operating system, and any separately
installed extensions have their own data-handling behavior and are outside the
C Insight privacy boundary.
