---
type: release
id: release-notes-autonomous-execution-discipline
title: Autonomous Execution Discipline — release preparation notes (not yet released)
authority: informative
---

# Autonomous Execution Discipline — release preparation notes

Status: implemented on `feat/autonomous-execution-discipline`; **no version bump, tag or publish has been done.**
Base: `0.2.0-beta.2` (`4ebe024`).

## Added
- Core `enrollMission` (`CREATED | REUSED | SKIPPED | CONFLICT | UNAVAILABLE`), idempotent under the existing lock.
- `Mission.owner` (optional; Durable State stays schema v3), ownership checks on `mission checkpoint|finish`,
  `mission enroll | current | handoff`.
- Opt-in **Managed Execution** (`execution.mode: "managed"`): `monolith hook pre-tool-use`, `hook status`,
  `hook print-config --managed` (fail-closed snippet). Docs: `docs/reference/managed-execution.md`.
- Handover `execution` block (mode, enforcement confirmation, per-Mission ownership/liveness, untracked implementation);
  Mission Control shows the Mission owner and the execution section.
- `monolith update` delivers `document-formats.md` (when absent) and the Mission/Reporting Discipline text via `AGENT.md`.

## Fixed (Real-World Audit, Second Brain)
- Rows of a "Phase" table (Phases and Completion Summary) were read as planned Stories: a Second Brain-style roadmap
  produced 8 phantom Stories in Handover. Phase tables are no longer story tables.
- "No missions have ever been recorded" → "Operational state file is absent; historical mission records are unavailable from this source."
- `NO_PHASES_FOUND` states the expected format and does not unconditionally cite a file that may not exist.

## Compatibility
- Unmanaged projects and manual Mission workflows are unchanged. No schema migration. Finalize untouched.
- An older binary that rewrites `state.json` drops `Mission.owner` (the file stays valid).

## Known limits
See "What it does not guarantee" in `docs/reference/managed-execution.md`.
