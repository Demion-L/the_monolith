/**
 * Typed Read Model for Mission Control (UI-001B.1, ADR-010).
 *
 * A pure, read-only projection of data MONOLITH Core already owns. It adds no
 * persistent schema and no source of truth: every field is copied from, or
 * counted over, an existing artifact (`monolith.config.json`, `state.json`,
 * `active.md`, `roadmap-index.md`).
 *
 * Errors are DATA, not text: only fixed enum codes and project-relative paths
 * cross this boundary. No absolute path, no exception message and no file
 * excerpt other than the explicit content fields below ever appears in a
 * diagnostic, so the DTO is safe to serialize over HTTP later (G2 still gates
 * that).
 */
import type { StoryStateResolution } from './story-state.js';
import type { Checkpoint, Mission } from '../coordinatorium/types.js';
/** The fixed, closed set of files this model reads. */
export type SourceId = 'config' | 'state' | 'activeStory' | 'roadmap' | 'hypotheses' | 'decisions' | 'storyIndex' | 'ideas';
/**
 * - available: read and (where applicable) parsed successfully
 * - absent:    the file does not exist (a legitimate state for a fresh project)
 * - corrupt:   the file was read but its content is unusable
 * - forbidden: reading was refused by a security boundary
 * - unreadable: the file exists inside the boundary but could not be read
 */
export type SourceStatus = 'available' | 'absent' | 'corrupt' | 'forbidden' | 'unreadable';
export type SourceErrorCode = 'SOURCE_ABSENT' | 'SOURCE_OUTSIDE_PROJECT' | 'SOURCE_UNRESOLVABLE' | 'SOURCE_NOT_REGULAR' | 'SOURCE_EMPTY' | 'SOURCE_TOO_LARGE' | 'SOURCE_CHANGED' | 'SOURCE_UNREADABLE' | 'SOURCE_SYMLINK' | 'SOURCE_HARDLINKED' | 'SOURCE_BOUNDARY_INVALID' | 'SOURCE_UNSUPPORTED_PLATFORM' | 'PARSE_ERROR' | 'SCHEMA_INVALID' | 'CONFIG_INVALID' | 'ROOT_INVALID' | 'INTERNAL';
export interface SourceReport {
    id: SourceId;
    /** Project-relative, `/`-separated; null when the instance root could not be trusted. */
    path: string | null;
    status: SourceStatus;
    /** null iff status === 'available'. */
    code: SourceErrorCode | null;
}
/** `data` is null only when the sections' sources could not supply it. */
export interface Section<T> {
    data: T | null;
    /** The sources this section depends on, in fixed order. */
    sources: SourceReport[];
}
/**
 * Identity of the current story as classified by Core's `parseActiveStoryClaim`
 * (UI-003B-1A). `none` = the section declares no active story; `ids` = a
 * structural identity; `unknown` = the section cannot be classified (including
 * a self-contradicting one). Free text (e.g. contradiction values) is not carried.
 */
export type StoryClaimView = {
    kind: 'none';
} | {
    kind: 'ids';
    ids: string[];
} | {
    kind: 'unknown';
};
export interface ProjectOverview {
    /** `project.name` from `monolith.config.json`; null when absent or not a non-empty string. */
    name: string | null;
    /** Validated relative instance root (ADR-009), `/`-separated. */
    monolithRoot: string;
    monolithRootSource: 'config' | 'default';
    /** `schemaVersion` as found on disk; null unless state is available. Only the current schema is read. */
    stateSchemaVersionOnDisk: number | null;
    stateRevision: number | null;
    /** Counts over `tactical.missions`; null unless state is available or absent (absent ⇒ 0). */
    activeMissionCount: number | null;
    finishedMissionCount: number | null;
    /** Verbatim `## Current Story` section of `active.md`; null when the section cannot be shown. */
    currentStory: {
        excerpt: string;
        lineRange: string;
    } | null;
    /** Classification of `currentStory`; null when there is no readable Current Story section. */
    storyClaim: StoryClaimView | null;
}
export interface CurrentMissions {
    /** Every `in_progress` mission, ordered by (startedAt, id). More than one is reported, never collapsed. */
    active: Mission[];
}
export interface MissionCheckpoints {
    missionId: string;
    /** Number of checkpoints recorded for the mission. */
    count: number;
    /**
     * Highest-ordinal checkpoint (ID order is authoritative, as in `brief`).
     * Its `remainingSteps` are a HISTORICAL record at that checkpoint, not the
     * project's current plan.
     */
    latest: Checkpoint | null;
}
export interface CheckpointsData {
    /** One entry per active mission, same order as `CurrentMissions.active`. */
    byActiveMission: MissionCheckpoints[];
}
/**
 * Structured roadmap (UI-003C), interpreted by Core's `parseRoadmapPhases`.
 * Every status is REPORTED (the document's own claim), never CONFIRMED, and is
 * unrelated to Reconciliation. Diagnostics are fixed codes; no document text.
 */
