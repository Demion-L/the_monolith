/**
 * `monolith handover check` — report contract (ACCOUNTABILITY-001, Phase 5).
 *
 * A projection of facts Core already owns (read model, governance check, Story State Resolver, Development
 * History, ADR reader) plus verification evidence. It stores nothing and defines no new document. The JSON
 * form of this interface is the stable contract: fields are only ever added.
 *
 * Reading rules the report never breaks:
 *  - a finished mission does not mean a finalized story;
 *  - REPORTED evidence is not VERIFIED;
 *  - no finding does not mean the project is correct;
 *  - the status is about reviewability, never "production ready".
 */
import type { GovernanceResult } from '../governance/types.js';
export type EvidenceProvenance = 'REPORTED' | 'OBSERVED';
export type EvidenceResult = 'pass' | 'fail';
/**
 * - REVISION_MATCH:       recorded revision equals HEAD (or only evidence files changed since), clean at record time and now.
 * - REVISION_MATCH_DIRTY: revision matches but the tree was or is dirty — the result may not describe the current files.
 * - POTENTIALLY_STALE:    HEAD moved with non-evidence changes since the check ran.
 * - UNKNOWN:              no git, no recorded revision, an unreachable revision, or unknown tree state.
 * A revision match never proves the check is still meaningful; it only says the committed files are the same.
 */
export type Freshness = 'REVISION_MATCH' | 'REVISION_MATCH_DIRTY' | 'POTENTIALLY_STALE' | 'UNKNOWN';
export type FreshnessReason = 'HEAD_MATCH_CLEAN' | 'HEAD_MATCH_EVIDENCE_ONLY_CHANGES' | 'DIRTY_AT_RECORD' | 'DIRTY_NOW' | 'HEAD_CHANGED' | 'NO_GIT' | 'NO_RECORDED_REVISION' | 'REVISION_UNREACHABLE' | 'TREE_STATE_UNKNOWN';
/** Evidence level shown to the owner. VERIFIED exists only as a computed verdict, never on disk. */
export type EvidenceLevel = 'VERIFIED' | 'REPORTED' | 'STALE' | 'UNKNOWN' | 'FAILED';
export declare const HANDOVER_SCHEMA = 1;
/**
 * - READY_FOR_REVIEW:   every source was readable and nothing needs attention before a human reviews it.
 * - REVIEW_WITH_ISSUES: reviewable, but the report lists issues (governance findings, failed/stale evidence,
 *                       unverified completions, unfinished or failed missions).
 * - INCOMPLETE:         a core source is missing or unreadable, so the picture has holes.
 * - UNKNOWN:            the instance could not be established at all.
 */
export type HandoverStatus = 'READY_FOR_REVIEW' | 'REVIEW_WITH_ISSUES' | 'INCOMPLETE' | 'UNKNOWN';
export interface HandoverStory {
    id: string;
    /** Which authoritative documents say what, kept apart (never collapsed into one status). */
    planned: 'PLANNED' | 'NOT_LISTED' | 'UNKNOWN';
    active: 'ACTIVE' | 'NOT_ACTIVE' | 'UNKNOWN';
    finalization: 'FINALIZED' | 'LISTED_NOT_FINAL' | 'NOT_FINALIZED' | 'UNKNOWN';
    /** Status text of the story-index entry, verbatim (REPORTED by the document); null when none. */
    indexStatus: string | null;
    consistency: 'CONSISTENT' | 'INCOMPLETE' | 'CONFLICT';
    missions: {
        total: number;
        inProgress: number;
        completed: number;
        failed: number;
        cancelled: number;
    };
    evidence: {
        verified: number;
        reported: number;
        stale: number;
        unknown: number;
        failed: number;
    };
}
export interface HandoverMissionRef {
    id: string;
    title: string;
    storyId: string | null;
    checkpointCount: number;
}
export interface HandoverEvidenceItem {
    id: string;
    storyId: string | null;
    command: string;
    result: EvidenceResult;
    provenance: EvidenceProvenance;
    level: EvidenceLevel;
    freshness: Freshness;
    freshnessReason: FreshnessReason;
    recordedAt: string;
    gitHead: string | null;
    dirty: boolean | null;
    /** Project-relative source file. */
    source: string;
}
export interface HandoverIssue {
    /** Fixed code. */
    code: string;
    /** `conflict` = documents contradict each other; `unverified` = a claim without verifying evidence; `attention` = the rest. */
    kind: 'conflict' | 'unverified' | 'attention';
    message: string;
    /** Where the basis can be inspected (project-relative path or a command), so the owner can trace it. */
    basis: string | null;
}
export interface HandoverOwnerDecision {
    code: 'FINALIZE_STORY' | 'ADR_PROPOSED' | 'RESOLVE_CONFLICT';
    subject: string;
    message: string;
    basis: string;
}
export interface HandoverReport {
    schema: typeof HANDOVER_SCHEMA;
    status: HandoverStatus;
    /** Why the status is what it is (fixed codes), so a verdict is never opaque. */
    statusReasons: string[];
    project: {
        name: string | null;
        activePhase: {
            kind: 'none' | 'not_declared' | 'phase' | 'unmatched' | 'ambiguous' | 'unknown';
            id: string | null;
        };
        currentStory: {
            kind: 'none' | 'ids' | 'unknown';
            ids: string[];
        };
        governance: {
            result: GovernanceResult | 'NOT_CHECKED';
            errors: number;
            warnings: number;
        };
    };
    progress: {
        planned: number;
        active: number;
        finalized: number;
        listedNotFinal: number;
        /** Only stories whose story-index entry itself says READY FOR REVIEW. */
        awaitingReview: string[];
        unknown: number;
        stories: HandoverStory[];
        storiesTruncated: boolean;
    };
    missions: {
        total: number;
        inProgress: number;
        completed: number;
        failed: number;
        cancelled: number;
        checkpoints: number;
        orphanCheckpoints: number;
        withoutStoryLink: number;
        activeWithoutCheckpoint: HandoverMissionRef[];
        failedMissions: HandoverMissionRef[];
        active: HandoverMissionRef[];
        truncated: boolean;
    };
    architecture: {
        available: boolean;
        total: number;
        accepted: number;
        proposed: number;
        /** Any other declared status, verbatim, with counts. */
        other: {
            status: string;
            count: number;
        }[];
        /** Files under docs/adr that could not be listed (wrong name, no/ malformed frontmatter, ...). */
        unrecognized: number;
        missingMetadata: number;
        complete: boolean;
    };
    verification: {
        git: {
            available: boolean;
            head: string | null;
            dirty: boolean | null;
        };
        counts: {
            verified: number;
            reported: number;
            stale: number;
            unknown: number;
            failed: number;
        };
        items: HandoverEvidenceItem[];
        unreadableRecords: number;
        recordsTruncated: boolean;
        /** Stories with at least one completed mission and no VERIFIED evidence. */
        storiesWithoutVerifiedEvidence: string[];
    };
    outstanding: {
        issues: HandoverIssue[];
        ownerDecisions: HandoverOwnerDecision[];
    };
    /** Project-relative sources or commands this report was built from. */
    sources: string[];
    /** Fixed statements about what this report does not establish. */
    limitations: string[];
}
//# sourceMappingURL=types.d.ts.map