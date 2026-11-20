/**
 * Read-only, local, offline git signals for the freshness check
 * (SELF-AWARENESS-001, hardened in alpha.4 by A4-SEC-01/02).
 *
 * Contract:
 *  - Only `git log`, `git rev-list`, `git diff-tree`, `git rev-parse` and
 *    `git cat-file` are run; never a command that writes, never through a shell.
 *  - Offline: lazy fetch of missing objects (partial clones) is disabled
 *    (`GIT_NO_LAZY_FETCH=1`) and every transport is refused
 *    (`GIT_ALLOW_PROTOCOL=none`), so a missing object is an error here, never a
 *    download, an object-store write, or a program started from remote config.
 *    (`-c protocol.allow=never` alone was tested and does NOT stop a `file`
 *    promisor remote; it is kept only as an additional layer.)
 *  - Structural parsing: output that carries attacker-influenced text (commit
 *    subjects, file names) is never split on characters that text can contain.
 *    Records use NUL (`-z`), which neither a subject nor a path can contain;
 *    commit metadata and file lists come from separate commands; shas and dates
 *    are validated against strict patterns; the commit list is cross-checked
 *    against `git rev-list`. Anything unexpected is `GIT_OUTPUT_INVALID`.
 *  - Fail closed: every failure degrades to `{ status: 'unavailable' }`, which
 *    freshness turns into UNKNOWN. Git being absent, broken, refusing the
 *    directory or returning something unparseable never fails the brief and is
 *    never evidence of FRESH.
 */
import type { GitSignals } from './freshness.js';
/** Upper bound on commits read after the last state update. Hitting it marks the result truncated. */
export declare const MAX_COMMITS_SINCE = 500;
/** Largest blob `readBlobAt` will read; checked with `git cat-file -s` before the content is requested. */
export declare const MAX_BLOB_BYTES: number;
export declare const SAFE_CONFIG: string[];
export declare const SAFE_ENV: {
    GIT_OPTIONAL_LOCKS: string;
    GIT_TERMINAL_PROMPT: string;
    GIT_EXTERNAL_DIFF: string;
    /** git >= 2.44: a missing object is an error instead of a fetch from the promisor remote. */
    GIT_NO_LAZY_FETCH: string;
    /** Older git has no GIT_NO_LAZY_FETCH; refusing every transport stops the fetch itself. */
    GIT_ALLOW_PROTOCOL: string;
    /** State-document names come from config: never git pathspec magic. */
    GIT_LITERAL_PATHSPECS: string;
    /** Replace refs would change the history this check reports. */
    GIT_NO_REPLACE_OBJECTS: string;
};
export declare function isGitSha(s: string): boolean;
/**
 * @param targetDir project directory (git is run from here; paths are relative to it)
 * @param stateFiles state documents, relative to `targetDir`. Only existing ones need be passed.
 */
export declare function readGitSignals(targetDir: string, stateFiles: string[]): GitSignals;
/**
 * Contents of `relPath` (relative to `targetDir`) as of commit `sha`, or null
 * when the file does not exist there, is larger than `MAX_BLOB_BYTES`, is not
 * available locally (a partial clone's missing blob is NOT fetched) or cannot be
 * read. `git cat-file` only: read-only, no textconv, no shell. Used by KA-001 to
 * judge an idea registration as it was when the commit was made.
 */
export declare function readBlobAt(targetDir: string, sha: string, relPath: string): string | null;
//# sourceMappingURL=git-signals.d.ts.map