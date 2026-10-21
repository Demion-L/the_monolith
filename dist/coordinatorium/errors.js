/**
 * Error taxonomy for the Coordinatorium State Keeper.
 *
 * Every error the state keeper or mission layer can throw is one of these.
 * The CLI maps all of them to a non-zero exit code; `code` exists so a
 * future caller (or a test) can distinguish failure classes without
 * string-matching messages.
 */
export class CoordinatoriumError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'CoordinatoriumError';
        this.code = code;
    }
}
export class StateCorruptedError extends CoordinatoriumError {
    constructor(message) {
        super('STATE_CORRUPTED', message);
        this.name = 'StateCorruptedError';
    }
}
export class StateSchemaError extends CoordinatoriumError {
    constructor(message) {
        super('STATE_SCHEMA_INVALID', message);
        this.name = 'StateSchemaError';
    }
}
export class LockTimeoutError extends CoordinatoriumError {
    constructor(message) {
        super('LOCK_TIMEOUT', message);
        this.name = 'LockTimeoutError';
    }
}
/**
 * Thrown when a lock (the primary `state.json.lock` or the internal
 * recovery mutex) could not be created — a staging-file open, metadata
 * write/fsync, or publish-link step failed. Never thrown for ordinary lock
 * contention (an already-existing canonical lock is not a failure, just a
 * reason to wait). The original fs error is preserved as `cause`/`causeCode`,
 * never masked.
 */
export class LockCreationError extends CoordinatoriumError {
    lockPath;
    phase;
    pid;
    nonce;
    timestamp;
    cleanedUp;
    cause;
    causeCode;
    constructor(params) {
        const causeCode = params.cause?.code;
        const causeMessage = params.cause instanceof Error ? params.cause.message : String(params.cause);
        const timestamp = new Date().toISOString();
        super('LOCK_CREATION_FAILED', `Failed to create lock at "${params.lockPath}" (phase: ${params.phase}` +
            `${causeCode ? `, cause: ${causeCode}` : ''}): ${causeMessage} ` +
            `[pid=${params.pid} nonce=${params.nonce} at=${timestamp} cleanedUp=${params.cleanedUp}]`);
        this.name = 'LockCreationError';
        this.lockPath = params.lockPath;
        this.phase = params.phase;
        this.pid = params.pid;
        this.nonce = params.nonce;
        this.timestamp = timestamp;
        this.cleanedUp = params.cleanedUp;
        this.cause = params.cause;
        this.causeCode = causeCode;
    }
}
export class MissionNotFoundError extends CoordinatoriumError {
    constructor(id) {
        super('MISSION_NOT_FOUND', `No mission found with id "${id}"`);
        this.name = 'MissionNotFoundError';
    }
}
export class InvalidTransitionError extends CoordinatoriumError {
    constructor(message) {
        super('INVALID_TRANSITION', message);
        this.name = 'InvalidTransitionError';
    }
}
export class ValidationError extends CoordinatoriumError {
    constructor(message) {
        super('VALIDATION_ERROR', message);
        this.name = 'ValidationError';
    }
}
/**
 * Thrown when a checkpoint is requested to be created against a mission
 * that exists but is not `in_progress` (COORDINATORIUM-002). Reading
 * checkpoints for such a mission is unaffected — only creation is blocked.
 */
export class MissionNotActiveError extends CoordinatoriumError {
    constructor(id, status) {
        super('MISSION_NOT_ACTIVE', `Mission "${id}" is not active (status: "${status}") — cannot create a checkpoint`);
        this.name = 'MissionNotActiveError';
    }
}
export class CheckpointNotFoundError extends CoordinatoriumError {
    constructor(id) {
        super('CHECKPOINT_NOT_FOUND', `No checkpoint found with id "${id}"`);
        this.name = 'CheckpointNotFoundError';
    }
}
