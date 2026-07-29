# Changelog

## 0.13.0

- Expanded Project Diagnostics with compiler, language, standard, user/system/
  quote include paths, defines, forced includes, and response-file breakdowns.
- Added conservative same-name/same-directory compile-command candidates for
  headers while clearly distinguishing them from clangd's unobservable actual
  inferred command.
- Displayed configured fallback flags when no direct or candidate compilation
  database entry is available.
- Added one schema-versioned diagnostic report shared by the tree, clipboard
  copy, plain-text export, and JSON export.
- Included clangd state/version, index progress, database metadata, command
  source, and current-file diagnostics in exported reports.

## 0.12.12

- Fixed a closed Relationship Graph being restored when the workspace or VS
  Code was opened again.
- Distinguished explicit panel close from extension shutdown: only a graph
  that was still open at shutdown remains eligible for session restore.
- Saved the workspace session immediately after an explicit graph close so a
  quick Reload Window cannot revive the previous snapshot.

## 0.12.11

- Added bidirectional incremental source loading when Code Preview is scrolled
  near its top or bottom edge.
- Inserted newly rendered lines in place while preserving vertical anchors,
  horizontal scroll, semantic coloring, and navigation behavior.
- Added a bounded loaded-line window that trims the distant edge and reloads it
  on demand instead of allowing unbounded Webview DOM growth.
- Added configurable incremental loading, batch size, and maximum loaded lines.
- Reused document-version semantic-token results across every loaded batch.

## 0.12.10

- Code Preview now shows a pointer cursor over semantic symbols that can be
  clicked to continue Definition browsing.
- Kept the text cursor for keywords, operators, literals, and comments so
  non-navigation syntax does not look actionable.

## 0.12.9

- Added editor-grade semantic symbol classification to Code Preview through
  the active VS Code Document Semantic Tokens provider.
- Layered function, method, variable, parameter, type, namespace, macro, and
  modifier styling over the existing keyword/string/comment lexical fallback.
- Preserved exact target-range highlighting and all preview click/navigation
  behavior when semantic spans split a source line.
- Added bounded, versioned preview token caching with edit, configuration, and
  visible-theme refresh handling.
- Added settings to disable semantic highlighting or tune its cache size.
- Kept semantic-provider failures non-fatal with an automatic lexical fallback.

## 0.12.8

- Added versioned, bounded Relationship Graph snapshots to Workspace Session.
- Restored loaded nodes/edges, selection, relation filters, collapsed branches,
  and viewport pan/zoom without issuing clangd or Include queries.
- Revalidated restored function/type nodes only when the user explicitly
  continues semantic expansion.
- Added root-file availability checks and lazy `missing` state for other
  deleted graph locations.
- Added configurable graph-session restore and snapshot node limit; oversized
  node/edge graphs safely degrade to a root-only snapshot.
- Added strict graph-section parsing so malformed or incompatible graph state
  is dropped without rejecting the rest of the workspace session.

## 0.12.7

- Added explicit Definition ownership edges so one graph can connect source
  files, C++ types, and callable symbols.
- Added Add Defining File for function/type nodes; the resulting file node can
  immediately expand Includes and Included By.
- Added cancellable Add Type Members; loaded callable members can immediately
  expand Callers and Callees.
- Added Add Containing Type for callable nodes, including a qualified
  out-of-class definition fallback.
- Added a Definition filter, orange dash-dot edge style, legend entry, and
  export support.
- Kept all cross-relation growth explicit and bounded by the existing graph
  node, edge, and depth limits.

## 0.12.6

- Coalesced graph mutations, pan/zoom, and resize work to one render per
  animation frame.
- Replaced full SVG layer rebuilds with stable-ID keyed node/edge
  reconciliation.
- Added viewport virtualization with a graph-space buffer so large loaded
  graphs retain only nearby SVG elements.
- Replaced repeated edge scans in layered ranking with linear adjacency-list
  traversal.
- Added throttled slow-render diagnostics and last-render timing in the graph
  status tooltip.
