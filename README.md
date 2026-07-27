# C Insight

C Insight is a Source Insight-style C/C++ navigation extension for VS Code. It
starts and manages its own `clangd` process and keeps symbol context, source
previews, references, callers, callees, and document symbols visible in a
dedicated activity-bar container.

完整中文说明见随扩展发布的 `docs/user-guide.zh-CN.md`。

## MVP features

- Go to definition and find references
- Shared Code Preview with highlighted definition, declaration, reference,
  caller, callee definition, and call-site snippets
- Incoming and outgoing call trees with lazy loading and recursion detection
- C++ supertype and subtype trees with lazy expansion, search, and export
- Cursor-following context with symbol identity, type/signature, definition,
  declaration, reference count, and first-level caller/callee counts
- Source snippets directly in References, Callers, and Callees result rows
- Document symbol outline and a Symbol Search view with live clangd workspace
  queries, type filtering, and configurable grouping
- Session navigation history with shared Code Preview Back/Forward
- Workspace-persistent grouped bookmarks with filtering, sorting, JSON
  import/export, group management, and stale relocation
- Workspace-scoped browsing-session restore for history, preview, reference
  filters, symbol search, and revalidated call-hierarchy depth
- `compile_commands.json`, `.clangd`, and fallback flags
- clangd lifecycle, status, logs, restart, and provider-conflict warning
- Large-workspace request cancellation, staged context loading, in-flight
  request coalescing, lazy source snippets, and bounded source-line caching

## Usage

1. Open a C or C++ workspace, then select the C Insight icon in the Activity
   Bar.
2. Put the cursor on a function or variable. Context and Code Preview follow
   the cursor automatically.
3. Expand References, Callers, or Callees. Selecting a result updates Code
   Preview without moving the editor; use **Open Location** from the result's
   context menu to navigate.
4. Single-click a symbol inside Code Preview to preview its definition. A
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
   Insight browsing session. Call hierarchy data is queried again from clangd.
10. In C++, place the cursor on a class or struct and choose Show Supertypes or
    Show Subtypes. Select a type to preview it; use the view menu for depth
    expansion and Text, JSON, or Mermaid export.

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
results. Source lines and Function Call classification are resolved only when
rows become visible, unless a source-text search or export explicitly needs
all matching lines.

Additional commands can copy one or all results, export text or JSON, open a
plain-text result list, and expand or collapse groups.

References has an independent Pin button. Callers and Callees each show a Pin
button but share one synchronized Call Hierarchy pin state. Pinning blocks only
automatic editor-cursor updates; explicit Find References, Show
Incoming/Outgoing, or Refresh commands can replace the corresponding pinned
content. Expansion, search, path search, export, and Code Preview selection
remain active. Source edits retain pinned results and label them `stale` until
an explicit refresh. Per-view pin state lasts for the current VS Code session.

### Project diagnostics

The Project Diagnostics view reports the clangd state, selected executable and
version, detected `compile_commands.json`, and the compile command used for the
active source file. It also summarizes clangd errors, warnings, and missing
includes across the workspace, with current-file messages available as child
items. The view refreshes when the active editor, clangd state, diagnostics, or
compilation database changes. Its title-bar actions provide manual refresh and
direct access to the classified **C Insight: clangd** log.

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
to inspect every reason, including clangd availability, indexing, compilation
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
- `cInsight.followCursor`
- `cInsight.followCursorDelay`
- `cInsight.followCursorDetailsDelay`
- `cInsight.codePreview.linesBefore`
- `cInsight.codePreview.linesAfter`
- `cInsight.references.pageSize`
- `cInsight.references.groupBy`
- `cInsight.callHierarchy.defaultDepth`
- `cInsight.callHierarchy.maximumDepth`
- `cInsight.callHierarchy.maximumNodes`
- `cInsight.callHierarchy.cacheSize`
- `cInsight.callHierarchy.pathSearchMaximumDepth`
- `cInsight.callHierarchy.pathSearchMaximumPaths`
- `cInsight.callHierarchy.pathSearchMaximumNodes`
- `cInsight.exclude`

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
