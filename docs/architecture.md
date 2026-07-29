# Architecture

The TypeScript extension is both the VS Code integration and the LSP client.
`ClangdManager` owns one clangd process. Navigation queries go through
`AnalysisService`, keeping tree UI code independent from the concrete backend.

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
never reads local files or sends LSP requests directly. The extension host
requests Document Semantic Tokens through VS Code's registered provider,
decodes only the visible preview range, and layers those symbol classes over
the existing lexical fallback. Provider results are bounded and keyed by URI
and document version, so moving within the same version only repeats the cheap
range decode; edits and relevant configuration changes invalidate them. Theme
changes rerender the visible preview. The Webview maps semantic
classes to public VS Code theme variables because it cannot reuse the editor
renderer or inspect every final semantic-token color rule.

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

The same hierarchy families map their loaded `TreeNode` data into a versioned
common export model. Text, JSON, and Mermaid rendering is shared; each caller
supplies only relation metadata and whether semantic edges follow or reverse
the visual parent-child direction.

Relationship Graph has a separate bounded semantic model keyed by stable
content-derived node and edge IDs. The extension host owns this model and all
file/navigation authority. Its editor-area WebviewPanel receives immutable
snapshots and renders native SVG under a nonce-restricted CSP. Incoming
messages contain only a discriminated action and node ID; the host validates
the ID against its current model before previewing or opening a file.
Call nodes are laid out by semantic Caller → Callee rank around the selected
root. Multi-level expansion is cancellable, reuses already loaded directions,
and leaves partial results intact. Search and export operate only on the
current immutable snapshot; node context actions delegate bookmarks and
navigation back to extension-host services.

Canvas-only state (relation filters, collapsed branches, stable positions,
selection, pan, and zoom) remains inside the Webview and never mutates or
deletes the host semantic model. Snapshot revisions add or merge semantic
data, while the viewport is fitted only when the root identity changes.
Collapse derives the outward branch from semantic ranks and hides it locally,
so expanding it again cannot trigger a language or file-system request.

Rendering is scheduled through `requestAnimationFrame` and reconciles SVG
elements by stable semantic IDs. Layer ranks are computed from adjacency lists
in O(V+E), while graph-space viewport bounds select nearby nodes before DOM
reconciliation. The complete immutable snapshot remains available for search,
statistics, collapse, and export. Slow frames are reported to the extension
host with a throttled, validated telemetry-free message and written only to
the local C Insight output channel. Closing the panel cancels active work and
releases both host graph maps and Webview render/layout caches.

Mixed graphs use an explicit `defines` relation directed from the owning
container to the defined entity: File → Symbol and Type → Member. Cross-domain
actions are available only from the validated host-side node context menu.
They attach normal file, type, or call nodes to the same bounded model, so each
new node reuses its existing repository and expansion capabilities. Adding
type members uses document symbols plus cancellable Call Hierarchy prepare
requests; adding a containing type uses document nesting or a qualified
out-of-class definition fallback. No cross-domain action runs on selection,
render, filter, search, or export.

Workspace Session stores Relationship Graph in an optional schema-versioned
section capped independently from the live graph. The host snapshot contains
semantic nodes/edges; the Webview reports selection, enabled relations,
collapsed IDs, and viewport through a validated, debounced message. Restore
checks the root URI and reconstructs only the static model and canvas. Opaque
Call/Type hierarchy items are intentionally excluded and prepared lazily on
the first explicit expansion of a restored node. Oversized snapshots degrade
to the root, while malformed graph sections are discarded independently from
the enclosing workspace session.

Callers/Callees trees and Relationship Graph share a
`CallHierarchyRepository`, including separate bounded Incoming and Outgoing
caches and the opaque clangd call items needed by follow-up requests. The graph
maps every result into semantic Caller → Callee edges and merges stable node
IDs. Supertypes/Subtypes trees and Relationship Graph likewise share a
`TypeHierarchyRepository`; inheritance edges are normalized as Supertype →
Subtype before entering the graph model.

Includes/Included By trees and Relationship Graph share an
`IncludeHierarchyRepository`. It owns the resolver, forward promise cache, and
single reverse workspace index. File-graph creation and forward expansion call
only `forward`; only an explicit Included By expansion path calls `incoming`,
which is the sole operation that can build the reverse index. Include edges
are normalized as Includer → Included.

Include Hierarchy is local and does not require a non-standard clangd method.
The forward tree parses directives lazily and resolves them with the active
compilation database's `-iquote`, `-I`, and `-isystem` paths. The reverse tree
builds a bounded workspace index only on first expansion, then incrementally
updates it for file changes. Both directions share compile-database
invalidation, cycle/duplicate protection, and export semantics in which edges
always point from the including file to the included file.

Reverse-index builds use isolated maps and a generation token. File events
arriving during a scan are queued into the candidate index; invalidation
cancels the active generation. Only a complete current generation is
atomically published, so consumers never observe partial or superseded maps.

The language client also registers clangd's standard language capabilities
with VS Code. C Insight commands query `AnalysisService` directly so their
results cannot accidentally come from another extension.

## Trust boundary

C Insight does not start clangd in an untrusted workspace. It launches the
process without a shell and never executes CMake or build commands
automatically.