- Released expansion work, semantic graph state, layout caches, and SVG caches
  when the graph panel closes.
- Added a 5,001-node/5,000-edge host-model performance regression test.

## 0.12.5

- Added distinct Call, Inheritance, and Include edge colors/line styles plus an
  always-visible graph legend; recursive and cyclic edges are emphasized.
- Added node state labels for expandable, expanded, duplicate, cycle,
  unresolved, and locally collapsed nodes.
- Added Collapse Branch and Expand Branch without deleting host graph data or
  semantic request caches.
- Preserved pan, zoom, and existing node positions across graph expansion;
  automatic Fit now occurs only for a new root.
- Added visible/loaded node and edge statistics, filter-aware edge counts,
  keyboard node navigation, keyboard preview/open, and accessible labels.

## 0.12.4

- Added File Relationship Graph roots through the explicit Show File
  Relationship Graph command.
- Added on-demand Includes and Included By expansion with semantic
  Includer → Included edges, unresolved targets, cycle detection, and
  multi-level expansion.
- Added a shared Include Hierarchy repository for forward-resolution caching
  and one common reverse workspace index.
- Kept reverse-index construction demand-driven: opening/exporting/searching a
  file graph or expanding only Includes does not build Included By.

## 0.12.3

- Added C++ Type Graph roots with on-demand Supertypes and Subtypes expansion.
- Added a shared Type Hierarchy repository so tree views and the graph reuse
  identical cached clangd requests.
- Added multi-level Type Graph expansion, search, bookmarks, navigation, and
  Text/JSON/Mermaid export through the existing graph interactions.
- Standardized inheritance edges as Supertype → Subtype and verified both
  function and type roots in the VS Code end-to-end suite.

## 0.12.2

- Added cancellable multi-level Call Graph expansion from any selected node,
  with visible completion, cancellation, failure, and graph-limit status.
- Added loaded-node search and node context actions for expansion, bookmarks,
  navigation, and focus.
- Added Text, JSON, and Mermaid export from the graph toolbar and command
  palette.
- Changed the layered Call Graph layout to place callers left of the root and
  callees to its right.

## 0.12.1

- Added a shared Call Hierarchy repository so the native trees and
  Relationship Graph reuse the same bounded Incoming/Outgoing request caches.
- Show Relationship Graph now prepares the callable symbol under the cursor
  and retains clangd's opaque call item for subsequent graph expansion.
- Added Expand Callers, Expand Callees, and Stop actions for the selected graph
  node, with cancellable progress and clangd 20 outgoing-call diagnostics.
- Maps calls into semantic Caller → Callee edges, merges repeated targets, and
  labels direct or indirect recursion without duplicating graph entities.
- Enforces graph depth, node, and edge budgets while expanding Call Graph data.
- A positive `relationshipGraph.defaultDepth` loads the root's first Caller
  and Callee level; zero keeps the root collapsed.

## 0.12.0

- Added the Relationship Graph foundation as an editor-area WebviewPanel.
- Added a pure, bounded graph model with stable semantic node/edge IDs,
  duplicate merging, revisions, stale state, node/edge budgets, and
  JSON/Mermaid export primitives.
- Added a strict nonce-based CSP and validated Webview-to-host message
  protocol; the Webview renders data but never reads files or calls clangd.
- Added native SVG rendering with pan, zoom, Fit, Reset Layout, relationship
  filters, selection, and double-click editor navigation.
- Added **Show Relationship Graph** for the active local C/C++ file. This
  foundation release creates a file root only and deliberately performs no
  Call, Type, Include, or Included By queries yet.
- Added `cInsight.relationshipGraph.defaultDepth`, `maximumDepth`,
  `maximumNodes`, `maximumEdges`, `layout`, and `includeSystemHeaders`.

## 0.11.10

- Builds the Included By reverse index in isolated temporary maps and publishes
  it atomically only after a complete, current scan.
