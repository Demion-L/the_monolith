/**
 * Project State Freshness (SELF-AWARENESS-001).
 *
 * `Completeness` says whether the brief lost data while being rendered.
 * `Freshness` says whether the recorded project state can still be trusted.
 * They are independent: `Completeness: COMPLETE` + `Freshness: STALE` is a
 * valid combination, and nothing here ever changes `Completeness`.
 *
 * `evaluateFreshness()` is pure: it takes already-gathered evidence and
 * returns a verdict. Git is a signal, never the only source of truth:
 *
 *   STALE    only on a concrete, named discrepancy — either the state
 *            documents contradict each other, or git history references
 *            work items that no state document mentions.
 *   FRESH    only on positive evidence — git is readable, the last state
 *            update is located, and every commit after it either touches
 *            only the state documents or belongs to a recorded work item.
 *   UNKNOWN  everything else. Git activity alone, an old date alone, or the
 *            absence of an active story alone never produce STALE, and the
 *            absence of an active story never means "project complete".
 */

export type FreshnessStatus = 'FRESH' | 'STALE' | 'UNKNOWN';

export type FreshnessReasonCode =
  | 'STATE_CONTRADICTION'
  | 'UNRECORDED_WORK'
  | 'GIT_UNAVAILABLE'
  | 'STATE_NOT_IN_GIT'
  | 'GIT_HISTORY_TRUNCATED'
  | 'UNATTRIBUTED_ACTIVITY'
  | 'NO_ACTIVITY_SINCE_STATE_UPDATE'
  | 'ACTIVITY_RECORDED';

export interface FreshnessReason {
  code: FreshnessReasonCode;
  message: string;
}

/** One commit after the last state update, as seen by git. */
export interface GitCommitSignal {
  sha: string;
  /** ISO-8601 committer date. Informational only — never compared with "now". */
  date: string;
  subject: string;
  /** Paths changed by the commit, relative to the project directory. Empty for plain merges. */
  files: string[];
}

export type GitUnavailableReason = 'GIT_NOT_INSTALLED' | 'NOT_A_GIT_REPOSITORY' | 'GIT_FAILED';

export type GitSignals =
  | { status: 'unavailable'; reason: GitUnavailableReason }
  | {
      status: 'ok';
      /** The newest commit that touched any state document; null if none ever did. */
      lastStateUpdate: { sha: string; date: string } | null;
      /** Commits reachable from HEAD but not from `lastStateUpdate`, newest first. */
      commitsSince: GitCommitSignal[];
      /** True when git history was cut at the read limit — the picture is partial. */
      truncated: boolean;
    };

export type StoryClaim =
  | { kind: 'none' }
  | { kind: 'ids'; ids: string[] }
  | { kind: 'unknown' };

export interface FreshnessEvidence {
  git: GitSignals;
  /** What `active.md` says is current. `unknown` when the file/section is unreadable or says nothing parseable. */
  activeStory: StoryClaim;
  /** What `roadmap-index.md` says is the active story ("Active Story: ..."), or null if the line is absent. */
  roadmapActiveStory: string | null;
  /** Work-item status by id as declared by roadmap-index.md and story-index.md (uppercased status). */
  roadmapStatuses: ReadonlyMap<string, string>;
  storyIndexStatuses: ReadonlyMap<string, string>;
  /** Concatenated text of the state documents that were readable; used to decide whether an id is "recorded". */
  recordedText: string;
  /** Repo-relative-to-project paths that are state documents (their own commits are not "activity"). */
  stateFiles: ReadonlySet<string>;
}

export interface FreshnessResult {
  status: FreshnessStatus;
  reasons: FreshnessReason[];
  /** Human-readable, single-line warnings (never fatal). */
  warnings: string[];
  recommendation: string;
  activeStory: 'none-recorded' | 'recorded' | 'unknown';
  lastStateUpdate: { sha: string; date: string } | null;
  /** Commits after the last state update that touched something other than state documents. */
  activityCount: number | null;
  /** Work-item ids seen in git after the last state update and absent from every state document. */
  unrecordedWork: string[];
}

// ---------------------------------------------------------------------------
// Work-item ids
// ---------------------------------------------------------------------------

/**
 * Work-item id: an upper-case, dash-separated prefix, a number, then optional
 * sub-story qualifiers — UI-002D, SEC-001B.1-R, LOCK-RELEASE-001, CONTEXT-001A.
 * Deliberately narrow: an id that is not matched is simply not evidence.
 */
const WORK_ITEM_SOURCE = String.raw`(?:[A-Z]{2,}-)+\d{3}[A-Z]?(?:\.\d+)*(?:-[A-Z])?`;
/** Decision / lesson records are not work items. */
const NON_WORK_PREFIXES = ['ADR-', 'DEC-', 'LESSON-'];

