/**
 * Durable State — typed error taxonomy.
 *
 * Every error carries a stable `code`. Callers branch on `code`, never on
 * message text. No error message embeds event payloads or file contents
 * (payloads are application data and may be sensitive).
 */
export type DurableErrorCode = 'VALIDATION' | 'TASK_NOT_FOUND' | 'TASK_PRUNED' | 'TASK_EXISTS' | 'TASK_CLOSED' | 'LEASE_HELD' | 'STALE_FENCE' | 'CONTENTION' | 'LOG_CORRUPT' | 'LOG_UNSUPPORTED' | 'LOG_TOO_LARGE' | 'STORE_SECURITY' | 'STORE_IO' | 'EFFECT_IN_DOUBT' | 'EFFECT_FAILED' | 'RETENTION_REFUSED';
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
export declare class StoreIoError extends DurableError {
    readonly cause?: unknown | undefined;
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
export declare class RetentionRefusedError extends DurableError {
    readonly taskId: string;
    readonly why: string;
    constructor(taskId: string, why: string);
}
//# sourceMappingURL=errors.d.ts.map