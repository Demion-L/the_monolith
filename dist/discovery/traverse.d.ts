/**
 * Bounded, safe project traversal (DISCOVERY-001B-1, ADR-021).
 *
 * Lists the directory tree of a project and nothing else: it never reads file
 * content, never writes, never runs project code and never touches the network.
 * It is the only code in Discovery that lists directories.
 *
 * What it does:
 *  - lists each directory through `opendir` + `Dir#readSync` (never `readdirSync`),
 *    one open handle at a time, so a hostile directory cannot be loaded whole before
 *    a cap applies; the handle is always closed (`finally`);
 *  - never follows a symlink (it is listed as kind `symlink` and counted; its target is
 *    never looked at); FIFOs, sockets and devices are listed as `other`, never opened;
 *  - excludes the real `<monolithRoot>` (resolved with `resolveMonolithRoot`, not by
 *    the literal name `.monolith`), a fixed list of dependency/build directories, nested
 *    repositories (a directory holding `.git`) and directories on another file system;
 *  - bounds the work and the retained result: directory entries READ (every listing counts,
 *    including the one of a directory later found to be unreadable, replaced or opaque),
 *    entries per directory, depth, wall-clock time and the UTF-8 bytes of the retained
 *    paths; every bound that fires yields `PARTIAL` with a typed diagnostic, never a
 *    silent cut. A nested repository is recognised by one `lstat` of `<dir>/.git` BEFORE
 *    the directory is listed, so its content is neither read nor counted;
 *  - is deterministic for an unchanged tree: names are ordered by UTF-16 code units
 *    (never `localeCompare`), breadth-first, and the result is sorted before it is
 *    returned. No clock value, absolute path or `readdir` order reaches the result.
 *
 * What it does NOT do (ADR-013, SEC-001B.3 open; TM-C unsupported): it does not prevent
 * and does not reliably detect a process that replaces a directory (e.g. with a symlink)
 * while the walk runs. The window runs from the `lstat` that queues a directory until
 * the walk has listed it, i.e. the breadth-first distance in between. Comparing the
 * identity (`dev`/`ino`) of a directory before and after listing it (`DIR_CHANGED`) may
 * notice SOME replacements; a replacement that is put back before the second `lstat`
 * goes unnoticed, and names read from the substitute can then appear as COMPLETE.
 * Do not run it on a tree an untrusted process is modifying.
 *
 * Root: `projectRoot` must be absolute and is the caller's explicit choice. A symlink as
 * root is accepted and its target is walked (nothing below the root is ever followed, so
 * the boundary is the directory the caller named). A missing, non-directory, unreadable
 * or otherwise unresolvable root throws `ROOT_UNSAFE` (from `resolveMonolithRoot`, before
 * any listing); `ROOT_NOT_DIRECTORY` is the defensive second check. Errors other than a
 * root-containment error from `resolveMonolithRoot` propagate unchanged.
 *
 * Nested MONOLITH instances: only the actual `<monolithRoot>` is excluded. A sub-project
 * that has its own `.monolith` stays part of the inventory (its sources belong to this
 * project); that directory is not recognised by name. Excluding the confirmed internals
 * of nested instances is a decision for DISCOVERY-001B-2.
 *
 * The time budget is checked between entries; a synchronous syscall that hangs in the
 * kernel (e.g. a dead network mount) is not interrupted.
 */
import { type Dirent } from 'fs';
export type TraversalEntryKind = 'file' | 'directory' | 'symlink' | 'other';
export interface TraversalEntry {
    /** Project-relative, `/`-separated; never absolute, never contains `..`. */
    path: string;
    kind: TraversalEntryKind;
}
export interface TraversalLimits {
    /**
     * Directory entries READ from the file system in total, across every listing (included in
     * the result or not); see `LIMIT_ENTRIES`. A listing is charged for the entries it read,
     * so a directory that does not fit in the remaining budget is not enumerated.
     */
    maxEntries: number;
    /** A directory with more entries than this is opaque (not enumerated). */
    maxEntriesPerDir: number;
    /** Deepest path (in segments) that is listed; a directory at this depth is not entered. */
    maxDepth: number;
    /** Wall-clock budget in milliseconds (monotonic). */
    deadlineMs: number;
    /**
     * Total UTF-8 bytes of the paths kept in `entries` (`Buffer.byteLength`, checked before an
     * entry is added; see `LIMIT_PATH_BYTES`). It bounds the retained path text, not the memory
     * of the process: JS strings, entry objects and the queue add overhead proportional to
     * `maxEntries`, and the figure is a proxy for heap use (about one byte per ASCII character).
     */
    maxPathBytes: number;
}
/** Starting values (ADR-021 Q-10); validated by the 001B-1 benchmark, see the story report. */
export declare const DEFAULT_TRAVERSAL_LIMITS: Readonly<TraversalLimits>;
/** Directories never entered, matched by name at any depth. */
export declare const EXCLUDED_DIR_NAMES: readonly string[];
/** Directories never entered, matched by project-relative path. */
export declare const EXCLUDED_DIR_PATHS: readonly string[];
/**
 * Closed list. `affectsCompleteness` codes make the result PARTIAL (something inside
 * the declared scope could not be done). The others report the scope policy.
 * An unknown code is treated as affecting completeness (fail closed).
 */
