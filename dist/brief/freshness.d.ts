/**
 * Project State Freshness (SELF-AWARENESS-001).
 *
 * `Completeness` says whether the brief lost data while being rendered.
 * `Freshness` says whether the recorded project state can still be trusted.
 * They are independent: `Completeness: COMPLETE` + `Freshness: STALE` is a
 * valid combination, and nothing here ever changes `Completeness`.
 *
 * `evaluateFreshness()` is pure: it takes already-gathered evidence and
 * returns a verdict. Git is a signal, never the only source of truth:
 *
 *   STALE    only on a concrete, named discrepancy — either the state
 *            documents contradict each other, or git history references
 *            work items that no state document mentions.
 *   FRESH    only on positive evidence — git is readable, the last state
 *            update is located, and every commit after it either touches
 *            only the state documents or belongs to a recorded work item.
 *   UNKNOWN  everything else. Git activity alone, an old date alone, or the
 *            absence of an active story alone never produce STALE, and the
 *            absence of an active story never means "project complete".
 */
export type FreshnessStatus = 'FRESH' | 'STALE' | 'UNKNOWN';
export type FreshnessReasonCode = 'STATE_CONTRADICTION' | 'UNRECORDED_WORK' | 'GIT_UNAVAILABLE' | 'STATE_NOT_IN_GIT' | 'GIT_HISTORY_TRUNCATED' | 'UNATTRIBUTED_ACTIVITY' | 'NO_ACTIVITY_SINCE_STATE_UPDATE' | 'ACTIVITY_RECORDED';
export interface FreshnessReason {
    code: FreshnessReasonCode;
    message: string;
    /** STATE_CONTRADICTION only: the state documents (by file name) that disagree. */
    documents?: string[];
}
/** One commit after the last state update, as seen by git. */
export interface GitCommitSignal {
    sha: string;
    /** ISO-8601 committer date. Informational only — never compared with "now". */
    date: string;
    subject: string;
    /** Paths changed by the commit, relative to the project directory. Empty for plain merges. */
    files: string[];
}
export type GitUnavailableReason = 'GIT_NOT_INSTALLED' | 'NOT_A_GIT_REPOSITORY' | 'GIT_FAILED';
export type GitSignals = {
    status: 'unavailable';
    reason: GitUnavailableReason;
} | {
    status: 'ok';
    /** The newest commit that touched any state document; null if none ever did. */
    lastStateUpdate: {
        sha: string;
        date: string;
    } | null;
    /** Commits reachable from HEAD but not from `lastStateUpdate`, newest first. */
    commitsSince: GitCommitSignal[];
    /** True when git history was cut at the read limit — the picture is partial. */
    truncated: boolean;
};
export type StoryClaim = {
    kind: 'none';
} | {
    kind: 'ids';
    ids: string[];
} | {
    kind: 'unknown';
};
export interface FreshnessEvidence {
    git: GitSignals;
    /** What `active.md` says is current. `unknown` when the file/section is unreadable or says nothing parseable. */
    activeStory: StoryClaim;
    /** What `roadmap-index.md` says is the active story ("Active Story: ..."), or null if the line is absent. */
    roadmapActiveStory: string | null;
    /** Work-item status by id as declared by roadmap-index.md and story-index.md (uppercased status). */
    roadmapStatuses: ReadonlyMap<string, string>;
    storyIndexStatuses: ReadonlyMap<string, string>;
    /** Concatenated text of the state documents that were readable; used to decide whether an id is "recorded". */
    recordedText: string;
    /** Repo-relative-to-project paths that are state documents (their own commits are not "activity"). */
    stateFiles: ReadonlySet<string>;
}
export interface FreshnessResult {
    status: FreshnessStatus;
    reasons: FreshnessReason[];
    /** Human-readable, single-line warnings (never fatal). */
    warnings: string[];
    recommendation: string;
    activeStory: 'none-recorded' | 'recorded' | 'unknown';
    lastStateUpdate: {
        sha: string;
        date: string;
    } | null;
    /** Commits after the last state update that touched something other than state documents. */
    activityCount: number | null;
    /** Work-item ids seen in git after the last state update and absent from every state document. */
    unrecordedWork: string[];
}
export declare function extractWorkItemIds(text: string): string[];
export declare function mentionsId(text: string, id: string): boolean;
/** Interprets the `## Current Story` excerpt of active.md. */
export declare function parseActiveStoryClaim(excerpt: string | null): StoryClaim;
/** `Active Story: <text>` line of roadmap-index.md. */
export declare function parseRoadmapActiveStory(content: string): string | null;
/** Table rows `| id | title | STATUS | date |` of roadmap-index.md. */
export declare function parseRoadmapStatuses(content: string): Map<string, string>;
/** `### [STORY ]<id> — title` followed by `**Status:** X` in story-index.md. */
export declare function parseStoryIndexStatuses(content: string): Map<string, string>;
export declare function evaluateFreshness(ev: FreshnessEvidence): FreshnessResult;
//# sourceMappingURL=freshness.d.ts.map