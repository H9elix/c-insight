# C Insight

C Insight is a Source Insight-style C/C++ navigation extension for VS Code. It
starts and manages its own `clangd` process and keeps symbol context, source
previews, references, callers, callees, and document symbols visible in a
dedicated activity-bar container.

Demand-driven tree views use a shared status contract for idle, loading,
empty, cancelled, stale, limited, and failed operations. Idle rows explain how
to trigger the first query; failure details remain available in descriptions
and tooltips without overwhelming the result label.

完整中文说明见随扩展发布的 `docs/user-guide.zh-CN.md`。
该手册包含完整功能/窗口矩阵、全部配置默认值与范围、状态持久化说明，以及从
`package.json` 自动生成的全部命令与菜单入口参考。

## Developer and maintenance

- Developer and maintainer: `youjinchun`
- License: MIT
- Semantic engines: clangd by default; Microsoft C/C++ Provider is available
  as an explicit opt-in mode
- Microsoft integration: 0.18.0 contains the isolated feasibility evidence;
  0.18.1 adds the opt-in production adapter, 0.18.2 validates its effective
  configuration and known Provider conflicts, and 0.18.3 adds per-query
  performance observability; 0.18.4 contains cpptools Call Hierarchy load and
  crash-containment improvements; 0.18.5 decouples Code Preview and provides a
  References-based Microsoft Callers fallback; 0.18.6 prevents semantic-token
  rendering from blocking cross-file Preview navigation; 0.18.7 removes the
  disproven defensive workarounds while retaining those fixes; 0.18.8 handles
  cpptools' non-standard C function symbol kind in the safe Callers mapping;
  0.18.9 clarifies approximate empty Callers results and identifies the active
  Microsoft semantic provider to the user; 0.18.10 distinguishes absent
  References evidence from references that cannot be mapped to caller functions;
  0.18.11 exposes those loaded-node evidence totals in Project Diagnostics
- Telemetry: none; C Insight does not upload source code
- Public repository and issue tracker: not configured yet

Use **C Insight: About** to inspect or copy the installed version and host
information. Development requirements and quality gates are in
`CONTRIBUTING.md`; disclosure guidance and data boundaries are in `SECURITY.md`
and `PRIVACY.md`.

Microsoft-provider probe design, reproducible commands, results, and API
boundaries are documented in `docs/microsoft-provider-probe.zh-CN.md`.
The optional `npm run test:e2e:ffmpeg:microsoft` gate opens the workspace from
`C_INSIGHT_FFMPEG_WORKSPACE` (default `/home/user/projects/FFmpeg`) in an
isolated Extension Host and verifies cross-file Code Preview plus the safe
References-based Callers path without invoking native Incoming Calls.

## MVP features

- Go to definition and find references
- Explicit `cInsight.engine` selection between managed clangd and the installed
  Microsoft C/C++ Provider; changing engines requires Reload Window
- Shared Code Preview with highlighted definition, declaration, reference,
  caller, callee definition, and call-site snippets
- Incoming and outgoing call trees with lazy loading and recursion detection
- C++ supertype and subtype trees with lazy expansion, search, and export
- Forward Includes and reverse Included By trees with compile-command-aware
  header resolution, lazy expansion, search, cycle detection, and export
- Editor-area Call, C++ Type, and File Include Relationship Graph with bounded
  multi-level and explicit cross-relation expansion, semantic layered layout,
  search, bookmarks, export,
  stable pan/zoom, filtering, branch collapse, state labels, keyboard access,
  viewport-virtualized SVG rendering, preview, and editor navigation
- Cursor-following context with symbol identity, type/signature, definition,
  declaration, reference count, and first-level caller/callee counts
- Source snippets directly in References, Callers, and Callees result rows
- Document symbol outline and a Symbol Search view with live clangd workspace
  queries, type filtering, and configurable grouping
- Session navigation history with shared Code Preview Back/Forward
- Workspace-persistent grouped bookmarks with filtering, sorting, JSON
  import/export, group management, and stale relocation
