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
//# sourceMappingURL=prune-check.d.ts.map