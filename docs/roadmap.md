# C Insight Roadmap Notes

## Second phase completion

Versions 0.14.0 through 0.16.3 completed the planned References, Call
Hierarchy, and Type Hierarchy semantic-evidence, restoration, search, and
export work. Version 0.16.3 completed compatibility regression and user-guide
auditing. The deferred items below remain deliberately outside this phase.

## Third phase performance and reliability

Version 0.17.0 established a versioned synthetic large-workspace baseline for
reference classification, graph construction/snapshotting, hierarchy export,
and preview scrolling. Subsequent third-phase work will use this baseline while
adding request scheduling, large-result resource controls, interaction
consistency, diagnostics, and real FFmpeg acceptance measurements.
Version 0.17.1 introduced priority-aware semantic request scheduling, bounded
background concurrency, cancellation before dispatch, and safe coalescing
within a shared cancellation scope.
Version 0.17.2 bounded References tree materialization and detail caches,
introduced cancellable record-limited References bulk output, and applied a
shared encoded-size guard to all file exports.
Version 0.17.3 unified idle, loading, empty, cancelled, stale, limited, and
error presentation across the demand-driven navigation trees and aligned both
Call Hierarchy directions on the same expansion-failure behavior.
Version 0.17.4 added centralized runtime observability for semantic scheduling,
latency, caches, and resource-limit hits in Project Diagnostics and its
shareable reports.

## Deferred fourth phase

Do not implement the fourth-phase feature work until the user explicitly
reactivates it. Keep the following items as memo-only candidates while the
third phase focuses on large-workspace validation, performance, resource
control, interaction consistency, and diagnostics:

- A complete semantic context menu in Code Preview for Definition,
  Declaration, References, Callers/Callees, Type Hierarchy, bookmarks, and
  editor navigation.
- Include analysis improvements covering compiler builtin paths and bounded,
  conservative conditional-preprocessor evaluation.
- Type/Include workspace-session restoration, subject to the safety rules in
  the dedicated restoration memo below.
- Cross-procedural pointer/data-flow analysis, complete template instantiation
  chains, and compiler macro-expansion stacks.
- Optional Microsoft C/C++ extension engine support, only if a stable public
  API and a clear user need make coexistence practical.

Replanning or third-phase completion does not implicitly authorize these
features. They remain deferred until explicitly requested.

## Deferred Code Preview ideas

The following features were intentionally excluded from 0.5.0 and may be
reconsidered after real-world use:

- A complete Code Preview context menu for additional semantic queries beyond
  the current Definition preview interaction.
- Persisting and restoring horizontal and vertical scroll positions for every
  preview history target.
## References classification follow-ups

Version 0.6.1 added confidence-labelled Read, Write, Read/Write, address, and
macro-related classifications. Version 0.14.0 added a unified evidence model
so every result records its conclusion, evidence source, stable rule,
explanation, and confidence. Version 0.14.1 distinguished pointee writes and
used clangd signatures to conservatively identify mutable reference/pointer
argument effects. The remaining second-phase work will refine overloaded
operators, templates, macro expansion provenance, and other cases not exposed
by standard clangd Document Highlights. Version 0.14.2 then recognized
punctuation-based overloaded operator references as inferred calls. Version
0.14.3 added macro-definition and template-declaration provenance. Full
compiler macro expansion stacks and template instantiation chains remain
outside the standard clangd reference protocol. Version 0.14.4 completed this
classification phase with confidence/evidence filters, matching grouping
modes, and self-describing versioned exports.

## Call hierarchy follow-ups

Version 0.7.1 provides bounded call-path search, Mermaid graph export, and
explicit indirect-call syntax hints. Version 0.10.0 restores the call root and
maximum loaded depth by re-querying clangd. Version 0.15.0 added bounded,
direction-specific stable path identities and restores only nodes that were
actually expanded. Version 0.15.1 added bounded source evidence nodes for
explicit unresolved function-pointer and member-function-pointer calls without
guessing runtime targets. Pointer target-set/data-flow analysis remains
deferred.

## Engineering diagnostics

Compilation database discovery, clangd project diagnostics, background index
progress, reliability reporting, and stale-result markers were implemented in
the 0.8.x series. Version 0.13.0 added compile-command decomposition,
conservative header command candidates, fallback-flag visibility, and
shareable versioned text/JSON reports.

## Session stabilization

Version 0.13.3 completed the deferred 0.10.1 stabilization work with serialized
saves, startup cursor-follow ordering, cancellable sectioned progress, remote
URI availability checks, partial-failure isolation, and a total serialized
snapshot byte budget. Exact Call/Type/Include per-node expansion restoration
remains governed by their separate roadmap notes.

## Type hierarchy

Version 0.11.0 added clangd-backed Supertypes and Subtypes trees, bounded lazy
expansion, search, and export. Version 0.16.0 added explicit relationship,
protocol evidence, confidence, type-kind, declaration, and duplicate/cycle
explanations to the tree and exports. Exact cross-session expansion restoration
remains deferred until real-world usage justifies adding Type Hierarchy to the
unified workspace snapshot. Version 0.16.1 added local kind/relationship
filters plus depth- and path-aware search over loaded nodes. Version 0.16.2
added loaded-subgraph statistics and explicit depth/node truncation metadata
to every Type Hierarchy export format.

## Include hierarchy

Version 0.11.2 added compile-command-aware Includes and an on-demand reverse
Included By index, with lazy expansion, bounded search/export, classification,
and cycle/duplicate handling. Exact compiler builtin include-path discovery,
conditional-preprocessor evaluation, and cross-session tree restoration remain
deferred.

## Deferred Type/Include workspace restoration

Do not implement Type Hierarchy or Include Hierarchy workspace-session
restoration in the current 0.11.x plan. Their roots, loaded depths, and
per-node expansion state remain runtime-only.

If revisited, restoration should save stable root file/position identities and
loaded maximum depths, then re-query relationships after startup rather than
serializing clangd's opaque temporary data. Included By restoration must be
delayed, visible, and cancellable so reopening a large workspace never starts
an unexpected reverse-index scan.

Reconsider this work only if real usage shows that repeatedly rebuilding these
trees is disruptive. Relationship Graph session restoration is already
implemented independently and does not restore these tree views.
