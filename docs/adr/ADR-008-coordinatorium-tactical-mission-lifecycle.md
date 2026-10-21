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
- **Stale-lock recovery:** the lock file's body is `pid:timestamp`. A waiter
  that cannot acquire the lock checks whether the recorded `pid` is still
  alive (`process.kill(pid, 0)`) and whether the lock is older than 30s; if
  either check fails, it steals the lock. This recovers from a crashed
  `monolith` process without a background reaper. A lock a process does
  hold successfully is only ever released by checking that the `pid` in the
  file is still its own (never clears another holder's lock).
- **Revision:** every successful `mutateState` call increments `revision`
  by exactly 1. It is a corruption/audit signal, not a concurrency version
  check (no optimistic-locking/CAS semantics) — the lock is the mechanism
  that prevents lost updates; revision only proves it worked.

This was verified, not assumed: `state-keeper.test.ts` spawns real,
independent `node` child processes (via `typescript`'s `transpileModule`,
not a mock) that call `startMission` against the same `state.json`
simultaneously, and `monolith mission start` was run as 6 real concurrent
shell processes against a scratch instance — both show unique IDs, zero
lost updates, `revision === N`.

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
  extra file inside the directory to carry `pid:timestamp` for stale
  recovery anyway; a single file is simpler.
- `flock()` is not available (as address-space-shared, cooperative) in a
  portable, dependency-free way from Node without a native addon or a CLI
  shell-out, and its semantics around NFS and certain Windows filesystems
  are inconsistent. The explicit-ownership + staleness file lock avoids that
  portability risk entirely at the cost of needing the stale-recovery logic
  this ADR documents.

### Why stale-lock recovery by PID liveness, not just by age

A fixed age-based timeout alone would force a human to manually delete a
stale lock after every crashed process, or risk a long-running (legitimate)
mutation being preempted by too short a timeout. Checking PID liveness
first (`process.kill(pid, 0)`) recovers from a crash immediately rather
than waiting out the `staleMs` window, while the 30s age fallback still
catches a host-recycled-PID edge case (a new, unrelated process reusing the
dead holder's PID) that liveness alone cannot.

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

- 169 total tests passing (was 138 before this slice — scriptorium 75,
  graph 63, unchanged); typecheck clean; build clean.
- 31 new tests: 11 state-keeper (schema validation, corruption, atomicity,
  revision monotonicity, state-field preservation, one real multi-process
  concurrency test), 17 mission lifecycle + CLI integration, 3 init
  regression (state.json creation, non-overwrite, `monolith validate`
  still passes on a freshly scaffolded instance).
- Manual CLI smoke test: `init` → `mission start` ×2 → `list` → `show` →
  `finish --result completed` → `list` (active/finished split correct) →
  unknown-id and double-finish both exit 1 with a clear message.
- Manual concurrency smoke test: 6 real concurrent `node dist/cli/index.js
  mission start` shell processes against one scratch instance →
  `revision === 6`, 6 unique IDs, no corruption.

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
  `src/coordinatorium/mission.test.ts`, `src/init/init.test.ts`