function isWorkItem(id: string): boolean {
  return !NON_WORK_PREFIXES.some((p) => id.startsWith(p));
}

export function extractWorkItemIds(text: string): string[] {
  const re = new RegExp(`(?<![A-Za-z0-9-])${WORK_ITEM_SOURCE}(?![A-Za-z0-9]|\\.\\d|-[A-Z0-9])`, 'g');
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    if (isWorkItem(m[0])) seen.add(m[0]);
  }
  return [...seen];
}

function mentionsId(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9]|\\.\\d|-[A-Z0-9])`).test(text);
}

// ---------------------------------------------------------------------------
// Parsers for the state documents (confirmed structure only)
// ---------------------------------------------------------------------------

const NONE_RE = /^\W*(?:no active story|none|unknown)\b|^\s*[—-]\s*$/i;

/** Interprets the `## Current Story` excerpt of active.md. */
export function parseActiveStoryClaim(excerpt: string | null): StoryClaim {
  if (excerpt === null) return { kind: 'unknown' };
  const firstLine = excerpt.split('\n').find((l) => l.trim() !== '') ?? '';
  if (/^\W*no active story\b/i.test(firstLine)) return { kind: 'none' };
  const ids = extractWorkItemIds(excerpt);
  return ids.length > 0 ? { kind: 'ids', ids } : { kind: 'unknown' };
}

/** `Active Story: <text>` line of roadmap-index.md. */
export function parseRoadmapActiveStory(content: string): string | null {
  const m = /^Active Story:\s*(.+?)\s*$/m.exec(content);
  return m ? m[1] : null;
}

/** Table rows `| id | title | STATUS | date |` of roadmap-index.md. */
export function parseRoadmapStatuses(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of content.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // leading and trailing '|' produce empty first/last cells
    if (cells.length < 5 || cells[0] !== '' || cells[cells.length - 1] !== '') continue;
    const id = cells[1];
    const status = cells[3];
    if (!/^[A-Za-z0-9][A-Za-z0-9.\-]*$/.test(id) || !/^[A-Z][A-Z _]+$/.test(status)) continue;
    if (!out.has(id)) out.set(id, status);
  }
  return out;
}

