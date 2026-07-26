# Architecture

The TypeScript extension is both the VS Code integration and the LSP client.
`ClangdManager` owns one clangd process. `AnalysisService` is the only module
that sends semantic requests, keeping UI code independent from the concrete
backend.

`ContextController` debounces cursor movement and assigns each refresh a
monotonic generation. Results from an older generation are discarded. The
views use native tree providers; callers and callees request children lazily.
Raw LSP call hierarchy items are retained because clangd may require their
opaque `data` field in subsequent requests.

Code Preview uses a nonce-restricted Webview script. Browser click coordinates
are converted to UTF-16 source positions and validated again against the
currently rendered document and line range by the extension host. The Webview
never reads local files or sends LSP requests directly.

The language client also registers clangd's standard language capabilities
with VS Code. C Insight commands query `AnalysisService` directly so their
results cannot accidentally come from another extension.

## Trust boundary

C Insight does not start clangd in an untrusted workspace. It launches the
process without a shell and never executes CMake or build commands
automatically.
