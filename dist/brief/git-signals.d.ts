/**
 * Read-only git signals for the freshness check (SELF-AWARENESS-001).
 *
 * Runs only `git log` and `git rev-parse`, never a command that writes, never
 * through a shell, with config that could launch helper programs switched off.
 * Any failure degrades to `{ status: 'unavailable' }` — git being absent,
 * broken or refusing the directory must never fail the brief.
 */
import type { GitSignals } from './freshness.js';
/** Upper bound on commits read after the last state update. Hitting it marks the result truncated. */
export declare const MAX_COMMITS_SINCE = 500;
/**
 * @param targetDir project directory (git is run from here; paths are relative to it)
 * @param stateFiles state documents, relative to `targetDir`. Only existing ones need be passed.
 */
export declare function readGitSignals(targetDir: string, stateFiles: string[]): GitSignals;
/**
 * Contents of `relPath` (relative to `targetDir`) as of commit `sha`, or null
 * when the file does not exist there or cannot be read. `git cat-file blob`
 * only: read-only, no textconv, no shell. Used by KA-001 to judge an idea
 * registration as it was when the commit was made.
 */
export declare function readBlobAt(targetDir: string, sha: string, relPath: string): string | null;
//# sourceMappingURL=git-signals.d.ts.map