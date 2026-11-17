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
import { type WriteWarning } from '../root/index.js';
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
 * Where a write may land (SEC-001B.2, ADR-012). There is no default and no
 * plain-string form: the caller states which trust model applies.
 *
 *  - `project`: `projectRoot` is the boundary. `stateDir` must lie inside it and
 *    no component below the root may be a symlink (even one that stays inside).
 *  - `trusted-directory`: the caller asserts that `stateDir` AND ALL ITS
 *    ANCESTORS are trusted. Nothing about the ancestors is checked (so a
 *    symlinked `.monolith` is invisible in this mode); only what lies below
 *    `stateDir` is. A missing `stateDir` is created.
 *
 * `onWarning` receives non-fatal findings reported after a successful publish
 * (durability downgrade, platform note, ...). It is called once per warning,
 * after the state lock has been released; an exception it throws is ignored and
 * never affects the result. Without it they are only returned by `mutateState`.
 */
export type StateWriteTarget = {
    scope: 'project';
    projectRoot: string;
    stateDir: string;
    onWarning?: (warning: WriteWarning) => void;
} | {
    scope: 'trusted-directory';
    stateDir: string;
    onWarning?: (warning: WriteWarning) => void;
};
/** Project-scoped write target (the CLI always uses this). */
export declare function projectTarget(projectRoot: string, stateDir: string, onWarning?: (warning: WriteWarning) => void): StateWriteTarget;
/** Trusted-directory write target: `stateDir` and its ancestors are asserted trusted by the caller. */
export declare function trustedDirectoryTarget(stateDir: string, onWarning?: (warning: WriteWarning) => void): StateWriteTarget;
/**
 * Where a read may look (SEC-001B.1-R). Same shape and same scopes as a write
 * target, minus `onWarning`; there is no default and no plain-string form. A
 * `StateWriteTarget` is accepted as is.
 */
export type StateReadTarget = {
    scope: 'project';
    projectRoot: string;
    stateDir: string;
} | {
    scope: 'trusted-directory';
    stateDir: string;
};
/**
 * Validate the shape of parsed JSON and return a typed, defensively-copied
 * CoordinatoriumState. Throws StateSchemaError for anything that does not
 * match the current schema — this function never "fixes", migrates or
 * partially accepts anything. An older (or newer) `schemaVersion` is rejected
 * outright, so a read-modify-write can never reach its write step and replace
 * a file this binary does not understand (NO LEGACY: BETA-020).
 */
export declare function validateState(raw: unknown): CoordinatoriumState;
/**
 * Read current state without taking a lock. If the file does not exist,
 * returns a fresh initial state WITHOUT persisting it — read paths never
 * have the side effect of creating state.json. Corrupted JSON or an
 * unsupported schema throws rather than being silently replaced.
 */
export declare function readState(target: StateReadTarget): Promise<CoordinatoriumState>;
/**
 * Read-modify-write under an exclusive cross-process lock. `mutator`
 * receives a deep-cloned draft of the current state and an `applyResult`
 * callback to hand back an arbitrary value (e.g. the mission it just
 * created) alongside the write. The revision is incremented exactly once
 * per successful call, after the mutator returns.
 */
export declare function mutateState<T>(target: StateWriteTarget, mutator: (draft: CoordinatoriumState) => T, lockOptions?: LockOptions): Promise<{
    state: CoordinatoriumState;
    result: T;
    warnings: WriteWarning[];
}>;
export interface ReplaceDecision {
    /** The complete state to publish. The caller has validated it; its `revision` is used as given. */
    state: CoordinatoriumState;
    /** Keep a byte-exact copy of the current file under this name (same directory) before replacing it. */
    backupName: string | null;
}
/**
 * Replace the whole state file under the same exclusive lock and the same safe
 * write path as `mutateState` — for `monolith state adopt` only. Unlike
 * `mutateState` it does NOT require the current file to be a valid current-schema
 * state (an incompatible or corrupt destination is exactly what an adoption may
 * have to replace), so it hands the raw bytes to `decide` instead.
 *
 * Order: read raw -> `decide` (may throw: nothing written) -> backup (if asked;
 * a failed backup aborts before the destination is touched) -> atomic replace ->
 * read back and compare. A mismatch after publication throws, and the backup
 * still exists.
 */
export declare function replaceStateUnderLock(target: StateWriteTarget, decide: (current: {
    raw: string | null;
}) => ReplaceDecision, lockOptions?: LockOptions): Promise<{
    state: CoordinatoriumState;
    backupPath: string | null;
    warnings: WriteWarning[];
}>;
//# sourceMappingURL=state-keeper.d.ts.map