export interface RoadmapPhaseView {
    /** Id from an explicit `### Phase <id>` heading. */
    id: string | null;
    /** Title after the dash; null when the heading has none (e.g. `### Phase 2+`). Untrusted text. */
    title: string | null;
    status: {
        /** Verbatim (whitespace-normalized) value; null when missing, empty or self-contradicting. */
        value: string | null;
        /** True only for a value the documents themselves declare (PLANNED, IN PROGRESS, COMPLETE(D), NOT DEFINED). */
        recognized: boolean;
        provenance: 'REPORTED';
    };
    goal: string | null;
    /**
     * True when Core shortened `goal` to its length limit. Computed in Core only.
     * Always present from this Core; absent in DTOs from older servers, where it means "unknown", not "complete".
     */
    goalTruncated?: boolean;
    /** Remaining body of the phase section, verbatim and untrusted; null when empty. */
    details: string | null;
}
/**
 * - none:         the document says explicitly there is no active phase
 * - not_declared: no `Active Phase:` pointer at all
 * - phase:        one explicit pointer matching exactly one recognised phase
 * - unmatched:    the pointer names no recognised phase
 * - ambiguous:    contradictory pointers, or the pointed id is duplicated
 */
export type ActivePhaseView = {
    kind: 'none';
} | {
    kind: 'not_declared';
} | {
    kind: 'phase';
    id: string;
} | {
    kind: 'unmatched';
} | {
    kind: 'ambiguous';
};
export type RoadmapDiagnosticCode = 'DOCUMENT_EMPTY' | 'PHASES_SECTION_MISSING' | 'PHASES_SECTION_DUPLICATED' | 'NO_PHASES_FOUND' | 'PHASE_HEADING_MALFORMED' | 'PHASES_TRUNCATED' | 'PHASE_STATUS_MISSING' | 'PHASE_STATUS_EMPTY' | 'PHASE_STATUS_CONFLICT' | 'PHASE_STATUS_UNRECOGNIZED' | 'PHASE_DETAILS_TRUNCATED' | 'PHASE_ID_DUPLICATE' | 'ACTIVE_PHASE_CONFLICT' | 'ACTIVE_PHASE_UNMATCHED' | 'ACTIVE_PHASE_AMBIGUOUS_ID' | 'ACTIVE_PHASE_REPORTED_COMPLETE' | 'INTERNAL';
export interface RoadmapDiagnosticView {
    code: RoadmapDiagnosticCode;
    severity: 'info' | 'warn';
    /** Index into `phases` when the diagnostic concerns one phase. */
    phaseIndex: number | null;
}
/**
 * - ok:           phases recognised, nothing structural lost
 * - partial:      phases recognised, but some content could not be (malformed heading, truncation)
 * - empty:        the document is available but blank
 * - no_phases:    a `## Phases` section exists without any phase
 * - unrecognized: non-empty document without a `## Phases` section
 * - error:        processing failed; the structure must not be trusted
 */
export type RoadmapParseState = 'ok' | 'partial' | 'empty' | 'no_phases' | 'unrecognized' | 'error';
export interface StructuredRoadmapView {
    state: RoadmapParseState;
    phases: RoadmapPhaseView[];
    activePhase: ActivePhaseView;
    diagnostics: RoadmapDiagnosticView[];
}
export interface RoadmapData {
    /** Raw, unparsed text of `roadmap-index.md`. Untrusted: must be shown escaped, never rendered or executed. */
    text: string;
    /**
     * Core's interpretation of `text`. Additive: DTOs from older servers lack it,
     * and consumers must then fall back to `text` without inventing phases.
     */
    structured?: StructuredRoadmapView;
}
/**
 * Structured story index (CORE-GRAPH-002), interpreted by Core's `parseStoryIndex`.
 * `story-index.md` is an index of FINISHED stories (decision D4): an unfinished story
 * is not there and no link to a phase is invented for it. Every status is REPORTED
 * (the document's own claim), never confirmed. No Story → Story relationship exists
 * (D5). Diagnostics are fixed codes; no document text.
 */
