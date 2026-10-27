/**
 * Durable State — typed error taxonomy.
 *
 * Every error carries a stable `code`. Callers branch on `code`, never on
 * message text. No error message embeds event payloads or file contents
 * (payloads are application data and may be sensitive).
 */

export type DurableErrorCode =
  | 'VALIDATION'
  | 'TASK_NOT_FOUND'
  | 'TASK_PRUNED'
  | 'TASK_EXISTS'
  | 'TASK_CLOSED'
  | 'TASK_ORPHANED'
  | 'REQUIRED_TASK_PENDING'
  | 'LEASE_HELD'
  | 'STALE_FENCE'
  | 'CONTENTION'
  | 'LOG_CORRUPT'
  | 'LOG_UNSUPPORTED'
  | 'LOG_TOO_LARGE'
  | 'STORE_SECURITY'
  | 'STORE_IO'
  | 'EFFECT_IN_DOUBT'
  | 'EFFECT_FAILED'
  | 'EFFECT_CONFLICT'
  | 'EFFECT_NOT_EXECUTED'
  | 'RETENTION_REFUSED'
  | 'PRUNE_DECISION_CORRUPT'
  | 'PRUNE_ATTEMPT_LIMIT'
  | 'STORE_PROTOCOL';

export class DurableError extends Error {
  readonly code: DurableErrorCode;
  constructor(code: DurableErrorCode, message: string) {
    super(message);
    this.name = 'DurableError';
    this.code = code;
  }
}

export class ValidationError extends DurableError {
  constructor(message: string) {
    super('VALIDATION', message);
    this.name = 'DurableValidationError';
  }
}

export class TaskNotFoundError extends DurableError {
  constructor(readonly taskId: string) {
    super('TASK_NOT_FOUND', `task "${taskId}" does not exist.`);
    this.name = 'TaskNotFoundError';
  }
}

/** The task existed and was pruned by retention; only its tombstone remains. */
export class TaskPrunedError extends DurableError {
  constructor(readonly taskId: string) {
    super('TASK_PRUNED', `task "${taskId}" was pruned by retention; only its tombstone remains.`);
    this.name = 'TaskPrunedError';
  }
}

export class TaskExistsError extends DurableError {
  constructor(readonly taskId: string) {
    super('TASK_EXISTS', `task "${taskId}" already exists with different content.`);
    this.name = 'TaskExistsError';
  }
}

/** The task reached a terminal state; its log is sealed. */
export class TaskClosedError extends DurableError {
  constructor(readonly taskId: string, readonly status: string) {
    super('TASK_CLOSED', `task "${taskId}" is ${status}; its log is sealed.`);
    this.name = 'TaskClosedError';
  }
}

export class LeaseHeldError extends DurableError {
  constructor(readonly taskId: string, readonly owner: string, readonly leaseUntil: string) {
    super('LEASE_HELD', `task "${taskId}" is leased by "${owner}" until ${leaseUntil}.`);
    this.name = 'LeaseHeldError';
  }
}

/**
 * A worker acted with an epoch/owner that is no longer current: someone else
 * claimed the task (fencing). The worker must stop; nothing was written.
 */
export class StaleFenceError extends DurableError {
  constructor(readonly taskId: string, readonly owner: string, readonly epoch: number, readonly currentEpoch: number) {
    super('STALE_FENCE', `"${owner}" (epoch ${epoch}) no longer holds task "${taskId}" (current epoch ${currentEpoch}).`);
    this.name = 'StaleFenceError';
  }
}

export class ContentionError extends DurableError {
  constructor(readonly taskId: string, readonly attempts: number) {
    super('CONTENTION', `gave up appending to task "${taskId}" after ${attempts} lost races.`);
    this.name = 'ContentionError';
  }
}

/** The log failed an integrity check (hash chain, sequence gap, schema). Fail closed; never auto-repaired. */
export class LogCorruptError extends DurableError {
  constructor(readonly taskId: string, readonly seq: number | null, readonly reason: string) {
    super('LOG_CORRUPT', `log of task "${taskId}" is corrupt${seq === null ? '' : ` at seq ${seq}`}: ${reason}`);
    this.name = 'LogCorruptError';
  }
}

