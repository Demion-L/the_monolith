/**
 * `monolith governance check` — report types (GOV-EVOLUTION Phase 5).
 *
 * The report is a projection of what Core already knows (the Mission Control read model,
 * `validateProject`) plus one minimal structural check of story capsules. It defines no new
 * document format and keeps no state. Only fixed codes, project-relative paths and
 * sanitized, clipped text cross this boundary.
 */

export type GovernanceSeverity = 'INFO' | 'WARNING' | 'ERROR';

export type GovernanceAreaId =
  | 'instance'
  | 'roadmap'
  | 'activeStory'
  | 'storyIndex'
  | 'capsules'
  | 'adr'
  | 'hypotheses'
  | 'missions'
  | 'ideas';

/**
 * - PASS:        checked, nothing to report
 * - EMPTY:       valid, but holds no records yet (never an error by itself)
 * - AVAILABLE:   readable; no structural rule applies beyond reading it
 * - ABSENT:      the source does not exist
 * - ISSUES:      at least one WARNING or ERROR finding
 * - NOT_CHECKED: could not be examined (an earlier failure made it untrustworthy)
 */
export type GovernanceAreaStatus = 'PASS' | 'EMPTY' | 'AVAILABLE' | 'ABSENT' | 'ISSUES' | 'NOT_CHECKED';

export interface GovernanceFinding {
  area: GovernanceAreaId;
  severity: GovernanceSeverity;
  /** Fixed code, e.g. `ACTIVE_PHASE_UNMATCHED`. */
  code: string;
  message: string;
  /** Project-relative, `/`-separated; null when the finding concerns no single file. */
  path: string | null;
}

export interface GovernanceArea {
  id: GovernanceAreaId;
  label: string;
  status: GovernanceAreaStatus;
}

export type GovernanceResult = 'NO_ISSUES' | 'ISSUES_FOUND';

export interface GovernanceReport {
  project: string | null;
  areas: GovernanceArea[];
  /** Sorted: ERROR, WARNING, INFO; then area order, path, code. Deterministic. */
  findings: GovernanceFinding[];
  counts: { error: number; warning: number; info: number };
  /** ISSUES_FOUND iff at least one WARNING or ERROR exists. INFO never makes a project "have issues". */
  result: GovernanceResult;
}
