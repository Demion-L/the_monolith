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
 * This module only reads (lstat/realpath/readFile). It never creates
 * anything. Check-then-use (TOCTOU) races are NOT closed here; see ADR-009.
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
//# sourceMappingURL=index.d.ts.map