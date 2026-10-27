/**
 * Durable State — typed error taxonomy.
 *
 * Every error carries a stable `code`. Callers branch on `code`, never on
 * message text. No error message embeds event payloads or file contents
 * (payloads are application data and may be sensitive).
 */
export type DurableErrorCode = 'VALIDATION' | 'TASK_NOT_FOUND' | 'TASK_PRUNED' | 'TASK_EXISTS' | 'TASK_CLOSED' | 'TASK_ORPHANED' | 'REQUIRED_TASK_PENDING' | 'LEASE_HELD' | 'STALE_FENCE' | 'CONTENTION' | 'LOG_CORRUPT' | 'LOG_UNSUPPORTED' | 'LOG_TOO_LARGE' | 'STORE_SECURITY' | 'STORE_IO' | 'EFFECT_IN_DOUBT' | 'EFFECT_FAILED' | 'EFFECT_CONFLICT' | 'EFFECT_NOT_EXECUTED' | 'RETENTION_REFUSED' | 'PRUNE_DECISION_CORRUPT' | 'PRUNE_ATTEMPT_LIMIT' | 'STORE_PROTOCOL';
export declare class DurableError extends Error {
    readonly code: DurableErrorCode;
    constructor(code: DurableErrorCode, message: string);
}
export declare class ValidationError extends DurableError {
    constructor(message: string);
}
export declare class TaskNotFoundError extends DurableError {
    readonly taskId: string;
    constructor(taskId: string);
}
/** The task existed and was pruned by retention; only its tombstone remains. */
export declare class TaskPrunedError extends DurableError {
    readonly taskId: string;
    constructor(taskId: string);
}
export declare class TaskExistsError extends DurableError {
    readonly taskId: string;
    constructor(taskId: string);
}
/** The task reached a terminal state; its log is sealed. */
export declare class TaskClosedError extends DurableError {
    readonly taskId: string;
    readonly status: string;
    constructor(taskId: string, status: string);
}
export declare class LeaseHeldError extends DurableError {
    readonly taskId: string;
    readonly owner: string;
    readonly leaseUntil: string;
    constructor(taskId: string, owner: string, leaseUntil: string);
}
/**
 * A worker acted with an epoch/owner that is no longer current: someone else
 * claimed the task (fencing). The worker must stop; nothing was written.
 */
export declare class StaleFenceError extends DurableError {
    readonly taskId: string;
    readonly owner: string;
    readonly epoch: number;
    readonly currentEpoch: number;
    constructor(taskId: string, owner: string, epoch: number, currentEpoch: number);
}
export declare class ContentionError extends DurableError {
    readonly taskId: string;
    readonly attempts: number;
    constructor(taskId: string, attempts: number);
}
/** The log failed an integrity check (hash chain, sequence gap, schema). Fail closed; never auto-repaired. */
export declare class LogCorruptError extends DurableError {
    readonly taskId: string;
    readonly seq: number | null;
    readonly reason: string;
    constructor(taskId: string, seq: number | null, reason: string);
}
/**
 * `withdrawTombstone` found the pruned task's data no longer complete: removal has started, so the prune is committed
 * and cannot be rolled back. (It is a `LogCorruptError` for callers that only know the old contract.)
 */
export declare class TombstoneCommittedError extends LogCorruptError {
    constructor(taskId: string, reason: string);
}
/** The log contains an event format/type this version does not know. Never skipped silently. */
export declare class LogUnsupportedError extends DurableError {
    readonly taskId: string;
    readonly seq: number;
    readonly what: string;
    constructor(taskId: string, seq: number, what: string);
}
export declare class LogTooLargeError extends DurableError {
    readonly taskId: string;
    readonly limit: number;
    constructor(taskId: string, limit: number);
}
/** The filesystem layout is not what a managed store must look like (symlink, foreign hard link, special file). */
export declare class StoreSecurityError extends DurableError {
    readonly detailCode: string;
    constructor(message: string, detailCode: string);
}
/**
 * The storage layer failed (disk full, I/O error, permission). Nothing was published by the failed call.
 * This is a PHYSICAL failure and is never confused with `LogTooLargeError`, which is the logical event budget.
 * `errnoCode` is the operating-system code found in the cause chain (`ENOSPC`, `EDQUOT`, `EIO`, ...), if any.
 */
