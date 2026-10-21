/**
 * State Keeper — the single point of read/write access to state.json.
 *
 * Guarantees:
 * - Atomic persistence: writes land via write-temp-then-rename, so a reader
 *   never observes a partially written file.
 * - No lost updates: every mutation runs inside a cross-process lock (see
 *   lock.ts), read-modify-write, with a monotonic revision bump.
 * - Never silently overwrites corrupted or unsupported state: malformed
 *   JSON or a schema mismatch throws before anything is written.
 *
 * AI reports state; this module validates and persists it. It has no
 * knowledge of what a "mission" is — that belongs to mission.ts.
 */
import { type LockOptions } from './lock.js';
import { type CoordinatoriumState } from './types.js';
export declare const STATE_FILE_NAME = "state.json";
export declare function stateFilePath(stateDir: string): string;
/**
 * Validate the shape of parsed JSON and return a typed, defensively-copied
 * CoordinatoriumState. Throws StateSchemaError for anything that does not
 * match the v1 schema — this function never "fixes" or partially accepts
 * malformed state.
 */
export declare function validateState(raw: unknown): CoordinatoriumState;
/**
 * Read current state without taking a lock. If the file does not exist,
 * returns a fresh initial state WITHOUT persisting it — read paths never
 * have the side effect of creating state.json. Corrupted JSON or an
 * unsupported schema throws rather than being silently replaced.
 */
export declare function readState(stateDir: string): Promise<CoordinatoriumState>;
/**
 * Read-modify-write under an exclusive cross-process lock. `mutator`
 * receives a deep-cloned draft of the current state and an `applyResult`
 * callback to hand back an arbitrary value (e.g. the mission it just
 * created) alongside the write. The revision is incremented exactly once
 * per successful call, after the mutator returns.
 */
export declare function mutateState<T>(stateDir: string, mutator: (draft: CoordinatoriumState) => T, lockOptions?: LockOptions): Promise<{
    state: CoordinatoriumState;
    result: T;
}>;
//# sourceMappingURL=state-keeper.d.ts.map