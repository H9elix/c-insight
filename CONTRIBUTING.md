# Contributing to C Insight

C Insight is maintained by `youjinchun`. A public source repository and issue
tracker have not been selected yet; this file defines the local development
and review contract in the meantime.

## Requirements

- VS Code 1.95 or newer
- Node.js and npm compatible with `package-lock.json`
- clangd 20 or newer for complete Callers/Callees support
- `xvfb-run` for headless Extension Host tests on Linux
- A compilation database for realistic C/C++ workspace validation

## Development workflow

```bash
npm install
npm run check
npm run benchmark
npm run package
xvfb-run -a npm run test:e2e
```

When an FFmpeg checkout and clangd 20 are available, also run:

```bash
C_INSIGHT_FFMPEG_ROOT=/path/to/FFmpeg \
C_INSIGHT_FFMPEG_CLANGD=/path/to/clangd-20 \
npm run acceptance:ffmpeg -- /tmp/c-insight-ffmpeg-acceptance.json
```

The acceptance command is read-only with respect to the FFmpeg checkout.

## Change contract

- Keep semantic requests demand-driven and cancellable where practical.
- Preserve configured depth, node, result, cache, and export safety limits.
- Add deterministic tests for model or protocol behavior.
- Update `CHANGELOG.md`, the Chinese user guide, and relevant architecture or
  acceptance documentation in the same change.
- Increment the extension version before packaging a modified test build so
  every VSIX filename identifies one exact implementation. Release handoff
  notes must list the behavior that needs focused manual testing.
- Run `npm run docs:commands` after adding or changing commands.
- Run `npm run ids:generate` after adding, removing, or renaming contributed
  commands or views. `npm run check` rejects a stale `src/ids.ts` registry.
- Run `npm run l10n:export` after adding or changing `vscode.l10n.t()` calls;
  `npm run check` verifies that both runtime catalogs remain synchronized.
- Do not add a public repository, issue, sponsor, or homepage link until the
  maintainer has selected that destination.

## Architecture

Start with `docs/architecture.md`. Keep protocol and model logic testable
without a VS Code host where possible.

## Commit style

Use a concise imperative subject with a functional prefix such as `feat:`,
`fix:`, `perf:`, `docs:`, `test:`, `diagnostics:`, or `ux:`. Each completed
small section should leave the worktree clean and independently reviewable.
