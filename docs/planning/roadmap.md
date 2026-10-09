# C Insight Roadmap and Memo

## Current status

The maintained code and documentation baseline is `0.22.16`. No new feature phase is active: the current release retains the implemented dual-engine architecture and `0.22.x` call-occurrence UI, complete member-field caller results with optional selected-variable classification, corrected Code Preview source-row styling, bounded automatic recovery from unexpected managed-clangd exits, configurable References group expansion that defaults off, preservation of navigation results at symbol-free cursor positions, icon-only primary view-title actions, and query-free Document Symbols viewport-center highlighting. It also establishes the public GitHub repository contract, automated quality/release workflows, versioned curated bilingual Release Notes, dependency auditing, generated third-party notices, explicit real-workspace test paths, and repository-wide prose-format enforcement. Deferred fourth-phase items remain memo-only until the user explicitly reactivates one of them.

The user guides define current behavior. Versioned validation reports preserve evidence from the environment and date named in each report; they are not rolling claims about every later release.

The current unreleased local development baseline suppresses edit-induced cursor queries, deduplicates lexical cursor targets, lazily invalidates Call and Type Hierarchy caches, and coalesces edit-driven Document Symbols, Code Preview, Include Hierarchy, Relationship Graph, and Project Diagnostics work. It intentionally keeps the formal package version at `0.22.16` until the temporary VSIX is accepted; version assignment, push, and release follow only after that acceptance.

## Completed phases

### Foundation and workspace navigation (`0.1.x`–`0.13.x`)

The foundation delivered the managed clangd client, Context, Code Preview, References, Callers/Callees, Navigation History, Bookmarks, workspace/document symbols, Type Hierarchy, Include Hierarchy, Relationship Graph, Project Diagnostics, reliability status, and bounded workspace-session restore. Relationship Graph implementation completed in `0.12.0`–`0.12.8`; its original design is retained in `relationship-graph-plan.zh-CN.md` as a historical implementation record.

`0.13.0` added compile-command decomposition, conservative header command candidates, fallback visibility, and versioned diagnostic reports. `0.13.3` completed session stabilization with serialized saves, startup ordering, cancellable sectioned restore, remote URI checks, partial-failure isolation, and a total snapshot byte budget.

### Semantic evidence (`0.14.0`–`0.16.3`)

References now carry classification, confidence, stable rules, evidence source, macro/template provenance, conservative mutable pointer/reference argument effects, and overloaded-operator hints. Filters, grouping, and versioned exports preserve that evidence. Complete compiler macro expansion stacks, template instantiation chains, and cross-procedural pointer target sets remain outside the available standard Provider evidence.

Call Hierarchy gained stable direction-specific paths, bounded restoration of expanded semantic branches, path search, export, and explicit unresolved function/member-pointer syntax evidence. Type Hierarchy gained relationship/protocol evidence, kind and relationship filters, depth/path-aware loaded search, loaded-subgraph statistics, and truncation metadata.

### Performance and reliability (`0.17.x`, revalidated in `0.20.0`–`0.20.5`)

This phase added the synthetic large-workspace benchmark, priority-aware request scheduling, cancellation before dispatch, safe coalescing, bounded References materialization and caches, export size guards, common view status, runtime observability, and repeatable read-only FFmpeg/clangd acceptance. The `0.20.x` pass revalidated and hardened cancellation, double-scale stress, resource lifecycle, isolated Extension Host launch, and both analysis engines. Detailed dated evidence remains under `docs/validation`.

### Microsoft C/C++ engine (`0.18.0`–`0.18.22`)

`0.18.0` established the isolated public-Provider probe. `0.18.1` introduced the opt-in Microsoft C/C++ language service (cpptools) adapter while keeping clangd as the default. Later releases added fail-closed configuration/conflict checks, engine-specific diagnostics and timing, serialized demand-driven Call Hierarchy work, semantic-token timeout fallback, References-based safe Callers, native Callees evidence, interaction/cache regressions, consistent presentation, staged fixture/FFmpeg acceptance, and reversible workspace-scoped conflict handling.

The adapter uses only stable VS Code Provider commands. It cannot select a unique Provider when competing extensions are active, stop work already dispatched inside cpptools, expose cpptools indexing internals, or provide clangd-only Type Hierarchy/protocol evidence. Native Microsoft Incoming Calls remains opt-in because a real cpptools crash path was confirmed; References-based Callers remains the safe default.

### Localization and maintainability (`0.19.x`–`0.20.14`)

The extension now follows VS Code display language with English fallback and Simplified Chinese resources. Runtime and manifest localization, generated typed IDs, command-wiring ownership, view lifecycle, pin-state ownership, runtime initialization, architecture tests, categorized documentation, bilingual command references, terminology checks, prose normalization, and local link validation are part of the packaging gate.

### Unified navigation interaction (`0.21.0`–`0.21.2`)

