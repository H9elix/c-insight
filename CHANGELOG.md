# Changelog

## 0.8.4

- Consolidated global analysis reliability into one persistent VS Code status
  bar item.
- Added compact Ready, Indexing, Limited, and Unavailable presentations with
  warning/error status-bar colors.
- Added a detailed hover listing every reliability issue and click-through to
  Project Diagnostics.
- Removed duplicate reliability nodes from References, Callers, and Callees.
- Retained per-view Pin and stale markers, and retained reliability-aware empty
  result wording.

## 0.8.3

- Added a shared reliability model that combines clangd lifecycle, background
  indexing, compilation database availability, current-file compile commands,
  and missing includes.
- Added expandable reliability warnings to References, Callers, and Callees
  without clearing or replacing loaded results.
- Reliability warnings open Project Diagnostics and never interrupt navigation
  with automatic notifications.
- Distinguishes reliable empty results from potentially incomplete “not found
  yet” results.
- Added independent stale-result markers for source edits, clangd restarts,
  analysis configuration changes, active compilation database changes, and
  restarted background indexing.
- Clears stale markers only when the corresponding References or Call
  Hierarchy query produces new results.

## 0.8.2

- Added direct handling of clangd's standard
  `backgroundIndexProgress` Work Done Progress stream.
- Added Background Index status, completed/total file counts, percentage, and
  last-update time to Project Diagnostics.
- Reflects active background work in the clangd lifecycle state and returns to
  Ready when indexing becomes idle.
- Added Restart Background Indexing to the Project Diagnostics title bar.
- Keeps indexing telemetry separate from log severity classification, avoiding
  false error reporting for normal LSP traffic.

## 0.8.1

- Added one shared compilation database resolver used by both clangd startup
  and Project Diagnostics.
- Automatically searches workspace roots, `build`, `Build`, `out`,
  `out/build`, CMake build directories, `_build`, and then other workspace
  candidates.
- Passes automatically discovered databases to clangd with
  `--compile-commands-dir`, so discovery now affects analysis rather than only
  status reporting.
- Added Select Compilation Database and Use Automatic Compilation Database
  Detection commands.
- Added database-source reporting and cached discovery/parsing for large
  workspaces.
- Detects active compilation database creation, modification, and deletion,
  then offers to restart clangd after a short debounce.

## 0.8.0

- Replaced the basic Index Status view with an automatically refreshed Project
  Diagnostics view.
- Added clangd executable, version, and lifecycle state inspection.
- Added compilation database discovery, path, entry count, and parse-status
  reporting with modification-time caching for large projects.
- Added current-file compilation command and working-directory inspection,
  including clear fallback-flags and header-inference explanations.
- Added workspace clangd diagnostic totals, missing-include counts, and
  current-file diagnostic summaries.
- Added dedicated Refresh Project Diagnostics and Show clangd Log title-bar
  actions.

## 0.7.4

- Restored Code Preview Lock Preview to its always-visible webview toolbar and
  removed its view-title Pin/Unpin commands.
- Retained the standardized fixed-position title-bar Pin/Unpin buttons for
  Context, References, Callers, and Callees.

## 0.7.3

- Moved Code Preview Lock Preview from its webview toolbar to standard
  Pin/Unpin buttons in the view title bar.
- Standardized Context, Code Preview, References, Callers, and Callees on the
  same Pin/Unpin icons and fixed menu position.
- Kept each view's existing pin semantics and ensured Context's button does not
  move when its state changes.

## 0.7.2

- Added an independent References Pin/Unpin state and title-bar buttons.
- Added one shared Call Hierarchy Pin/Unpin state; Callers and Callees each
  expose buttons and update synchronously.
- Pinned views reject editor cursor-follow updates while explicit Find
  References, Show Incoming/Outgoing, and manual Refresh operations remain
  allowed for their target views.
- Pinned symbols are displayed in the result roots. Source edits retain pinned
  content, invalidate semantic caches, and mark the views `stale`.
- Unpinned views continue following Context independently, while expansion,
  search, path search, export, and Code Preview navigation stay enabled for
  pinned views.
- Added update-policy unit tests and Extension Host command/state regression
  coverage.

## 0.7.1

- Added cancellable Caller and Callee path search from the current root to a
  function-name or qualified-name fragment.
- Path search reuses Incoming/Outgoing caches, avoids path-local cycles, and
  enforces independent maximum depth, returned-path, and visited-node limits.
- Added result selection that previews the destination definition.
- Added Mermaid `.mmd` and fenced Markdown export for currently loaded trees,
  with semantic caller-to-callee edge direction and escaped labels.
- Labels explicit function-pointer and member-function-pointer call-site syntax
  as `possible indirect call` without fabricating unresolved targets.
- Added path-search, Mermaid direction/escaping, and indirect-call syntax unit
  tests plus Extension Host command registration coverage.

## 0.7.0

- Enhanced Callers/Callees nodes with definition locations, call-site
  children, merged call counts, and explicit direct-recursion,
  indirect-recursion, and duplicate labels.
- Added independent bounded LRU caches for Incoming and Outgoing requests,
  including concurrent request coalescing, hit/miss statistics, failed-request
  eviction, and runtime resizing.
- Invalidates call caches after source edits, clangd restarts, or hierarchy
  configuration changes while preserving loaded trees across ordinary Context
  detail refreshes.
- Added cancellable expansion to a chosen depth, optional automatic depth, and
  maximum depth/node safety limits.
- Added search over currently loaded Callers or Callees and reveal of the
  selected match.
- Added text and JSON export of the currently loaded tree without hidden
  semantic requests.
- Added settings for default depth, maximum depth, maximum nodes, and cache
  size, plus Extension Host command registration coverage.

## 0.6.2

