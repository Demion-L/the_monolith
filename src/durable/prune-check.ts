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
export function committedProblem(taskId: string, events: readonly TaskEvent[], t: Tombstone, deletionStarted: boolean): string | null {
  if (events.length === 0) return deletionStarted ? null : 'the log has no readable events, yet no removal was started';
  const head = events.find((e) => e.seq === t.headSeq);
  if (head && head.hash !== t.headHash) return `the surviving event ${t.headSeq} is not the head hash the commit names`;
  const whole = events.length === t.headSeq && events.every((e, i) => e.seq === i + 1);
  if (!whole) return deletionStarted ? null : `events of the log are missing (${events.length} of ${t.headSeq} found), yet no removal was started`;
  return tombstoneProblem(taskId, events, t);
}
