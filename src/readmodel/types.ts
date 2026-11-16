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

import type { Checkpoint, Mission } from '../coordinatorium/types.js';

/** The fixed, closed set of files this model reads. */
export type SourceId = 'config' | 'state' | 'activeStory' | 'roadmap';

/**
 * - available: read and (where applicable) parsed successfully
 * - absent:    the file does not exist (a legitimate state for a fresh project)
 * - corrupt:   the file was read but its content is unusable
 * - forbidden: reading was refused by a security boundary
 * - unreadable: the file exists inside the boundary but could not be read
 */
export type SourceStatus = 'available' | 'absent' | 'corrupt' | 'forbidden' | 'unreadable';

export type SourceErrorCode =
  | 'SOURCE_ABSENT'
  | 'SOURCE_OUTSIDE_PROJECT'
  | 'SOURCE_UNRESOLVABLE'
  | 'SOURCE_NOT_REGULAR'
  | 'SOURCE_EMPTY'
  | 'SOURCE_TOO_LARGE'
  | 'SOURCE_CHANGED'
  | 'SOURCE_UNREADABLE'
  | 'SOURCE_SYMLINK'
  | 'SOURCE_HARDLINKED'
  | 'SOURCE_BOUNDARY_INVALID'
  | 'SOURCE_UNSUPPORTED_PLATFORM'
  | 'PARSE_ERROR'
  | 'SCHEMA_INVALID'
  | 'CONFIG_INVALID'
  | 'ROOT_INVALID'
  | 'INTERNAL';

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
export type StoryClaimView = { kind: 'none' } | { kind: 'ids'; ids: string[] } | { kind: 'unknown' };

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
  currentStory: { excerpt: string; lineRange: string } | null;
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
export type ActivePhaseView =
  | { kind: 'none' }
  | { kind: 'not_declared' }
  | { kind: 'phase'; id: string }
  | { kind: 'unmatched' }
  | { kind: 'ambiguous' };

export type RoadmapDiagnosticCode =
  | 'DOCUMENT_EMPTY'
  | 'PHASES_SECTION_MISSING'
  | 'PHASES_SECTION_DUPLICATED'
  | 'NO_PHASES_FOUND'
  | 'PHASE_HEADING_MALFORMED'
  | 'PHASES_TRUNCATED'
  | 'PHASE_STATUS_MISSING'
  | 'PHASE_STATUS_EMPTY'
  | 'PHASE_STATUS_CONFLICT'
  | 'PHASE_STATUS_UNRECOGNIZED'
  | 'PHASE_DETAILS_TRUNCATED'
  | 'PHASE_ID_DUPLICATE'
  | 'ACTIVE_PHASE_CONFLICT'
  | 'ACTIVE_PHASE_UNMATCHED'
  | 'ACTIVE_PHASE_AMBIGUOUS_ID'
  | 'ACTIVE_PHASE_REPORTED_COMPLETE'
  | 'INTERNAL';

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

export type NoteCode =
  | 'STATE_SPLIT_BRAIN'
  | 'MULTIPLE_ACTIVE_MISSIONS'
  | 'CHECKPOINT_ORDER_MISMATCH'
  | 'ACTIVE_MD_NO_CURRENT_STORY';

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

export interface DashboardReadModel {
  projectOverview: Section<ProjectOverview>;
  currentMissions: Section<CurrentMissions>;
  checkpoints: Section<CheckpointsData>;
  roadmap: Section<RoadmapData>;
  diagnostics: ReadDiagnostics;
}
