---
type: story-capsule
id: COORDINATORIUM-001
phase: phase-1
title: Tactical Coordinatorium — Mission Lifecycle MVP
date: 2026-10-21
status: COMPLETED
---

# COORDINATORIUM-001 — Tactical Coordinatorium: Mission Lifecycle MVP

## Objective

Give MONOLITH a persisted, machine-checkable record of development missions —
independent of any single AI session's self-reported `active.md` narrative —
via a deterministic, file-based State Keeper and a `monolith mission` CLI.
First vertical slice of Coordinatorium; Strategic Coordinatorium
(product/subsystem state) explicitly out of scope, schema-reserved only.

## Implementation Summary

**Vertical slice (original):**
- `.monolith/state.json` — schema-versioned (`schemaVersion`, `revision`,
  `strategic.systems` reserved, `tactical.missions`)
- `src/coordinatorium/state-keeper.ts` — `readState()` (no side effect when
  file absent) / `mutateState()` (lock → re-read → deep-cloned draft →
  mutator → increment revision → atomic temp-file+rename write → release)
- `src/coordinatorium/lock.ts` — cross-process file lock, `open(path, 'wx')`
  create-if-absent, `pid:nonce` body for crash recovery
- `src/coordinatorium/mission.ts` — mission lifecycle semantics (ID
  generation, valid state transitions: `in_progress` →
  `completed`/`failed`/`cancelled`, terminal)
- `monolith mission start|list|show|finish` CLI (`src/coordinatorium/cli.ts`,
  wired into `src/cli/index.ts`)
- `monolith init` scaffolds a literal initial `state.json`; never overwrites
  an existing one on re-init

**Hardening pass 1 (same day):** an independent review found the original
`isStale()` combined PID-liveness with a 30-second age fallback via OR — a
live owner could lose the lock purely from elapsed time. Rewrote `lock.ts`
around three explicit invariants: ownership is not time-based; uncertainty
(empty/malformed lock content) never grants ownership; timeout ends
waiting, not ownership. Liveness became three-valued (`alive`/`dead`/
`unknown`), with `EPERM` and anything-but-`ESRCH` both treated as "do not
recover."

**Corrective patch (same day):** a second independent review found the
hardening pass's own recovery path — "re-read the lock, confirm dead,
re-read again, then unlink" — was not atomic across its two syscalls and
could itself be raced; reproduced empirically with two forked processes
(a paused recoverer's later unlink deleted a faster recoverer's
already-published lock). Fixed by serializing recovery through a dedicated
`<lockPath>.recovery` mutex, created with the same exclusive primitive as
the primary lock.

**Final hardening (same day, this run):** the create path itself —
`open(lockPath, 'wx')` (publishes the canonical file immediately) →
single unchecked `writeSync` — could leave an empty/partial canonical
`state.json.lock` behind on a write failure or short write, which is
unparseable and therefore permanently stuck as "uncertain" (never
auto-recoverable). Fixed by writing metadata to a private staging file
(`<lockPath>.creating.<pid>.<nonce>`) via a byte-count-respecting
`writeAll` loop, and publishing it as the canonical lock only via
`linkSync` once the write (and optional `fsyncMetadata`) has fully
succeeded. Added `LockCreationError` (code `LOCK_CREATION_FAILED`) with
`phase`/`pid`/`nonce`/`timestamp`/`cleanedUp`/`cause`/`causeCode`.
Recovery-mutex creation reuses the same primitive; its own semantics
(never recovered by liveness/age) are unchanged.

## Files Changed

`src/coordinatorium/{types,state-keeper,lock,mission,cli,errors}.ts` and
their `*.test.ts` suites, `src/cli/index.ts`, `src/init/*` (state.json
scaffolding + never-overwrite special case), `templates/default-instance/
monolith/state.json`, `docs/adr/ADR-008-coordinatorium-tactical-mission-
lifecycle.md`, `AGENTS.md` (mission lifecycle docs), matching `dist/`
output.

## Tests

