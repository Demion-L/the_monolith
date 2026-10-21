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
>
> **Corrective patch (2026-10-21, same day):** a *second* independent
> review found that the hardening update's own recovery path — "re-read,
> compare, then unlink" — was not atomic and could itself be raced: a
> paused challenger's later unlink could delete a *different*, faster
> challenger's freshly-created lock. Reproduced empirically with two real
> forked processes before fixing it. Recovery is now serialized by a
> dedicated recovery mutex (see "Recovery is serialized by a dedicated
> mutex" below) — the earlier claim in this ADR that "no separate mutex is
> needed" was incorrect and has been corrected in place, not quietly
> dropped. 3 new deterministic regression tests (forced via test-only
> hooks, not timing luck). 182 tests total.

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

#### Recovery is serialized by a dedicated mutex (corrected 2026-10-21, same day)

The first version of this hardening pass claimed that "re-read immediately
before deleting, then compare byte-for-byte" was *itself* sufficient —
that a separate recovery mutex would not close any gap that compare-then-
delete didn't already close. **That claim was wrong, and a second,
independent review caught it before it shipped as the final word.**
"Re-read, compare, then unlink" is two separate statements, not one
syscall: `readFileSync` and `unlinkSync` do not happen atomically with
respect to each other, and nothing stops a *different* process from
completing its own entire recovery cycle — delete the stale record,
create its own fresh one — in the gap between this process's compare and
this process's unlink.

This was reproduced empirically (not just reasoned about) with two real
forked processes replaying exactly that two-statement sequence outside
`lock.ts`, with no mutex: process **B** read the dead owner's record,
confirmed it matched, and was paused (via a test hook) in the gap before
its `unlinkSync` call; process **C**, running the identical sequence
without a pause, finished first — deleted the stale record and created
its own lock (`pid:C-nonce`). When B was then resumed, its `unlinkSync`
deleted **C's** lock, purely by path, with no awareness its content had
changed — and B then successfully created its own lock on top of it. Both
B and C believed, at that point, that they owned the lock.

The fix: deleting a specific stale record is now exclusive, enforced by a
**recovery mutex** — `<lockPath>.recovery`, created with the identical
`open(path, 'wx')` primitive as the primary lock, holding no liveness
semantics of its own. A challenger that observes a dead owner must:

1. try to create the recovery mutex; if that fails (`EEXIST`), **back off
   immediately** — it does not wait on the mutex, it falls through to the
   primary lock's normal wait/retry loop, so a busy mutex never blocks
   progress on unrelated outcomes (e.g. the real owner becoming reachable
   another way);
2. only once holding the mutex, **re-read the primary lock from scratch**
   and re-confirm both that its content still matches what was originally
   observed *and* that its owner is still dead — both checks happen
   inside the mutex-protected section, where no other process can be
   concurrently reaching the same conclusion about the same stale record;
3. only then unlink it, and release the mutex in a `finally`.

Why this closes the gap the first version missed: at most one process can
ever hold `<lockPath>.recovery` at a time (same atomicity argument as the
primary lock itself), so at most one process is ever between "re-verified
dead" and "deleted" for a given stale record — there is no window left
for a second process to interleave its own full cycle. Claiming a stale
primary lock is now a *two-step handshake* (hold the mutex to delete the
old record; release it; then separately race for the primary lock itself
via the ordinary `open(wx)` path, exactly like any other acquirer) rather
than one unprotected compare-then-act sequence.

Two cases this must handle, and does, verified by `lock.test.ts`
("TOCTOU regression — serialized recovery"):

- **A challenger paused while holding the mutex** (right before the
  unlink) fully blocks a second challenger — the second cannot acquire
  the mutex, cannot bypass it, and simply times out without touching
  anything. No overlap is possible because the second challenger never
  gets far enough to delete anything.
- **A challenger paused *before* requesting the mutex**, while a faster
  challenger fully recovers and claims the lock in the meantime, must
  find — once it finally gets the mutex — that the record no longer
  matches what it originally observed, and must abort without deleting
  the new owner's lock.

**The recovery mutex is itself never recovered by liveness or age.** If a
process crashes while holding it, it simply stays held — every subsequent
recovery attempt for that lock returns "mutex busy" and the caller times
out cleanly (`LockTimeoutError`), forever, until a human removes the
`.recovery` file by hand. This is a deliberate choice: **safety over
availability**. Making the mutex itself recoverable would reopen exactly
the same class of problem one level down (now two processes could both
conclude the *mutex's* holder is dead and race to steal it), and the brief
explicitly rules out building a recursive recovery hierarchy. The
trade-off is explicit and tested (`lock.test.ts`, "a recovery mutex
orphaned by a process that crashed while holding it..."): automatic crash
recovery for that one lock becomes permanently unavailable until manual
cleanup, but the primary lock file is never touched, nothing is
corrupted, and no caller ever hangs — it gets a diagnosable timeout.

**`release()` only ever removes a lock file that is still, byte-for-byte,
the record it created** (`pid:nonce`, not just `pid` — a nonce closes the
narrow theoretical gap where a PID could be reused across two unrelated
acquisitions). It is always called from `mutateState`'s `finally` block,
so it runs whether the mutator or the write failed. This same
read-compare-then-unlink shape is, syntactically, just as non-atomic as
the one that caused the recovery bug above — but it is not exploitable in
practice, and the reason is not "the nonce makes it atomic" (it does not;
nonce comparison is an identity check, not a compare-and-swap primitive).
It is safe because the *only* process ever positioned to delete a lock
based on a liveness verdict is one that went through the recovery-mutex
protocol above, which can only ever conclude "dead" about an owner that
is, in fact, dead — and a process calling its own `release()` is, by
definition, still alive and running that very call. No process can ever
legitimately conclude a still-running owner is dead, so no process can
ever race to replace that owner's lock while it holds it. The gap between
`release()`'s read and its unlink is real but has no process that can
land in it with a conflicting intent.

**Known limitation, stated plainly:** this is a local-filesystem lock
built on `open(..., 'wx')` and `rename()` atomicity. It makes no claim
about distributed coordination, and its guarantees are not evaluated on
network filesystems (NFS, SMB, etc.) where that atomicity is not always
dependable. Liveness checks are also local — `process.kill(pid, 0)` only
makes sense when lock challengers and the owner share the same PID
namespace (true for `monolith` processes on one machine; not evaluated
across containers/namespaces/hosts). The recovery mutex adds one more
specific, accepted limitation: a process that crashes at exactly the
wrong instant (while holding `<lockPath>.recovery`) permanently disables
automatic recovery for that lock until a human deletes the orphaned
mutex file — this requires two crashes in a row (the original owner, then
a recoverer) and is judged an acceptable price for never risking double
ownership.

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
fallback was meant to catch is instead closed by the recovery mutex's
mutex-protected re-verification step (see "Locking protocol") and the
`nonce` in the lock record — a new process must still go through
`open(path, 'wx')` to claim the lock before its PID matters at all, so a
reused PID belonging to an unrelated, brand-new process is never mistaken
for the old dead holder.

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

- 182 total tests passing (138 before this slice — scriptorium 75, graph
  63, unchanged — then 31 for the original slice, then 10 from the
  2026-10-21 hardening, then 3 from the same-day corrective patch below);
  typecheck clean; build clean.
- First-slice tests (31): 11 state-keeper, 17 mission lifecycle + CLI
  integration, 3 init regression.
- Hardening tests (10): real-process coverage for a live owner never
  being preempted regardless of hold duration, a crashed owner being
  recovered quickly, empty/malformed/unparseable lock content never being
  claimed, 5 concurrent recovery challengers never overlapping in
  ownership, `release()` refusing to delete a changed or already-gone
  lock file, a write failure (directory made read-only mid-mutation)
  leaving the previous valid `state.json` intact, and `mutateState` on an
  externally-corrupted file throwing without writing anything.
- Corrective-patch tests (3, `lock.test.ts` "TOCTOU regression —
  serialized recovery"): a challenger paused *while holding the recovery
  mutex* fully blocks a second challenger (which times out, never
  acquiring, never touching the stale record); a challenger paused
  *before* requesting the mutex, once resumed, correctly aborts without
  deleting a faster challenger's legitimately-claimed lock; a recovery
  mutex orphaned by a crashed holder causes clean, repeatable
  `LockTimeoutError`s (no corruption, no hang) rather than ever granting
  false ownership. All three force their exact interleaving via test-only
  hooks (`beforeRecoveryAttempt`, `beforeStaleUnlink`) and real forked
  processes — not sleep-based timing luck. Run 5× consecutively with no
  flakes before being accepted.
- Manual CLI smoke test: `init` → `mission start` ×2 → `list` → `show` →
  `finish --result completed` → `list` (active/finished split correct) →
  unknown-id and double-finish both exit 1 with a clear message.
- Manual concurrency smoke test: 8 real concurrent `node dist/cli/index.js
  mission start` shell processes against one scratch instance →
  `revision === 8`, 8 unique IDs, no corruption, no lock/recovery files
  left behind.
- What is proven by test vs. assumed: the "no lost updates", "live owner
  never preempted", and "recovery never double-grants ownership"
  properties are demonstrated for processes on one machine sharing a PID
  namespace, within the timeouts exercised by the tests (seconds, not
  hours). No test runs for hours or exercises clock changes (NTP step,
  manual clock adjustment) — since the design no longer reasons about
  elapsed time at all, clock behavior should be irrelevant, but that
  irrelevance follows from code inspection, not from a dedicated test
  exercising a clock jump during an active lock hold. The formal argument
  for "at most one process ever owns the lock" rests on `open(path,
  'wx')`'s atomicity being exactly as advertised by the OS/filesystem —
  this is assumed, not independently re-verified by these tests, for both
  the primary lock and the recovery mutex.

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
