/**
 * Frontend view-model for the five MVP sections (ADR-010).
 *
 * Deliberately minimal and independent of MONOLITH Core: field names follow
 * Core's Mission/Checkpoint shape as a guide, but nothing here is imported
 * from Core and nothing is persisted. `null` means "not available" and is
 * rendered as UNKNOWN.
 */

export type MissionStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Current-story state. The five cases are never collapsed into one `null`:
 *  - `active`:  a structural story identity exists
 *  - `none`:    the section declares no active story (NOT "project complete")
 *  - `unknown`: a section exists but cannot be classified (or the source is a legacy DTO)
 *  - `no_section`: the source is readable but has no usable `## Current Story` section
 *  - `source`:  the source is absent / corrupt / forbidden / unreadable
 */
export type StoryState =
  | { kind: 'active'; ids: string[]; excerpt: string | null }
  | { kind: 'none'; excerpt: string | null }
  | { kind: 'unknown'; excerpt: string | null }
  | { kind: 'no_section' }
  | { kind: 'source'; status: 'absent' | 'corrupt' | 'forbidden' | 'unreadable' | 'unavailable'; code: string | null };

export interface ProjectOverview {
  name: string | null;
  /** `undefined` = the data source has no such field (the row is not shown); `null` = unknown. */
  description?: string | null;
  /** Revision counter of the project state, if the source provides one. */
  stateRevision: number | null;
  /** Verbatim `## Current Story` excerpt (untrusted text). `undefined` = not provided by the source (row hidden). */
  currentStory?: string | null;
  /** Structured story state. `undefined` = the source does not provide it (falls back to the excerpt row). */
  story?: StoryState;
  /** Mission counters. `null` = unknown (state unusable); `undefined` = not provided (row hidden). */
  activeMissionCount?: number | null;
  finishedMissionCount?: number | null;
}

export interface Mission {
  id: string;
  title: string | null;
  status: MissionStatus;
  summary: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

export interface Checkpoint {
  id: string;
  missionId: string | null;
  createdAt: string | null;
  summary: string | null;
  /** Historical record as of `createdAt`; NOT the current plan. */
  remainingSteps: string[] | null;
  /** Checkpoints recorded for the mission. Absent = the source does not say; never shown as a number. */
  recordedCount?: number;
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
}

export interface DashboardData {
  /** True for every fixture, false for data adapted from the HTTP API. */
  isDemo: boolean;
  overview: ProjectOverview;
  /** `null` = the source could not supply the section (shown as NOT AVAILABLE, never as "none"). */
  missions: Mission[] | null;
  checkpoints: Checkpoint[] | null;
  /** Raw roadmap text, shown verbatim. */
  roadmapText: string | null;
  diagnostics: Diagnostic[];
}

export type ScenarioId = 'normal' | 'partial' | 'empty';