- Workspace-scoped browsing-session restore for history, preview, reference
  filters, symbol search, revalidated call-hierarchy depth, and static
  Relationship Graph snapshots
- `compile_commands.json`, `.clangd`, and fallback flags
- clangd lifecycle, status, logs, restart, and provider-conflict warning
- Large-workspace request cancellation, staged context loading, in-flight
  request coalescing, lazy source snippets, and bounded source-line caching
- Per-view visibility scheduling that pauses cursor semantics when navigation
  views are hidden and avoids querying unrelated hidden relationships

## Usage

All hierarchy views use the same title-action order: Show, Expand to Depth,
Search Loaded, Stop Expansion, then relationship-specific actions. Text, JSON,
and Mermaid exports are consistently available from each hierarchy view's
overflow menu.

After bounded expansion is cancelled or reaches `maximumDepth` or
`maximumNodes`, the affected view keeps its loaded nodes and shows an in-tree
status row naming the relevant setting. Terminal nodes at the configured depth
boundary are labelled `max depth`.

Each hierarchy direction has an independent `maximumNodes` budget: loading
Callers does not reduce the Callees budget, and loading Supertypes does not
reduce the Subtypes budget.

Hierarchy JSON exports use one versioned envelope with relation and semantic
edge-direction metadata plus normalized node states. Text and Mermaid use the
same loaded-node model, so all formats agree on duplicates, cycles, recursion,
and safety-limit markers.

1. Open a C or C++ workspace, then select the C Insight icon in the Activity
   Bar.
2. Put the cursor on a function or variable. Context and Code Preview follow
   the cursor automatically.
3. Expand References, Callers, or Callees. Selecting a result updates Code
   Preview without moving the editor; use **Open Location** from the result's
   context menu to navigate.
4. Single-click a symbol inside Code Preview to preview its definition. A
   pointer cursor identifies semantic symbols that can continue navigation. A
   double-click opens the exact source position in the main editor.
5. Use the Code Preview toolbar to move backward or forward, lock cursor
   following, copy code, copy the path, or open the current target.
6. Use `F12` for definition, `Shift+F12` for references, or the editor context
   menu for incoming and outgoing calls.
7. Pin Context when you want all context views to stop following cursor
   movement. Context, References, Callers, and Callees use fixed-position
   Pin/Unpin title-bar buttons. The Code Preview lock only prevents editor
   cursor updates and still permits single-click definition browsing inside
   the preview.
8. Open Symbol Search and use its search button for workspace-wide function,
   variable, type, and macro lookup. Select a result to preview it, or use Open
   Location and Add Bookmark from its context menu.
9. Reopen the same folder or `.code-workspace` to restore the previous C
   Insight browsing session. Restore is sectioned, cancellable, Remote-aware,
   and completed before cursor following starts. Call hierarchy data is queried
   again from clangd; oversized snapshots degrade within a configurable total
   byte budget.
10. In C++, place the cursor on a class or struct and choose Show Supertypes or
    Show Subtypes. Select a type to preview it; use the view menu for depth
    expansion and Text, JSON, or Mermaid export.
11. In a C/C++ file, choose Show Includes to follow its include directives, or
    Show Included By to find workspace files that include it. Included By
    builds its reverse workspace index only when first expanded.
12. Put the cursor on a function and choose **Show Relationship Graph** to open
    a Call Graph beside the editor. Select any function node and use Expand
    Callers, Expand Callees, or Expand to Depth; Stop cancels the active
    request. Search locates loaded nodes, the node context menu supports
    bookmarks, and Text/JSON/Mermaid export never triggers new queries. If no
    callable symbol is under the cursor, the active file is used as a
    non-callable root.
13. Put the cursor on a C++ class or struct and run the same command to open a
    Type Graph. Expand Supertypes or Subtypes from any loaded type; inheritance
    arrows always point from the base type to the derived type.
14. Run **Show File Relationship Graph** to use the active source/header as a
    file root. Expand Includes or Included By from any resolved file node.
    Opening the graph and forward-only expansion do not build the reverse
    workspace index.
