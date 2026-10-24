/**
 * Durable State — typed error taxonomy.
 *
 * Every error carries a stable `code`. Callers branch on `code`, never on
 * message text. No error message embeds event payloads or file contents
 * (payloads are application data and may be sensitive).
 */
export class DurableError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'DurableError';
        this.code = code;
    }
}
export class ValidationError extends DurableError {
    constructor(message) {
        super('VALIDATION', message);
        this.name = 'DurableValidationError';
    }
}
export class TaskNotFoundError extends DurableError {
    taskId;
    constructor(taskId) {
        super('TASK_NOT_FOUND', `task "${taskId}" does not exist.`);
        this.taskId = taskId;
        this.name = 'TaskNotFoundError';
    }
}
/** The task existed and was pruned by retention; only its tombstone remains. */
export class TaskPrunedError extends DurableError {
    taskId;
    constructor(taskId) {
        super('TASK_PRUNED', `task "${taskId}" was pruned by retention; only its tombstone remains.`);
        this.taskId = taskId;
        this.name = 'TaskPrunedError';
    }
}
export class TaskExistsError extends DurableError {
    taskId;
    constructor(taskId) {
        super('TASK_EXISTS', `task "${taskId}" already exists with different content.`);
        this.taskId = taskId;
        this.name = 'TaskExistsError';
    }
}
/** The task reached a terminal state; its log is sealed. */
export class TaskClosedError extends DurableError {
    taskId;
    status;
    constructor(taskId, status) {
        super('TASK_CLOSED', `task "${taskId}" is ${status}; its log is sealed.`);
        this.taskId = taskId;
        this.status = status;
        this.name = 'TaskClosedError';
    }
}
export class LeaseHeldError extends DurableError {
    taskId;
    owner;
    leaseUntil;
    constructor(taskId, owner, leaseUntil) {
        super('LEASE_HELD', `task "${taskId}" is leased by "${owner}" until ${leaseUntil}.`);
        this.taskId = taskId;
        this.owner = owner;
        this.leaseUntil = leaseUntil;
        this.name = 'LeaseHeldError';
    }
}
/**
 * A worker acted with an epoch/owner that is no longer current: someone else
 * claimed the task (fencing). The worker must stop; nothing was written.
 */
export class StaleFenceError extends DurableError {
    taskId;
    owner;
    epoch;
    currentEpoch;
    constructor(taskId, owner, epoch, currentEpoch) {
        super('STALE_FENCE', `"${owner}" (epoch ${epoch}) no longer holds task "${taskId}" (current epoch ${currentEpoch}).`);
        this.taskId = taskId;
        this.owner = owner;
        this.epoch = epoch;
        this.currentEpoch = currentEpoch;
        this.name = 'StaleFenceError';
    }
}
export class ContentionError extends DurableError {
    taskId;
    attempts;
    constructor(taskId, attempts) {
        super('CONTENTION', `gave up appending to task "${taskId}" after ${attempts} lost races.`);
        this.taskId = taskId;
        this.attempts = attempts;
        this.name = 'ContentionError';
    }
}
/** The log failed an integrity check (hash chain, sequence gap, schema). Fail closed; never auto-repaired. */
export class LogCorruptError extends DurableError {
    taskId;
    seq;
    reason;
    constructor(taskId, seq, reason) {
        super('LOG_CORRUPT', `log of task "${taskId}" is corrupt${seq === null ? '' : ` at seq ${seq}`}: ${reason}`);
        this.taskId = taskId;
        this.seq = seq;
        this.reason = reason;
        this.name = 'LogCorruptError';
    }
}
/** The log contains an event format/type this version does not know. Never skipped silently. */
export class LogUnsupportedError extends DurableError {
    taskId;
    seq;
    what;
    constructor(taskId, seq, what) {
        super('LOG_UNSUPPORTED', `log of task "${taskId}" has an unsupported ${what} at seq ${seq}; refusing to interpret it.`);
        this.taskId = taskId;
        this.seq = seq;
        this.what = what;
        this.name = 'LogUnsupportedError';
    }
}
export class LogTooLargeError extends DurableError {
    taskId;
    limit;
    constructor(taskId, limit) {
        super('LOG_TOO_LARGE', `task "${taskId}" reached the event limit (${limit}); continue the work in a new task (parentTaskId).`);
        this.taskId = taskId;
        this.limit = limit;
        this.name = 'LogTooLargeError';
    }
}
/** The filesystem layout is not what a managed store must look like (symlink, foreign hard link, special file). */
export class StoreSecurityError extends DurableError {
    detailCode;
    constructor(message, detailCode) {
        super('STORE_SECURITY', message);
        this.detailCode = detailCode;
        this.name = 'StoreSecurityError';
    }
}
export class StoreIoError extends DurableError {
    cause;
    constructor(message, cause) {
        super('STORE_IO', message);
        this.cause = cause;
        this.name = 'StoreIoError';
    }
}
/** An effect was announced but its outcome was never recorded (crash between intent and result). */
export class EffectInDoubtError extends DurableError {
    taskId;
    effectKey;
    constructor(taskId, effectKey) {
        super('EFFECT_IN_DOUBT', `effect "${effectKey}" of task "${taskId}" has an unrecorded outcome; reconcile it against the external system.`);
        this.taskId = taskId;
        this.effectKey = effectKey;
        this.name = 'EffectInDoubtError';
    }
}
export class EffectFailedError extends DurableError {
    taskId;
    effectKey;
    detail;
    constructor(taskId, effectKey, detail) {
        super('EFFECT_FAILED', `effect "${effectKey}" of task "${taskId}" failed permanently: ${detail}`);
        this.taskId = taskId;
        this.effectKey = effectKey;
        this.detail = detail;
        this.name = 'EffectFailedError';
    }
}
export class RetentionRefusedError extends DurableError {
    taskId;
    why;
    constructor(taskId, why) {
        super('RETENTION_REFUSED', `refusing to prune task "${taskId}": ${why}`);
        this.taskId = taskId;
        this.why = why;
        this.name = 'RetentionRefusedError';
    }
}
