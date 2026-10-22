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
/**
 * Protective ceiling for `state.json` (SEC-001B.1) — NOT a retention policy.
 * Append-only checkpoints grow the file without bound; see STATE-001.
 * Enforced on read (bounded reader) and before an atomic write.
 */
export declare const MAX_STATE_BYTES: number;
export declare function stateFilePath(stateDir: string): string;
/**
 * Validate the shape of parsed JSON and return a typed, defensively-copied
 * CoordinatoriumState. Throws StateSchemaError for anything that does not
 * match a supported schema version — this function never "fixes" or
 * partially accepts malformed state.
 *
 * Supports exactly two on-disk shapes:
 * - `schemaVersion: 2` (current) — `tactical.checkpoints` is required.
 * - `schemaVersion: 1` (legacy, pre-COORDINATORIUM-002) — migrated
 *   in-memory to v2 on read (see `migrateV1ToV2`). Anything else
 *   (including a *newer* version this binary doesn't know about) is
 *   rejected outright — this is the deliberate fix for the compatibility
 *   gap an independent review found in the first COORDINATORIUM-002 cut:
 *   that cut kept `schemaVersion` at 1 while adding `tactical.checkpoints`,
 *   so an *older* binary (hardcoded to `schemaVersion === 1`, with no
 *   notion of checkpoints) could read a checkpoint-bearing v1-tagged file,
 *   reconstruct state from only the fields it knew about (`tactical: {
 *   missions }`, dropping checkpoints entirely — this function has never
 *   been a passthrough for unknown fields), and silently overwrite the
 *   file on its next mutateState call, destroying checkpoint history with
 *   no error raised. Bumping to 2 converts that silent data loss into a
 *   loud, immediate `StateSchemaError` for any reader that doesn't
 *   understand v2 — the version check below runs before anything is ever
 *   read into a mutable draft, so mutateState never reaches its write step
 *   (same proven pattern as the existing corrupted-JSON guard).
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