15. In any Relationship Graph, right-click a function/type to add its defining
    file, a type to add callable members, or a callable to add its containing
    type. Definition edges connect the domains; the new nodes retain their
    normal Call, Inheritance, or Include expansion actions.

For large workspaces, the inexpensive symbol identity and definition preview
appear first. References and first-level call counts load after the cursor has
remained stable for `cInsight.followCursorDetailsDelay` milliseconds. Moving
again cancels the stale clangd work. Requests taking at least one second are
reported in the C Insight output channel as `Slow clangd request`.

### Symbol Search

Symbol Search sends debounced `workspace/symbol` queries to clangd as you type.
Results remain in the view after the picker closes. Its title buttons search,
filter symbol kinds, change grouping, refresh the last query, or clear it.
Selecting a result updates Code Preview; its context menu opens the editor or
adds a workspace bookmark.

### Bookmarks

Bookmarks persist per workspace and can be filtered by label, group, path, or
symbol. Sort each group by name, path, source position, creation time, or last
update. The title bar imports or exports a versioned JSON file; imports can
merge duplicate positions or replace the current collection. Group context
menus rename or merge, export, and delete complete groups.

### References Explorer

References are classified as Definition, Declaration, Function Call, Read,
Write, Read/Write, Address, or a conservative fallback Reference. Macro-symbol
results carry a Macro prefix. Read and Write prefer clangd semantic document
highlights; compound updates, direct address syntax, and non-called function
uses add syntax or explicitly labelled inferred evidence. Classification
confidence is included in row tooltips and exported results.

Use the References title buttons to filter results, switch between
file/directory/function/reference-type/flat grouping, and restrict results to
the workspace, current directory, or current file. Reference Type creates
Definitions, Declarations, Function Calls, Reads, Writes, Read/Writes,
Addresses, and Other References groups. The grouping choice is saved per
workspace; scope filters are temporary.

Only the first `cInsight.references.pageSize` results are added initially.
Choose **Load More References** or **Show All References** for additional
results, up to `cInsight.references.maximumDisplayedResults`. Source lines and Function Call classification are resolved only when
rows become visible, unless a source-text search or export explicitly needs
all matching lines.

Additional commands can copy one or all results, export text or JSON, open a
plain-text result list, and expand or collapse groups. Bulk output is bounded
by `cInsight.export.maximumResults`; file exports also enforce
`cInsight.export.maximumMegabytes`. Reference export preparation reports
progress and can be cancelled.

References has an independent Pin button. Callers and Callees each show a Pin
button but share one synchronized Call Hierarchy pin state. Pinning blocks only
automatic editor-cursor updates; explicit Find References, Show
Incoming/Outgoing, or Refresh commands can replace the corresponding pinned
content. Expansion, search, path search, export, and Code Preview selection
remain active. Source edits retain pinned results and label them `stale` until
an explicit refresh. Per-view pin state lasts for the current VS Code session.

### Project diagnostics

The Project Diagnostics view reports the selected analysis engine, lifecycle
state, detected `compile_commands.json`, and the compile command used for the
active source file. Clangd mode includes executable, version, and index data;
Microsoft mode includes extension version, effective IntelliSense setting,
known Provider conflicts, and verification evidence. It summarizes Language
diagnostics, warnings, and missing includes across the workspace, with
current-file messages available as child items. The view refreshes when the
active editor, engine state, diagnostics, or compilation database changes.
Its title-bar actions retain direct access to the clangd log for clangd mode.

The active command is broken down into compiler, language, standard, user,
system, and quote include paths, definitions, forced includes, and response
files. Headers show a same-directory source candidate as diagnostic guidance
without claiming it is clangd's actual inferred command. The complete report
can be copied or exported as versioned JSON or plain text.

The `Runtime Performance` group exposes a session-scoped snapshot of semantic
request queueing and latency, request outcomes, cache occupancy and eviction,
resource-limit hits, and configured safety limits. Copied and exported reports
include the same snapshot without request parameters or source content.