export declare class StoreIoError extends DurableError {
    readonly cause?: unknown | undefined;
    readonly errnoCode: string | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/** An effect was announced but its outcome was never recorded (crash between intent and result). */
export declare class EffectInDoubtError extends DurableError {
    readonly taskId: string;
    readonly effectKey: string;
    constructor(taskId: string, effectKey: string);
}
export declare class EffectFailedError extends DurableError {
    readonly taskId: string;
    readonly effectKey: string;
    readonly detail: string;
    constructor(taskId: string, effectKey: string, detail: string);
}
/**
 * Thrown by the function given to `runEffect` to assert that the external operation did NOT take effect
 * (for example a connection refused before any request was sent). It is the only kind of error that leaves
 * an effect safely retryable by default: any other exception, a timeout above all, proves nothing about
 * what the remote side did, and the effect is then recorded as having an unknown outcome.
 */
export declare class EffectNotExecutedError extends DurableError {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/**
 * Another caller announced, finished or re-announced the same effect between this caller's decision and its
 * announcement (compare-and-set on the effect's identity in the log lost). The function was NOT run by this call.
 * Re-read the task and decide again; the other caller's attempt is the one that counts.
 */
export declare class EffectConflictError extends DurableError {
    readonly taskId: string;
    readonly effectKey: string;
    constructor(taskId: string, effectKey: string);
}
/**
 * The task is active in the log, but a task it requires (`parentTaskId` / `dependsOn`) was pruned or does not exist,
 * so it must not run. Raised by `claim`; the log is NOT what decides this, the required task's state right now is.
 */
export declare class TaskOrphanedError extends DurableError {
    readonly taskId: string;
    readonly requiredTaskId: string;
    constructor(taskId: string, requiredTaskId: string);
}
/**
 * A task this one requires is in an unfinished prune (tombstone published, removal not finished or not provably
 * rolled back), or could not be examined right now. Nothing is run and NOTHING IS CANCELLED: the state is transient,
 * and the call can simply be repeated. Contrast `TaskOrphanedError`, which is final.
 */
export declare class RequiredTaskPendingError extends DurableError {
    readonly taskId: string;
    readonly requiredTaskId: string;
    readonly retryable = true;
    constructor(taskId: string, requiredTaskId: string);
}
export declare class RetentionRefusedError extends DurableError {
    readonly taskId: string;
    readonly why: string;
    constructor(taskId: string, why: string);
}
/** Why the prune decision register of a task cannot be trusted (Design A, section 20.4). */
export type PruneCorruptReason = 'register' | 'gap' | 'unknown-artifact' | 'commit-audit' | 'multiple-commit' | 'history' | 'task-dir-missing' | 'tombstone-without-commit' | 'legacy-tombstone-unmigrated';
/**
 * The persisted prune decision register of a task is corrupt, or the task directory is missing, or it is an
 * unmigrated legacy tombstone. Fail closed: nothing is deleted and nobody is cancelled; an operator decides.
 * Never mapped to `TaskOrphanedError`, `RetentionRefusedError` or a quarantine, and never retryable.
 * `published` is true when a write the caller made is already visible (the outcome of that write is unknown).
 */
export declare class PruneDecisionCorruptError extends DurableError {
    readonly taskId: string;
    readonly reason: PruneCorruptReason;
    readonly file: string | null;
    readonly attempt: number | null;
    readonly published: boolean;
    readonly retryable = false;
    constructor(taskId: string, reason: PruneCorruptReason, file?: string | null, attempt?: number | null, published?: boolean);
}
/** The attempt number would exceed `MAX_PRUNE_ATTEMPTS`. A liveness limit: numbers are never reused or reset. */
export declare class PruneAttemptLimitError extends DurableError {
    readonly taskId: string;
    readonly attempts: number;
    constructor(taskId: string, attempts: number);
}
export type StoreProtocolCode = 'PROTOCOL_NOT_INITIALIZED' | 'PROTOCOL_UNSUPPORTED' | 'PROTOCOL_STORE_NOT_EMPTY';
/**
 * The store does not carry a usable `durable-protocol.json`: it is uninitialized (read-only diagnostics only), has a
 * version this build does not understand, or cannot be initialized because it already holds tasks. The marker is
 * created only by an explicit operator action, never by opening the store.
 */
export declare class StoreProtocolError extends DurableError {
    readonly detailCode: StoreProtocolCode;
    constructor(message: string, detailCode: StoreProtocolCode);
}
//# sourceMappingURL=errors.d.ts.map