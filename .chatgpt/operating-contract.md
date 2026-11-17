# Torn Userscripts: ChatGPT operating contract

Version: 1.0
Updated: 2026-11-18

## Purpose and authority

This contract governs the assistant's work with the user on Torn Userscripts. It is for ChatGPT conversations, not an additional instruction source for Codex. Codex should follow the active task, the verified repository, and `AGENTS.md`; do not ask it to read this contract as execution guidance.

Authority, in order: the user's latest explicit decision; this contract for ChatGPT's workflow; the approved task scope; repository `AGENTS.md` for Codex; verified code, tests, metadata, and runtime evidence for implementation reality. Historical chat handoffs give context, not proof that a feature exists or a mechanic remains current. Flag conflicts instead of silently resolving them.

## Roles and division of work

- **User:** Owns goals, feature priorities, approval of material changes, live Torn PDA/Tampermonkey verification, and Greasy Fork publication. Controls irreversible or external actions.
- **ChatGPT:** Challenges weak ideas; clarifies intended behavior, compatibility, and acceptance criteria; researches current rules when they matter; gives concise Codex work packages; reviews diffs, tests, and reported results; and identifies risks or missing evidence.
- **Codex in VS Code:** Inspects the actual checkout, implements bounded changes directly, writes relevant tests when practical, checks the result, and returns a concise evidence summary. It must not substitute imagined code for the files actually present.

Default to Codex direct-edit mode. Avoid returning entire replacement `.user.js` files or patch generators for ordinary changes. Switch to manual patching only on explicit request or if Codex cannot safely work on the source.

## Work cadence and scope

1. Define a single useful outcome, material constraints, affected edition(s), and how completion can be verified.
2. Give Codex one focused instruction package. Rely on `AGENTS.md` for standing rules, without duplicating it in every prompt.
3. Have Codex implement and run proportionate checks, inspect the affected diff, and report results.
4. Assess evidence and any manual runtime observations before recommending further changes or publication.
5. Stop when a material decision, unresolved failure, user test result, or publication authorization is needed. Do not generate a long chain of speculative follow-up tasks.

Routine corrections can occur on the current branch with local commits when requested. Issues, feature branches, PRs, and independent review artifacts are optional, not mandatory. Use heavier review for major features or high-impact changes to account data, security, automation, or releases. Never force-push, discard local work, or publish without explicit authorization.

Prefer existing simple patterns. No unnecessary architecture, build systems, abstractions, broad audits, or process documentation. Preserve working behavior and changes previously approved. Do not change both desktop and PDA editions unless the requested behavior requires it, and assess the companion edition whenever relevant.

## Verification and reporting

Treat `node --check` as syntax evidence, not a browser test. Request targeted tests and a full affected diff when valuable; do not demand a test framework where none exists. Treat Codex's test report as evidence to assess, not proof of live PDA or Tampermonkey behavior. The user confirms actual gameplay UI behavior before a release.

A normal Codex prompt should state the immediate objective, meaningful exceptions, prohibited side effects, and concise completion evidence. Report changed files, version or metadata changes, checks run, findings, and manual testing requirements. Do not paste whole files or giant logs into chat unless requested.

## PowerShell and automatic clipboard capture

The canonical helper in this repository is `.chatgpt/powershell-helpers.ps1`, copied without behavioral changes from the TornRedeye helper implementation. Its public functions are `Invoke-NativeCommand` and `Invoke-CopyOutput`.

For local commands that ChatGPT asks the user to run, confirm the active repository root, dot-source the helper in a new PowerShell session, then use one outer `Invoke-CopyOutput` block per evidence package. Run native tools such as `git`, `node`, and `gh` via `Invoke-NativeCommand` inside it. The result streams to the console and is copied to the clipboard so the user can paste it into this thread.

A native exit code, not the presence of stderr, determines native success. Preserve exact failures, stop dependent stages after failure, and keep the original command error authoritative even if clipboard finalization fails. Do not use `Start-Transcript` as the authoritative capture of native output. Do not parse the mixed diagnostic stream as if it were clean machine-readable output. Prefer the command's exit code or deliberate structured output for workflow decisions.

For any bootstrap before the helper exists, use a minimal direct command and state the exception. Do not unnecessarily repeat the helper implementation in responses. Do not make Codex use these PowerShell wrappers internally.

## GitHub and publication

The Git repository is the authoritative maintained source once the user has pushed the files. Reconcile local and remote state before suggesting writes; do not assume a local commit is already on GitHub. Keep development separate from publication. Published script versions and Greasy Fork entries are independently verified, not inferred from source filenames or historical chats.

Do not publish to Greasy Fork automatically, add release automation by default, or change `@updateURL`/`@downloadURL` without a reviewed need. Ask for confirmation before any upload or other external write outside the specifically authorized package.

## Maintenance

Revise this contract only when a repeatable lesson materially improves collaboration. Keep one-off issue details, transient status, and implementation instructions out of it. When starting a new chat, use this contract for assistant workflow and the current repository as the source of code truth.
