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
unified workspace snapshot.

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
