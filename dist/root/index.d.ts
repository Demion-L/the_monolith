/**
 * Single source of truth for where a MONOLITH instance lives (SEC-001A).
 *
 * Policy (ADR-009):
 *  - `monolithRoot` is a RELATIVE path strictly INSIDE the project root.
 *  - Absent config file, or absent `monolithRoot` key → documented default
 *    `.monolith`. A config file that EXISTS but cannot be used (unreadable,
 *    invalid JSON, not an object) or a `monolithRoot` that is present but not
 *    a non-empty string → configuration error (never silently defaulted).
 *  - Absolute paths, any `..` segment, and a root that normalizes to the
 *    project root itself are rejected. (`..` is rejected even when it would
 *    lexically stay inside: the kernel resolves `a/..` through `a`, so a
 *    symlinked `a` makes lexical and real resolution diverge.)
 *  - Every existing component of the path must resolve (realpath) inside
 *    the real project root; dangling symlinks and symlink loops fail closed.
 *  - Violations throw RootContainmentError — callers never fall back.
 *
 * This module only reads (lstat/realpath/open+read). It never creates
 * anything. Check-then-use (TOCTOU) races are NOT closed here; see ADR-009,
 * ADR-011 and ADR-013 (the unified safe read contract implemented below).
 *
 * It also hosts the bounded project-file helpers (`checkProjectFile`,
 * `readProjectFile`, SEC-002) used for root-level files such as
 * `project.definition.mjs`, `monolith.config.json` and `AGENTS.md`, which
 * live next to — not below — `monolithRoot`.
 */
export declare const DEFAULT_MONOLITH_ROOT = ".monolith";
export declare const CONFIG_FILE_NAME = "monolith.config.json";
export type RootErrorCode = 'ROOT_INVALID_TYPE' | 'ROOT_EMPTY' | 'ROOT_ABSOLUTE' | 'ROOT_TRAVERSAL' | 'ROOT_IS_PROJECT_ROOT' | 'ROOT_SYMLINK_ESCAPE' | 'ROOT_UNRESOLVABLE' | 'ROOT_CONFIG_INVALID';
export declare class RootContainmentError extends Error {
    readonly code: RootErrorCode;
    constructor(code: RootErrorCode, message: string);
}
export type ConfigRead = {
    status: 'absent';
} | {
    status: 'ok';
    cfg: Record<string, unknown>;
} | {
    status: 'unreadable' | 'invalid-json' | 'not-object';
    detail: string;
};
/** Read `monolith.config.json` without interpreting `monolithRoot`. */
export declare function readConfigFile(targetDir: string): ConfigRead;
/**
 * Lexical validation. Returns the normalized root: `/`-joined segments with
 * empty and `.` segments removed. Throws RootContainmentError otherwise.
 */
export declare function normalizeMonolithRoot(value: unknown): string;
export interface ResolvedMonolithRoot {
    /** Absolute, lexical project root (`resolve(targetDir)`). */
    projectRoot: string;
    /** Real (symlink-free) project root. */
    projectRootReal: string;
    /** Validated relative root, `/`-separated, never empty. */
    monolithRoot: string;
    /** `projectRoot` + `monolithRoot`. Not realpath'd, so display paths stay stable. */
    rootAbs: string;
    source: 'config' | 'default';
}
/** Validate a root value against a project directory (no config read). */
export declare function resolveMonolithRootValue(targetDir: string, value: unknown): ResolvedMonolithRoot;
/**
 * Resolve the instance root for `targetDir`. Pass an already-read config
 * (`readConfigFile`) to avoid reading twice. Only an ABSENT config file yields
 * the default root; an existing but unusable one throws ROOT_CONFIG_INVALID
 * (fail closed) so a broken config can never redirect writes to `.monolith`.
 */
export declare function resolveMonolithRoot(targetDir: string, config?: ConfigRead): ResolvedMonolithRoot;
/**
 * Verify a fixed file below the instance root (state.json, active.md,
 * state.json.lock, ...) against the real project root, so a symlinked file
 * or a symlinked intermediate directory cannot redirect I/O outside.
 * Returns the lexical absolute path. `relFromRoot` must be trusted/fixed.
 */
export declare function assertContainedFile(root: ResolvedMonolithRoot, relFromRoot: string): string;
/** Non-throwing variant for read paths that report diagnostics. */
export declare function checkContainedFile(root: ResolvedMonolithRoot, relFromRoot: string): RootContainmentError | null;
/** Upper bound for any file this module inspects or reads (1 MiB). */
export declare const MAX_PROJECT_FILE_BYTES: number;
export type ProjectFileErrorCode = 'FILE_MISSING' | 'FILE_OUTSIDE_PROJECT' | 'FILE_UNRESOLVABLE' | 'FILE_NOT_REGULAR' | 'FILE_EMPTY' | 'FILE_TOO_LARGE' | 'FILE_CHANGED' | 'FILE_UNREADABLE' | 'FILE_SYMLINK' | 'FILE_HARDLINKED' | 'READ_BOUNDARY_INVALID' | 'READ_UNSUPPORTED_PLATFORM';
/**
 * Codes that mean "the file system layout is not what a MONOLITH-managed file
 * must look like" — as opposed to missing, empty, oversized or a transient
 * replacement. A caller may want to surface these differently from an I/O fault.
 */
