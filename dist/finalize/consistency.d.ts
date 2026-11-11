/**
 * Consistency assessment of the state documents around a finalization (FIN-002).
 *
 * `finalize` writes a fixed, small set of documents (story-index.md, active.md,
 * and whatever the owner listed in `docUpdates` / HANDOFF). It deliberately does
 * NOT write roadmap-index.md, so a roadmap row that still says IN PROGRESS for
 * the story that was just finalized used to survive a successful `apply`
 * unnoticed. This module reports such disagreements; it never edits anything
 * and never changes the outcome of the operation.
 *
 * It reuses `findContradictions()` of `monolith brief` — the single definition
 * of "state documents disagree" — and feeds it the text the documents have (or
 * will have, for a plan) after finalization. Four things are kept apart:
 *   - operation success            → plan/apply `status` (unchanged)
 *   - managed documents            → written by this finalization
 *   - external documents           → not written by it; remediation is advice only
 *   - completeness of the evidence → NOT_VERIFIED when a document cannot be read
 */
export type ConsistencyStatus = 'CONSISTENT' | 'INCONSISTENT' | 'NOT_VERIFIED';
export interface ConsistencyFinding {
    message: string;
    /** State documents (file names) that disagree. */
    documents: string[];
    /** The subset of `documents` that this finalization does not write. */
    externalDocuments: string[];
    /** What a person can do; MONOLITH does not do it. */
    remediation: string;
}
export interface ConsistencyAssessment {
    status: ConsistencyStatus;
    /** true: computed from the texts a pending plan would write; false: read from disk. */
    projected: boolean;
    findings: ConsistencyFinding[];
    /** Why the check could not be completed (NOT_VERIFIED). */
    notVerified: string[];
    /** What this check does not cover. */
    scope: string;
}
export interface ConsistencyInput {
    /** Text of each state document as it is / will be; null = missing or unreadable. */
    active: string | null;
    roadmap: string | null;
    storyIndex: string | null;
    /** Project-relative paths this finalization writes (or has written). */
    writtenPaths: string[];
    projected: boolean;
    /** The MONOLITH root (project-relative); documents are matched by their full canonical path. */
    managedRoot?: string;
}
export declare function assessConsistency(input: ConsistencyInput): ConsistencyAssessment;
//# sourceMappingURL=consistency.d.ts.map