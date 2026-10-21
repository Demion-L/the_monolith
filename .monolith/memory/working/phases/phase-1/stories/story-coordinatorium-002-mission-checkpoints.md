---
type: story-capsule
id: story-coordinatorium-002
phase: phase-1
title: "Mission Checkpoints (incl. Schema v2 migration and Init Safety .gitkeep closure)"
date: 2026-10-21
status: COMPLETED
---

# COORDINATORIUM-002 — Mission Checkpoints

## Objective

Give an `in_progress` mission durable, append-only progress checkpoints —
structured notes a human or AI session can read between sessions — stored
through the existing deterministic State Keeper, with no new lock, mutex,
or daemon. Close out, in the same finalization pass, two defects
discovered and fixed in the course of this work: a `state.json` schema
compatibility gap, and a `monolith init` `.gitkeep` overwrite-safety gap.

## Implementation Summary

**Mission Checkpoints (commit `aea408f`):**
- New `Checkpoint` domain entity in a sibling `tactical.checkpoints` map
  (not nested inside `Mission`) — `id`, `missionId`, `createdAt`, `summary`
  (required), `remainingSteps` (0+), `context` (optional)
- `createCheckpoint` / `listCheckpoints` / `getCheckpoint` — no
  update/delete path; checkpoints are immutable once created
- `createCheckpoint` is gated on the target mission being `in_progress`
  (`MissionNotActiveError` otherwise); `listCheckpoints`/`getCheckpoint`
  stay available for a finished mission's history
- IDs are `<missionId>-CKPT-NNNN`, scan-derived the same way mission IDs
  are — no separate counter
- Ordinal generation and the active-mission check happen inside the
  existing `mutateState()` lock, so concurrent creators can't collide —
  verified with both in-process concurrent calls and real forked-process
  tests
- `monolith mission checkpoint|checkpoints` CLI subcommands

**Schema v2 migration (commit `b8a320f`, same-day compatibility fix):**
- An independent review found that keeping `schemaVersion` at 1 while
  adding `tactical.checkpoints` let a pre-002 binary — hardcoded to
  `schemaVersion === 1`, no concept of checkpoints — read a
  checkpoint-bearing v1-tagged file, reconstruct state from only the
  fields it recognized, drop the checkpoints, and silently overwrite the
  file on its next `mutateState` call. Confirmed directly against the
  actual historical pre-002 `validateState()` via git history, not assumed
- Fix: `STATE_SCHEMA_VERSION` bumped to 2; `tactical.checkpoints` is now
  required for v2 (every v2 writer always serializes it).
  `validateState()` additionally accepts `LEGACY_SCHEMA_VERSION_V1` (1) as
  a migration input — missions, revision, and any present checkpoints
  carried over exactly, checkpoints defaulting to `{}` when absent; only
  `schemaVersion` is relabeled. Migration is purely in-memory on read, via
  the existing atomic `mutateState` write path — no new write path, lock,
  or daemon
