---
type: template
id: plan-coordinatorium-002-mission-checkpoints
category: templates
---

# Plan: COORDINATORIUM-002 — Mission Checkpoints

**Story:** COORDINATORIUM-002 (not started)
**Date:** 2026-10-21
**Mode:** planning
**Depends on:** COORDINATORIUM-001 (COMPLETED 2026-10-21) — State Keeper, `lock.ts`, mission lifecycle

---

## Objective

Let an active (`in_progress`) mission accumulate structured, append-only
checkpoints recording progress between AI sessions — what has been
achieved, what remains, and whatever context the next session needs to
pick the work back up — without turning a "session" into a Coordinatorium
entity of its own.

This is a **design proposal only.** No implementation, CLI commands, or
schema changes are part of this document or this run.

---

## Design Hypothesis (as given, confirmed against current code)

- A **Mission** remains the long-lived unit of work (`src/coordinatorium/
  types.ts` — unchanged).
- A **Session** does not become a Coordinatorium entity — a checkpoint
  records a point in time, not "who was present."
- A **Checkpoint belongs to exactly one Mission** (`missionId` foreign
  key).
- A Checkpoint fixes: what has been achieved, what remains, and whatever
  the next session needs to continue.
- Persistence goes through the existing Project State Keeper
  (`state-keeper.ts`'s `mutateState`/`readState`) — no new storage
  mechanism.
- No background processes, daemons, or external databases — unchanged
  constraint from ADR-008.

---

## 1. Checkpoint Format and Required Fields

```ts
export interface Checkpoint {
  id: string;              // "<missionId>-CKPT-NNNN", e.g. "MIS-0002-CKPT-0001"
  missionId: string;       // the Mission this checkpoint belongs to
  createdAt: string;       // ISO 8601, set by the keeper at creation time
  summary: string;         // required, non-empty — what was achieved since the last checkpoint
  remainingSteps: string[]; // required array (may be empty) — explicit next steps
  context: string | null;  // optional free-text — anything else the next session needs to know
}
```

Required at creation: `missionId`, `summary` (non-empty, trimmed — same
`requireNonEmptyString` helper `mission.ts` already uses). `remainingSteps`
defaults to `[]` if omitted; each element must be a non-empty string.
`context` defaults to `null`. `id` and `createdAt` are never
caller-supplied — derived/stamped by the keeper, exactly like `Mission.id`
and `startedAt` today.

No `updatedAt` field: checkpoints are immutable once created (see §3) —
there is nothing to track "last updated."

---

## 2. Storage and Relation to `missionId`

**Proposed: a new top-level `tactical.checkpoints: Record<string,
Checkpoint>` section, parallel to the existing `tactical.missions`** —
*not* a `checkpoints` array nested inside `Mission`.

```ts
export interface TacticalState {
  missions: Record<string, Mission>;
  checkpoints: Record<string, Checkpoint>; // new
}
```

Why a sibling top-level map rather than nesting inside `Mission`:

- **Additive, not invasive.** `Mission` and `validateMission()` stay
  completely untouched — every existing test, CLI path, and the `Mission`
  type itself are unaffected. Only new code is added (a sibling
  `validateCheckpoint()`, a sibling `nextCheckpointId()` scanner), by
  direct analogy with how missions already work. This matches
  `AGENTS.md`'s "Additive evolution" principle directly.
- **Matches the existing schema shape.** `tactical.missions` and a future
  `tactical.checkpoints` are structurally identical patterns (`Record<id,
  record>`, scan-derived IDs, validated field-by-field) — no new
  validation *style* needs inventing.
- **Avoids rewriting larger objects than necessary conceptually** (not a
  real I/O cost at this scale — see §3 — but keeps `Mission` the stable,
  simple shape mission CLI code already assumes).

The link to its mission is the plain field `missionId`, validated at
creation time against `readState(...).tactical.missions` inside the same
locked section — creating a checkpoint for an unknown `missionId` fails
exactly like `finishMission` on an unknown mission id today
(`MissionNotFoundError`, reused).

`listCheckpoints(stateDir, missionId)` filters `tactical.checkpoints` by
`missionId` and sorts by `createdAt` — cheap at the expected scale (tens
of checkpoints per mission, not thousands), same reasoning ADR-008 already
gives for one-JSON-file-rewritten-per-mutation.

---

## 3. Append-Only History vs. Alternatives

**Proposed: strictly append-only.** The v1 API exposes only `createCheckpoint`
(write) and `listCheckpoints` / `getCheckpoint` (read) — **no
`updateCheckpoint`, no `deleteCheckpoint`.** Once written, a checkpoint
record never changes.

Trade-offs considered:

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Append-only** (proposed) | No edit-conflict semantics to design; matches `execution-history.md`'s already-established append-only governance pattern (`memory-governance.md` rule 4); trivially auditable — a checkpoint is a fact about a moment, not a mutable record | History grows unboundedly per mission (acceptable — see below) | **Chosen** |
| Mutable "latest checkpoint" (one per mission, overwritten) | Smaller state; no growth | Loses history — can't see *how* a mission's understanding evolved; reintroduces a read-modify-write race on "the" checkpoint that the append-only model doesn't have at all (every write is a fresh key, never a conflicting update to an existing one) | Rejected — throws away the main value of checkpoints (continuity across sessions, not just a snapshot) |
| Soft-delete / superseded flag | Keeps history, allows "retracting" a bad checkpoint | Adds mutation semantics back in for a case with no demonstrated need yet | Deferred — not needed for MVP; can be added later as a strictly additive field (`supersededBy: string | null`) without breaking the append-only core if the need arises |

Unbounded growth is accepted at this stage for the same reason ADR-008
accepts rewriting the whole `state.json` per mutation: tens of missions,
each with on the order of single-digit-to-low-tens of checkpoints, is not
a measured cost. If a mission accumulates checkpoints at a rate that makes
this a real problem, that is itself a signal the mission should probably
have been finished and split — a workflow observation, not a reason to
pre-optimize storage now.

---

## 4. Behavior on a Finished Mission

**Proposed: reject.** `createCheckpoint` must check `mission.status ===
'in_progress'` (inside the same locked section it reads the mission in)
and throw if not — a checkpoint on a `completed`/`failed`/`cancelled`
mission is rejected with a clear, typed error (proposed: a new
`MissionNotActiveError`, code `MISSION_NOT_ACTIVE`, parallel to the
existing `InvalidTransitionError` used by `finishMission` on an
already-terminal mission).

Rationale: a checkpoint's entire purpose is continuity for a mission that
is still being worked on. A terminal mission has nothing left to
continue — allowing a checkpoint there would produce confusing,
meaningless history and silently suggest a closed mission is still live.
This mirrors the mission lifecycle's own terminal-state rule (`finishMission`
on a non-`in_progress` mission already throws `InvalidTransitionError`)
rather than inventing new semantics.

