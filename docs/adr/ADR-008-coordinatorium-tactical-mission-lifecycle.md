---
type: adr
id: ADR-008
title: Coordinatorium — Tactical Mission Lifecycle (First Vertical Slice)
status: accepted
date: 2026-10-21
related_adrs:
  - ADR-007
---

# ADR-008 — Coordinatorium: Tactical Mission Lifecycle (First Vertical Slice)

---

> **Implementation status (2026-10-21):** Implemented. `src/coordinatorium/`
> (types, errors, lock, state-keeper, mission, cli) + `monolith mission
> start|list|show|finish`. 31 tests (`src/coordinatorium/*.test.ts`,
> `src/init/init.test.ts`), including a real multi-process concurrency test.
> Strategic Coordinatorium is schema-reserved only — see Scope below.
>
> **Hardening update (2026-10-21, same day):** an independent review found
> that the original locking design's stale-lock recovery conflated "owner
> is dead" with "lock is merely old" (`isStale()` returned true on EITHER
> condition), so a live owner could in principle lose its lock purely from
> elapsed time. `src/coordinatorium/lock.ts` was rewritten around three
> explicit invariants (see "Locking protocol" below); age is no longer a
> factor in any decision. 10 new tests added (`lock.test.ts` — real forked
> processes for liveness/crash/concurrent-recovery scenarios; extra cases
> in `state-keeper.test.ts` for write-failure and corrupted-state-via-
> mutateState). 179 tests total.

## Context

