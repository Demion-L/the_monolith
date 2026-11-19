/**
 * Story State Resolver (ARCH-002B) — one read-only view of what the state documents
 * say about ONE story.
 *
 * Principle: SINGLE AUTHORITY PER FACT. Planned, Active and Finalized are three
 * independent facts, each with one authoritative source:
 *
 *   Planned story    → roadmap-index.md (phase story tables under `## Phases`)
 *   Active story     → active.md `## Current Story` (structural `**Story:**` field)
 *   Finalized story  → story-index.md (structured entries)
 *   Active phase     → roadmap-index.md `## Current Focus` (not resolved here)
 *   Finalization evidence → Story capsule (referenced by path, never read here)
 *   Execution history / tech debt → their own append-only / registry documents (out of scope)
 *
 * The resolver keeps the three facts apart and checks that they are logically
 * compatible. It does NOT compute a single "status": a story that is planned,
 * active and finalized at once is reported as a CONFLICT, never collapsed.
 *
 * Contract:
 *  - Pure, deterministic, synchronous. No I/O, no Git, no network, no LLM, no writes.
 *  - Reuses Core's parsers (`parseActiveStoryClaim`, `parseRoadmapPhases`,
 *    `parseStoryIndex`, `parseRoadmapActiveStory`, `parseRoadmapStatuses`) and the
 *    single definition of "done" (`isDone`). No second parser of these documents.
 *  - A missing / unreadable / unparseable source is UNKNOWN, never "the story does
 *    not exist". Absence from a document is only `absent` when that document was
 *    read and recognised in full.
 *  - Legacy roadmap fields (`Active Story:`, status columns in story tables) are never
 *    a normative source of the Active Story; they only produce `LEGACY_*` drift
 *    diagnostics when they explicitly contradict the authoritative state.
 *  - Diagnostics are fixed codes plus short, clipped, project-relative provenance.
 */
import type { StoryPhaseRef, StructuredRoadmapView, StructuredStoryIndexView } from './types.js';
/**
 * The document texts the resolver reads. `null` = the document is missing or could not
 * be read (the caller's reader already classified why). Paths are project-relative
 * labels used for provenance only.
 */