- An old (pre-002) binary now fails loudly (`StateSchemaError`) against a
  v2 file instead of silently corrupting it — proven by transpiling and
  running the actual historical pre-002 source from git against a real v2
  file (`checkpoint.test.ts` → "pre-COORDINATORIUM-002 binary safety
  against a v2 file")
- ADR-008 amended with two dated addenda (same convention as the
  2026-10-21 lock.ts hardening passes) rather than a new ADR number

**Init Safety — `.gitkeep` overwrite closure (this finalization pass,
commit `093ea09`):**
- `createEmptyDirs()` (`src/init/scaffold.ts`) called
  `writeFileSync(gitkeepPath, '')` unconditionally for 10 tracked
  directories, and these paths were absent from
  `planScaffoldConflicts()`'s preflight check — a pre-existing, possibly
  non-empty `.gitkeep` was silently truncated on init/re-init
- Fix: the 10 paths were extracted into a single `GITKEEP_DIRS` source of
  truth, consumed by both `planScaffoldConflicts()` (now flags an existing
  `.gitkeep` as a conflict, refusing the whole init before any write — the
  existing `InitConflictError` contract, same as every other tracked
  file) and `createEmptyDirs()` (now also skips the write if the file
  already exists, as a second guard at the write site itself).
  `--yes` does not bypass this, matching the existing contract for every
  other tracked file
- Note: this closes the gap the preflight-based design is meant to cover;
  it is not a claim of full TOCTOU (check-then-write race) safety — no
  cross-process locking guards the window between `planScaffoldConflicts`
  and `scaffoldInstance`, same as every other file init protects today

## Files Changed

**COORDINATORIUM-002 / Schema v2 (prior commits, verified this session):**
`src/coordinatorium/{types,checkpoint,mission,cli,errors}.ts`,
`src/coordinatorium/checkpoint.test.ts`, `src/coordinatorium/state-keeper.ts`,
`src/cli/index.ts`, `templates/default-instance/monolith/state.json`,
`docs/adr/ADR-008-coordinatorium-tactical-mission-lifecycle.md`, `AGENTS.md`,
`.monolith/memory/long-term/tech-debt.md`

**Init Safety `.gitkeep` fix (this session):**
`src/init/scaffold.ts`, `src/init/init-safety.test.ts`

**Documentation synchronization (this session, Step 5.5):**
`README.md`, `AGENTS.md`, `CLAUDE.md`, `package.json`,
`docs/architecture/toolkit-pipeline.md`,
`templates/default-instance/instruction/{CLAUDE.md,.cursorrules,.windsurfrules}`
(stale "Cognitive Operating System" framing, superseded 2026-10-21 by the
toolkit mission in `AGENTS.md`/`MANIFESTO.md`, was still present in both the
repo's own instruction files and the scaffold templates that propagate it
to every new instance), `.monolith/skills/finalize-story/SKILL.md` (new
mandatory Step 5.5)

## Tests

252 total tests passing, typecheck clean, build clean:
scriptorium 75, graph 63, `coordinatorium/checkpoint.test.ts` 40,
`coordinatorium/state-keeper.test.ts` 21, `init/init-safety.test.ts` 12
(5 new this session — existing non-empty `.gitkeep` refused + unchanged,
no partial scaffold on a `.gitkeep` conflict, `--yes` does not bypass,
clean init still creates `.gitkeep` placeholders, repeat init refused
without touching `.gitkeep`), `coordinatorium/mission.test.ts` 17,
`init/init.test.ts` 3, `cli/init-args.test.ts` 6,
`coordinatorium/lock.test.ts` 15 (run 5× consecutively, no flakes).

`checkpoint.test.ts` includes: in-process concurrent checkpoint creation
against a legacy v1 file (migrates exactly once, no lost updates, no
duplicate IDs), a real multi-process concurrency test ("concurrency
(independent processes)"), and the old-binary-vs-v2-file safety test
described above.

Manual verification this session:
- Real-PTY interactive `monolith init` run (Python `pty`, since `script
  -qc` under a bare `printf` pipe did not reliably drive readline) — 4
  prompts answered, full scaffold incl. protected `.gitkeep` files, exit 0
- Manual CLI smoke test: `init --yes` → `mission start` → 2×
  `mission checkpoint` (with `--remaining`/`--context`) → `mission
  checkpoints` → `mission finish --result completed` → `mission
  checkpoints` (history still visible) → `mission checkpoint` on the now-
  finished mission (correctly exits 1, `MissionNotActiveError`) →
  `state.json` inspected: `schemaVersion: 2`, checkpoints survive
  `finish`, revision incremented correctly

## Key Decisions

- `tactical.checkpoints` as a sibling top-level map, not nested in
  `Mission` — extends the existing state shape by direct analogy rather
  than deepening `state-keeper.ts`'s domain coupling (TD-006 re-assessed,
  still open — see ADR-008 addendum)
- Schema compatibility is enforced by a version bump + explicit migration
  function, not by silently accepting unversioned optional fields — an old
  binary must fail loudly, never silently drop data
- The `.gitkeep` fix reuses the existing preflight-conflict architecture
  (single source-of-truth path list) rather than introducing a second,
  independent validation system for this one file type

## ADRs Written

None new. ADR-008 amended with two dated addenda (Mission Checkpoints;
Schema v2 compatibility fix) — this repo's established convention for
same-day extensions to an existing decision record.

## Lessons Learned

A scaffold write path was added (`createEmptyDirs`, during an earlier,
unrelated story) without being wired into the shared preflight-conflict
check that every other tracked-file write path goes through — the two
lists (what gets written vs. what gets conflict-checked) silently drifted
apart, and the gap wasn't caught until this explicit review. See
`LESSON-2026-0007`.
