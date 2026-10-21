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
