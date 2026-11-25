# C Insight User Guide

This guide applies to C Insight `0.24.0`. Start with the sixteen functional views, then use the layout, shared-interaction, update and configuration sections as needed. Source, issues and releases are at [github.com/H9elix/c-insight](https://github.com/H9elix/c-insight).

Reading guide:

1. [Requirements and language](#prerequisites)
2. [Quick start and opening views](#quick-start)
3. [Functional views](#functional-views)
4. [View layout and combinations](#layouts)
5. [Shared navigation and browsing tools](#shared-interactions)
6. [Update logic and resource use](#update-model)
7. [Configuration and commands](#configuration)
8. [Diagnostics, privacy and limits](#diagnostics-and-privacy)
9. [Complete command reference](#command-reference)

<a id="prerequisites"></a>

## 1. Requirements and language

### 1.1 Environment and analysis engines

Use VS Code 1.95 or newer. Managed clangd is the default engine; clangd 20 or newer is recommended for complete Call Hierarchy support. Microsoft mode requires Microsoft C/C++ in the same extension host. For WSL, SSH and containers, install C Insight and the engine where the source lives. Provide a real compile_commands.json whenever possible.

For GitHub downloads, choose a platform-specific VSIX when available: Windows uses `win32-x64` or `win32-arm64`; Linux uses `linux-x64`, `linux-arm64` or `linux-armhf` (32-bit ARM); macOS uses `darwin-x64` (Intel) or `darwin-arm64` (Apple Silicon). Each contains only its native search executable. The `universal` package contains all twelve bundled native variants; a VSIX with no platform suffix is also Universal. Choose according to the extension host: Windows with x64 WSL needs `linux-x64`, while an ARM64 Linux SSH host needs `linux-arm64`. Verify your downloaded VSIX against its entry in `SHA256SUMS`. Universal is a packaging choice, not support for browser-only VS Code or every possible OS.

### 1.2 Display language

C Insight follows the VS Code display language: Simplified Chinese for zh-cn and English as the fallback. Run Configure Display Language and reload to change it. Symbol names, paths, command IDs and raw engine logs remain untranslated.

<a id="quick-start"></a>

## 2. Quick start and opening views

### 2.1 Start browsing

Open a C/C++ folder or multi-root workspace, provide a `compile_commands.json` when possible, and select **C Insight** in the Activity Bar. The default `cInsight.engine` is `clangd`; set it to `microsoft` and reload the window to use the Microsoft C/C++ language service (cpptools).

Put the editor cursor on a symbol, open the required views, single-click a result to preview it and double-click to open its exact location.

### 2.2 Find a view

Run **C Insight: Open View…** from the Command Palette or a C/C++ editor's context menu. The searchable picker lists 16 independent views with short purposes, up to four enabled combined views with their custom names and slot numbers, and actions to create/manage combinations. Search matches names, English aliases and purposes. Highlighting or cancelling opens nothing; accepting an independent view opens its native pane, not a combined presentation of that feature. Selecting a combination opens that exact slot. With no combinations, Manage offers to create one; Create uses the existing four-slot limit.

A nonmodal one-time tip appears when any independent or enabled combined pane first becomes visible, including a restored pane or History/Bookmarks. Activating the extension, opening only a source file, or opening only the picker does not trigger it. Dismissal is remembered in the extension host/profile's global state, without per-version resets or synchronization; local, WSL and SSH hosts keep separate records. Existing installations receive the tip once too. Its **Open Views…** action opens the same picker without moving other panes.

<a id="functional-views"></a>

## 3. Functional views

The sixteen independent views are listed below. Combined layouts, graphs, shared interactions and update scheduling have separate sections.

<a id="view-context"></a>

### 3.1 Context

Context summarizes the selected symbol: name, qualified name, signature, definitions/declarations and available relationship counts. Base information appears first; deferred References and call counts follow when those details are requested. Pinning Context pauses the automatic cursor-follow chain, while explicit queries remain available.

<a id="view-preview"></a>

### 3.2 Code Preview

#### 3.2.1 Definitions and source context

For callable symbols, Code Preview and both Callers/Callees roots prefer a provider definition distinct from the declaration. The Call Hierarchy query retains its original opaque provider item even when the displayed root points to the implementation. A declaration fallback is shown while no distinct definition is available; clangd index completion or bounded definition-only retries upgrade an untouched, unlocked, and unpinned preview without clearing loaded branches. After preview interaction, the other views may still accept that upgrade, but Code Preview waits for a new editor target or explicit refresh.

#### 3.2.2 Scrolling and buffered loading

Code Preview prepares one `loadBatchLines` source buffer on each available side of a fresh target before showing it. Its first layout stays hidden until the original `linesBefore` position has been applied, so the target and scrollbar appear in their final initial positions. Additional context is prefetched within one viewport of a loaded edge. A wheel gesture that nevertheless reaches an unloaded edge is retained and applied after insertion as a fallback. Actual `scrollTop` movement selects the loading direction; inserted or trimmed rows preserve the visible anchor and horizontal position.

#### 3.2.3 Explicit preview ownership

An explicit tree, history, graph, or in-preview selection temporarily owns Code Preview. Scrolling or pressing the pointer inside the preview does the same, so delayed context details or a later declaration-to-definition upgrade cannot reset source that is already being read. Repeated publications of the exact same URI and range update metadata without rebuilding the Webview. Pending reference details, call counts, and preferred-definition retries may still update their own views. Deliberate mouse or arrow-key movement in the editor, or an explicit refresh/query, lets the newer context reclaim Code Preview. Merely revealing another C Insight view does not reclaim it, and Lock Preview remains the stronger rule.

#### 3.2.4 Semantic coloring and palettes

<a id="code-preview-colors"></a>

Set `cInsight.codePreview.colorScheme` to `"theme"` (default), `"fixed-dark"`, or `"fixed-light"`. Theme mode maps semantic categories to public VS Code color variables and may differ from the editor's final colors. Fixed modes define source background, foreground, gutter and target highlights as well as token colors, independently of the editor theme. The preview header and toolbar still follow VS Code.

`cInsight.codePreview.tokenColors` defaults to `{}` and accepts independent category overrides. Only opaque six-digit `#RRGGBB` values are accepted; invalid entries fall back to the selected palette with a deduplicated warning. Function and method, or type and class, are separate keys. All 22 keys, preset colors and copyable settings appear below; validation boundaries remain in the [Chinese configuration and validation guide](../validation/code-preview-fixed-colors.zh-CN.md).

Colors change presentation only: semantic classification still comes from the active registered provider, with the same bounded timeout and lexical fallback. Disabling semantic highlighting still uses the selected palette for lexical categories. Color-setting and theme changes update a dedicated style element without replacing source HTML, clearing token/scroll caches, querying the engine, or changing lock/history state. Hidden views defer style work until shown or ready. Existing parameter/readonly italics and deprecated strikethrough remain unchanged.

##### 3.2.4.1 Default fixed-palette colors

With `cInsight.codePreview.tokenColors` omitted or `{}`, the fixed schemes use the following 22 categories. Theme mode uses public theme variables and has no theme-independent hex table. Classification depends on the provider; identifiers not classified during lexical fallback use the plain foreground.

| Category key | Meaning | Fixed dark | Fixed light |
| --- | --- | --- | --- |
| `namespace` | namespace | `#4EC9B0` | `#267F99` |
| `type` | type | `#4EC9B0` | `#267F99` |
| `class` | class | `#4EC9B0` | `#267F99` |
| `struct` | struct | `#4EC9B0` | `#267F99` |
| `interface` | interface | `#4EC9B0` | `#267F99` |
| `enum` | enum | `#4EC9B0` | `#267F99` |
| `typeParameter` | typeParameter | `#4EC9B0` | `#267F99` |
| `function` | function | `#DCDCAA` | `#795E26` |
| `method` | method | `#DCDCAA` | `#795E26` |
| `variable` | variable | `#9CDCFE` | `#001080` |
| `parameter` | parameter | `#9CDCFE` | `#001080` |
| `property` | property | `#9CDCFE` | `#001080` |
| `enumMember` | enumMember | `#B5CEA8` | `#098658` |
| `event` | event | `#9CDCFE` | `#001080` |
| `macro` | macro | `#C586C0` | `#AF00DB` |
| `label` | label | `#C8C8C8` | `#000000` |
| `decorator` | decorator | `#DCDCAA` | `#795E26` |
| `keyword` | keyword | `#C586C0` | `#0000FF` |
| `string` | string | `#CE9178` | `#A31515` |
| `comment` | comment | `#6A9955` | `#008000` |
| `number` | number | `#B5CEA8` | `#098658` |
| `operator` | operator | `#D4D4D4` | `#000000` |

The source-surface defaults below are not supported `tokenColors` category keys:

| Source element | Fixed dark | Fixed light |
| --- | --- | --- |
| Source background | `#1E1E1E` | `#FFFFFF` |
| Plain text / unclassified identifiers | `#D4D4D4` | `#000000` |
| Line numbers | `#858585` | `#6E7681` |
| Target line background | `#264F78` | `#DCEBFA` |
| Target line left border | `#007ACC` | `#007ACC` |
| Target symbol background | `#5B4B18` | `#FFF2B2` |
| Target symbol outline | `#D7BA7D` | `#B89500` |

##### 3.2.4.2 settings.json examples and reset

Merge these keys into your existing `settings.json`; do not replace unrelated settings. Use workspace `.vscode/settings.json` to affect only this project. These settings do not change the main editor theme. This example deliberately overrides six categories; all other categories retain the selected preset:

```json
{
  "cInsight.codePreview.colorScheme": "fixed-dark",
  "cInsight.codePreview.tokenColors": {
    "function": "#FFD866",
    "method": "#FFD866",
    "variable": "#D4D4D4",
    "property": "#78DCE8",
    "macro": "#AB9DF2",
    "comment": "#808080"
  }
}
```

Function and method are independent; changing variable does not change parameter or property. To use the fixed light defaults without overrides:

```json
{
  "cInsight.codePreview.colorScheme": "fixed-light",
  "cInsight.codePreview.tokenColors": {}
}
```

Use `fixed-dark` for the dark defaults. To restore the original theme mapping, set `colorScheme` to `theme` and `tokenColors` to `{}`. Removing one category key restores only that category to the selected preset.

<a id="view-references"></a>

### 3.3 References

References lists symbol uses with definition/declaration, call, read/write, address and macro-related classification. Group by file, directory, enclosing function, reference type, confidence or evidence; filter scope and text, page results, pin the target and export the filtered list. Semantic and inferred evidence remain distinguishable.

Set `cInsight.references.autoExpandGroups` to `true` to initially expand every result group in File, Directory, Function, Reference Type, Confidence, and Evidence Source grouping modes. It defaults to `false`, so groups initially remain collapsed; Flat mode has no groups. Setting changes immediately republish the current tree, and manual Expand All and Collapse All remain available. These already materialized rows issue no additional analysis-engine request.

<a id="view-callers"></a>

### 3.4 Callers

#### 3.4.1 Exact caller locations

Callers follows incoming relations and previews the exact use, not merely the caller definition. Roots prefer an implementation; independent declarations are shown before call occurrences. clangd supplies incoming calls directly. Microsoft mode defaults to a References-based enclosing-function approximation; native incoming calls are optional and can crash affected cpptools builds.

#### 3.4.2 Macro-use queries

When the selected macro can be associated with a same-named readable source `#define`, Callers defaults to macro-use semantics. The root keeps the exact macro name, its first level comes from References to that macro, and the macro definition plus calls written through another alias or directly through the expanded function are excluded. The same result is available on the macro name in its `#define`, at a normal use, or in another macro's replacement text, including numeric/expression macros without a Call Hierarchy root. For example, querying `LOG` in `#define LOG_ALIAS LOG` returns the direct replacement-text reference, not indirect uses spelled `LOG_ALIAS` and not every call to LOG's expanded function.

Uses with available callable symbols retain their enclosing function name, every exact occurrence, and upward expansion. Other uses remain navigable under a generic macro-reference label: the use may be outside a function, its source file may not be open, or the Provider may be unable to resolve its enclosing callable. clangd macro-use queries do not bulk-open reference files just for caller labels; opening the relevant source and refreshing can resolve that function when the Provider supplies it. A failed per-file symbol lookup preserves the exact references rather than failing the entire macro query; cancellation still cancels. The cursor's existing Definition request is reused for macro evidence instead of repeated for every non-callable symbol. Results remain subject to the active configuration, indexing, and Provider's References coverage; an inactive preprocessing branch or an unused macro may legitimately yield no uses.

Clangd mode also recognizes compiler `-D` macros when Hover explicitly identifies that exact macro. Callers keeps the macro name and lists its own References, including `#if` uses. Without a readable source definition the root is anchored at the selected use, which remains in the child results. Automatic following works with Context hidden or collapsed; macro identity and Context share at most one lazy Hover. Compiler-macro definition locations and workspace-symbol indexing may be missing or inaccurate; see the [synthetic scenario and verification steps](../validation/command-line-macros.zh-CN.md).

A contextual **Show Expanded Function Callers** title action and macro-root context-menu entry deliberately replace only the Callers tree with a callable expanded target. A retained Provider item is reused; otherwise C Insight lazily checks at most 16 actual macro uses and synchronizes those candidate documents only when the action is invoked. A macro without a resolved callable target keeps its existing result and shows an explanation. Refresh or Show Incoming Calls restores macro-use semantics. Callees and Relationship Graph remain on their existing Provider semantics, and synthetic macro-only roots never enter Callees.

#### 3.4.3 Member access classification

Field and property Callers display the Provider's complete original result without instance classification by default. After clangd prepares Call Hierarchy, C Insight requests Incoming Calls directly, avoiding member-chain parsing, root-variable References and candidate-source classification.

Set `cInsight.callHierarchy.classifyMemberCallers` to `true` to classify a simple chain such as `st->codecpar`, `st->codecpar->sample_rate`, `(st)->codecpar`, or `object.member`. Matching accesses are listed under **Selected variable**, identifiable accesses through another variable or member path follow under **Other variables or member paths**, and calls, array bases, casts, aliases, and other expressions that cannot be proven either way remain under **Variable instance could not be determined**. Every semantic access returned by the Provider remains visible. The opt-in path reads unopened candidate files directly instead of opening them as VS Code documents, reuses one root-variable References query, and limits Definition fallback to 16 candidates only when References is unavailable. It intentionally does not infer aliases or pointer assignments. The same grouping is retained in the Call Relationship Graph, restored graph sessions, and Text/JSON/Mermaid exports only while the option is enabled. Microsoft mode always retains the safe References-based member fallback when cpptools exposes no Call Hierarchy root; that complete fallback result is classified only when the option is enabled.

<a id="view-callees"></a>

### 3.5 Callees

Callees shows functions called by the selected function. Every returned occurrence remains a separate source-location row, and the earliest occurrence of a repeated semantic relation can load the next level. clangd and Microsoft mode use outgoing-call results; Microsoft has no speculative outgoing fallback. Explicit unresolved function-pointer calls can retain navigable syntax evidence without inventing runtime targets.

<a id="view-supertypes"></a>

### 3.6 Supertypes

Supertypes follows the base types implemented or inherited by a C++ class or struct. Place the editor cursor on its name and run Show Supertypes, then lazily expand the desired branch. This view requires clangd; Microsoft mode does not expose the necessary public Type Hierarchy execution path.

<a id="view-subtypes"></a>

### 3.7 Subtypes

Subtypes follows derived types of the selected C++ type. Run Show Subtypes and expand only the branches you need. Supertypes and Subtypes prepare the same type root, then load their directions independently. Both support loaded-node search, relation evidence, bounded expansion and Text/JSON/Mermaid export.

<a id="view-includes"></a>

### 3.8 Includes

Includes follows files directly or indirectly included by the active C/C++ source or header. Run Show Includes; expanding reads that file and resolves textual include directives using source and compilation-database search paths. Selecting a relation previews its #include line. It does not execute a preprocessor or start the reverse workspace scan.

<a id="view-included-by"></a>

### 3.9 Included By

Included By finds workspace files that include the selected file. Run Show Included By; the first reverse expansion builds a cancellable in-memory index. File changes update an existing index, but typing in an unopened or unqueried view does not start a scan. Forward and reverse views keep independent roots. Unresolved, duplicate, cycle and system-header states remain explicit.

<a id="view-history"></a>

### 3.10 Navigation History

Navigation History lists explicit browsing locations in reverse chronological order. Automatic cursor following does not add records. Single-click restores a preview; double-click opens that location. Its cursor is shared with Code Preview Back/Forward, while VS Code editor Back/Forward remains separate. History and its source filter are restored when the corresponding workspace-session option is enabled.

<a id="view-bookmarks"></a>

### 3.11 Bookmarks

Bookmarks persist important symbol and source positions per workspace. Add the editor symbol or a result location, rename it, organize groups, search and sort, or import/export JSON. Editing marks affected bookmarks stale and starts bounded text relocation using the stored identifier. Bookmark data is saved independently of the optional browsing-session snapshot.

<a id="view-symbol-search"></a>

### 3.12 Symbol Search

Symbol Search keeps an editable input fixed at the top of the view while results scroll independently below it. Typing sends debounced workspace-symbol queries to the active analysis engine; the title Search command focuses the existing input. Grouping, kind filtering, refresh, clear, and workspace-session restore remain available. A single click previews a result, a double click opens it, and right click offers Open Location and Add Bookmark.

<a id="view-document-symbols"></a>

### 3.13 Document Symbols

Document Symbols shows the active document hierarchy with theme-aware icons for symbol kinds.

Document Symbols has a persistent top search inputusing the same surface as Project Files. It performs case-insensitive name-substring matching over all symbols already loaded for the active document, including members inside collapsed classes or structs. Results retain matching nodes and their ancestor context without querying an engine or loading other files. The × button and Escape clear the query without hiding the field; Ctrl+F/Cmd+F focuses it. Empty matches display a symbol-specific message. Search arrows, left/right keys and Collapse All affect only the matching projection, leaving ordinary expansion records intact. Single-click preview and double-click/Enter editor navigation remain unchanged.

Document Symbols and Project Files share their filter-follow rules. While unlocked, successful double-click, Enter and context-menu Open Location actions clear the query after focus leaves, including repeated opens of the same result. Single-click preview retains it. Failed opens do not clear, and delayed completions cannot overwrite newer input. Search-box, list, context-menu and sort-picker interaction suppress automatic clearing and scrolling. Outside the view, enabled following clears only a query that hides the current center symbol; matching queries remain and the target is centered where possible. Hidden views retain search state and resume the same policy when shown, without additional background semantic queries.

Its title bar contains Lock/Unlock, Sort and Refresh in stable slots. Lock pauses automatic clearing, scrolling and ancestor expansion: the active document inventory and center highlight still update, and explicit filtering, clearing, expansion, sorting and navigation remain available. Unlock resumes center following once focus is outside the view. The independent lock defaults off, lasts only for the current Extension Host session, and does not change `followEditorCenter` or another view's pin state.

Expanded panes allow uninterrupted wheel browsing. When a combined pane returns to its base size, or the list height otherwise shrinks, an out-of-view followed row is smoothly centered after dimensions settle, including when it was scrolled away while expanded. Repeated expand/browse/contract cycles work the same way; a still-visible row does not move. Locks, disabled following and focus inside the view pause automatic positioning. Wheel input, search, locking and explicit navigation stop an in-progress centering animation. System or VS Code reduced-motion preferences use immediate positioning instead. The correction uses cached rows in that presentation only, without clearing the filter, expanding ancestors or querying the engine.

`cInsight.documentSymbols.sortBy` defaults to `"position"`; accepted values are `"position"` (source location), `"name"` (case-insensitive natural names) and `"type"` (symbol kind, then name and location). Only siblings are sorted, preserving hierarchy, stable node IDs, expansion and filter text. Sorting uses loaded nodes without another engine request. The Sort menu saves to workspace settings when a workspace is open, otherwise to user settings.

Document Symbols highlights the deepest loaded symbol containing the active editor viewport's center line and reveals it under the focus/lock policy above. `cInsight.documentSymbols.followEditorCenter` defaults to `true`; disabling it immediately removes the marker and stops automatic reveal. Successful unlocked explicit opens still clear the query without scrolling or expanding ancestors just to clear it. The debounced viewport update uses only loaded symbol ranges, does not issue another semantic-engine request, does no work while the view is hidden, and reveals without taking editor focus or changing the user's tree selection. A flat Provider result without full symbol ranges can be highlighted only where its reported range covers the center line.

<a id="view-project-files"></a>

<a id="project-files"></a>

### 3.14 Project Files

**Project Files** is a shared Webview result view next to Document Symbols. It starts collapsed and enumerates only when shown. The view can be moved to the bottom panel or another view group.

The flat inventory includes all file types across every workspace root, not only open editors or C/C++ sources. It honors folder-specific `files.exclude` and always removes `.git` metadata; `.gitignore`, `search.exclude`, and `cInsight.exclude` are not additional filters. Git-ignored build/dependency files can therefore appear unless hidden through `files.exclude`. Duplicate names show their relative directory and, in multi-root workspaces, their root name.

Files use natural ascending name order (`file2.c` before `file10.c`). The title-bar Sort action also offers relative-path and extension order, with stable path tie-breaking. Sorting changes workspace settings but does not rescan or fetch timestamps. The active editor file is highlighted and marked **Active file**; image/custom resource editors are supported, and text diff editors use the modified side. Selecting a preview does not change this marker. Highlighting is independent from automatic scrolling.

The search box stays at the top while the list scrolls. Input immediately filters all loaded files by case-insensitive name/path substring, not regular expressions or fuzzy subsequences. Its **×** button appears only for nonempty input and clears without opening anything or moving focus away. Manual input/clear resets list scrolling to the top; no matches displays a localized empty message. Ctrl+F/Cmd+F focuses the input, and Escape clears without hiding it. Manual sorting and refreshing preserve input. Automatic handling follows these rules:

| State / action | Query | Automatic scrolling |
| --- | --- | --- |
| Unlocked single-click/Space preview | Preserved | No preview-driven movement |
| Unlocked successful double-click/Enter/Open Location | Cleared | Center the opened file where possible if following is enabled |
| Focus inside the file view, search or its menus | Preserved | Deferred |
| Unlocked focus outside the file view | Cleared only if it hides the current file | Center the current file where possible if following is enabled |
| Locked | Never automatically cleared | Disabled; active-file highlighting still updates |

Automatic actions never focus the search input, steal focus or change list selection. Failed opens do not clear; delayed completions cannot overwrite a newer query. A file outside the workspace, excluded by `files.exclude`, or absent from the bounded inventory does not cause clearing just to reveal it. Hidden views and an unfocused VS Code window defer automatic actions.

Automatic reveal places the highlighted row near the center of the list viewport, including after opening a filtered result or switching editor tabs. Near either end, or with less than one screen of files, normal scroll limits apply without adding blank rows. Repeated updates for the same visible file do not pull the list back after manual scrolling; another focus-leave cycle, unlocking or an explicit open can position it again.

The independent title-bar Lock/Unlock actions use a stable pin-icon slot. They affect only Project Files automatic clearing/scrolling, not other views, the persisted follow setting, manual operations or filesystem updates. Lock defaults off and is not session-persisted. Unlock synchronizes once when focus is outside; otherwise it waits for focus to leave. Disabling `followActiveEditor` removes highlighting and automatic reveal, but successful explicit opens still clear when unlocked.

Single-click/Space previews text from line one; double-click/Enter/Open Location opens that location using the existing navigation history and delayed-follow policy. Images, binary files, and files above 10 MiB leave the text preview unchanged with an explanation on single click; opening uses VS Code's default resource editor. Explicit text previews retain existing optional semantic coloring.

Project Files uses the same resize correction as Document Symbols: wheel browsing remains uninterrupted while expanded, and an out-of-view followed file is smoothly centered after contraction settles, across repeated cycles. A still-visible file retains its scroll position. Following, locks and focus still apply; wheel input interrupts animations, and reduced-motion preferences use immediate positioning. Only the current presentation's cached rows are used; no search clearing, file rescanning or changes to other presentations occur.

Create/delete/rename events coalesce into a 500 ms relisting; ordinary text edits do not rescan. Hiding the view cancels scans and stops its watchers; showing it reconciles files again. Enumeration, sorting, filtering, and activity markers neither read file contents nor call either semantic engine. Filesystem-watcher exclusions and remote/external changes may require the explicit Refresh action. The file inventory and query are not added to workspace-session snapshots.

| Setting | Default | Values / range | Behavior |
| --- | --- | --- | --- |
| `cInsight.projectFiles.sortBy` | `"name"` | `"name"`, `"path"`, `"type"` | Ascending presentation order; no rescan |
| `cInsight.projectFiles.followActiveEditor` | `true` | boolean | Highlight the active file; reveal only while unfocused and unlocked, clearing a hiding filter if needed; disabling does not suppress clearing after an unlocked explicit open |
| `cInsight.projectFiles.maximumFiles` | `50000` | integer, 1000–200000 | Reload when visible after changing the limit; otherwise defer until shown |

When the limit is reached, a persistent status warns that both the inventory and its local search can be incomplete. No open workspace shows a folder/workspace prompt.

<a id="view-diagnostics"></a>

### 3.15 Project Diagnostics

Project Diagnostics explains missing or incomplete results: selected engine and provider status, clangd process/index state, compilation-database selection, the active translation-unit command, search paths, definitions, diagnostics and runtime counters. Copy or export a Text/JSON report, select a database, or inspect a source diagnostic. Detailed logs and reliability appear in the diagnostics section below.

<a id="layouts"></a>

<a id="view-text-search"></a>

### 3.16 Search & Replace

Choose **Search & Replace** in **C Insight: Open View…**, or run **C Insight: Search Text…**. This view searches all text files without clangd or Microsoft C/C++ queries. It can also be added to a combination as `textSearch`. Native editor Ctrl+F/H remain unchanged; within this view Ctrl+F focuses the query and Ctrl+H opens replacement controls.

Independent and combined views display the first 200 matches by default; file headers do not consume that allowance. Status shows displayed/total and checked matches outside the list. This display cap does not truncate the query or narrow file checkboxes and replacement selections. An Open results window button appears above results whenever there are matches, including fewer than 200. The command palette also offers C Insight: Open Results Window.

The editor-area results window is a read-only snapshot of one query, with independent scroll, selection and file expansion. Single-click previews; double-click or Enter opens source. It has no replacement controls. A running query continues streaming into its window; completion or cancellation fixes the snapshot. Reopening the same query focuses its window, while different queries can remain open together. Source changes mark snapshots stale and navigation revalidates content before opening a target. Hiding all presentations of the current query, including its snapshot, cancels scanning; old query windows cannot keep a new query running. Closing a window releases its data references; snapshots do not restore across restarts.

Press Enter or Search to run; Shift+Enter inserts a newline. Typing, cursor movement and source edits never automatically start a scan. Scopes are current file, open text files, a chosen folder and the entire multi-root workspace. Without a workspace, use the current file. Results group by file with line/column, context and highlighted matches. Single-click previews source; double-click or Enter opens the editor without clearing the query. Previous/Next browse matches. Checkboxes select replacement targets; the virtualized list renders only the viewport and overscan, with the inline prefix in the small view and the complete query in its large window.

Match case, whole words and regex use native VS Code workspace-search conventions. Paste newlines or press Shift+Enter for multiline text; regex content determines multiline search, with no separate option that implicitly makes `.` span newlines. Disk and unsaved documents use the same matcher. Include/exclude accept comma-separated globs such as `**/*.{c,h}, **/*.cpp`; bare names match any depth and `./` anchors at the root. Searches respect `.gitignore`, `.ignore`, `.rgignore`, `files.exclude` and `search.exclude`. As in native search, explicit include globs can override ignore-file rules; exclusion globs take precedence. Native settings `search.useParentIgnoreFiles`, `search.useGlobalIgnoreFiles`, `search.followSymlinks` and `search.smartCase` control corresponding behavior. BOM and `files.encoding` support UTF-8, UTF-16 and GBK; uncertain decoding or failed reads of matching files count as skipped.

The bundled ripgrep backend directly streams native matches. The host validates matching source snapshots, UTF-16 positions and replacement hashes without matching the file again. It runs in the current local/WSL/SSH extension host without system-tool installation. Native failures show an error instead of changing matching rules. Native `search.maxResults` defaults to 20000; `null` removes the match-count cap. Legacy candidate-file, per-file-size and total result-text search caps no longer apply. Status reports matches, scanned and skipped files. Cancellation or a reached limit retains marked partial results, which cannot be batch-replaced. Queries and results last only for the extension session.

Expand Replace, enter replacement text and optionally preserve case. Preview the current match, checked matches, one file or all results. Regex replacements support JavaScript capture syntax including `$1`, `$<name>`, `$&` and `$$`. Inspect read-only diffs, switch files with their buttons, then confirm replacement in the modal dialog. Changing checkboxes requires a fresh preview. Batches are limited to 200 files and 64 MiB of diff snapshots. Edits use VS Code WorkspaceEdit, remain unsaved and support native undo.

Incomplete, cancelled, truncated, skipped-file or stale searches cannot be batch-replaced. Query, replacement or selection changes invalidate the diff plan; all target contents and document versions are checked again before applying. Conflicts prevent edits. Read-only targets and untrusted workspaces reject replacement. Source edits only invalidate results; replacements refresh affected files, retaining original unreplaced matches rather than repeatedly discovering text inserted by replacement.

| Setting | Default | Values | Meaning |
| --- | --- | --- | --- |
| `search.maxResults` | `20000` | positive integer or `null` | Shared native/C Insight match cap; `null` means unlimited |
| `cInsight.textSearch.inlineResultLimit` | `200` | positive integer | Display cap for independent/combined views; does not limit query data, snapshot windows or replacement scope |
| `cInsight.textSearch.maximumFiles` | `50000` | deprecated | Ignored; no separate candidate-file cap |
| `cInsight.textSearch.maximumMatches` | `10000` | deprecated | Ignored; use `search.maxResults` |
| `cInsight.textSearch.maximumFileMegabytes` | `10` | deprecated | Ignored; no separate search file-size cap |

## 4. View layout and combinations

### 4.1 Native docking and grouping

View headers, containers, and layout moves remain native VS Code features; the renderer replaces only result content. Callers and Callees can still share one C Insight tab in the bottom panel. If dragging does not reach the desired drop target, run **View: Move View**, select the view, and choose the existing destination container rather than a new panel. **View: Move Focused View** is also available; no full layout reset is required.

<a id="combined-views"></a>

### 4.2 Combined views

#### 4.2.1 Create and manage combinations

Run **C Insight: Create Combined View** and select panes. Up to four native slots—**Combined View 1**, **Combined View 2**, **Combined View 3**, and **Combined View 4**—can be shown and moved independently to the bottom, left, or right. Existing independent views remain available. Each combination supports horizontal or vertical arrangement regardless of docking location.

Choose from Context, Code Preview, References, Callers, Callees, Supertypes, Subtypes, Includes, Included By, Navigation History, Bookmarks, Symbol Search, Document Symbols, Project Files, and Project Diagnostics. A role can appear once per combination and in multiple combinations; Relationship Graph remains an editor panel. The combination toolbar has four buttons: add panes, change orientation, toggle hover expansion and manage. Horizontal combinations place it vertically on the left, with buttons above the name; vertical combinations place it horizontally at the top, with the name on the left and buttons on the right. The outer surface has no side gutters: toolbar and content use the available width while keeping their internal padding. This follows arrangement rather than docking location; individual pane headers and VS Code's native title bar keep their layout. Long names truncate with a full-name tooltip, and the button group scrolls when space is limited. Management supports renaming, equal sizing and deletion; each pane's “…” menu provides its feature actions, expansion percentage, expansion direction, moving earlier/later and removal. The pane arrow collapses it. Drag splitters or focus a splitter and use arrow keys to adjust base proportions.

#### 4.2.2 Reorder and resize panes

Drag a pane's title text to reorder it within the same combination: move left/right horizontally or up/down vertically, then release at the insertion marker. Approaching the scroll area's edge scrolls that axis. Each pane retains its base weight and collapsed state; collapsed panes can also move. Sizes freeze and hover expansion pauses during dragging; afterward base proportions return, and subsequent mouse movement can trigger hover again. Escape, window blur, pointer cancellation, dropping outside, or an external order/weight/orientation change cancels the drag. Header buttons and splitters keep their original actions; Move Earlier/Later remains available for keyboard use. Reordering uses the existing user layout settings, with no new setting or cross-combination dragging.

#### 4.2.3 Hover expansion and direction

Without a per-pane target percentage, a hovered pane targets the size calculated from twice its base weight, bounded by available space and pane minimums. Each pane's “…” menu offers **Expansion Direction…** with Both Directions (`both`), Expand Right/Down (`forward`), Expand Left/Up (`backward`) and Default Expansion Direction. Labels follow orientation, and the default option shows its current effective direction. There is no combination-wide direction button or menu.

Unconfigured panes follow current expanded order: the rightmost/bottommost expanded pane defaults to `both`, all others to `forward`. Reordering, collapsing, adding or removing panes recalculates defaults. Explicit choices stay with pane identity and do not affect matching panes in another combination.

Forward borrows trailing slack while fixing the leading edge; backward borrows leading slack while fixing the trailing edge; both allows redistribution on both sides. One-way consecutive hovers preserve visible sizes outside the permitted side. Insufficient slack limits growth without borrowing from the wrong side or adding overflow. Leaving the entire combination restores base proportions.

Legacy combination-wide `hoverDirection` values are read as explicit choices for existing panes, preserving their behavior. Reading never writes settings; the next user layout edit saves the new `hoverDirections` format. An existing per-pane mapping takes priority. Restoring one pane's default removes only its explicit choice; other legacy choices remain, and newly added panes follow positional defaults.

<a id="combined-hover-size"></a>

#### 4.2.4 Per-pane expansion targets

Choose **Set Hover Expansion Size…** from a child pane's **…** menu and enter an integer from `1` to `100`. A value of `65` targets 65% of the combination's usable width, or height for vertical layouts, excluding the global toolbar, splitters and collapsed panes. The menu shows the current target or **Default expansion**, and offers **Restore Default Hover Expansion Size** when an override exists. Cancelled, invalid or unchanged input does not save.

Targets belong to one pane in one combination. They follow the pane when reordered and are removed with it; another combination's matching pane is unaffected. Ordinary splitters and equal-size reset still adjust only base ratios. Restoring default removes the percentage override and returns to weighted expansion without resetting the base layout. The optional layout field `hoverSizePercentages` maps included role suffixes to integer percentages; omitted, invalid or absent-role entries use the default behavior.

Targets cannot shrink a pane below its base size or compress neighbors below 160 px horizontally or 80 px vertically. Forward mode borrows only trailing slack and retains preceding expanded panes, so a target may not be reached and the last pane still cannot grow backwards. Both-direction mode can use space on either side but retains the same minima. Changes need no reload; protected controls retain their geometry until fresh content movement applies the new target. Pane state and semantic queries are unchanged.

#### 4.2.5 Control protection and timing

Entering the global toolbar, a pane header, the Code Preview header or a search/result toolbar cancels pending resizing and freezes an active animation at its visible pixels. Fresh pointer movement in content restarts the dwell. Mode changes made over controls are saved immediately but geometry changes wait until pointer departure. This protection also applies to both-direction mode.

`cInsight.combinedViews.hoverEnterDelay` controls dwell (default `200` ms), `cInsight.combinedViews.hoverAnimationDuration` controls expansion/restoration animation (default `200` ms), and `cInsight.combinedViews.hoverLeaveDelay` controls the wait after leaving the entire combination (default `250` ms). All three are user-wide integer settings from `0` to `10000` ms and update all combinations without reloading. Zero means immediate expansion, no animation, or immediate restoration respectively; changing an active wait restarts it with the new value. Expanded panes have a minimum width of 160 px horizontally or height of 80 px vertically; undersized combinations scroll internally. A single expanded pane does not enlarge. Dragging, text selection, held mouse buttons and menus pause automatic resizing, and reduced-motion preferences always disable animation. Hovering does not focus, query the engine, reload code, or resize VS Code's outer view boundaries.

#### 4.2.6 Shared feature state

Results, business filters and feature pins/locks remain shared. Callers/Callees retain their shared pin; References has its own pin; Code Preview shares its target and lock. Each tree presentation keeps independent local filtering, expansion, selection and scrolling. Symbol/file lists share their feature lock but manage local filter clearing and following independently. Actions target the originating presentation; editor commands prefer the last-used visible matching presentation, then the original view. Query demand is the OR of all visible presentations; hiding a combination or collapsing/removing its pane withdraws that presentation's demand without creating a second engine or semantic controller.

#### 4.2.7 Themes and fonts

Combined panes follow VS Code's dark, light and high-contrast themes for horizontal/vertical scrollbars, interface typography, inputs and focus indicators. Source text uses `editor.fontFamily` and `editor.fontSize`; fixed preview colors still follow `cInsight.codePreview.colorScheme` and `tokenColors`. Theme and font updates apply to styles while retaining filters, expansion and scroll positions.

#### 4.2.8 Saved layout settings

`cInsight.combinedViews.slot1` through `slot4` are application/user settings shared across projects. Each defaults to `{"enabled":false,"title":"","direction":"horizontal","views":[],"ratios":[]}`. `enabled` shows the slot, `title` allows up to 80 characters (empty uses the default), `direction` accepts `horizontal` or `vertical`, and optional `hoverDirections` maps pane roles to `forward`, `backward` or `both`, with omitted entries following expanded order. The old `hoverDirection` is accepted only for compatibility as described above. `views` lists unique role suffixes, and `ratios` supplies matching positive weights from `0.001` to `1000` (missing entries use `1`). Role suffixes are `context`, `preview`, `references`, `callers`, `callees`, `supertypes`, `subtypes`, `includes`, `includedBy`, `history`, `bookmarks`, `workspaceSymbols`, `symbols`, `projectFiles`, `status`. Native docking positions remain VS Code-managed; layout settings contain no source paths or semantic results. `cInsight.combinedViews.hoverExpand` defaults to `true` and is independent of feature locks.

```json
{
  "cInsight.combinedViews.slot1": {
    "enabled": true,
    "title": "Code browsing",
    "direction": "horizontal",
    "hoverDirections": {"preview": "forward", "references": "backward"},
    "hoverSizePercentages": {"preview": 65},
    "views": ["preview", "callers", "references"],
    "ratios": [2, 1, 1]
  },
  "cInsight.combinedViews.hoverExpand": true,
  "cInsight.combinedViews.hoverEnterDelay": 200,
  "cInsight.combinedViews.hoverAnimationDuration": 200,
  "cInsight.combinedViews.hoverLeaveDelay": 250
}
```

### 4.3 How combinations complement native views

VS Code already lets you move, group and resize native views. A combined view adds a C Insight-specific browsing surface inside one native view; it does not replace the outer workbench layout. See [VS Code's layout guide](https://code.visualstudio.com/docs/configure/custom-layout#_drag-and-drop-views-and-panels).

| Reading need | Native VS Code layout | C Insight combined view |
| --- | --- | --- |
| Move a browsing setup | Move views or containers and group them | Move one combination; manage its internal order and proportions together |
| Temporarily gain reading space | Resize boundaries or collapse neighboring views | Hover expands a content pane and leaving restores proportions; controls pause resizing |
| Reuse a feature in several setups | Use the original view placement | Up to four named combinations reuse shared results, with local tree filtering, expansion and scrolling |
| Reuse internal layout across projects | VS Code owns native view/container placement | User settings retain combination names, roles, directions and proportions |
| Available content | Native and extension-contributed views | The sixteen C Insight roles; original independent views remain available and graphs stay in editor tabs |

<a id="shared-interactions"></a>

## 5. Shared navigation and browsing tools

### 5.1 Source-result mouse and keyboard actions

Result trees use a shared Webview renderer. Clicking a source-location name previews it; double-clicking opens it in the editor without changing branch expansion. Only disclosure arrows or the left/right keys expand and collapse branches. The same rules apply to Callers, Callees, Context, References, Type/Include Hierarchy, Navigation History, Bookmarks, Document Symbols, and Project Diagnostics. Enter opens the selected result; Space previews it. Ordinary result views have Collapse All and a local filter for currently expanded rows; Ctrl+F/Cmd+F opens that filter and Escape clears it. Document Symbols and Project Files instead keep their search inputs visible; Escape clears without hiding them. Existing view-title commands and node context actions remain available. The renderer virtualizes rows and resolves source descriptions only for the displayed viewport.

C Insight treats the second click on the same result name within `cInsight.navigation.doubleClickInterval` (default 500 ms) as a double click. The first click previews immediately; the second opens the editor and never changes expansion. Enter opens immediately, while Space previews. Symbol Search retains its existing activation classifier. Opening a result with double click or Enter does not immediately replace cursor-driven Context, Code Preview, References, Callers, or Callees results. Following resumes after the editor cursor moves to a different position with the mouse or keyboard; Document Symbols and Project Diagnostics still follow the active file immediately. Explicit Open Location, Go to Definition, Code Preview editor navigation, and Relationship Graph navigation retain their existing behavior. Clicking a navigable symbol inside Code Preview follows its definition there; double-clicking source text or blank space opens the corresponding or nearest rendered line in the editor. Pin and lock controls continue to block automatic replacement while allowing explicit navigation.

After opening source from a result tree, Code Preview, Go to Definition or Relationship Graph, use native VS Code Back/Forward commands or mouse side buttons bound to them to return between the origin and destination. Code Preview's own browsing history remains separate.

### 5.2 Call Hierarchy operations

Callers and Callees automatically expand the root's first level by default. Only a visible direction is automatically queried; explicit Show Incoming Calls and Show Outgoing Calls commands remain direction-specific. Set `cInsight.callHierarchy.defaultDepth` to `0` to keep new roots collapsed. Expanding a node displays every returned call site directly as a source-ordered row: two calls from `add` appear as two `add` rows and three calls from `main` appear as three `main` rows. Callers first prepend every independent declaration of the function being expanded. Those declarations are loaded and cached only when that semantic node is expanded; they are searchable and navigable but do not participate in call depth, paths, budgets, sessions, or semantic exports. Only the earliest call occurrence of each semantic caller or callee can lazily load the next level.

Callers and Callees share one pin state. A pin blocks automatic target replacement, while explicit queries, expansion, loaded-node search, bounded caller/callee path search and exports remain available. Exports read loaded semantic relationships; declarations do not consume call budgets or become call edges.

### 5.3 Relationship graphs

Run Show Relationship Graph for a function/type, or Show File Relationship Graph for the active file. The graph opens in an editor tab. Expand calls, inheritance, includes and explicit defining/containing relations; select nodes to preview source, double-click to open, search loaded nodes, collapse branches, pan/zoom and export Text/JSON/Mermaid. Call/type/include trees share query caches with the graph, but keep independent presentation state.

### 5.4 Pins, locks and workspace sessions

Context pin pauses the automatic follow chain. References has an independent pin; Callers/Callees share theirs. Code Preview lock blocks cursor following but allows explicit browsing. Document Symbols and Project Files independently lock automatic clear/reveal. Workspace snapshots can restore supported history, preview, reference/search state, precise call branches and still-open graphs; type/include trees are not restored.

<a id="update-model"></a>

## 6. Update logic and resource use

### 6.1 Automatic following and empty positions

Queries are demand-driven: hidden relationship views do not issue their corresponding automatic detail requests.

When an automatic cursor query returns no definition, declaration, Call Hierarchy root, hover, or symbol information, C Insight treats the position as symbol-free and preserves the existing Context, Code Preview, References, Callers, and Callees. It also skips delayed References and call-count details for that position. Explicit Refresh, Find All References, and Show Incoming/Outgoing Calls still query and publish the selected position, including an empty result; switching to a non-C/C++ editor retains the existing clear behavior.

Typing does not issue a cursor-driven semantic refresh, regardless of typing cadence or the number of caret/selection events VS Code emits for one edit. The edit gate remains active until deliberate mouse or keyboard movement leaves the edit, while a short event-association window absorbs positions that differ slightly from the reported insertion endpoint. Movement within the same identifier is deduplicated, whitespace preserves the current results without querying, and a location already confirmed symbol-free is remembered until that document changes. Non-whitespace punctuation remains queryable so C++ operators are not hidden. Explicit commands always bypass this automatic gate.

### 6.2 Cache invalidation and explicit requests

An empty Microsoft field-reference result is not retained in the hierarchy cache because cpptools can return one transiently while its browse database becomes ready. Running Show Incoming Calls or Refresh explicitly also invalidates the current hierarchy cache before issuing a fresh Provider query.

Source edits mark loaded Call and Type Hierarchy results stale but defer cache clearing until the next actual hierarchy request. This preserves the visible trees during typing and avoids repeated cache work when no hierarchy view is queried. Repeated edits publish each identical stale state only once.

### 6.3 Secondary updates during editing

Continuous edits are coalesced before secondary UI work. Visible Document Symbols waits 800 ms after the last edit; Code Preview skips rerendering when a change is entirely below its rendered range and otherwise rerenders once after 200 ms; Include Hierarchy compares a 500 ms debounced `#include` fingerprint and ignores ordinary body edits. An unopened or unqueried Included By view never starts a reverse workspace scan because of typing. Relationship Graph publishes the same source-stale state only once, and diagnostic bursts are merged into a 500 ms Project Diagnostics refresh.

<a id="configuration"></a>

## 7. Configuration and commands

### 7.1 Setting families

Open **Settings** and search for `C Insight` to see every setting, accepted value, range, and default in the active display language. Stable configuration IDs begin with `cInsight.`. Important groups include:

The `cInsight.documentSymbols.*` family controls Document Symbols presentation and viewport following.

- `cInsight.engine`, `cInsight.clangd.*`, `cInsight.microsoft.*`, `cInsight.compileCommandsDir`, `cInsight.fallbackFlags`, and `cInsight.exclude`
- `cInsight.codePreview.*`, `cInsight.analysis.*`, `cInsight.backgroundIndex.*`, `cInsight.diagnostics.*`, `cInsight.followCursor`, `cInsight.followCursorDelay`, `cInsight.followCursorDetailsDelay`, and `cInsight.navigation.*`
- `cInsight.references.*`, `cInsight.callHierarchy.*`, and `cInsight.export.*`
- `cInsight.typeHierarchy.*`, `cInsight.includeHierarchy.*`, and `cInsight.relationshipGraph.*`
- `cInsight.history.*`, `cInsight.bookmarks.*`, `cInsight.symbolSearch.*`, and `cInsight.session.*`
- `cInsight.combinedViews.*` for user-wide combined layouts and hover expansion
- `cInsight.includeDeclarationInReferences` and `cInsight.includeSystemReferences`

The [Chinese configuration tables](user-guide.zh-CN.md#configuration) enumerate every key, default, range and meaning.

### 7.2 Editor menu and shortcuts

All commands are available from the Command Palette under **C Insight**. Context menus and view title bars expose commands relevant to the current editor, view, or selected node.

The C/C++ editor context menu places C Insight's entries immediately after clangd's **Switch Between Source/Header**, when that command is present, with a native separator between the two groups. They start with **Open View…**, followed by Bookmark Current Symbol, Show Includes, Show Included By, Show Relationship Graph, Show File Relationship Graph, and **C Insight: Symbol Navigation**. That submenu contains Go to Definition, Find All References, Show Incoming Calls, Show Outgoing Calls, Show Supertypes, and Show Subtypes. Call commands appear for C/C++; type commands appear for C++/Objective-C++. The Command Palette, F12/Shift+F12, pane toolbars, result-item menus and native VS Code commands retain their existing entry points.

### 7.3 View-title actions

Primary view-title actions use compact VS Code Theme Icons. Hover an icon to see its localized command title; the Command Palette also retains the full title. Context, Code Preview, References, Callers, Callees, and Document Symbols share the Refresh icon, while Clear Bookmark Filter uses the clear-all icon. Text, JSON, and Mermaid exports remain textual in the `...` overflow menu.

### 7.4 Cross-compilation

Cross-compiled bare-metal and embedded Linux projects should generate that database from the real target toolchain. Configure a narrow clangd `--query-driver` allowlist when the driver must supply target and system-header defaults; keep `--sysroot`, `--target`, CPU/ABI options, includes, and defines in compile commands or `.clangd`, not in clangd server arguments. Microsoft mode requires its own cpptools `compileCommands` and `compilerPath` configuration. See [Cross-compilation and embedded projects](cross-compilation.en.md) for complete examples and Remote-path constraints.

<a id="diagnostics-and-privacy"></a>

## 8. Diagnostics, privacy and limits

### 8.1 Reliability and diagnostics

Project Diagnostics explains engine availability, compilation database detection, the active file command, indexing progress, request performance, and result reliability. Runtime counters include edit-induced cursor suppression, same lexical-target deduplication, known symbol-free target suppression, and rejected stale context writes to Code Preview. Raw clangd/cpptools logs, command IDs, setting IDs, symbol names, file paths, and exported JSON field names remain untranslated so diagnostic evidence and automation stay stable.

If the managed clangd process exits unexpectedly, C Insight automatically restarts it up to four times in a three-minute sliding window. A fifth close stops the crash loop; inspect **C Insight: clangd**, then run **C Insight: Restart clangd** explicitly. A `Server process exited with signal SIGSEGV` line is the primary process failure. Subsequent `EPIPE`, destroyed-stream, and `textDocument/didOpen failed` messages are secondary effects of pending synchronization reaching the closed pipe; C Insight collapses duplicates but cannot repair the clangd defect that caused the signal. Automatic recovery resets index progress and marks dependent semantic results stale until the new process is ready.

### 8.2 Compilation-database paths

In clangd mode, a relative `cInsight.compileCommandsDir` is resolved against the first workspace folder. The setting does not interpolate `${workspaceFolder}`; use `"build"` or an absolute directory. C Insight passes the selected directory to clangd but never executes build commands or compilation-database entries. An explicit `--query-driver` does authorize clangd to execute a matching trusted driver. In Microsoft mode, the same C Insight setting supports diagnostics but does not configure cpptools.

### 8.3 Privacy

C Insight has no telemetry and does not upload source code. See [Privacy](../../PRIVACY.md), [Security](../../SECURITY.md), and [Contributing](../../CONTRIBUTING.md) for the complete boundaries and maintenance workflow. For detailed feature behavior, use the [Simplified Chinese manual](user-guide.zh-CN.md).

### 8.4 Analysis boundaries

Static analysis cannot resolve every runtime dispatch target, function pointer, alias, generated macro expansion, template instantiation or inactive preprocessing branch. Evidence and confidence distinguish semantic results from conservative inference. Include relationships are textual, not a full preprocessing evaluation.

<!-- GENERATED COMMAND REFERENCE START -->

<a id="command-reference"></a>

## 9. Complete command reference

This section is generated from `package.json`. Every command is available from the Command Palette; the table also lists view-title, editor-context, tree-item, and default-keybinding entry points. An entry can be hidden when its `when` condition does not match the current UI state.

| Command | Command ID | Entry points |
| --- | --- | --- |
| Open View… | `cInsight.openView` | Command Palette; Editor context menu |
| Create Combined View | `cInsight.combinedViews.create` | Command Palette |
| Manage Combined View | `cInsight.combinedViews.manage` | Command Palette; View title |
| About | `cInsight.about` | Command Palette |
| Show Relationship Graph | `cInsight.relationshipGraph.show` | Command Palette; Editor context menu |
| Show File Relationship Graph | `cInsight.relationshipGraph.showFile` | Command Palette; Editor context menu |
| Export Relationship Graph as Text | `cInsight.relationshipGraph.exportText` | Command Palette |
| Export Relationship Graph as JSON | `cInsight.relationshipGraph.exportJson` | Command Palette |
| Export Relationship Graph as Mermaid | `cInsight.relationshipGraph.exportMermaid` | Command Palette |
| Go to Definition | `cInsight.goToDefinition` | Command Palette; Editor context menu → C Insight: Symbol Navigation; Keybinding `f12` |
| Find All References | `cInsight.findReferences` | Command Palette; Editor context menu → C Insight: Symbol Navigation; Keybinding `shift+f12` |
| Show Incoming Calls | `cInsight.showIncomingCalls` | Command Palette; Editor context menu → C Insight: Symbol Navigation; Callers title |
| Show Expanded Function Callers | `cInsight.callers.showExpandedTarget` | Command Palette; Callers title; Tree item context menu |
| Show Outgoing Calls | `cInsight.showOutgoingCalls` | Command Palette; Editor context menu → C Insight: Symbol Navigation; Callees title |
| Pin Context | `cInsight.pinContext` | Command Palette; Context title |
| Unpin Context | `cInsight.unpinContext` | Command Palette; Context title |
| Pin References | `cInsight.pinReferences` | Command Palette; References title |
| Unpin References | `cInsight.unpinReferences` | Command Palette; References title |
| Pin Callers and Callees | `cInsight.pinCallHierarchy` | Command Palette; Callers title; Callees title |
| Unpin Callers and Callees | `cInsight.unpinCallHierarchy` | Command Palette; Callers title; Callees title |
| Refresh | `cInsight.refresh` | Command Palette; View title; Document Symbols title |
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
| Show Supertypes | `cInsight.typeHierarchy.showSupertypes` | Command Palette; Editor context menu → C Insight: Symbol Navigation; Supertypes title |
| Show Subtypes | `cInsight.typeHierarchy.showSubtypes` | Command Palette; Editor context menu → C Insight: Symbol Navigation; Subtypes title |
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
| Sort Document Symbols | `cInsight.documentSymbols.sort` | Command Palette; Document Symbols title |
| Lock Document Symbols Following | `cInsight.documentSymbols.lock` | Command Palette; Document Symbols title |
| Unlock Document Symbols Following | `cInsight.documentSymbols.unlock` | Command Palette; Document Symbols title |
| Refresh Project Files | `cInsight.projectFiles.refresh` | Command Palette; Project Files title |
| Sort Project Files | `cInsight.projectFiles.sort` | Command Palette; Project Files title |
| Lock Project Files Following | `cInsight.projectFiles.lock` | Command Palette; Project Files title |
| Unlock Project Files Following | `cInsight.projectFiles.unlock` | Command Palette; Project Files title |
| Search Text… | `cInsight.searchText` | Command Palette |
| Run Text Search | `cInsight.textSearch.run` | Command Palette; Search & Replace title |
| Cancel Text Search | `cInsight.textSearch.cancel` | Command Palette; Search & Replace title |
| Open Results Window | `cInsight.textSearch.openResults` | Command Palette |

<!-- GENERATED COMMAND REFERENCE END -->