`listCheckpoints`/`getCheckpoint` remain available for a finished mission
(reading history never stops working) — only *writing* a new checkpoint
is blocked.

---

## 5. Minimal CLI Commands (proposed shape — not implemented)

```
monolith mission checkpoint <missionId> --summary "..." \
  [--remaining "step one" --remaining "step two" ...] \
  [--context "..."]

monolith mission checkpoints <missionId>
```

- `checkpoint` creates one; `--summary` required, `--remaining` may repeat
  zero or more times, `--context` optional. Thin CLI layer only — all
  validation/lifecycle logic lives in `mission.ts` (or a new sibling
  `checkpoint.ts`), exactly matching the existing `cli.ts` /
  `mission.ts` split.
- `checkpoints` lists a mission's checkpoint history, chronological,
  formatted like `mission show` today.
- Optional, non-essential nice-to-have (not required for MVP): `mission
  show <id>` could additionally print a checkpoint count / most recent
  checkpoint summary — deferred to implementation time, not decided here.

---

## 6. Compatibility with `schemaVersion` / `revision`

**Proposed: stay on `schemaVersion: 1`.** The new `tactical.checkpoints`
section is additive and must be read **backward-compatibly**: if an
on-disk `state.json` predates this story and has no `tactical.checkpoints`
key at all, `validateState()` must default it to `{}` rather than
throwing — exactly how `createInitialState()` already defaults fresh
state. This is the single concrete compatibility requirement to carry into
implementation, and it needs its own regression test (see §9, test 6).