declare const DIAGNOSTIC_AFFECTS_COMPLETENESS: {
    readonly LIMIT_ENTRIES: true;
    readonly LIMIT_DEPTH: true;
    readonly LIMIT_DIR_ENTRIES: true;
    readonly LIMIT_DEADLINE: true;
    readonly LIMIT_PATH_BYTES: true;
    readonly DIR_UNREADABLE: true;
    readonly DIR_VANISHED: true;
    readonly DIR_CHANGED: true;
    readonly DIR_ERROR: true;
    readonly NAME_UNREPRESENTABLE: true;
    readonly ENTRY_UNCLASSIFIED: true;
    readonly EXCLUDED_DIR: false;
    readonly MONOLITH_ROOT_EXCLUDED: false;
    readonly SYMLINK_SKIPPED: false;
    readonly NESTED_REPO_SKIPPED: false;
    readonly MOUNT_SKIPPED: false;
};
export type TraversalDiagnosticCode = keyof typeof DIAGNOSTIC_AFFECTS_COMPLETENESS;
export interface TraversalDiagnostic {
    code: TraversalDiagnosticCode;
    /** Project-relative path, when the diagnostic concerns one. */
    path?: string;
    /** Total occurrences, present on the summary line of a code that exceeded the listed paths. */
    count?: number;
    message: string;
}
export interface TraversalStats {
    /** Entries included in `entries`. */
    entries: number;
    files: number;
    directories: number;
    symlinks: number;
    other: number;
    /** Directory entries read from the file system by all listings (the figure `maxEntries` bounds). */
    examined: number;
    /** UTF-8 bytes of the paths in `entries` (the figure `maxPathBytes` bounds). */
    pathBytes: number;
    /** Directories whose contents were listed. */
    listedDirectories: number;
}
export interface TraversalResult {
    /** `PARTIAL` as soon as something inside the declared scope could not be done. */
    completeness: 'COMPLETE' | 'PARTIAL';
    /**
     * `true` when a second walk of the same, unchanged tree with the same limits would return
     * this exact result. It is `false` when any diagnostic whose cause is not a function of the
     * tree alone was recorded: the time budget (`LIMIT_DEADLINE`), a tree that changed or a
     * transient failure (`DIR_CHANGED`, `DIR_VANISHED`, `DIR_ERROR`) or an entry whose type
     * could not be determined (`ENTRY_UNCLASSIFIED`). It is not a synonym of `COMPLETE`: a
     * walk cut by a deterministic limit is `PARTIAL` and still reproducible. It is a statement
     * about the result, not a guarantee about a tree that changes during the walk.
     */
    reproducible: boolean;
    limits: TraversalLimits;
    stats: TraversalStats;
    /** Sorted by `path` in UTF-16 code-unit order. */
    entries: TraversalEntry[];
    /** Sorted: completeness-affecting first, then by code, path, message. */
    diagnostics: TraversalDiagnostic[];
}
export type TraversalErrorCode = 'INVALID_LIMITS' | 'ROOT_UNSAFE' | 'ROOT_NOT_DIRECTORY' | 'UNSUPPORTED_PLATFORM';
/** The traversal cannot start or cannot be trusted; no result exists (FAILED). */
export declare class TraversalError extends Error {
    readonly code: TraversalErrorCode;
    constructor(code: TraversalErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
export interface TraversalDirHandle {
    readSync(): Dirent | null;
    closeSync(): void;
}
export interface TraversalIdentity {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    dev: bigint;
    ino: bigint;
}
export interface TraversalFs {
    opendir(path: string): TraversalDirHandle;
    lstat(path: string): TraversalIdentity;
    stat(path: string): TraversalIdentity;
}
export interface TraverseOptions {
    limits?: Partial<TraversalLimits>;
    /** @internal Test seam. */
    fs?: TraversalFs;
    /** @internal Test seam: monotonic milliseconds. */
    now?: () => number;
    /** @internal Test seam: the `open(2)` flags the platform provides. */
    platformFlags?: {
        noFollow?: number;
        nonBlock?: number;
    };
}
/**
 * Walk the project at `projectRoot` and return its structure.
 *
 * `projectRoot` is the explicit, caller-resolved project directory (for the CLI: `cwd`).
 * The instance root is resolved with `resolveMonolithRoot` and excluded. Throws
 * `TraversalError` when the walk cannot start or be trusted; otherwise returns a
 * result that says whether it is `COMPLETE` or `PARTIAL`.
 */
export declare function traverseProject(projectRoot: string, options?: TraverseOptions): TraversalResult;
export {};
//# sourceMappingURL=traverse.d.ts.map