- Cancels in-progress reverse indexing when compilation database, include
  configuration, or workspace analysis state invalidates the index.
- Uses a generation check so an obsolete scan cannot overwrite a newer index
  after invalidation.
- Queues file create/change/delete events received during scanning and applies
  them before the completed index becomes visible.
- Keeps a cancelled partial scan unavailable so the next explicit expansion
  starts from a clean rebuild.
- Pins E2E tests to a known cached VS Code runtime by default while allowing
  `C_INSIGHT_VSCODE_TEST_VERSION` to select another version explicitly.

## 0.11.9

- Added one shared Text, JSON, and Mermaid renderer for Call, Type, and Include
  Hierarchy.
- Standardized JSON exports with `schemaVersion`, `relation`, `direction`,
  `edgeDirection`, and `roots` metadata.
- Standardized node fields as `name`, `description`, `uri`, optional
  `sourceUri`/`line`, `states`, and `children`.
- Normalizes duplicate, cycle, recursion, maximum-depth, maximum-node,
  cancellation, and possible-indirect-call states in exports.
- Preserves semantic arrow direction for all six relationship views and still
  exports loaded nodes only.

## 0.11.8

- Added a shared hierarchy-tree state model for node counts, duplicate
  detection, reset, limit checks, and remaining budgets.
- Migrated Call, Type, and Include Hierarchy to the common state model.
- Made `maximumNodes` apply independently to Callers and Callees.
- Made `maximumNodes` apply independently to Supertypes and Subtypes.
- Added unit tests proving that direction state and budgets remain isolated.

## 0.11.7

- Added consistent in-tree status rows after a hierarchy batch expansion is
  cancelled or reaches its configured depth or node limit.
- Status rows name the relevant `maximumDepth` or `maximumNodes` setting and
  preserve all nodes loaded before stopping.
- Labels terminal Call, Type, and Include Hierarchy nodes with `max depth`.
- Added a shared, tested expansion-outcome model used by all hierarchy views.

## 0.11.6

- Standardized hierarchy view-title actions as Show, Expand to Depth, Search
  Loaded, Stop Expansion, followed by relationship-specific actions.
- Added always-visible Show and Stop buttons to Callers/Callees and
  Supertypes/Subtypes where they were previously missing.
- Added Callers/Callees Text, JSON, and Mermaid exports to the same overflow
  menu layout used by Type and Include Hierarchy.
- Standardized hierarchy export menu grouping and added the missing Call
  Hierarchy stop icon.

## 0.11.5

- Added a cancellable progress notification while Included By builds its
  reverse workspace index for the first time.
- Reports indexed and total file counts during the scan.
- Detects when `workspaceFileLimit` truncates discovery and warns that Included
  By results may be incomplete.
- Reuses a completed index without displaying progress or rescanning.

## 0.11.4

- Made Show Includes and Show Included By update only their corresponding
  views.
- Separated roots, node budgets, duplicate tracking, stale state, automatic
  expansion, and cancellation between the two directions.
- Kept the resolver and reverse workspace index shared so repeated reverse
  queries can reuse prior scanning without coupling view state.

## 0.11.3

- Added always-visible Show Includes and Show Included By view-title buttons.
- Made each empty-state prompt directly execute its corresponding query.
- Reports a clear warning when no local C/C++ file is active.

## 0.11.2

- Added Includes and Included By views for C/C++ files.
- Resolves includes using source-relative, compilation-database
  `-iquote`/`-I`/`-isystem`, workspace, and common system paths.
- Builds the reverse Included By workspace index only when first needed, then
  updates it as files change.
- Added lazy bounded expansion, cycle/duplicate detection, loaded-node search,
  cancellation, classification, and Text/JSON/Mermaid export.
- Integrated include nodes with Code Preview, editor navigation, and
  bookmarks.

## 0.11.1

- Added independent automatic-query scheduling for Context, Code Preview,
  References, Callers, and Callees visibility.
- Stops automatic semantic cursor queries when every navigation view is
  hidden.
