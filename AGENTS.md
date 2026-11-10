# C Insight repository maintenance

## Working language and scope

- Communicate with the maintainer in Simplified Chinese unless requested otherwise.
- Preserve unrelated user changes and untracked assets. Do not stage generated VSIX files, local recordings, or design candidates.
- The analysis engines are managed clangd and optional Microsoft C/C++ providers. Do not silently broaden provider capabilities or implement deferred roadmap items.

## Persistent regression knowledge

- Before diagnosing or changing behavior reported as a problem, read `docs/validation/regression-testing-guide.zh-CN.md` and the relevant entries in `docs/validation/historical-issues.zh-CN.md`.
- For each new actual user-reported problem, update the relevant historical-issue entry or add a new stable `CI-REG-NNN` entry during that task. Do not wait until a fix is available: unresolved or unconfirmed reports must retain that status.
- Record the symptom, environment and affected build when known, reproduction steps, expected behavior, observed evidence, confirmed versus suspected cause, regression coverage, and remaining manual checks. Ask only for missing information needed to proceed; never invent dates, versions, findings, or test outcomes.
- Reuse an existing ID for the same failure. A distinct cause or regression variant can receive its own ID with a cross-reference. Never renumber or recycle existing IDs.
- When fixing an issue, add or update the smallest suitable automated regression, document manual-only gaps, and update the issue record plus the guide's affected-area matrix or smoke checks when necessary.
- Distinguish product defects, external-engine failures, project configuration, intended interaction, known limitations, and deferred features. A feature explanation alone is not a new defect.
- Preserve disproved hypotheses as such. Do not describe old workarounds as current behavior, or claim that a historical pass proves a new build passed.
- Finish each problem-related handoff with its regression ID, checks actually executed, focused manual checks still needed, and acceptance/publication status.

## Validation and delivery

- Use `npm run check` for source changes; add affected Extension Host, engine, or performance checks in proportion to risk. Documentation-only changes need documentation validation, not a new plugin build or version.
- Keep ordinary Markdown paragraphs unwrapped, preserve code/list/table structure, and verify local links and localized terminology.
- Write documentation around current behavior, actionable guidance, and conclusions. Remove defensive commentary and transient task status; retain concise regression evidence and unresolved issues needed for maintenance.
- New runtime changes are first delivered as a descriptively named temporary VSIX. Do not increment the formal version, push, tag, or publish until the maintainer accepts the behavior and authorizes release.
- Commit completed local changes automatically, excluding unrelated user files. Use the repository's established `H9elix` / GitHub noreply identity; do not change global Git configuration or rewrite history without explicit authorization.
- For an authorized release, synchronize current documentation and curated bilingual notes, push `main`, wait for that commit's CI success, then push the annotated version tag. Verify the published assets and checksums. GitHub Release publication is not Marketplace publication.
- Never write credentials, private source excerpts, raw private logs, or personal machine paths into public regression records. Use minimal synthetic fixtures and redacted evidence.

## GitHub Release writing preference

- For future GitHub Releases, keep the curated bilingual body focused on functional additions, fixes, and user-visible behavior changes only. Omit validation results, test counts, audit results, and remaining-boundary/known-limitation sections from the Release body.
- Continue performing all required validation and asset/checksum verification. Keep evidence, limitations, and regression status in the relevant project documentation; omitting them from Release notes does not waive maintenance or delivery requirements.
- Apply this preference prospectively. Do not rewrite existing published Releases or historical notes unless explicitly requested.
- Release notes checks require version consistency, bilingual notes, a version comparison link, and no unfinished placeholders; an installation/verification section is not required.
