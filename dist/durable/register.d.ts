/**
 * The persisted prune decision register: record formats and the pure derivation of the prune state.
 *
 * Design A (docs/architecture/DURABLE-PRUNE-PROTOCOL-DESIGN-004.md, sections 5, 19, 20, 32, 37, 41; ADR-019).
 * This module does no I/O of its own. `derivePruneState` is a function of the names in the task directory and of what
 * `RegisterIO` returns for them, so its decisions can be tested with injected partial listings and I/O errors
 * without a filesystem. It never writes, never deletes and never repairs.
 *
 * Every verdict is fail-closed: `corrupt`, `unreadable`, `missing` and `legacy` never grant an irreversible action,
 * and a missing name is never read as permission to delete anything (section 37, "absence of information is not
 * permission").
 */
import { MAX_PRUNE_ATTEMPTS, type DecisionBy, type PruneOutcome, type PruneState, type Tombstone } from './types.js';
export { MAX_PRUNE_ATTEMPTS };
/** Re-checks of the register by a writer that has published a file (Design A, section 24.2). */
export declare const MAX_WRITE_RESOLVE = 3;
/** A register record is tiny; anything larger is refused before it is read. */
export declare const MAX_REGISTER_BYTES: number;
export declare const REGISTER_FORMAT_VERSION = 2;
/**
 * Staging files of the write primitive: `<name>.tmp.<pid>.<hex16>`. The ONE definition: the filesystem store uses it
 * for its own temp names too (Design A, section 20.2, N1), so the register can never mistake a staging file for a record.
 */
export declare const STAGING_RE: RegExp;
export declare const TOMBSTONE_FILE = "tombstone.json";
export declare const PROTOCOL_MARKER_FILE = "durable-protocol.json";
export declare const prepareFile: (n: number) => string;
export declare const decisionFile: (n: number) => string;
export interface PrepareRecord {
    v: 2;
    attempt: number;
    tombstone: Tombstone;
    check: string;
}
export type DecisionRecord = {
    v: 2;
    attempt: number;
    outcome: 'abort';
    by?: DecisionBy;
    check: string;
} | {
    v: 2;
    attempt: number;
    outcome: 'commit';
    tombstone: Tombstone;
    migrated?: true;
    legacySha256?: string;
    check: string;
};
/** SHA-256 of the canonical serialization of every other field: a guard against accidental damage, not against an adversary. */
export declare function checkOf(record: object): string;
export declare function encodePrepare(attempt: number, tombstone: Tombstone): string;
export declare function encodeDecision(attempt: number, outcome: PruneOutcome, tombstone: Tombstone | undefined, by: DecisionBy | undefined): string;
/** The `tombstone.json` file published from a commit. Same content, any reader of the v1 format understands it. */
export declare function encodeTombstone(tombstone: Tombstone): string;
/** Closed schema of a v1 tombstone. `null` when it is anything else. */
export declare function asTombstone(v: unknown, taskId: string): Tombstone | null;
/** Same tombstone, whatever the key order. */
export declare const sameTombstone: (a: Tombstone, b: Tombstone) => boolean;
/**
 * What reading one file gave. `bad` is a PRESENT file that is not a valid record (damage, an unknown schema, a symlink,
 * a special file) — evidence. `ioerr` is "the value is unknown" (EIO, EACCES, EMFILE): never evidence of anything.
 */
export type Obs<T> = {
    k: 'ok';
    v: T;
} | {
    k: 'absent';
} | {
    k: 'bad';
    reason: string;
} | {
    k: 'ioerr';
    reason: string;
};
export declare function parsePrepare(text: string, n: number, taskId: string): Obs<PrepareRecord>;
export declare function parseDecision(text: string, n: number, taskId: string): Obs<DecisionRecord>;
/** `tombstone.json` is the v1 format and is written by older code with its own key order: parse leniently, validate strictly. */
export declare function parseTombstoneFile(text: string, taskId: string): Obs<Tombstone>;
/**
 * Reads for `derivePruneState`. Each returns an observation of ONE name in the task directory; a name that is not there
 * is `absent`. The caller maps its filesystem errors to `ioerr` (never to `absent`) and a refused file (symlink, special
 * file, wrong size) to `bad`.
 */
export interface RegisterIO {
    prepare(n: number): Obs<PrepareRecord>;
    decision(n: number): Obs<DecisionRecord>;
    tombstone(): Obs<Tombstone>;
}
/**
 * The state of a task's register.
 *
 * `names` is ONE directory listing of `tasks/<id>/` (not an atomic snapshot: a name created during the listing may be
 * missing from it). `io` reads individual files. A verdict that rests only on names that were NOT in the listing is
 * not given without looking those names up (section 32.3); if the lookup finds the names the verdict is recomputed, if
 * every one is confirmed absent it stands with `basis: 'lookup'`, and if anything cannot be confirmed the answer is
 * `unreadable` — never a guess.
 */
export declare function derivePruneState(names: readonly string[], io: RegisterIO, maxAttempts?: number): PruneState;
//# sourceMappingURL=register.d.ts.map