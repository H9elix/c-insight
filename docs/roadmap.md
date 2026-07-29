# C Insight Roadmap Notes

## Deferred Code Preview ideas

The following features were intentionally excluded from 0.5.0 and may be
reconsidered after real-world use:

- A complete Code Preview context menu for additional semantic queries beyond
  the current Definition preview interaction.
- Persisting and restoring horizontal and vertical scroll positions for every
  preview history target.
## References classification follow-ups

Version 0.6.1 added confidence-labelled Read, Write, Read/Write, address, and
macro-related classifications. Future refinement may cover pointer side
effects, reference parameters, overloaded operators, templates, macro
expansion provenance, and other cases not exposed by standard clangd
Document Highlights.

## Call hierarchy follow-ups

Version 0.7.1 provides bounded call-path search, Mermaid graph export, and
explicit indirect-call syntax hints. Version 0.10.0 restores the call root and
maximum loaded depth by re-querying clangd. Exact per-node expansion identity
and deeper unresolved function-pointer/indirect-call analysis remain deferred.

## Engineering diagnostics

Compilation database discovery, clangd project diagnostics, background index
progress, reliability reporting, and stale-result markers were implemented in
the 0.8.x series. Version 0.13.0 added compile-command decomposition,
conservative header command candidates, fallback-flag visibility, and
shareable versioned text/JSON reports.

## Deferred 0.10.1 session stabilization

Version 0.10.0 restored correctly in initial FFmpeg testing, so the planned
stabilization release was deferred. Reconsider it if real usage exposes slow
large-tree restoration, startup cursor-follow races, Remote SSH reconnect
failures, oversized snapshots, stale locations after project changes, or a
need for restore progress/cancellation and finer partial-failure reporting.

## Type hierarchy

Version 0.11.0 added clangd-backed Supertypes and Subtypes trees, bounded lazy
expansion, search, and export. Exact cross-session expansion restoration is
deferred until real-world usage justifies adding Type Hierarchy to the unified
workspace snapshot.

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