- Added `Reference Type` to the References grouping selector.
- Type groups use a stable semantic order: Definitions, Declarations, Function
  Calls, Reads, Writes, Read/Writes, Addresses, and Other References.
- Selecting this grouping completes 0.6.1 classification before building
  groups; Macro remains an item label rather than creating extra groups.

## 0.6.1

- Added clangd `textDocument/documentHighlight` requests, cached once per
  referenced file, as the preferred semantic Read/Write evidence.
- Added Read, Write, and Read/Write categories; compound assignments and
  increment/decrement syntax override a write-only highlight.
- Added direct unary address acquisition and explicitly labelled inferred
  function-address classification for callable symbols used without a call.
- Detects macro definitions and prefixes related results with Macro, including
  combinations such as `Macro · Read`.
- Added semantic, syntax, inferred, or unknown confidence to tooltips and
  text/JSON exports; unresolved cases remain generic References.
- Added unit coverage for classification edge cases and a real clangd 20
  semantic Read-highlight integration assertion.

## 0.6.0

- Replaced the basic References tree with a stateful References Explorer.
- Added Definition, Declaration, direct Function Call, and fallback Reference
  classification. Advanced Read/Write, address, and macro analysis remains
  scheduled for 0.6.1.
- Added source/path/type filtering and file, directory, enclosing-function, or
  flat grouping; grouping persists per workspace.
- Added temporary All, Workspace, Current Directory, and Current File scopes,
  while retaining configured system and excluded-path filtering.
- Added progressive result creation with configurable page size, Load More,
  and Show All actions.
- Kept source reads lazy for visible rows; explicit search/export uses bounded
  concurrency, and function grouping requests document symbols once per file.
- Added copy-one, copy-all, text/JSON export, plain-text result-list, and group
  expand/collapse commands.
- Added loading, empty, filtered-empty, failed, result-count, and query-duration
  presentation.
- Preserved manual Reference-to-Code Preview navigation while Code Preview is
  locked.

## 0.5.0

- Added exact character-range highlighting for the active Code Preview target.
- Single-clicking a symbol in Code Preview now requests its definition and
  continues navigation inside the preview.
- Double-clicking source opens the exact clicked position in the main editor;
  its delayed single-click action is cancelled.
- Added bounded, branching Back and Forward preview history.
- Added a Code Preview lock that blocks editor cursor-follow updates while
  retaining in-preview definition navigation.
- Added toolbar actions to copy selected/preview code, copy the current path
  and line, and open the current target in the editor.
- Added configurable `cInsight.codePreview.linesBefore` and `linesAfter`
  context sizes.
- Enabled Webview interaction under a nonce-restricted Content Security Policy,
  with extension-side source position validation and cancellable definition
  requests.
- Recorded deferred full semantic context menus and per-target scroll
  restoration in `docs/roadmap.md`.

## 0.3.0

- Split cursor-following analysis into an immediate lightweight symbol context
  and delayed references/caller/callee details.
- Added LSP cancellation so stale cursor requests stop consuming clangd work.
- Coalesced identical in-flight requests and report uncancelled clangd requests
  taking at least one second.
- Stopped loading source snippets for collapsed or off-screen tree results;
  visible rows use a bounded 2000-line LRU cache.
- Suspended expensive cursor details while C Insight navigation views are not
  visible and refresh them when the views become visible.
- Debounced document-symbol updates while typing and rejected stale results.
- Added `cInsight.followCursorDetailsDelay` and an Extension Host regression
  scenario that rapidly moves the cursor before navigation queries.

## 0.2.3

- Fixed multiline clangd information logs being split so that continuation
  lines, such as a compilation directory and command, appeared as errors.
- Real `error:` and `warning:` diagnostics still override the inherited log
  level.

## 0.2.2

- Changed Code Preview to a fixed-height layout with an independently scrolling
  code region, keeping the horizontal scrollbar visible at the bottom of the
  preview window at every vertical position.

## 0.2.1

- Fixed Code Preview long lines being compressed by its flex layout.
- Added a horizontal scrolling region for source lines wider than the preview
  window.

## 0.2.0

- Replaced the Definition tree with a shared Code Preview webview that displays
  highlighted definition, declaration, reference, caller, callee-definition,
  and call-site snippets.
- Added inline source snippets to References, Callers, and Callees and preserved
  explicit editor navigation through the result context menu.
- Expanded Context with symbol identity, qualified name, type/signature,
  declaration locations, and first-level caller/callee counts.
- Classified clangd protocol output by its real severity so ordinary `I[...]`
  request/reply traffic is no longer displayed as an error.
- Added pure unit coverage and a real VS Code Extension Host E2E test covering
  clangd-backed definition, references, Code Preview, and Callees commands.

## 0.1.3

- Prefer the highest installed clangd from versions 22, 21, and 20 before the
  unversioned executable.
- Added clangd version discovery and Callees capability diagnostics.
- Callees now reports a clear clangd 20+ requirement instead of rejecting a
  tree expansion on older servers.
- Added a real clangd 20 outgoing-calls integration test.

## 0.1.2

- Fixed coexistence with another clangd client by not registering clangd's
  global execute commands such as `clangd.applyFix`.
- Kept document synchronization and all navigation providers enabled.
- Added regression tests for language-client feature filtering.

## 0.1.1

- Fixed clangd startup with vscode-languageclient 10 by avoiding the unsupported
  `--stdio` argument.
- Coalesced concurrent startup requests so cursor and symbol queries cannot
  create multiple clangd clients.
- Disabled automatic crash loops and improved failed-state shutdown handling.
- Added a real clangd LSP handshake regression test.

## 0.1.0

- Initial clangd-powered MVP.
- Definition, references, document/workspace symbols, callers, and callees.
- Cursor following, pinning, status, configuration, and restart support.
