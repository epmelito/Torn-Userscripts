# Torn Userscripts: Codex guidance

## Purpose and authority

Maintain the existing Torn City userscripts distributed through Greasy Fork. Prioritize small, reliable fixes and practical user-facing functionality over new architecture or process.

The user's current request defines the task. Existing source, metadata, and observable behavior define the implementation baseline. Read only the affected files and directly relevant tests or documentation; do not use old handoffs as proof of current behavior. Flag material conflicts or unknowns instead of guessing.

## Working approach

- Work directly in the verified local checkout in VS Code. Check the active branch and working tree before editing; preserve unrelated user changes.
- Make the smallest complete change. Do not introduce a framework, bundler, dependency, shared abstraction, or directory restructuring without a demonstrated need.
- Preserve existing features, layout, configuration, persisted state, and public interfaces unless the task explicitly changes them. Do not silently fix unrelated issues.
- Investigate the relevant code and reproduce or explain the defect before changing behavior. Follow existing naming and formatting conventions.
- Routine tasks need no GitHub issue, feature branch, pull request, or extra governance file. Use the current authorized branch. Do not commit, push, tag, or publish unless requested.
- Complete authorized inspection, editing, and focused validation without asking for approval at every step. Stop for a material design choice, destructive operation, external publication, or missing access.

## Userscript and compatibility contracts

- Identify which scripts are for desktop Tampermonkey and which are for Torn PDA. They are separate runtime targets; do not assume APIs, storage, injection timing, or browser behavior are interchangeable.
- Keep every published script installable as a readable, standalone `.user.js` userscript. Do not introduce minification, obfuscation, remote code loaders, or a build pipeline without an approved reason.
- Preserve `@name`, `@namespace`, `@match`/`@include`, `@grant`, `@connect`, and update-related metadata unless a change is necessary and understood. Do not redirect Greasy Fork updates to development sources.
- Keep `// @license      MIT` immediately below `@version`. Increment `@version` for a release that changes the published code, independently for each affected edition; do not churn versions for unfinished local experiments.
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
- Never publish to Greasy Fork or alter release/update infrastructure without explicit authorization. Publishing remains a separate user-controlled step.

## Local PowerShell evidence

When asking the user to run local PowerShell commands, use the checked-in `.chatgpt/powershell-helpers.ps1` functions `Invoke-CopyOutput` and `Invoke-NativeCommand` to display and copy command evidence. These helpers are for user-facing diagnostics, not required inside the application or Codex's own execution environment. If unavailable, say so rather than inventing their behavior.