186 total passing (was 151 before this story: webway 13 — now extracted to
Webway's own repo and no longer counted here per the 2026-10-21 Webway
extraction — scriptorium 75, graph 63, unchanged). Coordinatorium-specific:
11 state-keeper, 17 mission lifecycle + CLI integration, 3 init regression
(original slice); 10 real-process lock tests (liveness/crash/concurrent
recovery, hardening pass 1); 3 TOCTOU regression tests (corrective patch);
4 partial-write-safety tests including a real forked-process interleaving
test (final hardening). `typecheck`/`build` clean throughout. Targeted
`lock.test.ts` run 5× consecutively with no flakes at each hardening stage.

Manual smoke test (this finalization run, in an isolated scratch instance):
`init --yes` → `validate` (PASS) → `mission start` ×2 → `list` → `finish
--result completed` → `list` (active/finished split correct) → unknown-id
finish (exit 1, clear message) → double-finish on a completed mission
(exit 1, clear message) → final `state.json` has `revision: 3`, two
well-formed mission records, no lock/recovery/staging debris left behind.

## Key Decisions

- Liveness-only stale-lock recovery (no age fallback at all) — ADR-008,
  "Why stale-lock recovery is liveness-only, with no age fallback at all"
- Recovery of a specific stale lock record is serialized by a dedicated
  mutex, not a "re-read right before deleting" convention — ADR-008,
  "Recovery is serialized by a dedicated mutex"
- Lock/mutex *creation* publishes the canonical path only after its
  payload is fully (and, optionally, durably) written, via a staging file
  + atomic hard-link publish, never a plain `rename` — ADR-008, "Safe lock
  creation: staging + atomic hard-link publish"
- Mission IDs are derived from the missions map inside the lock, not a
  stored counter — avoids a second source of truth
- Multiple concurrent `in_progress` missions are allowed; "one story at a
  time" remains a human/AI discipline (`AGENTS.md`), not a runtime
  constraint Coordinatorium enforces

## ADRs Written

ADR-008 — Coordinatorium: Tactical Mission Lifecycle (First Vertical
Slice), including the three same-day hardening/corrective/final-hardening
addenda described above. `docs/adr/ADR-008-coordinatorium-tactical-
mission-lifecycle.md`.

## Lessons Learned

- Never combine a liveness/correctness check with an age/count-based
  fallback via OR in a recovery decision — the weaker signal can override
  the stronger one. → `LESSON-2026-0003` (architecture)
- A "re-read right before acting" sequence across two syscalls is not
  atomic merely because the window looks small — it needs an explicit
  mutex built on the resource's own exclusive-create primitive.
  → `LESSON-2026-0004` (architecture)
- Never publish a shared artifact (make it visible to other processes)
  before its payload is fully written — stage, then publish via an
  exclusive operation, never a plain `rename`. → `LESSON-2026-0005`
  (architecture)
- Verify a CLI's actual argument-parsing code before trusting a positional
  path argument in a smoke test, especially with an auto-confirm flag from
  inside a live repository. → `LESSON-2026-0006` (context-sync)

## Known Limitations / Deferred (explicit, not oversights)

- Strategic Coordinatorium (product/subsystem state) remains schema-
  reserved only — no mutation logic exists for `strategic.systems`.
- Mission registration is not runtime-enforced — nothing stops an AI
  session from editing code without ever calling `mission start`/`finish`.
- No mission checkpointing, resume, or session-to-mission linkage —
  candidate next step, see COORDINATORIUM-002 proposal
  (`.monolith/context/templates/plan-coordinatorium-002-mission-
  checkpoints.md`).
- The locking/State-Keeper design is a local-filesystem mechanism
  (`open(..., 'wx')`, `linkSync`, `rename()` atomicity); not evaluated on
  network filesystems or across PID namespaces/containers/hosts.
- Pre-existing, unrelated CLI drift noted during finalization (not part of
  this story, not fixed here): `monolith init`'s positional directory
  argument is silently ignored (always targets `process.cwd()`); the
  top-level `monolith` usage text lists `status` and `dry-run` as if
  ordinary commands, though invoking either exits 1 with "not yet
  implemented (Phase 6)". Logged in `tech-debt.md` (TD-007).
