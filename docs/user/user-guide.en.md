# C Insight User Guide

This guide applies to C Insight `0.22.7`. C Insight is a Source Insight-style C/C++ navigation extension for VS Code. It follows the VS Code display language: Simplified Chinese is used for `zh-cn`, while English is the fallback for English and untranslated locales. Run **Configure Display Language** and reload the window to switch languages.

## Getting started

Open a C/C++ folder or multi-root workspace, provide a `compile_commands.json` when possible, and select **C Insight** in the Activity Bar. The default `cInsight.engine` is `clangd`; set it to `microsoft` and reload the window to use the Microsoft C/C++ language service (cpptools).

Cross-compiled bare-metal and embedded Linux projects should generate that database from the real target toolchain. Configure a narrow clangd `--query-driver` allowlist when the driver must supply target and system-header defaults; keep `--sysroot`, `--target`, CPU/ABI options, includes, and defines in compile commands or `.clangd`, not in clangd server arguments. Microsoft mode requires its own cpptools `compileCommands` and `compilerPath` configuration. See [Cross-compilation and embedded projects](cross-compilation.en.md) for complete examples and Remote-path constraints.

The main views are Context, Code Preview, References, Callers, Callees, Supertypes, Subtypes, Includes, Included By, Navigation History, Bookmarks, Symbol Search, Document Symbols, and Project Diagnostics. Queries are demand-driven: hidden relationship views do not issue their corresponding automatic detail requests.

Single-clicking any source-location result in a C Insight tree previews it in Code Preview; double-clicking the same result opens that exact location in the editor. This includes Context definitions/declarations, References, Callers, Callees, Type/Include Hierarchy, Navigation History, Bookmarks, workspace and document symbols, and source diagnostics. Disclosure arrows still expand hierarchical nodes, while explicit **Open Location** actions open immediately. Exact provider target ranges remain highlighted, while a local style reset removes the Webview host's gray preformatted-element background and rounded box from ordinary per-line `<code>` content.

For callable symbols, Code Preview and both Callers/Callees roots prefer a provider definition distinct from the declaration. The Call Hierarchy query retains its original opaque provider item even when the displayed root points to the implementation. A declaration fallback is shown while no distinct definition is available; clangd index completion or bounded definition-only retries upgrade the current unlocked and unpinned location without clearing loaded branches.

Callers and Callees automatically expand the root's first level by default. Only a visible direction is automatically queried; explicit Show Incoming Calls and Show Outgoing Calls commands remain direction-specific. Set `cInsight.callHierarchy.defaultDepth` to `0` to keep new roots collapsed. Expanding a node displays every returned call site directly as a source-ordered row: two calls from `add` appear as two `add` rows and three calls from `main` appear as three `main` rows. Callers first prepend every independent declaration of the function being expanded. Those declarations are loaded and cached only when that semantic node is expanded; they are searchable and navigable but do not participate in call depth, paths, budgets, sessions, or semantic exports. Only the earliest call occurrence of each semantic caller or callee can lazily load the next level.

Symbol Search keeps an editable input fixed at the top of the view while results scroll independently below it. Typing sends debounced workspace-symbol queries to the active analysis engine; the title Search command focuses the existing input. Grouping, kind filtering, refresh, clear, and workspace-session restore remain available. A single click previews a result, a double click opens it, and right click offers Open Location and Add Bookmark.

VS Code's public TreeView API does not expose a native double-click event, so C Insight treats the second activation of the same node within `cInsight.navigation.doubleClickInterval` (default 500 ms) as a double click. Two rapid keyboard activations behave the same way. The first activation is never delayed. Opening a tree result does not immediately replace cursor-driven Context, Code Preview, References, Callers, or Callees results. Following resumes after the editor cursor moves to a different position with the mouse or keyboard; Document Symbols and Project Diagnostics still follow the active file immediately. Explicit Open Location, Go to Definition, Code Preview editor navigation, and Relationship Graph navigation retain their existing behavior. Clicking a navigable symbol inside Code Preview follows its definition there; double-clicking source text or blank space opens the corresponding or nearest rendered line in the editor. Pin and lock controls continue to block automatic replacement while allowing explicit navigation.

## Configuration and commands

Open **Settings** and search for `C Insight` to see every setting, accepted value, range, and default in the active display language. Stable configuration IDs begin with `cInsight.`. Important groups include:

- `cInsight.engine`, `cInsight.clangd.*`, `cInsight.microsoft.*`, `cInsight.compileCommandsDir`, `cInsight.fallbackFlags`, and `cInsight.exclude`
- `cInsight.codePreview.*`, `cInsight.analysis.*`, `cInsight.backgroundIndex.*`, `cInsight.diagnostics.*`, `cInsight.followCursor`, `cInsight.followCursorDelay`, `cInsight.followCursorDetailsDelay`, and `cInsight.navigation.*`
- `cInsight.references.*`, `cInsight.callHierarchy.*`, and `cInsight.export.*`
- `cInsight.typeHierarchy.*`, `cInsight.includeHierarchy.*`, and `cInsight.relationshipGraph.*`
- `cInsight.history.*`, `cInsight.bookmarks.*`, `cInsight.symbolSearch.*`, and `cInsight.session.*`
- `cInsight.includeDeclarationInReferences` and `cInsight.includeSystemReferences`

All commands are available from the Command Palette under **C Insight**. Context menus and view title bars expose commands relevant to the current editor, view, or selected node.

## Diagnostics and privacy

Project Diagnostics explains engine availability, compilation database detection, the active file command, indexing progress, request performance, and result reliability. Raw clangd/cpptools logs, command IDs, setting IDs, symbol names, file paths, and exported JSON field names remain untranslated so diagnostic evidence and automation stay stable.

If the managed clangd process exits unexpectedly, C Insight automatically restarts it up to four times in a three-minute sliding window. A fifth close stops the crash loop; inspect **C Insight: clangd**, then run **C Insight: Restart clangd** explicitly. A `Server process exited with signal SIGSEGV` line is the primary process failure. Subsequent `EPIPE`, destroyed-stream, and `textDocument/didOpen failed` messages are secondary effects of pending synchronization reaching the closed pipe; C Insight collapses duplicates but cannot repair the clangd defect that caused the signal. Automatic recovery resets index progress and marks dependent semantic results stale until the new process is ready.

In clangd mode, a relative `cInsight.compileCommandsDir` is resolved against the first workspace folder. The current setting does not interpolate `${workspaceFolder}`; use `"build"` or an absolute directory. C Insight passes the selected directory to clangd but never executes build commands or compilation-database entries. An explicit `--query-driver` does authorize clangd to execute a matching trusted driver. In Microsoft mode, the same C Insight setting supports diagnostics but does not configure cpptools.

C Insight has no telemetry and does not upload source code. See [Privacy](../../PRIVACY.md), [Security](../../SECURITY.md), and [Contributing](../../CONTRIBUTING.md) for the complete boundaries and maintenance workflow. For detailed feature behavior, use the [Simplified Chinese manual](user-guide.zh-CN.md).

<!-- GENERATED COMMAND REFERENCE START -->

## Complete command reference

This section is generated from `package.json`. Every command is available from the Command Palette; the table also lists view-title, editor-context, tree-item, and default-keybinding entry points. An entry can be hidden when its `when` condition does not match the current UI state.