/**
 * Phase containment of one story, from the structural nesting under a `## Phase <id>`
 * heading only (D1), confirmed only by strict, exact comparison of the id token with
 * the Roadmap's phase ids (D2: no fuzzy match, no title match, no order, no correction).
 * - matched:    the token equals exactly one Roadmap phase id (`phaseId` === `token`)
 * - unmatched:  the token equals no Roadmap phase id (or the phase heading was malformed)
 * - ambiguous:  the token equals more than one Roadmap phase id (duplicated in the Roadmap)
 * - unverified: the Roadmap could not supply phase ids, so the nesting is NOT confirmed
 * - outside:    the story is not nested under any `## Phase` heading
 * `token` is the original text found in the story index, kept for diagnostics.
 */
export type StoryPhaseRef = {
    kind: 'matched';
    phaseId: string;
    token: string;
} | {
    kind: 'unmatched';
    token: string;
} | {
    kind: 'ambiguous';
    token: string;
} | {
    kind: 'unverified';
    token: string;
} | {
    kind: 'outside';
};
export interface StoryIndexItemView {
    /** Id exactly as declared in the heading (whitespace-normalized): `STORY 1.1`, `CONTEXT-001A`, ... */
    id: string;
    /** `duplicate` when another entry declares the same id: all such entries stay listed, none is a unique node. */
    idStatus: 'unique' | 'duplicate';
    /** Title after the dash; null when the heading has none. Untrusted text. */
    title: string | null;
    status: {
        /** Verbatim (whitespace-normalized) value; null when missing, empty or self-contradicting. */
        value: string | null;
        /** True only for a value the documents themselves declare. */
        recognized: boolean;
        provenance: 'REPORTED';
    };
    /** `**Date:**` verbatim (bounded); null when missing or empty. */
    date: string | null;
    phase: StoryPhaseRef;
}
export type StoryIndexDiagnosticCode = 'DOCUMENT_EMPTY' | 'STORIES_NOT_FOUND' | 'NO_FINALIZED_STORIES' | 'STORY_HEADING_MALFORMED' | 'PHASE_HEADING_MALFORMED' | 'STORIES_TRUNCATED' | 'STORY_ID_DUPLICATE' | 'STORY_OUTSIDE_PHASE' | 'STORY_STATUS_MISSING' | 'STORY_STATUS_EMPTY' | 'STORY_STATUS_CONFLICT' | 'STORY_STATUS_UNRECOGNIZED' | 'STORY_PHASE_UNMATCHED' | 'STORY_PHASE_AMBIGUOUS' | 'STORY_PHASE_UNVERIFIED' | 'INTERNAL';
export interface StoryIndexDiagnosticView {
    code: StoryIndexDiagnosticCode;
    severity: 'info' | 'warn';
    /** Index into `stories` when the diagnostic concerns one story. */
    storyIndex: number | null;
}
/**
 * - ok:           stories recognised, nothing structural lost
 * - partial:      stories recognised, but some content could not be (malformed heading, truncation)
 * - empty:        the document is available but blank
 * - none_finalized: the canonical `# Stories` section exists and lists nothing: a valid state before the
 *                 first finalization (not an error, and nothing is synthesized from the Roadmap)
 * - no_stories:   phase sections exist without any story
 * - unrecognized: non-empty document with neither stories nor phase sections
 * - error:        processing failed; the structure must not be trusted
 */
export type StoryIndexParseState = 'ok' | 'partial' | 'empty' | 'none_finalized' | 'no_stories' | 'unrecognized' | 'error';
export interface StructuredStoryIndexView {
    state: StoryIndexParseState;
    stories: StoryIndexItemView[];
    diagnostics: StoryIndexDiagnosticView[];
}
export type NoteCode = 'STATE_SPLIT_BRAIN' | 'MULTIPLE_ACTIVE_MISSIONS' | 'CHECKPOINT_ORDER_MISMATCH' | 'ACTIVE_MD_NO_CURRENT_STORY';
export interface ReadNote {
    code: NoteCode;
    severity: 'info' | 'warn';
}
/**
 * Where the operational state lives and whether independent copies exist
 * (BETA-020 Phase 2). Additive and data-only: no absolute path crosses this
 * boundary — the canonical file is named symbolically, and other state files
 * by their path relative to the project root.
 */
