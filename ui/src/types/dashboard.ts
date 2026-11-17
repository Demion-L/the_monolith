/**
 * Frontend view-model for the five MVP sections (ADR-010).
 *
 * Deliberately minimal and independent of MONOLITH Core: field names follow
 * Core's Mission/Checkpoint shape as a guide, but nothing here is imported
 * from Core and nothing is persisted. `null` means "not available" and is
 * rendered as UNKNOWN.
 */

/** Core's interpretation of the roadmap (UI-003C). The UI displays it; it never parses Markdown itself. */
export type { StructuredRoadmapView, RoadmapPhaseView, ActivePhaseView, RoadmapDiagnosticCode } from '../../../src/readmodel/types';
import type { StructuredRoadmapView, StateProvenanceView } from '../../../src/readmodel/types';
export type { StateProvenanceView };

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
  /** Core's structured roadmap. `undefined` = the source predates it (legacy DTO) or is a demo: fall back to the raw text. */
  roadmap?: StructuredRoadmapView;
  /**
   * `undefined` = the data source provides no such section (LIVE today: Core has no read model for it);
   * `null` = the source exists but could not be read; `[]` = readable and genuinely empty.
   */
  hypotheses?: KnowledgeItem[] | null;
  decisions?: KnowledgeItem[] | null;
  /** LIVE only: how Core reported each knowledge source (availability, incompleteness, issues). */
  hypothesesInfo?: KnowledgeInfo;
  decisionsInfo?: KnowledgeInfo;
  diagnostics: Diagnostic[];
  /** Availability of the fixed source files. `undefined` = not reported (demo). Not a validation result. */
  sources?: { total: number; available: number };
  /** Where the operational state lives (Phase 2). `undefined` = not provided (demo, older server, or location unresolved). */
  provenance?: StateProvenanceView;
}

/**
 * One hypothesis or ADR as the source states it (UI-004). Every field is the document's own
 * claim: nothing is defaulted, so a missing status stays `null` and is shown as UNKNOWN, never
 * as `accepted` / `validated`. Text fields are untrusted and rendered escaped.
 */
export interface KnowledgeItem {
  /** `HYP-005`, `ADR-020`, ... */
  id: string | null;
  title: string | null;
  /** Verbatim status as declared; may be a value the UI does not know. */
  status: string | null;
  summary: string | null;
  /** Project-relative path of the source document. Displayed as text only; validated by `safeDocPath`. */
  path: string | null;
  /** Declared supersession only (`superseded_by` / `supersedes`); never inferred. */
  supersededBy?: string[];
  supersedes?: string[];
}

/**
 * `not_available`: the source is absent. `error`: it exists but was refused or could not be read
 * (`code` is Core's fixed code). Either way the item list is `null`, never `[]`.
 */
export interface KnowledgeInfo {
  availability: 'available' | 'not_available' | 'error';
  code: string | null;
  /** False when Core could not interpret some documents/entries: the list is not exhaustive. */
  complete: boolean;
  issues: KnowledgeIssue[];
}

export interface KnowledgeIssue {
  code: string;
  severity: 'info' | 'warn';
  path: string | null;
  id: string | null;
}

export type ScenarioId = 'normal' | 'partial' | 'empty';