export interface StorySources {
    /** active.md */
    active: string | null;
    /** roadmap-index.md */
    roadmap: string | null;
    /** story-index.md */
    storyIndex: string | null;
}
/** Parsed documents, built once and reused for any number of stories. */
export interface StoryAuthorityContext {
    readonly sources: {
        active: SourceState;
        roadmap: SourceState;
        storyIndex: SourceState;
    };
    readonly activeClaim: ActiveClaim;
    readonly roadmap: StructuredRoadmapView | null;
    readonly storyIndex: StructuredStoryIndexView | null;
    readonly roadmapRows: readonly RoadmapRow[];
    readonly roadmapActiveStoryLine: string | null;
}
export type SourceState = 'available' | 'missing' | 'unrecognized' | 'partial';
type ActiveClaim = {
    kind: 'none';
} | {
    kind: 'ids';
    ids: string[];
} | {
    kind: 'unknown';
    contradiction: boolean;
} | {
    kind: 'unavailable';
};
interface RoadmapRow {
    storyId: string;
    /** Phase id of the enclosing `### Phase <id>` section; null if the section id is unusable. */
    phaseId: string | null;
    /** Legacy status column, verbatim (uppercased). Never authoritative. */
    legacyStatus: string;
}
export type Provenance = {
    document: 'active.md' | 'roadmap-index.md' | 'story-index.md';
    locator: string;
};
export type PlanningFact = {
    state: 'PLANNED';
    entries: {
        phaseId: string | null;
        provenance: Provenance;
    }[];
} | {
    state: 'NOT_LISTED';
} | {
    state: 'UNKNOWN';
};
export type ActiveFact = {
    state: 'ACTIVE';
    provenance: Provenance;
} | {
    state: 'NOT_ACTIVE';
    claimedIds: string[] | null;
    provenance: Provenance;
} | {
    state: 'UNKNOWN';
    reason: 'DOCUMENT_UNAVAILABLE' | 'CLAIM_UNPARSEABLE' | 'CLAIM_SELF_CONTRADICTORY';
};
export interface FinalizationEntry {
    /** Status as the document reports it (verbatim); null when missing/empty/self-contradicting. */
    status: string | null;
    /** True only for a status Core treats as done (COMPLETED / DONE). */
    finalized: boolean;
    title: string | null;
    date: string | null;
    phase: StoryPhaseRef;
    provenance: Provenance;
}
export type FinalizationFact = {
    state: 'FINALIZED';
    entries: FinalizationEntry[];
}
/** Present in story-index.md, but no entry carries a done status. */
 | {
    state: 'LISTED_NOT_FINAL';
    entries: FinalizationEntry[];
} | {
    state: 'NOT_FINALIZED';
} | {
    state: 'UNKNOWN';
};
export type PhaseAssociation = 
/** Exactly one phase is supported by the evidence. */
{
    state: 'RESOLVED';
    phaseId: string;
    evidence: Provenance[];
}
/** Evidence points at several phases or at a phase that cannot be matched. */
 | {
    state: 'AMBIGUOUS';
    candidates: string[];
}
/** No evidence at all, or the evidence is unverifiable. */
 | {
    state: 'UNKNOWN';
};
export type StoryConsistency = 'CONSISTENT' | 'INCOMPLETE' | 'CONFLICT';
export type StoryDiagnosticCode = 'ACTIVE_AND_FINALIZED' | 'FINALIZATION_RECORDS_CONFLICT' | 'PHASE_EVIDENCE_CONFLICT' | 'ACTIVE_CLAIM_SELF_CONTRADICTORY' | 'ACTIVE_SOURCE_UNAVAILABLE' | 'ROADMAP_SOURCE_UNAVAILABLE' | 'STORY_INDEX_SOURCE_UNAVAILABLE' | 'ACTIVE_CLAIM_UNPARSEABLE' | 'PHASE_ASSOCIATION_AMBIGUOUS' | 'PHASE_ASSOCIATION_UNVERIFIED' | 'FINALIZATION_STATUS_UNREADABLE' | 'FINALIZATION_RECORD_DUPLICATED' | 'LISTED_NOT_FINAL' | 'LEGACY_ROADMAP_STATUS_DRIFT' | 'LEGACY_ROADMAP_ACTIVE_STORY_DRIFT' | 'LEGACY_ROADMAP_ACTIVE_STORY_IGNORED';
export interface StoryDiagnostic {
    code: StoryDiagnosticCode;
    /** `conflict` and `incomplete` determine `consistency`; `warn`/`info` never do. */
    level: 'conflict' | 'incomplete' | 'warn' | 'info';
    /** Fixed, project-controlled-text-free sentence. */
    message: string;
    /** Where the facts that triggered it were read. */
    sources: Provenance[];
}
export interface StoryStateResolution {
    storyId: string;
    planning: PlanningFact;
    active: ActiveFact;
    finalization: FinalizationFact;
    phase: PhaseAssociation;
    consistency: StoryConsistency;
    diagnostics: StoryDiagnostic[];
    /** Availability of each authoritative source, so UNKNOWN is explainable. */
    sources: {
        active: SourceState;
        roadmap: SourceState;
        storyIndex: SourceState;
    };
}
export declare function buildStoryAuthorityContext(src: StorySources): StoryAuthorityContext;
/** Resolves one story from already-built context. Pure. */
export declare function resolveStoryStateIn(ctx: StoryAuthorityContext, rawStoryId: string): StoryStateResolution;
/** Convenience: parse the sources and resolve one story. */
export declare function resolveStoryState(sources: StorySources, storyId: string): StoryStateResolution;
/**
 * The story `active.md` declares current, resolved; `null` when it declares none or
 * cannot be read to a single id (those are visible via `buildStoryAuthorityContext`).
 */
export declare function resolveActiveStory(sources: StorySources): StoryStateResolution | null;
export {};
//# sourceMappingURL=story-state.d.ts.map