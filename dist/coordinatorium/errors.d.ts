/**
 * Error taxonomy for the Coordinatorium State Keeper.
 *
 * Every error the state keeper or mission layer can throw is one of these.
 * The CLI maps all of them to a non-zero exit code; `code` exists so a
 * future caller (or a test) can distinguish failure classes without
 * string-matching messages.
 */
export type CoordinatoriumErrorCode = 'STATE_CORRUPTED' | 'STATE_SCHEMA_INVALID' | 'LOCK_TIMEOUT' | 'MISSION_NOT_FOUND' | 'INVALID_TRANSITION' | 'VALIDATION_ERROR';
export declare class CoordinatoriumError extends Error {
    readonly code: CoordinatoriumErrorCode;
    constructor(code: CoordinatoriumErrorCode, message: string);
}
export declare class StateCorruptedError extends CoordinatoriumError {
    constructor(message: string);
}
export declare class StateSchemaError extends CoordinatoriumError {
    constructor(message: string);
}
export declare class LockTimeoutError extends CoordinatoriumError {
    constructor(message: string);
}
export declare class MissionNotFoundError extends CoordinatoriumError {
    constructor(id: string);
}
export declare class InvalidTransitionError extends CoordinatoriumError {
    constructor(message: string);
}
export declare class ValidationError extends CoordinatoriumError {
    constructor(message: string);
}
//# sourceMappingURL=errors.d.ts.map