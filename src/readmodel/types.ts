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

export interface ProjectOverview {
  /** `project.name` from `monolith.config.json`; null when absent or not a non-empty string. */
  name: string | null;
  /** Validated relative instance root (ADR-009), `/`-separated. */
  monolithRoot: string;
  monolithRootSource: 'config' | 'default';
  /** `schemaVersion` as found on disk (1 is migrated in memory); null unless state is available. */
  stateSchemaVersionOnDisk: number | null;
  stateRevision: number | null;
  /** Counts over `tactical.missions`; null unless state is available or absent (absent ⇒ 0). */
  activeMissionCount: number | null;
  finishedMissionCount: number | null;
  /** Verbatim `## Current Story` section of `active.md`; null when the section cannot be shown. */
  currentStory: { excerpt: string; lineRange: string } | null;
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

export interface RoadmapData {
  /** Raw, unparsed text of `roadmap-index.md`. Untrusted: must be shown escaped, never rendered or executed. */
  text: string;
}

export type NoteCode =
  | 'STATE_LEGACY_SCHEMA_MIGRATED'
  | 'MULTIPLE_ACTIVE_MISSIONS'
  | 'CHECKPOINT_ORDER_MISMATCH'
  | 'ACTIVE_MD_NO_CURRENT_STORY';

export interface ReadNote {
  code: NoteCode;
  severity: 'info' | 'warn';
}

export interface ReadDiagnostics {
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
