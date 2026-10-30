---
type: reference
id: durable-sec-001-remediation-report
status: remediation-complete-not-accepted
---

# DURABLE-SEC-001 — remediation report

**Status: remediation complete for F-1/F-2. Independent security acceptance has NOT been performed.** Criterion 23
stays open.

## Findings (primary source: `DURABLE-FIX-004F-SECURITY-REVIEW-PACKAGE.md`, addendum; commit `02701d4`)

| Finding | Description | Component | Status |
|---|---|---|---|
| F-1 | public `preparePrune`/`decidePrune(commit)`/`prune` accepted a tombstone for an unfinished task or a forged head | `fs-store.ts`, `memory-store.ts`, new `prune-check.ts` | fixed in `02701d4`, merged `e72e5f5`; re-verified here |
| F-2 | internal test seams (`ops`, `beforePublish`, `skipPrunePrecondition`, …) in the public constructors and `.d.ts` | `fs-store.ts`, `seams.ts`, `testing.ts` | fixed in `02701d4`; re-verified here |
| SEC-001B.3 / TM-C | concurrent adversarial mutation of directories/symlinks | `src/root`, all path-based `fs.*` calls | **open by design** (ADR-013, native layer deferred) |

The original review report text (`DURABLE-SECURITY-REVIEW-001`) is not in the repository; F-1/F-2 content above is taken
from the addendum and the fix commit message. Not to be confused with the unrelated F-1/F-2 of `LOCK-FIX-002` /
`LOCK-RESIDUAL-001` (Coordinatorium lock).

## What this task established

- F-1/F-2 were already fixed on `main`; the repository's status documents (`security-and-limitations.md`, `active.md`) still
  called them open. Those statements are corrected.
- Re-verification against current sources: `dist/durable/*.d.ts` contains no seam fields; the package `exports` map exposes
  `.` only; `prune-precondition.test.ts` covers forged/active/older-head tombstones, corrupt logs, the append-between-check-and-prepare
  race (G2 abort) and seam smuggling.
- New adversarial regression tests `prune-hostile-entries.test.ts`: a symlink or directory entry planted among a task's events,
  or an `events` directory that is a symlink out of the store, makes `prune` fail closed (`StoreSecurityError`) with a byte-identical
  tree and an untouched outside file.
- Probes (not committed): symlinked `events/` or durable root → read, write and cancel refused; a truncated event → `verify` reports
  the task corrupt and retention skips it; an orphan `*.tmp.*` file is reported (`STAGING_FILE_PRESENT`) and does not block appends.
- No new compatible-fix-level defect was found; no storage-format or public-API change was made.

## Limits (unchanged)

- TM-C: `rollForward` (`fs-store.ts`) and the residue repair unlink by path after a boundary check; a same-UID process swapping a
  directory for a symlink between the check and the `unlink` can redirect it. Not closable without a descriptor-based native
  layer (ADR-013 §5). Durable State inherits "trusted local project" as its supported model.
- OS-crash/power-loss durability is not claimed (Mode A only), nor network filesystems.
- Seam hygiene (F-2) is API hygiene, not a boundary against in-process code.

## O-1 — committed prune hardening (DURABLE-SEC-003)

Found by the independent review DURABLE-SEC-002: `prune()` reached `rollForward()` for any state derived as `committed`
without re-checking the F-1 preconditions. A hand-written `prune-1.prepare.json` + `prune-1.decision.json` (commit, valid
unkeyed checksum) for an ACTIVE task made `prune()` delete its events. Reproduced before the fix, refused after.

**Why not simply call `assertPrunable`:** after a roll-forward has started, part of the log is gone and the full
precondition can no longer hold; it would block the recovery of a genuine commit. Evidence: `tombstone.json` is published
after the commit and before the first data `unlink` (ADR-019), and a roll-forward deletes in directory order.

**Fix** (`fs-store.ts` `auditCommitted`, `prune-check.ts` `committedProblem`; no format or public-API change except the
optional `detail` of `PruneDecisionCorruptError`). Before `rollForward`, the surviving events and segment lines with
`seq <= headSeq` are read and verified one by one (events past the head are stragglers of appends that lost against the
commit, not evidence). Then:

| `tombstone.json` | surviving data | result |
|---|---|---|
| absent (removal not started) | whole prefix `1..headSeq` | judged like a prepare (finished task, same head and digest) |
| absent | anything missing | refused (`commit-audit`): nothing may be missing yet |
| present (removal may have started) | whole prefix | judged like a prepare |
| present | part of it | head slot, if present, must carry the committed head hash; otherwise nothing contradicts the commit, the roll-forward continues |
| any | unreadable, hardlinked, tampered or non-verifying event | refused, nothing removed |

Tests: `committed-prune.test.ts` (forged register for an active task, wrong head hash, older head, head beyond the log,
wrong digest, tampered event, symlink, all 16 subsets of removed events with `tombstone.json` published, stragglers,
interruption by an injected fault and repeated recovery, damaged `tombstone.json`, concurrent prune/append).
`pending-prune.test.ts` was corrected to the documented order (`tombstone.json` before the first unlink).

**Residual limits.** (1) A forger who also plants `tombstone.json`, and removes some data, defeats the partial-state check
(unkeyed register; same-privilege write access). (2) A stale writer that re-creates a deleted slot `<= headSeq` during a
roll-forward makes the audit refuse; an operator resolves it. (3) The memory store has no on-disk register to forge and is
unchanged. (4) TM-C is unchanged. Full security acceptance and criterion 23 remain open.
