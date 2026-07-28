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

Before each automatic cursor refresh, `ContextController` derives a query
demand from the live visibility of Context, Code Preview, References, Callers,
and Callees. All hidden means no cursor request. Individual LSP methods are
selected from that demand; manual commands bypass this visibility gate.
Document Symbols uses its own visibility gate.

Code Preview uses a nonce-restricted Webview script. Browser click coordinates
are converted to UTF-16 source positions and validated again against the
currently rendered document and line range by the extension host. The Webview
never reads local files or sends LSP requests directly.

Navigation History is session-scoped and uses one shared cursor for the
History view and Code Preview Back/Forward. Bookmarks are intentionally
separate: they persist in VS Code workspaceState and retain a captured
identifier for best-effort relocation after document edits.
Bookmark interchange uses a versioned JSON envelope. Parsing, filtering,
sorting, duplicate-position merging, and group mutations are kept in the pure
bookmark model; filesystem selection and missing-file checks remain in the
VS Code integration.

Symbol Search owns a native tree provider and sends workspace queries through
`AnalysisService`. A monotonic generation discards late responses from older
search text. Its result nodes reuse the shared location path for preview,
history, and bookmarks.

Workspace session persistence uses one versioned snapshot in VS Code
`workspaceState`, so a directly opened folder and a multi-root workspace each
receive isolated state. Lightweight UI state is restored directly. Call
hierarchy snapshots retain only a root source position and loaded depths;
clangd re-resolves the root and rebuilds those depths after startup. Autosave
runs every five seconds and shutdown performs a final save.

Type Hierarchy uses the standard prepare/supertypes/subtypes LSP requests.
Opaque `TypeHierarchyItem.data` values remain attached to each lazy node.
Supertypes and Subtypes have separate request caches and duplicate sets, while
both share one cancellation source. Each direction has an independent node
budget.

Call, Type, and Include Hierarchy use one common direction-state model for
loaded-node counts, duplicate tracking, resets, and budget calculations.
Direction state remains isolated even where semantic request caches are shared.

Include Hierarchy is local and does not require a non-standard clangd method.
The forward tree parses directives lazily and resolves them with the active
compilation database's `-iquote`, `-I`, and `-isystem` paths. The reverse tree
builds a bounded workspace index only on first expansion, then incrementally
updates it for file changes. Both directions share compile-database
invalidation, cycle/duplicate protection, and export semantics in which edges
always point from the including file to the included file.

The language client also registers clangd's standard language capabilities
with VS Code. C Insight commands query `AnalysisService` directly so their
results cannot accidentally come from another extension.

## Trust boundary

C Insight does not start clangd in an untrusted workspace. It launches the
process without a shell and never executes CMake or build commands
automatically.
