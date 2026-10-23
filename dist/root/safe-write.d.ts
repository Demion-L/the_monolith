/**
 * Safe write primitive (SEC-001B.2, ADR-012).
 *
 * The one code path that creates, replaces or removes project files. It adds,
 * for every write:
 *
 *  - an explicit WRITE BOUNDARY (`projectBoundary` / `trustedDirectoryBoundary`);
 *    there is no boundary-less write;
 *  - refusal of symlinks anywhere below the boundary, including symlinks that
 *    stay inside the project (W-SYM), of non-regular destinations (FIFO,
 *    device, directory) and of hardlinked destinations (`nlink > 1`);
 *  - a temp file opened `O_CREAT|O_EXCL|O_NOFOLLOW` (where the platform has
 *    `O_NOFOLLOW`) and published atomically: `rename()` over a regular file
 *    (`replaceFile`) or `link()` to a name that must not exist (`createFile`);
 *  - explicit PUBLICATION STATES. A failed write is NOT_PUBLISHED or UNKNOWN; a
 *    write that reached the final name is PUBLISHED and never throws. UNKNOWN is
 *    never retried and never silently downgraded;
 *  - identity-checked cleanup: only a temp file THIS call created, and only if
 *    the name still shows the `dev/ino` recorded from the descriptor.
 *
 * What this module does NOT do — and must not be described as doing: it does
 * not defend against a local actor who swaps directories or symlinks
 * concurrently with an operation (SEC-001B.3). `ParentRef` is a path plus a
 * `dev/ino` snapshot; re-checking it before an operation is a diagnostic
 * tripwire, not protection, because the operation resolves the path again.
 * Likewise the final `unlink` of an owned temp file cannot be made conditional
 * without `unlinkat`/dirfd: a name swapped between the identity check and the
 * unlink is a residual race.
 *
 * Platform: guarantees are stated for POSIX. Where `O_NOFOLLOW` or directory
 * fsync is missing (Windows) the checks that can still be done with
 * `lstat`/`fstat` are done, and a PLATFORM_BEST_EFFORT warning is returned.
 */