When `cInsight.compileCommandsDir` is empty, C Insight searches the workspace
root and common build directories before searching other workspace locations.
The selected directory is passed to clangd automatically. Use **C Insight:
Select Compilation Database** to choose a specific `compile_commands.json`, or
**C Insight: Use Automatic Compilation Database Detection** to clear that
choice. When the active database changes, C Insight offers to restart clangd
after build-system writes have settled.

Project Diagnostics also listens to clangd's standard background-index progress
stream. While indexing, it displays the completed and total file counts,
percentage, and last update time. When no work remains it reports `idle`; when
`cInsight.backgroundIndex` is disabled it reports `disabled`. The title-bar
**Restart Background Indexing** action restarts clangd so it can rescan the
active compilation database and changed files. Clangd's progress protocol does
not expose the name of the file currently being indexed.

The bottom status bar is the single location for global analysis reliability.
It reports Ready, live Indexing percentage, Limited, or Unavailable. Hover it
to inspect every reason, including engine availability, indexing, compilation
database and current-file commands, and missing includes; select it to open
Project Diagnostics. References, Callers, and Callees do not duplicate this
warning, though empty results still use “not found yet” wording while global
limitations are active.

Results are marked `stale` separately when their source predates an active-file
edit, clangd restart, analysis configuration or compilation database change,
or a new indexing pass. Existing results remain usable; explicitly running the
corresponding References or Call Hierarchy query replaces them and clears the
stale marker.

### Advanced Call Hierarchy

Callers and Callees distinguish definition nodes from their call-site
children, show source locations and merged call counts, and label direct
recursion, indirect recursion, and duplicate functions. Incoming and Outgoing
requests use separate bounded LRU caches and coalesce concurrent requests.
Caches are invalidated by source edits, clangd restarts, and call-hierarchy
configuration changes.

Use **Expand Callers/Callees to Depth** to load a bounded subtree. The operation
can be cancelled and respects `maximumDepth` and `maximumNodes`. Search operates
only on the tree already loaded in memory. Text and JSON export likewise avoid
triggering hidden expansion.

Use **Find Caller/Callee Path** to search the semantic graph from the current
root to a function-name fragment. Path search is cancellable, reuses hierarchy
caches, avoids cycles within each path, and has independent depth/path/node
limits. Selecting a result previews its destination definition.

Mermaid export writes semantic call direction for both trees and exports only
loaded nodes. Explicit function-pointer forms such as `(*callback)(value)` and
member-function-pointer calls are labelled `possible indirect call`; clangd
cannot provide targets for unresolved indirect calls, so C Insight does not
invent missing nodes.

### Include Hierarchy

Includes resolves each `#include` from the source directory and the
`-iquote`, `-I`, and `-isystem` paths in `compile_commands.json`. Included By
scans workspace C/C++ files on demand and then maintains that reverse index as
files change. Both views load deeper relations only when expanded, detect
cycles and duplicates, and support loaded-node search, bounded depth
expansion, cancellation, and Text, JSON, or Mermaid export.

The first Included By expansion shows cancellable file-count progress. If
workspace discovery reaches `workspaceFileLimit`, C Insight warns that reverse
results may be incomplete. A completed index is reused without rescanning.

The two views keep independent roots, loaded trees, node budgets, stale state,
and expansion cancellation. They share only resolution caches and the reverse
workspace index, so showing one direction never refreshes or automatically
expands the other.

Single-clicking an include row previews its directive. **Open Location** opens
the resolved included file. Unresolved directives remain visible with a
reason. System headers are hidden by default and can be enabled with
`cInsight.includeHierarchy.includeSystemHeaders`.

## Requirements

- VS Code 1.95 or newer
- Node.js is only required to build the extension
- `clangd` 20 or newer available on `PATH`, or configured with
  `cInsight.clangd.path`
- A `compile_commands.json` is strongly recommended for real projects

For CMake:

```sh
cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
```

## Development

```sh
npm install
npm run compile
npm test
npm run test:e2e:xvfb
```

Open this repository in VS Code and run the `Run C Insight` launch
configuration. It opens `test/fixtures/basic-cpp` in an Extension Development
Host.

To exercise background indexing in that fixture, generate its compilation
database once:

```sh
cmake -S test/fixtures/basic-cpp -B test/fixtures/basic-cpp/build \
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
```

## Settings

- `cInsight.clangd.path`
- `cInsight.clangd.arguments`
- `cInsight.compileCommandsDir`
- `cInsight.fallbackFlags`
- `cInsight.backgroundIndex`
- `cInsight.diagnostics.reportRedaction`
- `cInsight.followCursor`
- `cInsight.followCursorDelay`
- `cInsight.followCursorDetailsDelay`
- `cInsight.codePreview.linesBefore`
- `cInsight.codePreview.linesAfter`
- `cInsight.codePreview.semanticHighlighting`
- `cInsight.codePreview.semanticTokenCacheSize`
- `cInsight.codePreview.semanticTokenCacheMaximumMegabytes`
- `cInsight.codePreview.incrementalLoading`
- `cInsight.codePreview.loadBatchLines`
- `cInsight.codePreview.maximumLoadedLines`
- `cInsight.codePreview.restoreScrollPositions`
- `cInsight.codePreview.maximumScrollPositions`
- `cInsight.analysis.maximumConcurrentRequests`
- `cInsight.analysis.maximumBackgroundRequests`
- `cInsight.references.pageSize`
- `cInsight.references.maximumDisplayedResults`
- `cInsight.references.detailRequestCacheSize`
- `cInsight.references.groupBy`
- `cInsight.export.maximumResults`
- `cInsight.export.maximumMegabytes`
- `cInsight.callHierarchy.defaultDepth`
- `cInsight.callHierarchy.maximumDepth`
- `cInsight.callHierarchy.maximumNodes`
- `cInsight.callHierarchy.cacheSize`
- `cInsight.callHierarchy.pathSearchMaximumDepth`
- `cInsight.callHierarchy.pathSearchMaximumPaths`
- `cInsight.callHierarchy.pathSearchMaximumNodes`
- `cInsight.typeHierarchy.defaultDepth`
- `cInsight.typeHierarchy.maximumDepth`
- `cInsight.typeHierarchy.maximumNodes`
- `cInsight.includeHierarchy.defaultDepth`
- `cInsight.includeHierarchy.maximumDepth`
- `cInsight.includeHierarchy.maximumNodes`
- `cInsight.includeHierarchy.includeSystemHeaders`
- `cInsight.includeHierarchy.workspaceFileLimit`
- `cInsight.relationshipGraph.defaultDepth`
- `cInsight.relationshipGraph.maximumDepth`
- `cInsight.relationshipGraph.maximumNodes`
- `cInsight.relationshipGraph.maximumEdges`
- `cInsight.relationshipGraph.layout`
- `cInsight.relationshipGraph.includeSystemHeaders`
- `cInsight.exclude`

## Performance baseline

Run `npm run benchmark` to produce the versioned synthetic large-workspace
baseline. It covers 100,000 reference classifications, a 20,000-node
relationship graph, a 10,000-node hierarchy export, and 100,000 Code Preview
range updates. See `docs/performance-baseline.zh-CN.md` for scaling, JSON output,
budgets, and interpretation. This model benchmark complements rather than
replaces clangd and real-workspace acceptance testing.

Run `npm run acceptance:ffmpeg` for the read-only clangd 20 and compilation
database acceptance harness. Override the checkout and executable with
`C_INSIGHT_FFMPEG_ROOT` and `C_INSIGHT_FFMPEG_CLANGD`; optionally pass a JSON
output path after `--`. See `docs/third-phase-acceptance.zh-CN.md` for the
recorded environment, timings, interpretation, and acceptance boundaries.

## Known limitations

- The first release supports one local workspace root.
- Reference classification remains conservative for pointer side effects,
  overloaded C++ operators, templates, inline assembly, and other cases where
  clangd does not provide a semantic Read/Write highlight.
- Static call hierarchy cannot fully resolve all function pointers, runtime
  dispatch, macros, or conditional compilation.
- Installing another clangd or C/C++ semantic extension may create duplicate
  providers and duplicate indexing. C Insight filters clangd's global execute
  commands so it can coexist without command-registration failures.