`revision` behavior is unchanged: `createCheckpoint` goes through the same
`mutateState()` call as every other mutation, so it increments `revision`
by exactly 1, same as `startMission`/`finishMission` today — no new
revision semantics needed.

**Open question for implementation time, not decided here:** if it turns
out `tactical.checkpoints` cannot be made safely backward-compatible as a
pure default (e.g. if some other part of the schema needs to change
non-additively), `schemaVersion` would need to bump to 2 and
`validateState` would need version-specific handling. Nothing in the
current schema suggests this is necessary, but it should be explicitly
re-checked against the real validator code before writing the first line
of `createCheckpoint`.

---

## 7. Validation and Errors

Reuse the existing `CoordinatoriumError` taxonomy (`errors.ts`) wherever a
fit already exists; add only what doesn't:

| Condition | Error |
|---|---|
| `missionId` does not exist | `MissionNotFoundError` (existing, reused) |
| mission exists but is not `in_progress` | **new** `MissionNotActiveError` (code `MISSION_NOT_ACTIVE`) |
| `summary` missing/empty | `ValidationError` (existing, reused — same pattern as `mission.ts`'s `requireNonEmptyString`) |
| a `remainingSteps` element is not a non-empty string | `ValidationError` (existing, reused) |
| checkpoint `id` lookup miss (`getCheckpoint`) | **new** `CheckpointNotFoundError` (code `CHECKPOINT_NOT_FOUND`), parallel to `MissionNotFoundError` |

No new error class needed beyond these two; both follow the exact shape
`errors.ts` already establishes (`extends CoordinatoriumError`, one `code`,
one constructor-built message).

---

## 8. Inter-Process Safety via the Existing State Keeper

No new locking primitive. `createCheckpoint` is implemented as a single
`mutateState(stateDir, mutator)` call, exactly like `startMission`/
`finishMission` — the mission-existence check, the `in_progress` check,
the checkpoint-ID derivation (scan `tactical.checkpoints` for the given
`missionId`'s highest ordinal, same pattern as `nextMissionId`), and the
write all happen inside the same locked critical section, so two
concurrent `mission checkpoint` calls against the same mission (from
independent processes) can never collide on an ID or lose an update —
this is a direct, free consequence of reusing `mutateState`, not new
design work. The three same-day lock/State-Keeper hardening passes from
COORDINATORIUM-001 (liveness-only recovery, serialized recovery mutex,
safe staging+hard-link lock creation) apply unchanged and automatically —
Mission Checkpoints adds no new concurrency surface to `lock.ts` at all.

---

## 9. Test Scenarios (proposed, not written)

1. `createCheckpoint` appends a well-formed record with the correct
   `missionId`, a correctly-derived per-mission ordinal `id`, and a stamped
   `createdAt`.
2. Concurrent `createCheckpoint` calls (real forked processes, same style
   as `state-keeper.test.ts`'s existing concurrency test) against the same
   `missionId` never collide on `id` and never lose a checkpoint —
   `revision` advances by exactly the number of successful calls.
3. `createCheckpoint` against an unknown `missionId` throws
   `MissionNotFoundError`.
4. `createCheckpoint` against a `completed`/`failed`/`cancelled` mission
   throws `MissionNotActiveError` (one case per terminal status).
5. `listCheckpoints` returns only the requested mission's checkpoints, in
   chronological order, and returns `[]` (never throws) for a mission with
   none yet.
6. **Backward-compatibility regression (critical):** `readState`/
   `validateState` correctly parses a hand-written `state.json` fixture
   that has schemaVersion 1 but **no `tactical.checkpoints` key at all**
   (i.e. a file written by COORDINATORIUM-001-era code) — defaults to an
   empty map, does not throw.
7. Validation rejects an empty/whitespace-only `summary`, and a
   `remainingSteps` array containing an empty-string element, each with a
   clear `ValidationError` message.
8. CLI integration tests for `mission checkpoint`/`mission checkpoints`
   (usage-error messages, success-path formatting), same style as the
   existing `cli.ts` tests in `mission.test.ts`.

---

## 10. Non-Goals (explicit)

- **No checkpoint editing or deletion** in v1 — append-only, full stop
  (see §3's rejected alternatives for why).
- **No automatic/implicit checkpoint creation** — no hooks, no "checkpoint
  every N minutes," no checkpoint-on-exit. Purely an explicit CLI action,
  consistent with ADR-008's existing "no agent orchestration" scope cut.
- **No Session entity.** A checkpoint is a fact about a moment, not a
  record of "who was present" or "which AI session wrote this." If that
  turns out to be wanted later, it is a separate, additive field/decision,
  not part of this proposal.
- **No resumable execution snapshots.** A checkpoint is a structured human/
  AI-readable note (summary, remaining steps, context) — not a serialized
  tool-call/conversation state that could auto-resume a session.
- **No attachments or binary/blob payloads** — text fields only, same
  constraint the rest of `state.json` already operates under.
- **No cross-mission checkpoint references or dependency graph.**
- **No runtime enforcement** that an AI session actually calls `mission
  checkpoint` — same non-enforcement precedent already established for
  `mission start`/`finish` in ADR-008.
- **No `schemaVersion` bump** unless implementation discovers the
  additive-default approach in §6 doesn't hold (open question, flagged
  there — not assumed false here).

---

## Architectural Debt Assessment: Does `state-keeper.ts`'s Mission-Specific Knowledge Block This? (`TD-006`)

**Finding, not a fix:** `state-keeper.ts` is documented as "deliberately
ignorant of what a mission is," but `validateState()`/`validateMission()`
still hand-reconstruct the `Mission` shape field-by-field, and mission-ID
derivation (`nextMissionId`) is itself a domain-specific scanning
convention. This is real, narrow coupling — not the clean separation the
module's own doc comment implies.

**Does it block Mission Checkpoints? No.** The proposed design in §2
adds `tactical.checkpoints` as a sibling top-level section using the exact
same pattern (`Record<id, record>`, scan-derived IDs, a dedicated
field-by-field validator) that `tactical.missions` already uses — it
extends the existing coupling by direct analogy, it does not deepen it or
require refactoring `state-keeper.ts` first. `Mission`/`validateMission`
are untouched by this proposal entirely.

**When it would become worth addressing:** if a *third* top-level,
differently-shaped section is added (most plausibly Strategic
Coordinatorium's `strategic.systems`, still schema-reserved and
unimplemented), `state-keeper.ts`'s `validateState()` would be hand-writing
a third bespoke validator inline in the same function. At that point, a
small, separable refactor (a per-section validator registry, or
extracting `validateMission`/`validateCheckpoint`/a future
`validateSystem` behind a uniform shape) becomes worth scheduling — as its
own task, not a precondition this proposal needs to wait on.

**Recommendation:** proceed with Mission Checkpoints as designed here;
leave `TD-006` open and re-evaluate it specifically when Strategic
Coordinatorium is next considered, not before.

---

## Definition of Done (for when this is actually started)

- [ ] `Checkpoint` type + `tactical.checkpoints` schema addition, with the
      backward-compatibility default (§6) implemented and regression-tested
- [ ] `createCheckpoint`, `listCheckpoints`, `getCheckpoint` in a new
      `src/coordinatorium/checkpoint.ts` (or added to `mission.ts` — decide
      at implementation time based on file size/cohesion)
- [ ] `MissionNotActiveError`, `CheckpointNotFoundError` added to
      `errors.ts`
- [ ] `monolith mission checkpoint` / `monolith mission checkpoints` CLI
      commands wired into `src/cli/index.ts` and `src/coordinatorium/cli.ts`
- [ ] All test scenarios in §9 passing, including the real multi-process
      concurrency test and the backward-compatibility fixture test
- [ ] `typecheck`/`build`/full test suite clean
- [ ] ADR written or ADR-008 amended (team's existing convention — see how
      ADR-008 absorbed three same-day hardening addenda — favors amending
      ADR-008 under a new dated section rather than a fresh ADR number,
      since this is still Tactical Coordinatorium; decide at start of
      implementation)
- [ ] `AGENTS.md` mission-lifecycle section updated to document the new
      commands, same way it documents `start`/`list`/`show`/`finish` today