import * as fs from 'fs';
export type PublicationState = 'NOT_PUBLISHED' | 'PUBLISHED' | 'UNKNOWN';
export type WriteErrorCode = 'WRITE_SCOPE_REQUIRED' | 'WRITE_BOUNDARY_INVALID' | 'WRITE_OUTSIDE_BOUNDARY' | 'WRITE_PARENT_SYMLINK' | 'WRITE_PARENT_NOT_DIRECTORY' | 'WRITE_PARENT_MISSING' | 'WRITE_PARENT_CHANGED' | 'WRITE_TARGET_SYMLINK' | 'WRITE_TARGET_NOT_REGULAR' | 'WRITE_TARGET_EXISTS' | 'WRITE_TARGET_HARDLINKED' | 'WRITE_TMP_COLLISION' | 'WRITE_TOO_LARGE' | 'WRITE_READONLY' | 'WRITE_PERMISSION' | 'WRITE_NO_SPACE' | 'WRITE_FSYNC_FAILED' | 'WRITE_VERIFY_FAILED' | 'WRITE_LINK_UNSUPPORTED' | 'WRITE_PUBLICATION_UNKNOWN' | 'WRITE_FAILED';
export type WriteWarningCode = 'DIR_FSYNC_UNSUPPORTED' | 'DIR_FSYNC_FAILED' | 'STAGING_RESIDUE' | 'PUBLICATION_VERIFIED_AFTER_ERROR' | 'PLATFORM_BEST_EFFORT';
export interface WriteWarning {
    code: WriteWarningCode;
    message: string;
    path?: string;
}
/** What the caller asked to be fsynced. */
export type DurabilityRequest = 'full' | 'file' | 'none';
/** What was actually achieved. `unknown`: a directory fsync failed with an I/O error. */
export type DurabilityReached = 'full' | 'file' | 'none' | 'unknown';
export interface TempFileInfo {
    name: string;
    /** Ownership (successful `O_EXCL` create + recorded identity) is established. */
    owned: boolean;
    /** `true` removed/absent, `false` left in place, `null` not attempted. */
    removed: boolean | null;
}
export interface SafeWriteErrorInit {
    code: WriteErrorCode;
    phase: string;
    publication: 'NOT_PUBLISHED' | 'UNKNOWN';
    path: string;
    tmp?: TempFileInfo;
    cause?: unknown;
}
export declare class SafeWriteError extends Error {
    readonly code: WriteErrorCode;
    readonly phase: string;
    readonly publication: 'NOT_PUBLISHED' | 'UNKNOWN';
    readonly path: string;
    readonly tmp?: TempFileInfo;
    readonly cause?: unknown;
    constructor(message: string, init: SafeWriteErrorInit);
}
export interface WriteOutcome {
    publication: 'PUBLISHED';
    durability: DurabilityReached;
    warnings: WriteWarning[];
}
export interface PlatformCaps {
    /** `O_NOFOLLOW` exists. */
    noFollow: boolean;
    /** A directory can be opened and fsynced. */
    dirFsync: boolean;
    /** `process.geteuid` exists, so file ownership can be checked. */
    ownerCheck: boolean;
    /** Security guarantees of ADR-012 are stated for this platform. */
    posix: boolean;
}
export declare function detectPlatformCaps(): PlatformCaps;
/** The filesystem calls the primitive makes. Overridable ONLY by tests, for fault injection. */
export interface FsOps {
    openSync: typeof fs.openSync;
    writeSync: typeof fs.writeSync;
    fchmodSync: typeof fs.fchmodSync;
    fstatSync: typeof fs.fstatSync;
    fsyncSync: typeof fs.fsyncSync;
    closeSync: typeof fs.closeSync;
    renameSync: typeof fs.renameSync;
    linkSync: typeof fs.linkSync;
    unlinkSync: typeof fs.unlinkSync;
    lstatSync: typeof fs.lstatSync;
    mkdirSync: typeof fs.mkdirSync;
}
export declare const realFsOps: FsOps;
/** Test-only knobs; production callers never pass them. */
export interface InternalOptions {
    ops?: Partial<FsOps>;
    caps?: Partial<PlatformCaps>;
}
export type WriteScopeMode = 'project' | 'trusted-directory';
/**
 * Trust boundary of a write. Created only by `projectBoundary` /
 * `trustedDirectoryBoundary`. In both modes the ANCESTORS of the boundary are
 * trusted (in `project` mode: the root the user pointed at; in
 * `trusted-directory` mode: because the caller asserts it); every component
 * below the boundary is checked.
 */
export declare class WriteBoundary {
    private constructor();
    get mode(): WriteScopeMode;
    /** @internal */
    static create(mode: WriteScopeMode, dir: string): WriteBoundary;
}
/** Project scope: `projectRoot` is the boundary; target directories must lie inside it. */
export declare function projectBoundary(projectRoot: string): WriteBoundary;
/** Trusted-directory scope: the caller asserts `dir` and ALL its ancestors are trusted. */
export declare function trustedDirectoryBoundary(dir: string): WriteBoundary;
interface ParentData {
    path: string;
    dev: bigint;
    ino: bigint;
    boundary: WriteBoundary;
}
/**
 * A verified directory below a boundary. Opaque on purpose: code outside this
 * module must not read its path. Today it is a path with a `dev/ino` snapshot;
 * SEC-001B.3 may replace it with a directory descriptor. It is NOT a security
 * handle (see the module comment).
 */
export declare class ParentRef {
    private constructor();
    /** @internal */
    static create(data: ParentData): ParentRef;
}
export interface OpenParentOptions extends InternalOptions {
    /** Create missing directories (one `mkdir` per component, never `recursive`). */
    create?: boolean;
}
/**
 * Walk `dirAbs` below the boundary, `lstat`-ing every component: it must be a
 * real directory, never a symlink (W-SYM) — including a symlink that stays
 * inside the project. Missing components are created only with `create`.
 */
export declare function openParent(boundary: WriteBoundary, dirAbs: string, opts?: OpenParentOptions): ParentRef;
export type TargetProbe = {
    state: 'free';
    path: string;
} | {
    state: 'exists';
    path: string;
} | {
    state: 'symlink';
    path: string;
} | {
    state: 'special';
    path: string;
} | {
    state: 'parent-symlink';
    path: string;
} | {
    state: 'parent-not-directory';
    path: string;
} | {
    state: 'outside';
    path: string;
} | {
    state: 'unreadable';
    path: string;
    detail: string;
};
/**
 * Read-only: classify what is at `fileAbs` without writing. Missing parent
 * directories make the target `free` (they would be created). A dangling
 * symlink is a `symlink`, never `free`.
 */
