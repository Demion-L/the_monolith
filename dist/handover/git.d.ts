/**
 * Read-only git signals for verification freshness (ACCOUNTABILITY-001).
 *
 * Same safe-git posture as `brief/git-signals.ts` (no pager, no external diff, no lazy fetch, no
 * helper programs, no shell, nothing written). Every failure degrades to "unknown": a missing git,
 * a non-repository or unparseable output is never evidence of anything.
 */
export interface GitView {
    /** False when git is missing, the directory is not a repository, or git failed. */
    available: boolean;
    /** Full HEAD sha; null when unavailable or the repository has no commit yet. */
    head: string | null;
    /** Tracked or untracked changes outside the excluded paths; null when it could not be determined. */
    dirty: boolean | null;
    /** Number of changed entries (bounded by git's output); null when unknown. */
    dirtyEntries: number | null;
}
/** HEAD and working-tree cleanliness of the repository containing `projectRoot`. */
export declare function readGitView(projectRoot: string, excludeRels?: string[]): GitView;
/**
 * Paths changed between two revisions, outside the excluded paths. `null` when either revision is
 * not a known commit (e.g. a different clone) — the caller must treat that as "cannot tell".
 */
export declare function changedBetween(projectRoot: string, from: string, to: string, excludeRels?: string[]): string[] | null;
//# sourceMappingURL=git.d.ts.map