/** `### [STORY ]<id> — title` followed by `**Status:** X` in story-index.md. */
export function parseStoryIndexStatuses(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = /^###\s+(?:STORY\s+)?([A-Za-z0-9][A-Za-z0-9.\-]*)\s+—/.exec(lines[i]);
    if (!h) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      if (/^#{1,3}\s/.test(lines[j])) break;
      const s = /^\*\*Status:\*\*\s*([A-Z][A-Z _]*)/.exec(lines[j]);
      if (s) {
        if (!out.has(h[1])) out.set(h[1], s[1].trim());
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const MAX_LISTED = 5;

function listIds(ids: string[]): string {
  if (ids.length <= MAX_LISTED) return ids.join(', ');
  return `${ids.slice(0, MAX_LISTED).join(', ')} and ${ids.length - MAX_LISTED} more`;
}

function isDone(status: string | undefined): boolean {
  return status === 'COMPLETED' || status === 'DONE';
}

function findContradictions(ev: FreshnessEvidence): string[] {
  const out: string[] = [];

  if (ev.activeStory.kind === 'none' && ev.roadmapActiveStory !== null && !NONE_RE.test(ev.roadmapActiveStory)) {
    out.push(`active.md records no active story, but roadmap-index.md names "${ev.roadmapActiveStory}".`);
  }

  if (ev.activeStory.kind === 'ids') {
    for (const id of ev.activeStory.ids) {
      if (isDone(ev.roadmapStatuses.get(id))) {
        out.push(`active.md treats ${id} as current, but roadmap-index.md marks it ${ev.roadmapStatuses.get(id)}.`);
      } else if (isDone(ev.storyIndexStatuses.get(id))) {
        out.push(`active.md treats ${id} as current, but story-index.md marks it ${ev.storyIndexStatuses.get(id)}.`);
      }
    }
  }

  for (const [id, roadmapStatus] of ev.roadmapStatuses) {
    const indexStatus = ev.storyIndexStatuses.get(id);
    if (indexStatus !== undefined && indexStatus !== roadmapStatus) {
      out.push(`${id} is ${roadmapStatus} in roadmap-index.md but ${indexStatus} in story-index.md.`);
    }
  }
  return out;
}

const REVIEW_RECOMMENDATION = 'Review project state before relying on this brief.';

export function evaluateFreshness(ev: FreshnessEvidence): FreshnessResult {
  const reasons: FreshnessReason[] = [];
  const warnings: string[] = [];
  const base = {
    activeStory:
      ev.activeStory.kind === 'none' ? ('none-recorded' as const) : ev.activeStory.kind === 'ids' ? ('recorded' as const) : ('unknown' as const),
    lastStateUpdate: ev.git.status === 'ok' ? ev.git.lastStateUpdate : null,
    activityCount: null as number | null,
    unrecordedWork: [] as string[],
  };

  // 1. Internal contradictions need no git at all.
  const contradictions = findContradictions(ev);
  for (const message of contradictions) reasons.push({ code: 'STATE_CONTRADICTION', message });

  // 2. Git-derived signals.
  let gitVerdict: 'fresh' | 'unknown' | 'stale' | null = null;
  if (ev.git.status === 'unavailable') {
    const why: Record<GitUnavailableReason, string> = {
      GIT_NOT_INSTALLED: 'git is not installed or not runnable',
      NOT_A_GIT_REPOSITORY: 'the project is not inside a git repository',
      GIT_FAILED: 'git could not be queried',
    };
    reasons.push({ code: 'GIT_UNAVAILABLE', message: `Cannot compare state with history: ${why[ev.git.reason]}.` });
    gitVerdict = 'unknown';
  } else if (ev.git.lastStateUpdate === null) {
    reasons.push({
      code: 'STATE_NOT_IN_GIT',
      message: 'No commit touches the state documents, so the last state update cannot be located.',
    });
    gitVerdict = 'unknown';
  } else {
    const activity = ev.git.commitsSince.filter((c) => c.files.some((f) => !ev.stateFiles.has(f)));
    base.activityCount = activity.length;

    const referenced = new Set<string>();
    let unattributed = 0;
    for (const c of activity) {
      const ids = extractWorkItemIds(c.subject);
      if (ids.length === 0) unattributed++;
      for (const id of ids) referenced.add(id);
    }
    const unrecorded = [...referenced].filter((id) => !mentionsId(ev.recordedText, id)).sort();
    base.unrecordedWork = unrecorded;

    if (unrecorded.length > 0) {
      reasons.push({
        code: 'UNRECORDED_WORK',
        message:
          `${activity.length} commit(s) after the last state update (${ev.git.lastStateUpdate.sha.slice(0, 7)}, ${ev.git.lastStateUpdate.date.slice(0, 10)}) ` +
          `reference ${unrecorded.length} work item(s) that no state document mentions: ${listIds(unrecorded)}.`,
      });
      gitVerdict = 'stale';
    } else if (ev.git.truncated) {
      reasons.push({
        code: 'GIT_HISTORY_TRUNCATED',
        message: 'Git history after the last state update was cut at the read limit; the check is partial.',
      });
      gitVerdict = 'unknown';
    } else if (unattributed > 0) {
      reasons.push({
        code: 'UNATTRIBUTED_ACTIVITY',
        message:
          `${unattributed} commit(s) after the last state update touch project files without naming a work item; ` +
          `whether the recorded state still describes them cannot be determined.`,
      });
      gitVerdict = 'unknown';
    } else if (activity.length === 0) {
      reasons.push({
        code: 'NO_ACTIVITY_SINCE_STATE_UPDATE',
        message: 'No commit after the last state update changed anything beyond the state documents.',
      });
      gitVerdict = 'fresh';
    } else {
      reasons.push({
        code: 'ACTIVITY_RECORDED',
        message: `All ${activity.length} commit(s) after the last state update reference work items that the state documents mention.`,
      });
      gitVerdict = 'fresh';
    }

    if (activity.length > 0 && ev.activeStory.kind === 'none') {
      warnings.push('Git activity exists after the last recorded state update, but no active story is recorded.');
    }
  }

  // 3. Combine. A contradiction or unrecorded work is concrete evidence of staleness;
  //    FRESH needs positive evidence and no contradiction.
  let status: FreshnessStatus;
  if (contradictions.length > 0 || gitVerdict === 'stale') status = 'STALE';
  else if (gitVerdict === 'fresh') status = 'FRESH';
  else status = 'UNKNOWN';

  if (status !== 'FRESH') {
    if (status === 'STALE') warnings.unshift('Project state may be outdated.');
    else warnings.unshift('Freshness could not be established from the available evidence.');
    if (ev.activeStory.kind === 'none') {
      warnings.push('No active story is recorded; this does not mean the project is complete.');
    } else if (ev.activeStory.kind === 'unknown') {
      warnings.push('The active story could not be determined from active.md.');
    }
  }

  const recommendation =
    status === 'FRESH' ? 'No action needed.' : status === 'STALE' ? REVIEW_RECOMMENDATION : `${REVIEW_RECOMMENDATION} Freshness is unverified, not confirmed outdated.`;

  return { status, reasons, warnings, recommendation, ...base };
}
