/**
 * State Reconciliation Report (SELF-AWARENESS-002).
 *
 * SELF-AWARENESS-001 says *whether* the recorded state looks outdated. This
 * module says *what* the evidence is and *what a human should check*. It is
 * pure: it takes the same `FreshnessEvidence` / `FreshnessResult` that
 * `brief` already computed, reads nothing and writes nothing.
 *
 * Two rules shape every line of the report:
 *   - A git commit is not evidence that a work item is complete, and a work-item
 *     id in a commit subject is not evidence that its recorded status is right.
 *     The report therefore only ever says "referenced" and "not mentioned",
 *     never "done" or "missing from the roadmap because it was finished".
 *   - Recommendations are things for a person to verify or decide. Nothing here
 *     edits a document or concludes anything on the person's behalf.
 *
 * Findings are graded:
 *   confirmed  a concrete, checkable discrepancy (documents contradict each other,
 *              or git names a work item that no state document mentions)
 *   suspected  something that may be a discrepancy but cannot be shown from the data
 *   unknown    the evidence needed to decide is missing (no git, truncated history, ...)
 */
import { type FreshnessEvidence, type FreshnessResult, type FreshnessStatus } from './freshness.js';
export type FindingKind = 'confirmed' | 'suspected' | 'unknown';
export type FindingCode = 'STATE_CONTRADICTION' | 'UNRECORDED_WORK' | 'UNATTRIBUTED_ACTIVITY' | 'ACTIVITY_WITHOUT_ACTIVE_STORY' | 'GIT_UNAVAILABLE' | 'STATE_NOT_IN_GIT' | 'GIT_HISTORY_TRUNCATED' | 'ACTIVE_STORY_UNKNOWN';
export interface ReconciliationFinding {
    kind: FindingKind;
    code: FindingCode;
    summary: string;
    /** Short, checkable pointers: document names or `<sha7> <subject>`. */
    evidence: string[];
}
export interface UntrackedWorkItem {
    id: string;
    /** Newest first, at most `MAX_COMMITS_PER_ITEM`. */
    commits: {
        sha: string;
        subject: string;
    }[];
    totalCommits: number;
}
export interface ReviewDocument {
    path: string;
    reasons: string[];
}
export interface ReconciliationReport {
    freshness: FreshnessStatus;
    lastStateUpdate: {
        sha: string;
        date: string;
    } | null;
    findings: ReconciliationFinding[];
    /** Work-item ids git references after the last state update that no state document mentions. Sorted. */
    untrackedWork: UntrackedWorkItem[];
    /** Ids git references that some state document mentions. Mentioned is not correct. Sorted. */
    mentionedWork: string[];
    documents: ReviewDocument[];
    limitations: string[];
    actions: string[];
}
export declare const MAX_COMMITS_PER_ITEM = 3;
export declare function reconcile(ev: FreshnessEvidence, result: FreshnessResult): ReconciliationReport;
export interface RenderedReconciliation {
    text: string;
    /** True when a section was dropped to fit the budget. */
    truncated: boolean;
}
/**
 * Deterministic, bounded text. The header (freshness) and the closing
 * "No files were modified." are mandatory and never dropped; the sections in
 * between are added in priority order while they fit, and an omission is
 * always announced.
 */
export declare function renderReconciliation(report: ReconciliationReport, maxChars: number): RenderedReconciliation;
//# sourceMappingURL=reconcile.d.ts.map