export interface StateProvenanceView {
    /** `shared` = one state for all worktrees (default); `isolated` = per worktree, by explicit choice; `local` = shared is not possible here (see `localReason`). */
    mode: 'shared' | 'isolated' | 'local';
    location: 'git-common-dir' | 'project-local';
    localReason: 'ISOLATED_MODE' | 'NOT_A_GIT_REPOSITORY' | 'PROJECT_NOT_AT_WORKTREE_ROOT' | null;
    /** Symbolic path, e.g. `<git-common-dir>/monolith/state.json`. */
    statePath: string;
    revision: number | null;
    schemaVersion: number | null;
    monolithVersion: string;
    repositoryIdentity: string | null;
    worktreeCount: number | null;
    splitBrain: {
        detected: boolean;
        canonicalMissingWithLocalData: boolean;
        /** Worktree-local state files found next to the shared state. Never merged, never chosen. */
        localStates: {
            path: string;
            status: 'ok' | 'incompatible-schema' | 'corrupt' | 'unreadable';
            schemaVersion: number | null;
            revision: number | null;
            missionCount: number | null;
            checkpointCount: number | null;
            currentWorktree: boolean;
        }[];
    };
}
export interface ReadDiagnostics {
    /** Present when the state location could be resolved. */
    state?: StateProvenanceView;
    /**
     * This reports availability of the fixed sources only. `monolith validate`
     * is never run, so a clean report is NOT a statement that the project is valid.
     */
    validation: 'NOT_PERFORMED';
    /** Every source, in fixed order: config, state, activeStory, roadmap. */
    sources: SourceReport[];
    notes: ReadNote[];
}
/**
 * One hypothesis or ADR as the document itself declares it (UI-004B). Nothing is
 * defaulted or inferred: a missing field is `null`, a status is verbatim (it may
 * be a value the project's own legend does not define), and supersession links are
 * only those written in the document. Text fields are untrusted.
 */
export interface KnowledgeItemView {
    /** `HYP-005`, `ADR-020`, ... as declared. */
    id: string | null;
    title: string | null;
    status: string | null;
    /** Short, plain-text excerpt (bounded by Core); never HTML. */
    summary: string | null;
    /** Project-relative, `/`-separated path of the source document. */
    path: string | null;
    /** ADRs only: `supersedes` / `superseded_by` exactly as declared; never inferred, never checked against other ADRs. */
    supersedes?: string[];
    supersededBy?: string[];
}
export type KnowledgeIssueCode = 'DOCUMENT_EMPTY' | 'ITEMS_TRUNCATED' | 'HYP_HEADING_MALFORMED' | 'HYP_ID_DUPLICATE' | 'HYP_STATUS_MISSING' | 'HYP_STATUS_EMPTY' | 'HYP_STATUS_CONFLICT' | 'ADR_FILE_UNREADABLE' | 'ADR_FILENAME_UNRECOGNIZED' | 'ADR_FRONTMATTER_MISSING' | 'ADR_FRONTMATTER_MALFORMED' | 'ADR_ID_MISSING' | 'ADR_ID_INVALID' | 'ADR_ID_MISMATCH' | 'ADR_ID_DUPLICATE' | 'ADR_FIELD_DUPLICATE' | 'ADR_STATUS_MISSING' | 'ADR_LINK_INVALID' | 'INTERNAL';
/** A fixed code plus a project-relative path; no document text. `warn` makes the list incomplete. */
export interface KnowledgeIssueView {
    code: KnowledgeIssueCode;
    severity: 'info' | 'warn';
    path: string | null;
    /** Identifier involved (validated shape, bounded); null when none. */
    id: string | null;
    /** Reader failure (file-level issues only). */
    reason: SourceErrorCode | null;
}
export interface KnowledgeData {
    items: KnowledgeItemView[];
    issues: KnowledgeIssueView[];
    /** False when any `warn` issue means documents or entries could not be interpreted: the list must not be read as exhaustive. */
    complete: boolean;
}
/**
 * One idea as the existing idea store reads it (GOV-EVOLUTION Phase 4). Read-only; text is untrusted
 * user data and is shown, never interpreted. `path` is the project-relative source file (provenance).
 */
export interface IdeaView {
    id: string;
    title: string;
    status: 'inbox' | 'planned' | 'archived';
    createdAt: string;
    description: string;
    /** True when Core shortened `description` to its limit. */
    descriptionTruncated: boolean;
    context: string | null;
    tags: string[];
    paths: string[];
    path: string;
}
export interface IdeasData {
    items: IdeaView[];
    /** Files that could not be read as ideas: fixed code + id only. */
    issues: {
        id: string;
        code: 'IDEA_CORRUPT' | 'IDEA_UNSAFE_PATH';
    }[];
    /** True when the item list was cut at the display limit. */
    truncated: boolean;
    /** False when some idea file could not be read or the list was cut: the list is not exhaustive. */
    complete: boolean;
}
/** Resolution of the declared active story (ARCH-002B); see `story-state.ts`. */
export interface StoryStateView {
    activeStory: StoryStateResolution | null;
    sources: StoryStateResolution['sources'];
}
/**
 * Development History (GOV-EVOLUTION Phase 3): a read-only view over the Missions and Checkpoints
 * ALREADY in the operational state. Nothing is stored, generated or inferred: a mission without a
 * checkpoint shows none, a mission without `storyId` has no story, and the Story link is exactly
 * the one recorded on the mission. Text fields are untrusted.
 */
