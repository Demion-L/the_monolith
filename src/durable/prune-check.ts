/**
 * Preconditions of an irreversible prune, checked against the task's own log. A pure function over verified events: the
 * stores call it AFTER the prune attempt is visible in the register, so that any append that lands later closes the
 * attempt through G2 (ADR-019) instead of being missed by a check-then-act gap.
 */

import { canonicalize, sha256Hex, type Json } from './canonical.js';
import { GENESIS_HASH, verifyChain } from './log.js';
import { foldEvents } from './projection.js';
import { isTerminal, type TaskEvent, type TaskState, type Tombstone } from './types.js';

/** sha256 of the canonical final result/error: what the tombstone keeps instead of the data. */
export function outcomeDigestOf(state: TaskState): string {
  const outcome = state.status === 'completed' ? state.result : { error: state.error };
  return sha256Hex(canonicalize((outcome ?? null) as Json));
}

/** The tombstone of a finished task: what remains of it once its data is removed. */
export function tombstoneFor(state: TaskState, prunedAt: string): Tombstone {
  return {
    v: 1, taskId: state.taskId, kind: state.kind, finalStatus: state.status, createdAt: state.createdAt, closedAt: state.closedAt as string,
    prunedAt, headSeq: state.headSeq, headHash: state.headHash, outcomeDigest: outcomeDigestOf(state),
  };
}

/**
 * Why `tombstone` may not be used to remove the task whose log is `events`, or `null` when it may. Throws
 * `LogCorruptError` when the log itself does not verify (a corrupt task is never pruned). `prunedAt` is the pruner's own
 * clock and is not compared.
 */
export function tombstoneProblem(taskId: string, events: readonly TaskEvent[], t: Tombstone): string | null {
  if (events.length === 0) return 'its log has no readable events';
  verifyChain(taskId, events, 0, GENESIS_HASH);
  const s = foldEvents(events);
  if (!isTerminal(s.status)) return `the task is ${s.status}, not finished`;
  if (t.headSeq !== s.headSeq) return `the tombstone names head ${t.headSeq}, the log ends at ${s.headSeq}`;
  if (t.headHash !== s.headHash) return 'the tombstone head hash is not the hash of the last event of the log';
  if (t.finalStatus !== s.status) return `the tombstone says "${t.finalStatus}", the task ended "${s.status}"`;
  if (t.kind !== s.kind || t.createdAt !== s.createdAt || t.closedAt !== s.closedAt) return 'the tombstone does not describe this task';
  if (t.outcomeDigest !== outcomeDigestOf(s)) return 'the tombstone outcome digest is not the digest of the final outcome';
  return null;
}