MONOLITH tracks project knowledge (Scriptorium/ERG) but has no notion of
*work in progress*. A mission — a unit of development work an AI session
starts, hands off, and finishes — currently lives only in
`.monolith/memory/working/active.md`: free-text, single-slot ("one story at
a time"), and trusted entirely on the AI's self-report. There is no
persisted, machine-checkable record of what missions exist, which are
active, or how they ended.

COORDINATORIUM is conceived as two cooperating halves sharing one state
file:

1. **Strategic Coordinatorium** — product and subsystem state.
2. **Tactical Coordinatorium** — development missions and their lifecycle.

This ADR covers only the first vertical slice: **Tactical Coordinatorium**.
Strategic Coordinatorium is reserved in the schema (`strategic.systems`)
but nothing in this slice writes to it — a conscious scope cut, not an
oversight.

---

## Decision

**Introduce a deterministic, file-based State Keeper at `.monolith/state.json`,
and a `monolith mission` CLI for registering and closing out missions
against it.**

### Mission lifecycle

```
                 ┌─────────────┐
  mission start  │ in_progress │
   ────────────► └──────┬──────┘
                         │ mission finish --result <X>
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   ┌───────────┐  ┌───────────┐  ┌───────────┐
   │ completed │  │  failed   │  │ cancelled │   (terminal — no further
   └───────────┘  └───────────┘  └───────────┘    transition is possible)
```

A mission is:

```jsonc
{
  "id": "MIS-0001",
  "title": "Implement State Keeper",
  "system": "coordinatorium",
  "status": "in_progress",       // in_progress | completed | failed | cancelled
  "startedAt": "2026-10-21T...Z",
  "updatedAt": "2026-10-21T...Z",
  "summary": null                // set on finish, or null
}
```

Multiple missions may be `in_progress` concurrently — Tactical
Coordinatorium does not enforce "one story at a time"; that remains a
human/AI discipline documented in `AGENTS.md` (Core Rule), not a runtime
constraint. The two are complementary: `active.md` is the *narrative*
single-focus record a session reads first; `state.json` is the
*structured, queryable* ledger of everything that has ever been started.

### Shared State Keeper

`src/coordinatorium/state-keeper.ts` is the single point of read/write
access to `state.json`. It is deliberately ignorant of what a "mission" is
— `mission.ts` builds mission semantics (ID generation, valid transitions)
on top of two primitives the keeper exposes:

- `readState(stateDir)` — parses and schema-validates, with **no side
  effect** when the file is absent (returns an in-memory initial state;
  does not write it). Corrupted JSON or an unsupported `schemaVersion`
  throws rather than being discarded or "fixed".
- `mutateState(stateDir, mutator)` — acquires an exclusive cross-process
  lock, re-reads current state, hands a deep-cloned draft to `mutator`,
  increments `revision`, writes atomically (temp file + `rename`), and
  releases the lock. This is the *only* way anything is ever written.

AI reports mission state (via the CLI); the Keeper validates the shape and
persists it. The Keeper has no model knowledge and makes no decisions about
what a valid mission title or system name is beyond non-emptiness — that
stays in `mission.ts` / `cli.ts`, keeping the persistence layer reusable for
Strategic Coordinatorium later.

### Persistence and concurrency

- **Atomicity:** every write goes to `state.json.tmp.<pid>.<random>` then
  `rename()`s over `state.json`. `rename` within the same directory is a
  single atomic syscall on every platform Node targets — a reader never
  observes a partial file.
- **No lost updates:** atomic rename alone does not protect read-modify-write
  — two processes could both read revision 4, both write revision 5, and
  one update is silently lost. `mutateState` closes that gap with a
  **cross-process file lock** (`state.json.lock`), acquired via a single
  `open(path, 'wx')` syscall (atomic create-if-absent on every platform).
  The entire read → mutate → write cycle, including mission-ID generation,
  happens inside the locked section.
- **Lock recovery:** the lock file's body is `pid:nonce`. Recovery is
  liveness-gated only — see "Locking protocol" below for the full model.
- **Revision:** every successful `mutateState` call increments `revision`
  by exactly 1. It is a corruption/audit signal, not a concurrency version
  check (no optimistic-locking/CAS semantics) — the lock is the mechanism
  that prevents lost updates; revision only proves it worked.

This was verified, not assumed: `state-keeper.test.ts` spawns real,
independent `node` child processes (via `typescript`'s `transpileModule`,
not a mock) that call `startMission` against the same `state.json`
simultaneously, and `monolith mission start` was run as 8 real concurrent
shell processes against a scratch instance — both show unique IDs, zero
lost updates, `revision === N`.

### Locking protocol (hardened 2026-10-21)

Three invariants govern every decision in `lock.ts`, and are enforced in
code, not just documented intent:

> **"Lock ownership is not time-based."**
> The age of the lock file is never, by itself, a reason to take it. The
> original design's `isStale()` returned true if the recorded owner was
> dead **or** the lock was simply older than 30 seconds — an unconditional
> OR, not "age as a fallback for PID reuse" as originally rationalized.
> That meant a live owner mid-write could lose the lock to a waiter once
> 30 seconds had elapsed since acquisition — reproduced empirically (a
> forked process held the lock, stayed alive and provably still running,
> and a second process stole it once the age threshold passed). The
> rewrite removes `staleMs` from `LockOptions` entirely: recovery is
> liveness-gated only, full stop.
>
> **"Uncertainty never grants ownership."**
> If the lock file cannot be read, is empty, or does not parse as a
> well-formed `pid:nonce` record, that is **not** evidence the lock is
> free or stale — it is evidence of nothing, and is treated as "busy."
> The *previous* version of this code did the opposite: an unparseable
> record (`readLockHolder` returning `null`) fell into the same branch as
> a confirmed-dead owner and was immediately stealable. That is corrected:
> `readLockRecord` returning `null` now only ever leads to "wait and
> retry," never to deletion or acquisition.
>
> **"Timeout ends waiting, not ownership."**
> `timeoutMs` bounds how long a *challenger* is willing to wait. It has no
> effect on how long the current owner may hold the lock — there is no
> code path in which merely waiting longer causes a live owner to lose
> ownership.

**Liveness is the only recovery signal**, and it is three-valued, not
boolean (`checkLiveness()` in `lock.ts`):
- `process.kill(pid, 0)` succeeds → **alive** → never recover.
- throws `ESRCH` ("no such process") → **dead** → eligible for recovery.
- throws `EPERM` (process exists, not ours to signal) → treated as
  **alive** → never recover, per the brief's own framing ("EPERM means
  the process may be alive, so capture is forbidden").
- throws anything else → **unknown** → never recover (an unrecognized
  error is not proof of death).

**Recovery (dead owner only), race-safe without a dedicated mutex:** on a
confirmed-dead verdict, the challenger re-reads the lock file immediately
before deleting it and compares it byte-for-byte to the record it based
the "dead" verdict on. If unchanged, it deletes it and loops back to
retry `open(path, 'wx')`. If changed or gone — another challenger beat it
to the same decision — it does nothing and re-evaluates from scratch. A
separate "recovery mutex" file was considered and deliberately **not**
added: the compare-then-delete step, combined with `open(..., 'wx')`'s own
atomicity for both the delete-then-recreate race and the final
acquisition, is sufficient to guarantee at most one challenger ever wins a
given recovery — adding a second lock file to protect the first would not
close a gap this doesn't already close, and the brief explicitly asks not
to add infrastructure that isn't earning its keep. This was verified with
5 concurrent challengers racing to recover a single crashed owner
(`lock.test.ts`, "Scenario B — concurrent recovery challengers") — their
acquired/released windows never overlap.

**`release()` only ever removes a lock file that is still, byte-for-byte,
the record it created** (`pid:nonce`, not just `pid` — a nonce closes the
narrow theoretical gap where a PID could be reused across two unrelated
acquisitions). It is always called from `mutateState`'s `finally` block,
so it runs whether the mutator or the write failed.

**Known limitation, stated plainly:** this is a local-filesystem lock
built on `open(..., 'wx')` and `rename()` atomicity. It makes no claim
about distributed coordination, and its guarantees are not evaluated on
network filesystems (NFS, SMB, etc.) where that atomicity is not always
dependable. Liveness checks are also local — `process.kill(pid, 0)` only
makes sense when lock challengers and the owner share the same PID
namespace (true for `monolith` processes on one machine; not evaluated
across containers/namespaces/hosts).

### Mission ID generation

IDs are `MIS-<4-digit sequence>`, derived by scanning existing mission IDs
for the highest numeric suffix and incrementing — computed *inside* the
same locked section as the write, so concurrent `start` calls can never
collide. No separate counter field was added to the schema; the sequence is
recoverable from the missions map itself.

### Integration — explicit vs. implicit initialization

- **New projects:** `monolith init` now copies a literal
  `templates/default-instance/monolith/state.json` (the schema's initial
  value, no template variables) alongside the rest of the instance. This
  is the explicit path — every newly scaffolded project has a valid
  `state.json` from the start.
- **Existing projects without `state.json`:** `monolith mission start` is
  the implicit path. `readState` returns an initial state in-memory when
  the file is missing; the first `mutateState` call (on `start`) creates
  the directory if needed and writes it for the first time. Read-only
  commands (`list`, `show`) never create the file — a project with no
  missions yet shows "No missions." without any filesystem write.
- **Never overwrite existing state:** `init`'s existing behavior
  (overwrite every template file on re-init, with a warning) was
  special-cased for exactly one file: `scaffoldInstance` now skips copying
  `state.json` if a file already exists at the target path, regardless of
  its contents. Verified by `src/init/init.test.ts`.

### AGENTS.md / mission protocol

Both this repository's root `AGENTS.md` and
`templates/default-instance/projectroot/AGENTS.md` (so newly scaffolded
projects get it too) now document the `monolith mission` commands and
state explicitly: **this is not runtime-enforced in v0.1.** Nothing stops
an AI session from editing source files without ever calling `mission
start`; there is no hook, no gate, no CLI wrapper that requires it. This
is the same trust model `active.md` already operates under today — Tactical
Coordinatorium adds a structured, persisted record alongside it, not an
enforcement mechanism.

---

## Rationale

### Why a single JSON file over a store-per-mission or a log

A single canonical `state.json` matches the repository's existing
file-based-memory philosophy (`.monolith/memory/`, no database, no
background services) and keeps "read current state" a single, atomically
replaceable read — no reconciliation step. The cost is that every write
reads and rewrites the whole file; at the scale missions exist at (tens to
low hundreds per project, not thousands), this is not a real constraint.

### Why a file lock instead of "atomic rename is enough"

This was the explicit trap the brief called out. Atomic rename guarantees a
reader never sees a half-written file; it says nothing about two writers
racing on the same read-modify-write cycle. Without a lock, two concurrent
`mission start` calls can both read revision N, both compute `MIS-0001` as
the next ID (if IDs were derived from a value read before the critical
section), and the second `rename()` to land clobbers the first mission
entirely. The fix has to serialize the *entire* read-modify-write-plus-ID-
generation sequence, not just the final write.

### Why `open(path, 'wx')` over `proper-lockfile`-style directory locks or an OS advisory lock (`flock`)

- `open(..., 'wx')` is a single Node.js builtin syscall, atomic on every
  platform Node supports (Linux, macOS, Windows) — no new dependency,
  consistent with "no database, no background services, keep implementation
  minimal."
- Directory-based locks (`mkdir` as lock) are equally atomic but need an
  extra file inside the directory to carry `pid:nonce` for liveness-based
  recovery anyway; a single file is simpler.
- `flock()` is not available (as address-space-shared, cooperative) in a
  portable, dependency-free way from Node without a native addon or a CLI
  shell-out, and its semantics around NFS and certain Windows filesystems
  are inconsistent. The explicit-ownership file lock avoids that
  portability risk entirely at the cost of needing the liveness-gated
  recovery logic this ADR documents.

### Why stale-lock recovery is liveness-only, with no age fallback at all

The original design paired a PID-liveness check with a 30-second age
fallback, reasoning that age would catch a PID-reuse edge case liveness
alone couldn't. That reasoning doesn't survive scrutiny: age and liveness
were combined with OR, not "liveness first, age only as a tie-breaker
for PID reuse" — so the age branch could fire against a demonstrably
live, still-working owner, which is a strictly worse failure mode (silent
lost updates) than the problem it was trying to solve (a lock that stays
held slightly too long after a crash). A fixed age-based timeout also
forces an arbitrary choice between two bad outcomes: too short, and a
legitimate slow mutation gets preempted while still running; too long,
and a crashed holder blocks everyone for that whole window regardless.
Liveness alone has neither failure mode: a crash is detected the instant
anyone checks (`ESRCH`), and a live owner is never second-guessed no
matter how long it legitimately runs. The PID-reuse edge case the age
fallback was meant to catch is instead closed by the recovery protocol's
compare-before-delete step (see "Locking protocol") and the `nonce` in
the lock record — a new process must still go through `open(path, 'wx')`
to claim the lock before its PID matters at all, so a reused PID
belonging to an unrelated, brand-new process is never mistaken for the
old dead holder.

### Why mission IDs are derived, not a stored counter

A stored `nextMissionSeq` counter is one more field to validate, migrate,
and could in principle drift from the missions map (e.g. after a manual
edit). Deriving the next ID from the existing map, inside the lock, has one
source of truth and costs an O(missions) scan — negligible at this scale.

### Why multiple concurrent missions are allowed, with no runtime "one at a time" enforcement

The AGENTS.md "one story at a time" invariant is a human/AI workflow
discipline about *focus*, not a technical constraint about how many pieces
of work may exist. A tech-debt mission and a feature mission genuinely can
be open at once (e.g. tracked by different systems); Tactical
Coordinatorium's job is to record state accurately, not to impose a
policy the brief explicitly scoped out ("No agent orchestration").

---

## Alternatives Considered

### A SQLite (or other embedded DB) store instead of JSON

**Rejected.** Explicitly out of scope ("No database"). Would also break
the human-readable, git-diffable memory model the rest of `.monolith/` uses.

### Optimistic concurrency via a `revision` check-and-set, no lock

Caller reads `revision`, computes the mutation, writes only `if
on-disk-revision === read-revision`, else retries. **Rejected for this
slice.** It avoids holding a lock but pushes retry-loop complexity onto
every caller and still needs an atomic compare — which on a plain
filesystem means either a lock anyway or an OS-specific atomic CAS primitive
that doesn't exist for files portably. The brief asked for "keep
implementation minimal"; a single `acquireLock`/`release` pair is simpler
to reason about than a generic retry wrapper around every mutation.

### A stored `nextMissionSeq` counter field

**Considered and deferred** (see Rationale). Can be introduced later if
derivation from the missions map ever becomes a measured cost, without a
breaking schema change (it would be purely additive).

### Enforcing mission registration via a git hook or CLI wrapper

**Rejected for v0.1.** Out of scope ("No agent orchestration," "No agent
hooks"). Explicitly documented as a known limitation instead (see
Consequences).

---

## Consequences

**Becomes possible:**
- A persisted, queryable record of every mission a project has ever
  started, independent of any single AI session's memory.
- Multiple AI sessions or human contributors can safely run `monolith
  mission start`/`finish` concurrently without corrupting shared state.

**Becomes harder / explicitly deferred:**
- Strategic Coordinatorium (product/subsystem state) is schema-reserved
  only. No ADR yet covers what belongs in `strategic.systems` or how it's
  mutated.
- There is no enforcement that an AI session actually calls `mission
  start`/`finish` — a session can silently do work with no mission record
  at all. `AGENTS.md` documents the expectation; nothing checks it.
- No mission checkpointing, resume, or session-to-mission linkage. A
  mission only has the fields listed above.
- `state.json` has no referential link to `active.md`'s free-text story —
  the two can drift (e.g. a story closed in `active.md` with its mission
  left `in_progress`). Reconciling them is future work, not this slice.

**Mitigated by:**
- `monolith validate` is unaffected — it never inspects `state.json`
  (confirmed by `src/init/init.test.ts`'s regression test) — so this slice
  cannot cause an existing instance to fail validation.
- The lazy-initialization path means adopting this on an already-initialized
  project requires zero migration step; `mission start` just works the
  first time it's called.

---

## Validation

- 179 total tests passing (138 before this slice — scriptorium 75, graph
  63, unchanged — then 31 for the original slice, then 10 more from the
  2026-10-21 hardening); typecheck clean; build clean.
- First-slice tests (31): 11 state-keeper, 17 mission lifecycle + CLI
  integration, 3 init regression.
- Hardening tests (10, all in the same `lock.test.ts` / `state-keeper.test.ts`
  files as the originals): real-process coverage for a live owner never
  being preempted regardless of hold duration, a crashed owner being
  recovered quickly, empty/malformed/unparseable lock content never being
  claimed, 5 concurrent recovery challengers never overlapping in
  ownership, `release()` refusing to delete a changed or already-gone
  lock file, a write failure (directory made read-only mid-mutation)
  leaving the previous valid `state.json` intact, and `mutateState` on an
  externally-corrupted file throwing without writing anything.
- Manual CLI smoke test: `init` → `mission start` ×2 → `list` → `show` →
  `finish --result completed` → `list` (active/finished split correct) →
  unknown-id and double-finish both exit 1 with a clear message.
- Manual concurrency smoke test: 8 real concurrent `node dist/cli/index.js
  mission start` shell processes against one scratch instance →
  `revision === 8`, 8 unique IDs, no corruption, no lock file left behind.
- What is proven by test vs. assumed: the "no lost updates" and "live
  owner never preempted" properties are demonstrated for processes on one
  machine sharing a PID namespace, within the timeouts exercised by the
  tests (seconds, not hours). No test runs for hours or exercises clock
  changes (NTP step, manual clock adjustment) — since the design no longer
  reasons about elapsed time at all, clock behavior should be irrelevant,
  but that irrelevance follows from code inspection, not from a dedicated
  test exercising a clock jump during an active lock hold.

---

## References

- ADR-007 — Explicit-Only Identity Resolution (sibling precedent for an ADR
  whose status blockquote separates "decision" from "implemented")
- `src/coordinatorium/state-keeper.ts` — lock + atomic write + schema
  validation
- `src/coordinatorium/lock.ts` — cross-process file lock
- `src/coordinatorium/mission.ts` — mission lifecycle semantics
- `src/coordinatorium/cli.ts`, `src/cli/index.ts` — `monolith mission` wiring
- `src/coordinatorium/state-keeper.test.ts`,
  `src/coordinatorium/mission.test.ts`, `src/coordinatorium/lock.test.ts`,
  `src/init/init.test.ts`
