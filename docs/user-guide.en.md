# C Insight User Guide

C Insight is a Source Insight-style C/C++ navigation extension for VS Code.
It follows the VS Code display language: Simplified Chinese is used for
`zh-cn`, while English is the fallback for English and untranslated locales.
Run **Configure Display Language** and reload the window to switch languages.

## Getting started

Open a C/C++ folder or multi-root workspace, provide a `compile_commands.json`
when possible, and select **C Insight** in the Activity Bar. The default
`cInsight.engine` is `clangd`; set it to `microsoft` and reload the window to
use the Microsoft C/C++ language service (cpptools).

The main views are Context, Code Preview, References, Callers, Callees,
Supertypes, Subtypes, Includes, Included By, Navigation History, Bookmarks,
Symbol Search, Document Symbols, and Project Diagnostics. Queries are
demand-driven: hidden relationship views do not issue their corresponding
automatic detail requests.

Single-clicking a location previews it in Code Preview. Clicking a navigable
symbol inside Code Preview follows its definition within the preview; double
clicking source text or blank space in the source area opens the corresponding
or nearest rendered line in the editor. The resulting editor activation keeps
the current preview instead of immediately clearing it. Pin buttons stop automatic
cursor-driven replacement while explicit actions remain available.

## Configuration and commands

Open **Settings** and search for `C Insight` to see every setting, accepted
value, range, and default in the active display language. Stable configuration
IDs begin with `cInsight.`. Important groups include:

- `cInsight.engine`, `cInsight.clangd.*`, and `cInsight.compileCommandsDir`
- `cInsight.codePreview.*` and `cInsight.analysis.*`
- `cInsight.references.*`, `cInsight.callHierarchy.*`, and `cInsight.export.*`
- `cInsight.typeHierarchy.*`, `cInsight.includeHierarchy.*`, and
  `cInsight.relationshipGraph.*`
- `cInsight.history.*`, `cInsight.bookmarks.*`, `cInsight.symbolSearch.*`, and
  `cInsight.session.*`

All commands are available from the Command Palette under **C Insight**.
Context menus and view title bars expose commands relevant to the current
editor, view, or selected node.

## Diagnostics and privacy

Project Diagnostics explains engine availability, compilation database
detection, the active file command, indexing progress, request performance,
and result reliability. Raw clangd/cpptools logs, command IDs, setting IDs,
symbol names, file paths, and exported JSON field names remain untranslated so
diagnostic evidence and automation stay stable.

C Insight has no telemetry and does not upload source code. See `PRIVACY.md`,
`SECURITY.md`, and `CONTRIBUTING.md` for the complete boundaries and maintenance
workflow. The detailed Simplified Chinese manual is in
`docs/user-guide.zh-CN.md`.