export declare const READ_SECURITY_CODES: readonly ProjectFileErrorCode[];
export declare function isReadSecurityViolation(code: ProjectFileErrorCode): boolean;
export interface ProjectFileOptions {
    /** Size cap in bytes. Defaults to MAX_PROJECT_FILE_BYTES. */
    maxBytes?: number;
    /** Accept a zero-byte file. Defaults to false. */
    allowEmpty?: boolean;
}
/**
 * Options of the unified reader. `boundary` is mandatory and explicit: an
 * absolute directory whose ANCESTORS (and the directory itself) are trusted —
 * the project root the user pointed at, or, for a caller that says so, the
 * directory that holds the file. Every component below it is checked.
 */
export interface BoundedReadOptions extends ProjectFileOptions {
    boundary: string;
    /**
     * @internal Test seam: the `open(2)` flags the platform provides. Omitted in
     * production (taken from `fs.constants`). A missing flag makes the read fail
     * closed with READ_UNSUPPORTED_PLATFORM.
     */
    platformFlags?: {
        noFollow?: number;
        nonBlock?: number;
    };
    /** @internal Test seam: runs between the `lstat` walk and the `open`, so a test can swap the file deterministically. */
    afterInspect?: () => void;
}
export type ProjectFileCheck = {
    ok: true;
    path: string;
    size: number;
} | {
    ok: false;
    code: ProjectFileErrorCode;
    detail: string;
};
export type ProjectFileRead = {
    ok: true;
    path: string;
    size: number;
    content: string;
} | {
    ok: false;
    code: ProjectFileErrorCode;
    detail: string;
};
/**
 * The unified safe read (SEC-001B.1-R). One policy for every MONOLITH-managed
 * file; there is no permissive variant. Order matters:
 *  1. platform capabilities (`O_NOFOLLOW`, `O_NONBLOCK`) — absent → fail closed;
 *  2. explicit boundary: `abs` and `boundary` must be absolute (never the cwd),
 *     the boundary must be a directory, `abs` must lie strictly below it;
 *  3. `lstat` of EVERY component below the boundary: none may be a symlink
 *     (inside the project or not, dangling or not); the last must be a regular
 *     file with a single link — decided BEFORE `open`, so a FIFO/device/socket
 *     is never opened;
 *  4. `open` with `O_NOFOLLOW|O_NONBLOCK|O_NOCTTY`;
 *  5. `fstat` on the descriptor: still a regular file, same `dev/ino` as step 3,
 *     still one link, size within bounds — all before any content is read;
 *  6. optional read of at most `maxBytes + 1` bytes (the cap applies to bytes
 *     actually read); the descriptor is always closed.
 * Steps 3 and 4 are separate syscalls: this does NOT defend against a local
 * actor swapping a directory or file between them (dynamic TOCTOU, SEC-001B.3).
 * The identity check detects a swap of the FILE only. `label` is for diagnostics.
 * A file replaced between `lstat` and `open` is FILE_CHANGED (transient,
 * retryable), not a fault.
 */
export declare function readBoundedFile(abs: string, label: string, opts: BoundedReadOptions, wantContent: boolean): ProjectFileRead | ProjectFileCheck;
/**
 * `readBoundedFile`, retried across the two states MONOLITH's own writers pass
 * through (neither is a fault): the file is atomically replaced under us
 * (FILE_CHANGED, `rename`), or it has a second link for an instant
 * (FILE_HARDLINKED: a lock is published by `link()`ing its staging file and
 * the staging name is removed right after, SEC-001B.2). After the retries the
 * result is reported as it is — a link that stays is refused, never accepted.
 * Same policy, same options.
 */
export declare function readBoundedFileStable(abs: string, label: string, opts: BoundedReadOptions, wantContent: boolean): ProjectFileRead | ProjectFileCheck;
/**
 * Static check of a file below the PROJECT root (not `monolithRoot`) under the
 * unified read policy: exists, no symlink in any component below the root,
 * regular file with one link, non-empty (unless `allowEmpty`) and within
 * `maxBytes`. The content is never read.
 */
export declare function checkProjectFile(projectRoot: string, relPath: string, opts?: ProjectFileOptions): ProjectFileCheck;
/** `checkProjectFile` plus a bounded UTF-8 read of the content. */
export declare function readProjectFile(projectRoot: string, relPath: string, opts?: ProjectFileOptions): ProjectFileRead;
export { SafeWriteError, WriteBoundary, ParentRef, projectBoundary, trustedDirectoryBoundary, openParent, boundaryPathOf, probeTarget, createExclusive, disposeOwned, publishLink, createFile, replaceFile, detectPlatformCaps, reportWriteWarning, resetWriteWarningState, } from './safe-write.js';
export { findWriteArtifacts, describeWriteArtifacts } from './write-artifacts.js';
export type { WriteArtifact, WriteArtifactKind } from './write-artifacts.js';
export type { PublicationState, WriteErrorCode, WriteWarning, WriteWarningCode, WriteScopeMode, WriteOptions, WriteOutcome, DurabilityRequest, DurabilityReached, TargetProbe, OwnedToken, OwnedFile, DisposeResult, PlatformCaps, TempFileInfo, LinkPublishResult, FsOps, } from './safe-write.js';
//# sourceMappingURL=index.d.ts.map