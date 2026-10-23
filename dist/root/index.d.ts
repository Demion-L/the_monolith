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
 * anything. Check-then-use (TOCTOU) races are NOT closed here; see ADR-009
 * and ADR-011.
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
export type ProjectFileErrorCode = 'FILE_MISSING' | 'FILE_OUTSIDE_PROJECT' | 'FILE_UNRESOLVABLE' | 'FILE_NOT_REGULAR' | 'FILE_EMPTY' | 'FILE_TOO_LARGE' | 'FILE_CHANGED' | 'FILE_UNREADABLE';
export interface ProjectFileOptions {
    /** Size cap in bytes. Defaults to MAX_PROJECT_FILE_BYTES. */
    maxBytes?: number;
    /** Accept a zero-byte file. Defaults to false. */
    allowEmpty?: boolean;
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
 * Steps 2-6 of `openProjectFile`, for a path whose containment the caller has
 * already established (or does not need to: e.g. a lock file next to
 * `state.json`, whose directory was resolved through `resolveMonolithRoot`).
 * `label` is only used in diagnostics. A file replaced between `stat` and
 * `open` is reported as FILE_CHANGED (transient, retryable), not as a fault.
 */
export declare function readBoundedFile(abs: string, label: string, opts: ProjectFileOptions, wantContent: boolean): ProjectFileRead | ProjectFileCheck;
/**
 * `readBoundedFile`, retried while the file is atomically replaced under us
 * (FILE_CHANGED). For readers that race a rename-based writer or a lock
 * release/re-acquire: those are normal, not faults. After the retries it
 * still reports FILE_CHANGED rather than guessing.
 */
export declare function readBoundedFileStable(abs: string, label: string, opts: ProjectFileOptions, wantContent: boolean): ProjectFileRead | ProjectFileCheck;
/**
 * Static check of a file below the PROJECT root (not `monolithRoot`): exists,
 * stays inside the project (symlinks that stay inside are allowed), is a
 * regular file, is non-empty (unless `allowEmpty`) and within `maxBytes`.
 * The content is never read. `relPath` is `/`-separated and must be trusted/fixed.
 */
export declare function checkProjectFile(projectRoot: string, relPath: string, opts?: ProjectFileOptions): ProjectFileCheck;
/** `checkProjectFile` plus a bounded UTF-8 read of the content. */
export declare function readProjectFile(projectRoot: string, relPath: string, opts?: ProjectFileOptions): ProjectFileRead;
export { SafeWriteError, WriteBoundary, ParentRef, projectBoundary, trustedDirectoryBoundary, openParent, probeTarget, createExclusive, disposeOwned, publishLink, createFile, replaceFile, detectPlatformCaps, reportWriteWarning, resetWriteWarningState, } from './safe-write.js';
export type { PublicationState, WriteErrorCode, WriteWarning, WriteWarningCode, WriteScopeMode, WriteOptions, WriteOutcome, DurabilityRequest, DurabilityReached, TargetProbe, OwnedToken, OwnedFile, DisposeResult, PlatformCaps, TempFileInfo, LinkPublishResult, FsOps, } from './safe-write.js';
//# sourceMappingURL=index.d.ts.map