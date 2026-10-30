/**
 * Preconditions of an irreversible prune, checked against the task's own log. A pure function over verified events: the
 * stores call it AFTER the prune attempt is visible in the register, so that any append that lands later closes the
 * attempt through G2 (ADR-019) instead of being missed by a check-then-act gap.
 */
import { type TaskEvent, type TaskState, type Tombstone } from './types.js';
/** sha256 of the canonical final result/error: what the tombstone keeps instead of the data. */
export declare function outcomeDigestOf(state: TaskState): string;
/** The tombstone of a finished task: what remains of it once its data is removed. */
export declare function tombstoneFor(state: TaskState, prunedAt: string): Tombstone;
/**
 * Why `tombstone` may not be used to remove the task whose log is `events`, or `null` when it may. Throws
 * `LogCorruptError` when the log itself does not verify (a corrupt task is never pruned). `prunedAt` is the pruner's own
 * clock and is not compared.
 */
export declare function tombstoneProblem(taskId: string, events: readonly TaskEvent[], t: Tombstone): string | null;
/**
 * Why a COMMITTED prune must not be rolled forward over the data that is still on disk, or `null` when it may.
 * `events` are the surviving events with `seq <= t.headSeq`, each verified on its own (`parseEvent`), at most one per seq.
 * Events beyond the committed head are stragglers of appends that lost against the commit (G2 reports them as pruned but
 * leaves the file): they are deleted with the rest and are not evidence either way.
 *
 * What the data can prove depends on whether the roll-forward has begun. It publishes `tombstone.json` BEFORE its first
 * unlink, so a log with a part missing and no `tombstone.json` was not removed by a roll-forward:
 *  - `deletionStarted` is false: nothing may be missing. The whole prefix `1..headSeq` must be there and is judged exactly
 *    like a prepare (`tombstoneProblem`: a finished task with the tombstone's head). A register forged for an active task,
 *    or one that names a head the log does not have, is caught here, before the first unlink;
 *  - `deletionStarted` is true: a roll-forward deletes in directory order, so any part of the log may be gone and no check
 *    may demand the whole of it. The head slot, if it survives, must be the head the commit names; a complete prefix is
 *    judged as above; a partial one has nothing that contradicts the commit, and a part cannot prove the rest.
 * Throws `LogCorruptError` when a complete prefix does not verify.
 */
export declare function committedProblem(taskId: string, events: readonly TaskEvent[], t: Tombstone, deletionStarted: boolean): string | null;
//# sourceMappingURL=prune-check.d.ts.map