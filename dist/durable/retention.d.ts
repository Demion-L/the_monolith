/**
 * Retention planning — a pure function. Deciding is separated from doing so a
 * plan can be reviewed (dry run) before anything is removed.
 *
 * Rules, in order of precedence:
 *  1. An active task is never pruned. If its log is long, it may be compacted
 *     (events packed into verified segments; nothing is lost).
 *  2. A terminal task is kept while it is younger than `terminalRetentionMs`.
 *  3. A terminal task that an active task still points at (`parentTaskId` or
 *     `dependsOn`) is kept: the active task's continuation may need its
 *     result and history.
 *  4. Otherwise it is pruned. Pruning leaves a tombstone (id, final status,
 *     hash of the head and of the outcome) so a late duplicate delivery to a
 *     pruned task is recognised instead of resurrecting it.
 */
import type { TaskState } from './types.js';
export interface RetentionPolicy {
    /** How long a finished task stays fully readable. */
    terminalRetentionMs: number;
    /** Compact an active task once it holds more than this many events. Default 1000. */
    compactAfterEvents?: number;
    /** Events at the head that always stay loose (never packed). Default 100. */
    keepTailEvents?: number;
    /**
     * Do not create a segment for fewer events than this. Without it a task sitting just above
     * the threshold would get one tiny segment per appended event. Default 100.
     */
    minCompactBatch?: number;
}
export type RetentionAction = 'prune' | 'compact' | 'keep';
export interface RetentionDecision {
    taskId: string;
    action: RetentionAction;
    reason: string;
    /** For `compact`: pack events up to and including this seq. */
    throughSeq?: number;
}
export declare const DEFAULT_COMPACT_AFTER_EVENTS = 1000;
export declare const DEFAULT_KEEP_TAIL_EVENTS = 100;
export declare const DEFAULT_MIN_COMPACT_BATCH = 100;
/** Work left over by an interrupted run; finishing it is always safe because both operations are marker-first. */
export interface InterruptedWork {
    /** Tasks whose loose events are still on disk although a segment covers them. */
    compactions?: ReadonlySet<string>;
    /** Pruned tasks (tombstone present) whose data files are still on disk. */
    prunes?: readonly string[];
}
export declare function planRetention(states: readonly TaskState[], compactedThrough: ReadonlyMap<string, number>, policy: RetentionPolicy, now: Date, interrupted?: InterruptedWork): RetentionDecision[];
//# sourceMappingURL=retention.d.ts.map