| Command | Command ID | Entry points |
| --- | --- | --- |
| About | `cInsight.about` | Command Palette |
| Show Relationship Graph | `cInsight.relationshipGraph.show` | Command Palette; Editor context menu |
| Show File Relationship Graph | `cInsight.relationshipGraph.showFile` | Command Palette; Editor context menu |
| Export Relationship Graph as Text | `cInsight.relationshipGraph.exportText` | Command Palette |
| Export Relationship Graph as JSON | `cInsight.relationshipGraph.exportJson` | Command Palette |
| Export Relationship Graph as Mermaid | `cInsight.relationshipGraph.exportMermaid` | Command Palette |
| Go to Definition | `cInsight.goToDefinition` | Command Palette; Editor context menu; Keybinding `f12` |
| Find All References | `cInsight.findReferences` | Command Palette; Editor context menu; Keybinding `shift+f12` |
| Show Incoming Calls | `cInsight.showIncomingCalls` | Command Palette; Editor context menu; Callers title |
| Show Outgoing Calls | `cInsight.showOutgoingCalls` | Command Palette; Editor context menu; Callees title |
| Pin Context | `cInsight.pinContext` | Command Palette; Context title |
| Unpin Context | `cInsight.unpinContext` | Command Palette; Context title |
| Pin References | `cInsight.pinReferences` | Command Palette; References title |
| Unpin References | `cInsight.unpinReferences` | Command Palette; References title |
| Pin Callers and Callees | `cInsight.pinCallHierarchy` | Command Palette; Callers title; Callees title |
| Unpin Callers and Callees | `cInsight.unpinCallHierarchy` | Command Palette; Callers title; Callees title |
| Refresh | `cInsight.refresh` | Command Palette; View title |
| Restart clangd | `cInsight.restartClangd` | Command Palette |
| Restore Provider Settings | `cInsight.restoreProviderSettings` | Command Palette |
| Refresh Project Diagnostics | `cInsight.diagnostics.refresh` | Command Palette; Project Diagnostics title |
| Open Project Diagnostics | `cInsight.openProjectDiagnostics` | Command Palette |
| Show clangd Log | `cInsight.diagnostics.showClangdLog` | Command Palette; Project Diagnostics title |
| Copy Project Diagnostics Report | `cInsight.diagnostics.copyReport` | Command Palette; Project Diagnostics title |
| Export Project Diagnostics as Text | `cInsight.diagnostics.exportText` | Command Palette |
| Export Project Diagnostics as JSON | `cInsight.diagnostics.exportJson` | Command Palette; Project Diagnostics title |
| Restart Background Indexing | `cInsight.index.refresh` | Command Palette; Project Diagnostics title |
| Select Compilation Database | `cInsight.diagnostics.selectCompilationDatabase` | Command Palette; Project Diagnostics title |
| Use Automatic Compilation Database Detection | `cInsight.diagnostics.clearCompilationDatabase` | Command Palette |
| Open Location | `cInsight.openLocation` | Command Palette; Tree item context menu |
| Search Workspace Symbols | `cInsight.searchSymbols` | Command Palette; Symbol Search title |
| Refresh Workspace Symbol Search | `cInsight.symbolSearch.refresh` | Command Palette; Symbol Search title |
| Clear Workspace Symbol Search | `cInsight.symbolSearch.clear` | Command Palette; Symbol Search title |
| Group Workspace Symbols | `cInsight.symbolSearch.groupBy` | Command Palette; Symbol Search title |
| Filter Workspace Symbol Types | `cInsight.symbolSearch.filterKinds` | Command Palette; Symbol Search title |
| Filter Navigation History | `cInsight.history.filter` | Command Palette; Navigation History title |
| Clear Navigation History | `cInsight.history.clear` | Command Palette; Navigation History title |
| Bookmark Current Symbol | `cInsight.bookmarks.addCurrent` | Command Palette; Editor context menu; Bookmarks title |
| Add Bookmark | `cInsight.bookmarks.add` | Command Palette; Tree item context menu |
| Rename Bookmark | `cInsight.bookmarks.rename` | Command Palette; Tree item context menu |
| Change Bookmark Group | `cInsight.bookmarks.changeGroup` | Command Palette; Tree item context menu |
| Delete Bookmark | `cInsight.bookmarks.delete` | Command Palette; Tree item context menu |
| Refresh Bookmarks | `cInsight.bookmarks.refresh` | Command Palette; Bookmarks title |
| Filter Bookmarks | `cInsight.bookmarks.search` | Command Palette; Bookmarks title |
| Clear Bookmark Filter | `cInsight.bookmarks.clearSearch` | Command Palette; Bookmarks title |
| Sort Bookmarks | `cInsight.bookmarks.sort` | Command Palette; Bookmarks title |
| Import Bookmarks | `cInsight.bookmarks.import` | Command Palette; Bookmarks title |
| Export Bookmarks | `cInsight.bookmarks.export` | Command Palette; Bookmarks title; Tree item context menu |
| Rename or Merge Bookmark Group | `cInsight.bookmarks.renameGroup` | Command Palette; Tree item context menu |
| Delete Bookmark Group | `cInsight.bookmarks.deleteGroup` | Command Palette; Tree item context menu |
| Restore Previous Workspace Session | `cInsight.session.restore` | Command Palette |
| Clear Saved Workspace Session | `cInsight.session.clear` | Command Palette |
| Filter References | `cInsight.references.search` | Command Palette; References title |
| Clear Reference Filter | `cInsight.references.clearSearch` | Command Palette |
| Change Reference Grouping | `cInsight.references.groupBy` | Command Palette; References title |
| Change Reference Scope | `cInsight.references.scope` | Command Palette; References title |
| Filter References by Confidence or Evidence | `cInsight.references.filterEvidence` | Command Palette; References title |
| Load More References | `cInsight.references.loadMore` | Command Palette |
| Show All References | `cInsight.references.showAll` | Command Palette |
| Copy Reference | `cInsight.references.copy` | Command Palette; Tree item context menu |
| Copy All References | `cInsight.references.copyAll` | Command Palette |
| Export References as Text | `cInsight.references.exportText` | Command Palette |
| Export References as JSON | `cInsight.references.exportJson` | Command Palette |
| Open Reference List in Editor | `cInsight.references.openList` | Command Palette |
| Expand All Reference Groups | `cInsight.references.expandAll` | Command Palette |
| Collapse All Reference Groups | `cInsight.references.collapseAll` | Command Palette |
| Expand Callers to Depth | `cInsight.callers.expandToDepth` | Command Palette; Callers title |
| Expand Callees to Depth | `cInsight.callees.expandToDepth` | Command Palette; Callees title |
| Stop Call Hierarchy Expansion | `cInsight.callHierarchy.stopExpansion` | Command Palette; Callers title; Callees title |
| Search Loaded Callers | `cInsight.callers.search` | Command Palette; Callers title |
| Search Loaded Callees | `cInsight.callees.search` | Command Palette; Callees title |
| Export Callers as Text | `cInsight.callers.exportText` | Command Palette; Callers title |
| Export Callers as JSON | `cInsight.callers.exportJson` | Command Palette; Callers title |
| Export Callees as Text | `cInsight.callees.exportText` | Command Palette; Callees title |
| Export Callees as JSON | `cInsight.callees.exportJson` | Command Palette; Callees title |
| Find Caller Path | `cInsight.callers.findPath` | Command Palette; Callers title |
| Find Callee Path | `cInsight.callees.findPath` | Command Palette; Callees title |
| Export Callers as Mermaid | `cInsight.callers.exportMermaid` | Command Palette; Callers title |
| Export Callees as Mermaid | `cInsight.callees.exportMermaid` | Command Palette; Callees title |
| Show Supertypes | `cInsight.typeHierarchy.showSupertypes` | Command Palette; Editor context menu; Supertypes title |
| Show Subtypes | `cInsight.typeHierarchy.showSubtypes` | Command Palette; Editor context menu; Subtypes title |
| Expand Supertypes to Depth | `cInsight.supertypes.expandToDepth` | Command Palette; Supertypes title |
| Expand Subtypes to Depth | `cInsight.subtypes.expandToDepth` | Command Palette; Subtypes title |
| Stop Type Hierarchy Expansion | `cInsight.typeHierarchy.stopExpansion` | Command Palette; Supertypes title |
| Search Loaded Supertypes | `cInsight.supertypes.search` | Command Palette; Supertypes title |
| Search Loaded Subtypes | `cInsight.subtypes.search` | Command Palette; Subtypes title |
| Export Supertypes as Text | `cInsight.supertypes.exportText` | Command Palette; Supertypes title |
| Export Supertypes as JSON | `cInsight.supertypes.exportJson` | Command Palette; Supertypes title |
| Export Supertypes as Mermaid | `cInsight.supertypes.exportMermaid` | Command Palette; Supertypes title |
| Export Subtypes as Text | `cInsight.subtypes.exportText` | Command Palette; Subtypes title |
| Export Subtypes as JSON | `cInsight.subtypes.exportJson` | Command Palette; Subtypes title |
| Export Subtypes as Mermaid | `cInsight.subtypes.exportMermaid` | Command Palette; Subtypes title |
| Show Includes | `cInsight.includeHierarchy.showIncludes` | Command Palette; Editor context menu; Includes title |
| Show Included By | `cInsight.includeHierarchy.showIncludedBy` | Command Palette; Editor context menu; Included By title |
| Expand Includes to Depth | `cInsight.includes.expandToDepth` | Command Palette; Includes title |
| Expand Included By to Depth | `cInsight.includedBy.expandToDepth` | Command Palette; Included By title |
| Stop Includes Expansion | `cInsight.includes.stopExpansion` | Command Palette; Includes title |
| Stop Included By Expansion | `cInsight.includedBy.stopExpansion` | Command Palette; Included By title |
| Search Loaded Includes | `cInsight.includes.search` | Command Palette; Includes title |
| Search Loaded Included By | `cInsight.includedBy.search` | Command Palette; Included By title |
| Export Includes as Text | `cInsight.includes.exportText` | Command Palette; Includes title |
| Export Includes as JSON | `cInsight.includes.exportJson` | Command Palette; Includes title |
| Export Includes as Mermaid | `cInsight.includes.exportMermaid` | Command Palette; Includes title |
| Export Included By as Text | `cInsight.includedBy.exportText` | Command Palette; Included By title |
| Export Included By as JSON | `cInsight.includedBy.exportJson` | Command Palette; Included By title |
| Export Included By as Mermaid | `cInsight.includedBy.exportMermaid` | Command Palette; Included By title |

<!-- GENERATED COMMAND REFERENCE END -->
