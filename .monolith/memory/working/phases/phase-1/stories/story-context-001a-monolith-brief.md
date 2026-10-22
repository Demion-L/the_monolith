---
type: story-capsule
id: story-context-001a
phase: phase-1
title: "MONOLITH Context Gateway — monolith brief"
date: 2026-10-22
status: COMPLETED
---

# CONTEXT-001A — `monolith brief`

## Objective

Give an AI session (or a human) one deterministic, read-only command that
replaces reading 5–9 governance files at boot with a compact, bounded,
traceable summary of current project state — without LLM calls, network,
the ERG, or any write to the project. First deliverable of the Context
Gateway handoff; `monolith context <topic>` (CONTEXT-001B) was explicitly
out of scope.

## Implementation Summary

`monolith brief [--max-chars N] [--strict]` (default budget 6000 chars),
implemented in `src/brief/` as a three-stage pipeline
`collect() → BriefModel → render(model, maxChars)`:

- **Sections (fixed priority order):** P0 — `Completeness` line, identity,
  State Keeper status, Diagnostics, Active Missions, Mandatory Protocols
  (frontmatter `enforcement: mandatory` under `<monolithRoot>/protocols`);
  P1 — Active Mission Checkpoints (latest per active mission, incl. "Next
  steps"), Current Story (verbatim excerpt of `## Current Story` in
  `active.md`); P2 — Accepted ADR Index (frontmatter `status: accepted`),
  Recently Finished Missions (max 5); P3 — pointer block.
- **Read-only:** `state.json` read once per run; `mutateState()` never
  imported; no file, lock or directory is created. State Keeper v2 read
  natively, v1 via the existing in-memory migration (never written back).
- **Deterministic:** fixed ordering, locale-independent comparison, no
  clocks or random IDs; byte-identical output across runs.
- **Honest completeness:** `Completeness: COMPLETE | INCOMPLETE`. An error
  diagnostic, a P0 overflow (`BUDGET_EXCEEDED_BY_REQUIRED`, P0 shown in full
  regardless of `--max-chars`) or any data-bearing section that did not fit
  makes it INCOMPLETE. Truncation is always explicit
  (`[truncated N chars — see <source>]`, "N more omitted" markers).
  Empty optional sections and the static P3 block may be dropped for budget
  without INCOMPLETE (no information lost).
- **Provenance:** every section names its source.
- **CLI:** exit 0 = brief formed (COMPLETE or INCOMPLETE; INCOMPLETE warns
  on stderr), 1 = usage error, 2 = `--strict` and INCOMPLETE.
- **Config:** new optional `contextGateway.adrDirs` in
  `monolith.config.json` (extra ADR directories); this repository sets
  `["docs/adr"]`, so the brief lists ADR-001/002/003/007/008.

Two review remediation rounds were folded in before integration:

- **F-1…F-7:** `STATE_EMPTY` is an error; document discovery survives
  unreadable dirs/files, dangling symlinks and symlink cycles (symlinks are
  never followed); configured protocol/ADR directories must stay inside the
  project root (string-level + realpath check); exact truncation counts;
  explicit omission markers; corrupted config is reported
  (`CONFIG_UNREADABLE`, `CONFIG_ADR_DIRS_INVALID`), not masked as defaults;
  data/instruction boundary.
- **N-1/N-3:** every project-controlled string — document id/path/title,
  `monolithRoot`, all provenance pointers, mission/checkpoint ids and
  timestamps — goes through the existing `sanitizeSingleLine` (newlines and
  C0/C1 control characters escaped), so project data cannot forge a
  `Completeness:` line, a `##` heading or terminal escapes. The Story
  excerpt is the one deliberately multi-line field. N-3 pinned the
  Completeness contract above in code comments and tests.

## Files Changed

New: `src/brief/{cli,collect,config,constants,docs,index,render,sanitize,selectors,story,types}.ts`
and their 8 test files; tracked `dist/brief/**`. Modified: `src/cli/index.ts`
(`brief` subcommand + usage), `monolith.config.json` (`contextGateway`),
`.monolith/memory/long-term/tech-debt.md` (SEC-001, TD-009). No change to
`src/coordinatorium/`, `src/scriptorium/`, `src/graph/`.

## Tests

374/374 passing (scriptorium 75, graph 63, coordinatorium 93 — checkpoint
40, state-keeper 21, mission 17, lock 15 — brief 122, init 15, cli
init-args 6). Brief: render 34, collect 21, docs 15, integration 14,
selectors 12, config 10, cli 9, story 7. typecheck, build and
`git diff --check` clean; tracked `dist` matches a fresh build. A
budget sweep (1–4000 chars) on the real corpus showed no over-budget
output, no nondeterminism, no silent loss of ADR/protocol entries.

## Key Decisions

- Output is AI-readable text with per-section provenance, not JSON.
- The bound is a character budget (`--max-chars`, default 6000) with fixed
  section priority; P0 is never truncated.
- Absent `state.json` is reported as `status: absent` — never interpreted as
  an active mission or as a corrupted state; a corrupted/empty one is an
  error, not "no missions".
- `brief` supplements the Boot Sequence; it does **not** replace it.
- `contextGateway.adrDirs` is the minimal, explicit extension of the config
  contract for extra ADR directories; no path is hardcoded in core.
- The decisions were tracked as DEC-CONTEXT-001…003 in source comments
  only; **no ADR was written** (see Limitations).

## ADRs Written

None.

## Limitations (carried forward, not hidden)

- **SEC-001 (OPEN):** `monolithRoot` is not contained within the project
  root. Verified: `brief` reads `state.json`/`active.md` outside the
  project, and `monolith mission start` writes `state.json` outside it.
  Unchanged by this story.
- Not implemented: `monolith context <topic>` (CONTEXT-001B), JSON output,
  graph/ERG-derived relevance, Strategic Coordinatorium.
- Lone `\r` and U+2028/2029 inside the multi-line Story excerpt are not
  escaped.
- `src/brief/` imports `scriptorium/frontmatter` and the `coordinatorium`
  barrel directly rather than via `src/index.ts` (TD-009); `brief` is not
  re-exported from the package entrypoint.
- Decision records DEC-CONTEXT-* live only in source comments.

## Lessons Learned

- Sanitizing "the free-text fields" one by one leaves gaps: titles and
  summaries were escaped but document id/path and provenance pointers were
  not, and a newline in a *filename* could forge a `Completeness:` line.
  Review caught it; an exhaustive hostile-model test would have caught it
  first (LESSON-2026-0008).
- Budget-sweeping the renderer against the real corpus found a semantics
  gap (empty sections vanishing under COMPLETE) that example-based tests
  never hit; the fix was to state the contract, not to add machinery.
- A cross-subsystem input (`monolithRoot`) had three duplicated readers and
  one partial containment check — fixing one subsystem would have
  desynchronized the others, so it was registered (SEC-001) instead.
