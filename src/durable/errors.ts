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
  | 'RETENTION_REFUSED';

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

/** The log contains an event format/type this version does not know. Never skipped silently. */
export class LogUnsupportedError extends DurableError {
  constructor(readonly taskId: string, readonly seq: number, readonly what: string) {
    super('LOG_UNSUPPORTED', `log of task "${taskId}" has an unsupported ${what} at seq ${seq}; refusing to interpret it.`);
    this.name = 'LogUnsupportedError';
  }
}

export class LogTooLargeError extends DurableError {
  constructor(readonly taskId: string, readonly limit: number) {
    super('LOG_TOO_LARGE', `task "${taskId}" reached the event limit (${limit}); continue the work in a new task (parentTaskId).`);
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

export class StoreIoError extends DurableError {
  constructor(message: string, readonly cause?: unknown) {
    super('STORE_IO', message);
    this.name = 'StoreIoError';
  }
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

export class RetentionRefusedError extends DurableError {
  constructor(readonly taskId: string, readonly why: string) {
    super('RETENTION_REFUSED', `refusing to prune task "${taskId}": ${why}`);
    this.name = 'RetentionRefusedError';
  }
}
