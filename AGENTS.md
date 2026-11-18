# Torn Userscripts: Codex guidance

## Purpose and authority

Maintain the existing Torn City userscripts distributed through Greasy Fork. Prioritize small, reliable fixes and practical user-facing functionality over new architecture or process.

The user's current request defines the task. Existing source, metadata, and observable behavior define the implementation baseline. Read only the affected files and directly relevant tests or documentation; do not use old handoffs as proof of current behavior. Flag material conflicts or unknowns instead of guessing.

## Working approach

- Work directly in the verified local checkout in VS Code. Check the active branch and working tree before editing; preserve unrelated user changes.
- Apply Occam's razor: prefer the smallest complete, correct, robust, and maintainable solution. Additional complexity, including frameworks, bundlers, dependencies, shared abstractions, or restructuring, requires demonstrated justification.
- Organize each userscript family under `scripts/<feature>/`, with platform-specific source, `CHANGELOG.md`, and `INFO.md` in `web/` and `pda/` subdirectories. Keep shared tests at the feature root unless a dedicated test directory becomes justified.
- Preserve existing features, layout, configuration, persisted state, and public interfaces unless the task explicitly changes them. Do not silently fix unrelated issues.
- Investigate the relevant code and reproduce or explain the defect before changing behavior. Follow existing naming and formatting conventions.
- Routine tasks need no GitHub issue, feature branch, pull request, or extra governance file. Use the current authorized branch. Do not commit, push, tag, or publish unless requested.
- Complete authorized inspection, editing, and focused validation without asking for approval at every step. Stop for a material design choice, destructive operation, external publication, or missing access.

## Userscript and compatibility contracts

- Maintain equivalent core functionality across Web/Tampermonkey and Torn PDA while respecting their different APIs, storage, lifecycle, navigation, and UI constraints. Inspect the counterpart edition when changing shared behavior, update both where appropriate, and report intentional differences.
- Keep every published script installable as a readable, standalone `.user.js` userscript. Do not introduce minification, obfuscation, remote code loaders, or a build pipeline without an approved reason.
- Preserve `@name`, `@namespace`, `@match`/`@include`, `@grant`, `@connect`, and update-related metadata unless a change is necessary and understood. Do not redirect Greasy Fork updates to development sources.
- Keep `// @license      MIT` immediately below `@version`. Use `major.minor.patch` versions for each edition and increment them for releases that change published code, not unfinished local experiments.
- Equivalent shared feature releases use matching `major.minor` versions, normally with patch `0`. Platform-specific bug fixes increment only the affected edition's patch; the next shared feature release realigns both at the next appropriate shared version. Alignment must reflect functional parity: inspect actual functionality and published versions before initial alignment, never downgrade a published version, and never bump solely for cosmetic alignment.
- Every platform edition must contain its own `CHANGELOG.md` and `INFO.md`. Preserve changelog history; baseline a missing changelog at the current `@version` without inventing earlier entries. Record meaningful user-facing changes newest first and update each affected changelog whenever its release version changes.
- Treat each edition's `INFO.md` as the source of truth for its Greasy Fork Additional Info. Keep shared Web/PDA descriptions aligned, allowing genuine platform differences. Development editions use an accurate, minimal placeholder until a verified feature description is approved. Update descriptions when a release changes functionality, installation, compatibility, or other documented behavior; keep them concise and do not advertise unimplemented or unverified features.
- Preserve existing API key, permissions, and storage integration. Do not embed real keys, tokens, player secrets, or captured private API payloads in source, tests, logs, or commits. Never send them to an unapproved service.
- Verify Torn API endpoints, response fields, time units, cooldown logic, and missing/error states against current contracts or evidence. Do not silently turn unknown data into a valid value.
- For UI changes, handle Torn's dynamic navigation and rerenders without duplicate elements, event handlers, observers, or uncontrolled polling. Keep overlays small, readable, and consistent with the affected script's existing design.
- Avoid automatic gameplay actions or behavior that may violate Torn's scripting rules. Raise the concern before implementing a questionable interaction; do not reinterpret an advisory feature as permission to perform gameplay actions automatically.
- Preserve user-requested UI cleanup and explicitly approved behavior. Planned functionality is not implemented functionality.

## Verification and delivery

- For each edited `.js`/`.user.js` file, run `node --check` when Node is available. Run focused existing tests for changed behavior; do not invent a test command or dependency when the repository has none.
- Inspect the complete affected diff and run `git diff --check` for tracked changes. Also inspect new untracked files, which `git diff` does not show.
- When practical, add a small focused regression test for meaningful logic changes. Clearly identify behavior that still needs real Tampermonkey or Torn PDA testing. Syntax checks alone do not establish runtime compatibility.
- Report concisely: files changed, behavior changed, validation run and outcomes, remaining risks, and any manual verification required. Do not paste entire scripts or large diffs by default.
- Greasy Fork synchronization is publication infrastructure requiring explicit user authorization. Once enabled, treat pushes to its tracked release branch as publication actions. Publish only validated, intentional releases with updated version metadata and changelogs. Do not push, publish, or alter release/update infrastructure without explicit user authorization.

## Local PowerShell evidence

When asking the user to run local PowerShell commands, use the checked-in `.chatgpt/powershell-helpers.ps1` functions `Invoke-CopyOutput` and `Invoke-NativeCommand` to display and copy command evidence. These helpers are for user-facing diagnostics, not required inside the application or Codex's own execution environment. If unavailable, say so rather than inventing their behavior.
