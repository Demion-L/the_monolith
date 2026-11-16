/**
 * DTOs of the on-demand diagnostics of Mission Control (BETA-020 Phase 3).
 *
 * These are projections of what Core already computes (`validateProject`,
 * `collect` + `reconcile`). They add no rule and no verdict of their own. Only
 * fixed codes, enums, project-relative document names and sanitized, clipped
 * text cross this boundary — no absolute path, no exception text.
 */

export interface ValidationCheckDto {
  id: 'configuration' | 'instance' | 'templates';
  label: string;
  passed: boolean;
  /** Why the check failed; null on PASS. May name project-relative files. */
  message: string | null;
  /** Qualification of a PASS (e.g. what was NOT checked); null otherwise. */
  note: string | null;
}

/** Result of `monolith validate`, run in-process (static, ADR-011). */
export interface ValidationResultDto {
  result: 'PASS' | 'FAIL';
  checks: ValidationCheckDto[];
  /** Leftover write files (SEC-001B.2); never affects `result`. */
  warning: string | null;
}

/**
 * How much of the evidence needed to reconcile could be gathered. It is NOT the
 * Freshness verdict and not Core's Completeness:
 *  - COMPLETE:   git readable, history not cut, active story determined
 *  - INCOMPLETE: partial (history truncated / shallow, or the active story is unclassifiable)
 *  - UNKNOWN:    git history could not be compared at all
 */
export type ReconcileEvidence = 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN';

export interface ReconcileConflictDto {
  summary: string;
  /** The conflicting claims side by side. */
  sources: { document: string; claim: string }[];
}

export interface ReconcileWorkItemDto {
  id: string;
  totalCommits: number;
  commits: { sha: string; subject: string }[];
}

export interface ReconcileNoteDto {
  code: string;
  summary: string;
  evidence: string[];
}

export interface ReconciliationResultDto {
  evidence: ReconcileEvidence;
  /** Core's Freshness verdict, unchanged. UNKNOWN is not STALE. */
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
  lastStateUpdate: { sha: string; date: string } | null;
  /** Confirmed contradictions between state documents. */
  conflicts: ReconcileConflictDto[];
  /** Confirmed: git references these work items; no state document mentions them. */
  unrecordedWork: ReconcileWorkItemDto[];
  /** Suspected, not confirmable: activity that names no work item, or activity with no active story. */
  unattributed: ReconcileNoteDto[];
  /** Missing / partial evidence (git unavailable, truncated, shallow, active story unknown). */
  evidenceIssues: ReconcileNoteDto[];
  documents: { path: string; reasons: string[] }[];
  /** For a person to decide; none is applied. */
  actions: string[];
  limitations: string[];
  /** True when a list was cut to its display limit. */
  truncated: boolean;
}

/** Outcome of an on-demand run that could not produce a result. Fixed vocabulary only. */
export type DiagnosticsErrorCode = 'DIAGNOSTICS_FAILED' | 'DIAGNOSTICS_UNAVAILABLE';