export declare function probeTarget(boundary: WriteBoundary, fileAbs: string, opts?: InternalOptions): TargetProbe;
/** Proof that THIS call created the file: the identity recorded from the descriptor. */
export interface OwnedToken {
    readonly name: string;
    readonly dev: bigint;
    readonly ino: bigint;
}
export interface OwnedFile {
    fd: number;
    token: OwnedToken;
}
export type DisposeResult = 'removed' | 'absent' | 'not-owned' | 'failed';
/**
 * Create a brand-new file `name` in `parent`: `O_CREAT|O_EXCL|O_NOFOLLOW` at
 * `mode`. Success proves this call created it; its identity is recorded
 * immediately. If the identity cannot be recorded, ownership is NOT claimed:
 * the descriptor is closed, the file is left alone and the error says so.
 */
export declare function createExclusive(parent: ParentRef, name: string, mode: number, opts?: InternalOptions): OwnedFile;
/**
 * Remove `token`'s file iff the name still shows the recorded identity. Never
 * removes anything else. The unlink itself is not conditional (no `unlinkat`):
 * a name swapped between the check and the unlink is a residual race.
 */
export declare function disposeOwned(parent: ParentRef, token: OwnedToken, opts?: InternalOptions): DisposeResult;
export interface WriteOptions extends InternalOptions {
    /** Mode for a NEW file (`0o600` for state). With `exactMode: false` it is only the creation mode (umask applies). */
    mode: number;
    /** `fchmod` the file to exactly `mode` (default). Set `false` for documents that follow the umask. */
    exactMode?: boolean;
    /** `replaceFile` only: keep the mode (`& 0o777`) of an existing destination. Default `true`. */
    preserveMode?: boolean;
    /** `'full'` (default): fsync file and directory. `'file'`: file only. `'none'`. */
    durability?: DurabilityRequest;
    /** Refuse data larger than this. */
    maxBytes?: number;
}
export interface LinkPublishResult {
    outcome: 'published' | 'lost-race';
    warnings: WriteWarning[];
}
/**
 * Publish an owned, completely written and closed temp file under `finalName`
 * with `link()`, which fails if the name exists (symlink, FIFO or file alike).
 * `lost-race`: somebody else owns the name — nothing of ours was published
 * (the temp file is NOT removed here; the caller disposes it). Errors follow
 * the publication-state rules in the module comment.
 */
export declare function publishLink(parent: ParentRef, token: OwnedToken, finalName: string, opts?: InternalOptions): LinkPublishResult;
/**
 * Atomically replace `name` in `parent` (or create it if absent): temp file ->
 * fsync -> `rename`. The destination must be absent or a regular file with a
 * single link; its mode is kept unless `preserveMode: false`. Throws
 * `SafeWriteError` (NOT_PUBLISHED / UNKNOWN); once published it never throws.
 */
export declare function replaceFile(parent: ParentRef, name: string, data: string | Buffer, opts: WriteOptions): WriteOutcome;
/**
 * Create `name` in `parent` without ever overwriting: temp file -> fsync ->
 * `link()`, then the temp name is removed. The final name never shows a
 * partially written file. A destination that exists in any form (file,
 * symlink, FIFO, ...) is refused. Failures after the link succeeded are
 * warnings (`STAGING_RESIDUE`, directory fsync), never errors.
 */
export declare function createFile(parent: ParentRef, name: string, data: string | Buffer, opts: WriteOptions): WriteOutcome;
/**
 * Print a post-publication finding as one `warning` line (stderr by default).
 * The platform note is printed once per process, however many files are written.
 * Never throws: the write it reports on is already published.
 */
export declare function reportWriteWarning(warning: WriteWarning, print?: (line: string) => void): void;
/** Test-only: forget that the platform note was printed. */
export declare function resetWriteWarningState(): void;
export {};
//# sourceMappingURL=safe-write.d.ts.map