/**
 * `withdrawTombstone` found the pruned task's data no longer complete: removal has started, so the prune is committed
 * and cannot be rolled back. (It is a `LogCorruptError` for callers that only know the old contract.)
 */
export class TombstoneCommittedError extends LogCorruptError {
  constructor(taskId: string, reason: string) {
    super(taskId, null, reason);
    this.name = 'TombstoneCommittedError';
  }
}

/** The log contains an event format/type this version does not know. Never skipped silently. */
export class LogUnsupportedError extends DurableError {
  constructor(readonly taskId: string, readonly seq: number, readonly what: string) {
    super('LOG_UNSUPPORTED', `log of task "${taskId}" has an unsupported ${what} at seq ${seq}; refusing to interpret it.`);
    this.name = 'LogUnsupportedError';
  }
}

export class LogTooLargeError extends DurableError {
  constructor(readonly taskId: string, readonly limit: number) {
    super(
      'LOG_TOO_LARGE',
      `task "${taskId}" reached the event limit (${limit}); continue the work in a new task (parentTaskId). ` +
        'Completing, failing or cancelling the task is still possible.',
    );
    this.name = 'LogTooLargeError';
  }
}

/** The filesystem layout is not what a managed store must look like (symlink, foreign hard link, special file). */
export class StoreSecurityError extends DurableError {
  constructor(message: string, readonly detailCode: string) {
    super('STORE_SECURITY', message);
    this.name = 'StoreSecurityError';
  }
}

/**
 * The storage layer failed (disk full, I/O error, permission). Nothing was published by the failed call.
 * This is a PHYSICAL failure and is never confused with `LogTooLargeError`, which is the logical event budget.
 * `errnoCode` is the operating-system code found in the cause chain (`ENOSPC`, `EDQUOT`, `EIO`, ...), if any.
 */
export class StoreIoError extends DurableError {
  readonly errnoCode: string | undefined;
  constructor(message: string, readonly cause?: unknown) {
    super('STORE_IO', message);
    this.name = 'StoreIoError';
    this.errnoCode = errnoOf(cause);
  }
}

function errnoOf(cause: unknown): string | undefined {
  let c: unknown = cause;
  for (let i = 0; i < 4 && c !== null && typeof c === 'object'; i++) {
    const code = (c as { code?: unknown }).code;
    if (typeof code === 'string' && /^E[A-Z0-9]{2,}$/.test(code)) return code;
    c = (c as { cause?: unknown }).cause;
  }
  return undefined;
}

/** An effect was announced but its outcome was never recorded (crash between intent and result). */
export class EffectInDoubtError extends DurableError {
  constructor(readonly taskId: string, readonly effectKey: string) {
    super('EFFECT_IN_DOUBT', `effect "${effectKey}" of task "${taskId}" has an unrecorded outcome; reconcile it against the external system.`);
    this.name = 'EffectInDoubtError';
  }
}

export class EffectFailedError extends DurableError {
  constructor(readonly taskId: string, readonly effectKey: string, readonly detail: string) {
    super('EFFECT_FAILED', `effect "${effectKey}" of task "${taskId}" failed permanently: ${detail}`);
    this.name = 'EffectFailedError';
  }
}

/**
 * Thrown by the function given to `runEffect` to assert that the external operation did NOT take effect
 * (for example a connection refused before any request was sent). It is the only kind of error that leaves
 * an effect safely retryable by default: any other exception, a timeout above all, proves nothing about
 * what the remote side did, and the effect is then recorded as having an unknown outcome.
 */
export class EffectNotExecutedError extends DurableError {
  constructor(message: string, readonly cause?: unknown) {
    super('EFFECT_NOT_EXECUTED', message);
    this.name = 'EffectNotExecutedError';
  }
}

/**
 * Another caller announced, finished or re-announced the same effect between this caller's decision and its
 * announcement (compare-and-set on the effect's identity in the log lost). The function was NOT run by this call.
 * Re-read the task and decide again; the other caller's attempt is the one that counts.
 */
