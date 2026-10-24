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
export const DEFAULT_COMPACT_AFTER_EVENTS = 1000;
export const DEFAULT_KEEP_TAIL_EVENTS = 100;
export const DEFAULT_MIN_COMPACT_BATCH = 100;
export function planRetention(states, compactedThrough, policy, now) {
    const referencedBy = new Map();
    for (const s of states) {
        if (s.status !== 'active')
            continue;
        for (const ref of [...(s.parentTaskId ? [s.parentTaskId] : []), ...s.dependsOn]) {
            referencedBy.set(ref, [...(referencedBy.get(ref) ?? []), s.taskId]);
        }
    }
    const compactAfter = policy.compactAfterEvents ?? DEFAULT_COMPACT_AFTER_EVENTS;
    const keepTail = policy.keepTailEvents ?? DEFAULT_KEEP_TAIL_EVENTS;
    const minBatch = policy.minCompactBatch ?? DEFAULT_MIN_COMPACT_BATCH;
    return [...states]
        .sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))
        .map((s) => {
        if (s.status === 'active') {
            const through = s.headSeq - keepTail;
            if (s.eventCount > compactAfter && through - (compactedThrough.get(s.taskId) ?? 0) >= minBatch) {
                return { taskId: s.taskId, action: 'compact', reason: `${s.eventCount} events (> ${compactAfter})`, throughSeq: through };
            }
            return { taskId: s.taskId, action: 'keep', reason: 'active' };
        }
        const closedAt = Date.parse(s.closedAt);
        if (now.getTime() - closedAt < policy.terminalRetentionMs) {
            return { taskId: s.taskId, action: 'keep', reason: 'within retention period' };
        }
        const holders = referencedBy.get(s.taskId);
        if (holders && holders.length > 0) {
            return { taskId: s.taskId, action: 'keep', reason: `referenced by active task(s): ${holders.sort().join(', ')}` };
        }
        return { taskId: s.taskId, action: 'prune', reason: `${s.status} and past retention` };
    });
}