- Queries References only while References is visible; queries incoming or
  outgoing counts only when Context and the corresponding call view are both
  visible.
- Code Preview-only following requests Definition without unrelated semantic
  details.
- Callers/Callees-only following prepares lazy roots without preloading
  first-level calls.
- Document Symbols now queries only while its view is visible.
- Manual navigation, tree expansion, indexing, diagnostics, bookmarks, and
  session persistence retain their existing behavior.

## 0.11.0

- Added Supertypes and Subtypes views using the standard LSP Type Hierarchy
  protocol supported by clangd 20.
- Added lazy multi-level expansion with recursion, duplicate, maximum-depth,
  and maximum-node protection.
- Added loaded-node search, explicit depth expansion, cancellation, and Text,
  JSON, or Mermaid export.
- Integrated type nodes with Code Preview, Open Location, Navigation History,
  and Bookmarks.
- Marks loaded type hierarchies stale after source changes, clangd restarts, or
  type-hierarchy configuration changes.
- Added `cInsight.typeHierarchy.defaultDepth`, `maximumDepth`, and
  `maximumNodes`.

## 0.10.0

- Added a versioned, workspace-scoped browsing-session snapshot with five-second
  autosave and graceful-shutdown save.
- Restores Navigation History and its cursor/filter, Code Preview target and
  lock, Reference filters/page limit, and Symbol Search query/type filter.
- Restores Callers/Callees by re-resolving the saved root with clangd and
  rebuilding the previously loaded maximum depth instead of trusting old
  semantic results.
- Added automatic snapshot expiry, optional History and Call Hierarchy
  persistence, manual Restore Previous Session, and Clear Saved Session.
- Added `cInsight.session.restore`, `persistNavigationHistory`,
  `restoreCallHierarchy`, and `maximumAgeDays`.

## 0.9.3

- Added bookmark filtering across labels, groups, file URIs, and captured
  symbols.
- Added workspace-persistent Name, File Path, Source Position, Creation Time,
  and Last Updated sorting.
- Added versioned JSON import and export, with append/update and confirmed
  replace modes.
- Added duplicate-position merging, import validation, and missing-file stale
  markers.
- Added bookmark-group rename/merge, group export, and confirmed group delete.
- Added `cInsight.bookmarks.sortBy`.

## 0.9.2

- Added a dedicated Symbol Search view backed by clangd `workspace/symbol`.
- Added debounced live search with stale-response suppression and configurable
  result limits.
- Added Symbol Type, File, Directory, and flat result grouping.
- Added temporary multi-select symbol-kind filtering.
- Integrated symbol results with Code Preview, Open Location, Navigation
  History, and Bookmarks.
- Added `cInsight.symbolSearch.groupBy`, `maximumResults`, and `debounce`.

## 0.9.1

- Added a workspace-persistent Bookmarks view grouped by user-defined names.
- Added Bookmark Current Symbol and Add Bookmark actions for editor and C
  Insight location nodes.
- Added bookmark rename, group move, delete confirmation, refresh, Code Preview
  selection, and Open Location integration.
- Deduplicates bookmarks at the same file position while retaining stable IDs
  and user labels.
- Marks bookmarks stale after document edits, then uses the captured identifier
  to relocate to the closest whole-symbol occurrence after a debounce.
- Persists bookmark labels, groups, semantic preview modes, locations, symbols,
  and stale state in VS Code workspaceState.

## 0.9.0

- Added a session-scoped Navigation History view for Definition, Declaration,
  Reference, Caller, Callee, and Code Preview navigation.
- Integrated Code Preview Back/Forward with the shared history cursor,
  including forward-branch truncation after new navigation.
- Added consecutive duplicate merging and bounded history retention.
- Added history filtering by navigation origin and a Clear History action.
- History selection previews without creating duplicate entries; Open Location
  remains available from the item context menu.
- Added `cInsight.history.maximumEntries` and
  `cInsight.history.mergeConsecutiveDuplicates`.

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
