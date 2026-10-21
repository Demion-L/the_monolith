/**
 * Error taxonomy for the Coordinatorium State Keeper.
 *
 * Every error the state keeper or mission layer can throw is one of these.
 * The CLI maps all of them to a non-zero exit code; `code` exists so a
 * future caller (or a test) can distinguish failure classes without
 * string-matching messages.
 */
export type CoordinatoriumErrorCode = 'STATE_CORRUPTED' | 'STATE_SCHEMA_INVALID' | 'LOCK_TIMEOUT' | 'LOCK_CREATION_FAILED' | 'MISSION_NOT_FOUND' | 'INVALID_TRANSITION' | 'VALIDATION_ERROR';
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
/**
 * The phase of the create/publish protocol (`lock.ts`'s `createAndPublish`)
 * that failed. `staging-cleanup` is reported only via `cleanedUp: false` on
 * whichever phase actually failed (cleanup is always best-effort and never
 * itself the primary reason for a throw); it is listed here so the taxonomy
 * names every step of the protocol, not because it is a distinct throw site.
 */
export type LockCreationPhase = 'staging-open' | 'metadata-write' | 'metadata-fsync' | 'publish-link' | 'staging-cleanup';
export interface LockCreationErrorParams {
    lockPath: string;
    phase: LockCreationPhase;
    pid: number;
    nonce: string;
    /** Whether this process's own staging file was successfully removed
     * (or was already gone) after the failure. */
    cleanedUp: boolean;
    /** The original fs error (e.g. ENOSPC/EIO), or whatever else was thrown. */
    cause: unknown;
}
/**
 * Thrown when a lock (the primary `state.json.lock` or the internal
 * recovery mutex) could not be created — a staging-file open, metadata
 * write/fsync, or publish-link step failed. Never thrown for ordinary lock
 * contention (an already-existing canonical lock is not a failure, just a
 * reason to wait). The original fs error is preserved as `cause`/`causeCode`,
 * never masked.
 */
export declare class LockCreationError extends CoordinatoriumError {
    readonly lockPath: string;
    readonly phase: LockCreationPhase;
    readonly pid: number;
    readonly nonce: string;
    readonly timestamp: string;
    readonly cleanedUp: boolean;
    readonly cause: unknown;
    readonly causeCode: string | undefined;
    constructor(params: LockCreationErrorParams);
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