export class EffectConflictError extends DurableError {
  constructor(readonly taskId: string, readonly effectKey: string) {
    super('EFFECT_CONFLICT', `effect "${effectKey}" of task "${taskId}" was changed by another caller while this call was deciding; it was not run by this call.`);
    this.name = 'EffectConflictError';
  }
}

/**
 * The task is active in the log, but a task it requires (`parentTaskId` / `dependsOn`) was pruned or does not exist,
 * so it must not run. Raised by `claim`; the log is NOT what decides this, the required task's state right now is.
 */
export class TaskOrphanedError extends DurableError {
  constructor(readonly taskId: string, readonly requiredTaskId: string) {
    super('TASK_ORPHANED', `task "${taskId}" requires task "${requiredTaskId}", which was pruned or does not exist; it will not be run.`);
    this.name = 'TaskOrphanedError';
  }
}

/**
 * A task this one requires is in an unfinished prune (tombstone published, removal not finished or not provably
 * rolled back), or could not be examined right now. Nothing is run and NOTHING IS CANCELLED: the state is transient,
 * and the call can simply be repeated. Contrast `TaskOrphanedError`, which is final.
 */
export class RequiredTaskPendingError extends DurableError {
  readonly retryable = true;
  constructor(readonly taskId: string, readonly requiredTaskId: string) {
    super('REQUIRED_TASK_PENDING', `task "${taskId}" requires task "${requiredTaskId}", whose prune is not settled; it is not run now, and not cancelled. Retry.`);
    this.name = 'RequiredTaskPendingError';
  }
}

export class RetentionRefusedError extends DurableError {
  constructor(readonly taskId: string, readonly why: string) {
    super('RETENTION_REFUSED', `refusing to prune task "${taskId}": ${why}`);
    this.name = 'RetentionRefusedError';
  }
}

/** Why the prune decision register of a task cannot be trusted (Design A, section 20.4). */
export type PruneCorruptReason =
  | 'register'
  | 'gap'
  | 'unknown-artifact'
  | 'commit-audit'
  | 'multiple-commit'
  | 'history'
  | 'task-dir-missing'
  | 'tombstone-without-commit'
  | 'legacy-tombstone-unmigrated';

/**
 * The persisted prune decision register of a task is corrupt, or the task directory is missing, or it is an
 * unmigrated legacy tombstone. Fail closed: nothing is deleted and nobody is cancelled; an operator decides.
 * Never mapped to `TaskOrphanedError`, `RetentionRefusedError` or a quarantine, and never retryable.
 * `published` is true when a write the caller made is already visible (the outcome of that write is unknown).
 */
export class PruneDecisionCorruptError extends DurableError {
  readonly retryable = false;
  constructor(
    readonly taskId: string,
    readonly reason: PruneCorruptReason,
    readonly file: string | null = null,
    readonly attempt: number | null = null,
    readonly published = false,
  ) {
    super(
      'PRUNE_DECISION_CORRUPT',
      `the prune decision register of task "${taskId}" cannot be trusted (${reason}${file ? `: ${file}` : ''}); nothing was deleted or cancelled.`,
    );
    this.name = 'PruneDecisionCorruptError';
  }
}

/** The attempt number would exceed `MAX_PRUNE_ATTEMPTS`. A liveness limit: numbers are never reused or reset. */
export class PruneAttemptLimitError extends DurableError {
  constructor(readonly taskId: string, readonly attempts: number) {
    super('PRUNE_ATTEMPT_LIMIT', `task "${taskId}" has used all ${attempts} prune attempts; raise the limit or find out why they keep being aborted.`);
    this.name = 'PruneAttemptLimitError';
  }
}

export type StoreProtocolCode = 'PROTOCOL_NOT_INITIALIZED' | 'PROTOCOL_UNSUPPORTED' | 'PROTOCOL_STORE_NOT_EMPTY';

/**
 * The store does not carry a usable `durable-protocol.json`: it is uninitialized (read-only diagnostics only), has a
 * version this build does not understand, or cannot be initialized because it already holds tasks. The marker is
 * created only by an explicit operator action, never by opening the store.
 */
export class StoreProtocolError extends DurableError {
  constructor(message: string, readonly detailCode: StoreProtocolCode) {
    super('STORE_PROTOCOL', message);
    this.name = 'StoreProtocolError';
  }
}
