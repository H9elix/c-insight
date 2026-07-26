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
explicit indirect-call syntax hints. Cross-session expansion restoration and
deeper unresolved function-pointer/indirect-call analysis remain deferred.

## Engineering diagnostics

Compilation database discovery, clangd project diagnostics, background index
progress, reliability reporting, and stale-result markers were implemented in
the 0.8.x series.