Every ordinary source-location tree result now uses immediate single-activation Code Preview and configurable second-activation editor opening. The selected result remains stable across the programmatic editor transition; cursor-driven views resume only after a mouse or keyboard move to a different editor position. Document Symbols and Project Diagnostics continue to follow the active document. Documentation prose normalization prevents arbitrary hard-wrapped paragraphs from returning.

### Occurrence-based Call Hierarchy (`0.22.0`–`0.22.3`)

Callers and Callees project every returned call site directly under the semantic parent in source order. Only the earliest occurrence of a semantic relation is expandable, so repeated calls remain navigable without duplicating deeper queries. New roots expand one visible direction to depth one by default, and Symbol Search uses a persistent top input.

Code Preview and both call roots prefer an implementation distinct from the declaration without mutating the opaque Provider hierarchy item. Expanding a Caller semantic node lazily prepends its independent declarations, then lists incoming call sites. Supplemental declarations remain searchable and navigable but are excluded from semantic depth, node budgets, paths, sessions, and exports. The former non-expandable per-caller definition leaves and their background work have been removed.

### Selected-variable member Callers (`0.22.13`)

Field and property Callers opened through a simple named base now scope direct accesses to the selected variable declaration. Same-variable results lead the tree, other identifiable variables are omitted, and complex or unresolved bases remain visible after an explicit divider. clangd and Microsoft modes share the classification; the Microsoft adapter synthesizes a References-based field root when the public Call Hierarchy Provider returns none. Call Relationship Graph edges, graph-session restoration, and semantic exports retain selected-versus-unresolved evidence. Alias and points-to analysis remain deferred.

### Complete and lightweight member Callers (`0.22.14`)

Field and property Callers again retain the Provider's complete semantic result set, matching Source Insight's symbol-level scope while adding three ordered evidence groups: selected root plus complete member path, other roots or paths, and unresolved complex expressions. Simple nested chains such as `st->codecpar->sample_rate` anchor at `st`. Candidate classification reuses one root References query, reads unopened source through the workspace file system instead of opening documents, and permits only 16 Definition fallbacks when References is unavailable. This removes candidate-driven clangd `didOpen`, AST, preamble, diagnostics, and semantic-token work without claiming alias or points-to analysis.

### Optional member Caller classification (`0.22.15`)

`cInsight.callHierarchy.classifyMemberCallers` now selects between the two supported scopes. Its default `false` path restores the `0.22.12` symbol-level behavior and direct clangd query path with no classification work. Setting it to `true` enables the complete three-group `0.22.14` presentation. Microsoft mode retains its safe synthetic References-based field root in either mode because that is an engine-compatibility fallback rather than instance classification.

## Deferred fourth phase

Do not implement these items until the user explicitly reactivates them:

- A complete Code Preview semantic context menu covering Definition, Declaration, References, Callers/Callees, Type Hierarchy, bookmarks, and editor navigation.
- Include analysis that incorporates compiler-builtin/query-driver search paths and performs bounded, conservative conditional-preprocessor evaluation.
- Type Hierarchy and Include Hierarchy workspace-session restoration.
- Cross-procedural pointer/data-flow analysis, complete template-instantiation chains, and compiler macro-expansion stacks.
- Additional Microsoft C/C++ parity only where a stable public API exists; do not depend on private cpptools commands to imitate clangd-only features.

Replanning, maintenance, or completion of another phase does not implicitly authorize these features.

## Implemented items removed from the memo

The following are no longer deferred and must not be reintroduced as future work:

- Code Preview semantic-token coloring with bounded timeout, lexical fallback, and count/byte-bounded cache.
- Incremental upward/downward preview loading, an always-accessible horizontal scrollbar, and bounded per-target scroll/range restoration for the current Extension Host session.
- Relationship Graph static workspace-session restoration when the panel was still open at shutdown; explicitly closed panels are intentionally not restored.
- Exact Call Hierarchy semantic-branch restoration using stable paths and re-query rather than serialized opaque Provider data.
- Persistent Symbol Search input and automatic one-level expansion of the visible Callers/Callees direction.

## Continuing constraints

### Project diagnostics

Compilation-database discovery, current-file command decomposition, clangd lifecycle/index progress, Microsoft Provider evidence, reliability reporting, stale markers, report redaction, and runtime resource statistics are implemented. Cross-compilation accuracy still depends on the project's real compilation database and toolchain; C Insight does not run the build or manufacture target flags.

### Type Hierarchy

Supertypes/Subtypes remain clangd-backed, lazy, bounded, searchable, filterable, and exportable. Opaque hierarchy data remains runtime-only. If session restoration is reconsidered, save stable root/expanded-path identities and re-query after startup rather than serializing opaque items.

### Include Hierarchy

Includes/Included By remain local, compile-command-aware, lazy, independently triggered, bounded, and exportable. Included By restoration must never cause an unexpected startup workspace scan. Compiler paths learned internally by clangd through `--query-driver` are not available to the local resolver unless also present in compile flags.

### Workspace sessions

Relationship Graph has independent bounded static restoration. Type/Include trees remain runtime-only. Any new section must define schema compatibility, a byte limit, URI validation, cancellation, engine ownership, and isolated failure handling before implementation.