export interface HistoryCheckpointView {
    id: string;
    createdAt: string;
    summary: string;
    /** Historical record at that checkpoint; not the current plan. */
    remainingSteps: string[];
    context: string | null;
}
export interface HistoryMissionView {
    id: string;
    title: string;
    system: string;
    status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
    startedAt: string;
    updatedAt: string;
    /** Final summary as recorded when the mission was finished; null when none was recorded. */
    summary: string | null;
    /** Exactly the `storyId` recorded on the mission; null when none (never guessed). */
    storyId: string | null;
    /** Total checkpoints recorded for the mission (may exceed `checkpoints.length`). */
    checkpointCount: number;
    /** Oldest first (id ordinal order, as `brief` treats ids as authoritative), bounded. */
    checkpoints: HistoryCheckpointView[];
    checkpointsTruncated: boolean;
}
export type HistoryEventKind = 'mission_started' | 'checkpoint' | 'mission_finished';
/** One recorded fact, taken from a recorded timestamp. `mission_finished` uses the mission's `updatedAt`. */
export interface HistoryEventView {
    kind: HistoryEventKind;
    at: string;
    missionId: string;
    missionTitle: string;
    /** Checkpoint events only. */
    checkpointId: string | null;
    /** Checkpoint summary or mission final summary; null when none. */
    summary: string | null;
    /** `mission_finished` only. */
    result: 'completed' | 'failed' | 'cancelled' | null;
}
export interface DevelopmentHistory {
    /** Newest first by (startedAt, id); bounded by `MAX_HISTORY_MISSIONS`. */
    missions: HistoryMissionView[];
    totalMissions: number;
    /** True when `missions` is not all missions: the list is not exhaustive. */
    truncated: boolean;
    counts: {
        in_progress: number;
        completed: number;
        failed: number;
        cancelled: number;
    };
    totalCheckpoints: number;
    /** Checkpoints whose mission is not recorded; counted, never shown or attached elsewhere. */
    orphanCheckpoints: number;
    /** Latest recorded events, newest first, bounded. */
    recent: HistoryEventView[];
}
export interface DashboardReadModel {
    projectOverview: Section<ProjectOverview>;
    currentMissions: Section<CurrentMissions>;
    checkpoints: Section<CheckpointsData>;
    roadmap: Section<RoadmapData>;
    /**
     * Additive (UI-004B). `data === null` means the source is not available (see
     * `sources[0].status`: `absent` = NOT AVAILABLE, anything else = ERROR); it is never an empty list.
     * Absent from DTOs of older servers.
     */
    hypotheses?: Section<KnowledgeData>;
    decisions?: Section<KnowledgeData>;
    /**
     * Additive (CORE-GRAPH-002). `data === null` means `story-index.md` is not available
     * (see `sources[0].status`); never an empty list. Absent from DTOs of older servers.
     */
    storyIndex?: Section<StructuredStoryIndexView>;
    /**
     * Additive (ARCH-002B). Core's Story State Resolver applied to the story `active.md`
     * declares current: Planned / Active / Finalized facts kept apart, with provenance and
     * consistency. `data.activeStory === null` when no single active story is declared.
     * Absent from DTOs of older servers; the UI must not rebuild this itself.
     */
    storyState?: Section<StoryStateView>;
    /**
     * Additive (GOV-EVOLUTION Phase 3). Every mission (active, completed, failed, cancelled) with its
     * checkpoints, from the same state file as `currentMissions`. `data === null` means the state is not
     * usable (see `sources[0]`); absent state is an empty history. Absent from DTOs of older servers.
     */
    history?: Section<DevelopmentHistory>;
    /**
     * Additive (GOV-EVOLUTION Phase 4). Ideas from the existing idea store. `data === null` means the source is
     * not available (`absent` = no idea has been captured yet: the directory does not exist). Absent from DTOs of older servers.
     */
    ideas?: Section<IdeasData>;
    diagnostics: ReadDiagnostics;
}
//# sourceMappingURL=types.d.ts.map