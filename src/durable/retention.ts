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

export const DEFAULT_COMPACT_AFTER_EVENTS = 1000;
export const DEFAULT_KEEP_TAIL_EVENTS = 100;
export const DEFAULT_MIN_COMPACT_BATCH = 100;

/** Work left over by an interrupted run; finishing it is always safe because both operations are marker-first. */
export interface InterruptedWork {
  /** Tasks whose loose events are still on disk although a segment covers them. */
  compactions?: ReadonlySet<string>;
  /** Pruned tasks (tombstone present) whose data files are still on disk. */
  prunes?: readonly string[];
}

export function planRetention(
  states: readonly TaskState[],
  compactedThrough: ReadonlyMap<string, number>,
  policy: RetentionPolicy,
  now: Date,
  interrupted: InterruptedWork = {},
): RetentionDecision[] {
  const referencedBy = new Map<string, string[]>();
  for (const s of states) {
    if (s.status !== 'active') continue;
    for (const ref of [...(s.parentTaskId ? [s.parentTaskId] : []), ...s.dependsOn]) {
      referencedBy.set(ref, [...(referencedBy.get(ref) ?? []), s.taskId]);
    }
  }
  const compactAfter = policy.compactAfterEvents ?? DEFAULT_COMPACT_AFTER_EVENTS;
  const keepTail = policy.keepTailEvents ?? DEFAULT_KEEP_TAIL_EVENTS;
  const minBatch = policy.minCompactBatch ?? DEFAULT_MIN_COMPACT_BATCH;

  // Finishing an interrupted compaction only removes copies a segment already covers: no policy threshold applies.
  const finishCompaction = (s: TaskState): RetentionDecision => ({
    taskId: s.taskId, action: 'compact', reason: 'finish interrupted compaction', throughSeq: compactedThrough.get(s.taskId) ?? 0,
  });

  const decisions = [...states]
    .sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))
    .map((s): RetentionDecision => {
      if (s.status === 'active') {
        const through = s.headSeq - keepTail;
        if (s.eventCount > compactAfter && through - (compactedThrough.get(s.taskId) ?? 0) >= minBatch) {
          return { taskId: s.taskId, action: 'compact', reason: `${s.eventCount} events (> ${compactAfter})`, throughSeq: through };
        }
        return interrupted.compactions?.has(s.taskId) ? finishCompaction(s) : { taskId: s.taskId, action: 'keep', reason: 'active' };
      }
      const closedAt = Date.parse(s.closedAt as string);
      if (now.getTime() - closedAt < policy.terminalRetentionMs) {
        return interrupted.compactions?.has(s.taskId) ? finishCompaction(s) : { taskId: s.taskId, action: 'keep', reason: 'within retention period' };
      }
      const holders = referencedBy.get(s.taskId);
      if (holders && holders.length > 0) {
        return { taskId: s.taskId, action: 'keep', reason: `referenced by active task(s): ${holders.sort().join(', ')}` };
      }
      return { taskId: s.taskId, action: 'prune', reason: `${s.status} and past retention` };
    });
  for (const taskId of interrupted.prunes ?? []) {
    decisions.push({ taskId, action: 'prune', reason: 'finish interrupted prune (tombstone present, data still on disk)' });
  }
  return decisions.sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
}
