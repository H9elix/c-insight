# C Insight Roadmap Notes

## Deferred Code Preview ideas

The following features were intentionally excluded from 0.5.0 and may be
reconsidered after real-world use:

- A complete Code Preview context menu for References, Callers, Callees, and
  other semantic queries. Version 0.5.0 supports single-click Definition only.
- Persisting and restoring horizontal and vertical scroll positions for every
  preview history target.
- Editor-like semantic coloring in Code Preview. The preferred implementation
  is to decode clangd-backed VS Code Document Semantic Tokens, layer them over
  the existing lexical fallback, cache results, and invalidate them after
  source or theme changes. This is deferred because Webviews cannot reuse the
  editor renderer or obtain every theme's final computed semantic-token
  colors, so the result would be more complex without guaranteeing exact
  editor/Webview color parity.

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
the 0.8.x series.

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

The next relationship-navigation iteration should consolidate common
interaction patterns across Call, Type, and Include Hierarchy before a larger
graph view is considered.
