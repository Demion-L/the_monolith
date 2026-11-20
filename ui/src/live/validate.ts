import type { DashboardReadModel } from '../../../src/readmodel/types';

/**
 * Minimal runtime shape check of the HTTP response (TypeScript types are erased
 * and prove nothing about data that arrived over the network). It covers exactly
 * the fields the Dashboard reads; unknown extra fields are ignored. It is not a
 * schema platform and not a security boundary: free text is still rendered only
 * through Vue's escaping.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Mission counter: finite, integer, non-negative. */
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isCountOrNull = (v: unknown): v is number | null => v === null || isCount(v);
const isArr = <T>(v: unknown, item: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(item);

const MISSION_STATUSES = ['in_progress', 'completed', 'failed', 'cancelled'];
const SOURCE_STATUSES = ['available', 'absent', 'corrupt', 'forbidden', 'unreadable'];

function isSourceReport(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStrOrNull(v.path) &&
    isStr(v.status) &&
    SOURCE_STATUSES.includes(v.status) &&
    isStrOrNull(v.code)
  );
}

/** `{ data: T | null, sources: SourceReport[] }` */
function isSection(v: unknown, data: (d: unknown) => boolean): boolean {
  return isObj(v) && isArr(v.sources, isSourceReport as (x: unknown) => x is unknown) && (v.data === null || data(v.data));
}

function isMission(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.title) &&
    isStr(v.status) &&
    MISSION_STATUSES.includes(v.status) &&
    isStrOrNull(v.summary) &&
    isStr(v.startedAt) &&
    isStr(v.updatedAt)
  );
}

function isCheckpoint(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.missionId) &&
    isStr(v.createdAt) &&
    isStr(v.summary) &&
    isArr(v.remainingSteps, isStr)
  );
}

function isStoryClaim(v: unknown): boolean {
  return isObj(v) && (v.kind === 'none' || v.kind === 'unknown' || (v.kind === 'ids' && isArr(v.ids, isStr) && v.ids.length > 0));
}

const PARSE_STATES = ['ok', 'partial', 'empty', 'no_phases', 'unrecognized', 'error'];
const DIAG_SEVERITIES = ['info', 'warn'];

function isPhase(v: unknown): boolean {
  return (
    isObj(v) &&
    isStrOrNull(v.id) &&
    isStrOrNull(v.title) &&
    isObj(v.status) &&
    isStrOrNull(v.status.value) &&
    typeof v.status.recognized === 'boolean' &&
    (v.status.value !== null || v.status.recognized === false) &&
    v.status.provenance === 'REPORTED' &&
    isStrOrNull(v.goal) &&
    (v.goalTruncated === undefined || typeof v.goalTruncated === 'boolean') &&
    isStrOrNull(v.details)
  );
}

function isActivePhase(v: unknown, phases: unknown[]): boolean {
  if (!isObj(v)) return false;
  if (v.kind === 'phase') {
    // Must point at exactly one phase of this very payload: no dangling or duplicated binding.
    return isStr(v.id) && phases.filter((p) => isObj(p) && p.id === v.id).length === 1;
  }
  return v.kind === 'none' || v.kind === 'not_declared' || v.kind === 'unmatched' || v.kind === 'ambiguous';
}

/** The optional structured roadmap (absent in DTOs from older servers). */
function isStructuredRoadmap(v: unknown): boolean {
  if (!isObj(v) || !isStr(v.state) || !PARSE_STATES.includes(v.state)) return false;
  if (!Array.isArray(v.phases) || !v.phases.every(isPhase)) return false;
  // A failed or unrecognised parse never carries phases (it must not look like a roadmap).
  if (v.phases.length > 0 && !(v.state === 'ok' || v.state === 'partial')) return false;
  return (
    isActivePhase(v.activePhase, v.phases) &&
    Array.isArray(v.diagnostics) &&
    v.diagnostics.every(
      (d) =>
        isObj(d) &&
        isStr(d.code) &&
        isStr(d.severity) &&
        DIAG_SEVERITIES.includes(d.severity) &&
        (d.phaseIndex === null || (isCount(d.phaseIndex) && d.phaseIndex < (v.phases as unknown[]).length)),
    )
  );
}

const STORY_PARSE_STATES = ['ok', 'partial', 'empty', 'none_finalized', 'no_stories', 'unrecognized', 'error'];
const STORY_DIAG_CODES = [
  'DOCUMENT_EMPTY', 'STORIES_NOT_FOUND', 'NO_FINALIZED_STORIES', 'STORY_HEADING_MALFORMED', 'PHASE_HEADING_MALFORMED', 'STORIES_TRUNCATED', 'STORY_ID_DUPLICATE',
  'STORY_OUTSIDE_PHASE', 'STORY_STATUS_MISSING', 'STORY_STATUS_EMPTY', 'STORY_STATUS_CONFLICT', 'STORY_STATUS_UNRECOGNIZED',
  'STORY_PHASE_UNMATCHED', 'STORY_PHASE_AMBIGUOUS', 'STORY_PHASE_UNVERIFIED', 'INTERNAL',
];

function isStoryPhaseRef(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v.kind === 'outside') return true;
  if (v.kind === 'matched') return isStr(v.phaseId) && isStr(v.token);
  return (v.kind === 'unmatched' || v.kind === 'ambiguous' || v.kind === 'unverified') && isStr(v.token);
}

function isStoryItem(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    (v.idStatus === 'unique' || v.idStatus === 'duplicate') &&
    isStrOrNull(v.title) &&
    isObj(v.status) &&
    isStrOrNull(v.status.value) &&
    typeof v.status.recognized === 'boolean' &&
    (v.status.value !== null || v.status.recognized === false) &&
    v.status.provenance === 'REPORTED' &&
    isStrOrNull(v.date) &&
    isStoryPhaseRef(v.phase)
  );
}

/** The optional structured story index (absent in DTOs from older servers). */
function isStructuredStoryIndex(v: unknown): boolean {
  if (!isObj(v) || !isStr(v.state) || !STORY_PARSE_STATES.includes(v.state)) return false;
  if (!Array.isArray(v.stories) || !v.stories.every(isStoryItem)) return false;
  // A failed or unrecognised parse never carries stories (it must not look like an index).
  if (v.stories.length > 0 && !(v.state === 'ok' || v.state === 'partial')) return false;
  // `idStatus` must agree with the ids of this very payload: a payload cannot call a repeated id unique,
  // because the graph draws an edge only for a unique id.
  const counts = new Map<string, number>();
  for (const s of v.stories as Obj[]) counts.set(s.id as string, (counts.get(s.id as string) ?? 0) + 1);
  if ((v.stories as Obj[]).some((s) => (counts.get(s.id as string) as number > 1) !== (s.idStatus === 'duplicate'))) return false;
  const n = v.stories.length;
  return (
    Array.isArray(v.diagnostics) &&
    v.diagnostics.every(
      (d) =>
        isObj(d) &&
        isStr(d.code) &&
        STORY_DIAG_CODES.includes(d.code) &&
        isStr(d.severity) &&
        DIAG_SEVERITIES.includes(d.severity) &&
        (d.storyIndex === null || (isCount(d.storyIndex) && d.storyIndex < n)),
    )
  );
}

const STATE_MODES = ['shared', 'isolated', 'local'];
const LOCAL_STATE_STATUSES = ['ok', 'incompatible-schema', 'corrupt', 'unreadable'];

/** The optional state provenance (Phase 2); absent in DTOs from older servers. Displayed as plain text only. */
function isProvenance(v: unknown): boolean {
  if (!isObj(v) || !isObj(v.splitBrain)) return false;
  return (
    isStr(v.mode) && STATE_MODES.includes(v.mode) &&
    (v.location === 'git-common-dir' || v.location === 'project-local') &&
    isStrOrNull(v.localReason) &&
    isStr(v.statePath) &&
    isNumOrNull(v.revision) &&
    isNumOrNull(v.schemaVersion) &&
    isStr(v.monolithVersion) &&
    isStrOrNull(v.repositoryIdentity) &&
    isCountOrNull(v.worktreeCount) &&
    typeof v.splitBrain.detected === 'boolean' &&
    typeof v.splitBrain.canonicalMissingWithLocalData === 'boolean' &&
    Array.isArray(v.splitBrain.localStates) &&
    v.splitBrain.localStates.every(
      (l) => isObj(l) && isStr(l.path) && isStr(l.status) && LOCAL_STATE_STATUSES.includes(l.status) && isNumOrNull(l.schemaVersion) && isNumOrNull(l.revision) &&
        isCountOrNull(l.missionCount) && isCountOrNull(l.checkpointCount) && typeof l.currentWorktree === 'boolean',
    )
  );
}

const ISSUE_CODES = [
  'DOCUMENT_EMPTY', 'ITEMS_TRUNCATED', 'HYP_HEADING_MALFORMED', 'HYP_ID_DUPLICATE', 'HYP_STATUS_MISSING', 'HYP_STATUS_EMPTY',
  'HYP_STATUS_CONFLICT', 'ADR_FILE_UNREADABLE', 'ADR_FILENAME_UNRECOGNIZED', 'ADR_FRONTMATTER_MISSING', 'ADR_FRONTMATTER_MALFORMED',
  'ADR_ID_MISSING', 'ADR_ID_INVALID', 'ADR_ID_MISMATCH', 'ADR_ID_DUPLICATE', 'ADR_FIELD_DUPLICATE', 'ADR_STATUS_MISSING',
  'ADR_LINK_INVALID', 'INTERNAL',
];

function isKnowledgeItem(v: unknown): boolean {
  return (
    isObj(v) &&
    isStrOrNull(v.id) &&
    isStrOrNull(v.title) &&
    isStrOrNull(v.status) &&
    isStrOrNull(v.summary) &&
    isStrOrNull(v.path) &&
    (v.supersedes === undefined || isArr(v.supersedes, isStr)) &&
    (v.supersededBy === undefined || isArr(v.supersededBy, isStr))
  );
}

function isKnowledgeIssue(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.code) &&
    ISSUE_CODES.includes(v.code) &&
    (v.severity === 'info' || v.severity === 'warn') &&
    isStrOrNull(v.path) &&
    isStrOrNull(v.id) &&
    isStrOrNull(v.reason)
  );
}

function isKnowledgeData(d: unknown): boolean {
  return (
    isObj(d) &&
    typeof d.complete === 'boolean' &&
    Array.isArray(d.items) && d.items.every(isKnowledgeItem) &&
    Array.isArray(d.issues) && d.issues.every(isKnowledgeIssue) &&
    // `complete` must agree with the issues: a payload cannot claim completeness next to a warning.
    d.complete === !d.issues.some((i: unknown) => isObj(i) && i.severity === 'warn')
  );
}

function isHistoryCheckpoint(v: unknown): boolean {
  return isObj(v) && isStr(v.id) && isStr(v.createdAt) && isStr(v.summary) && Array.isArray(v.remainingSteps) && v.remainingSteps.every(isStr) && isStrOrNull(v.context);
}

function isHistoryMission(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.title) &&
    isStr(v.system) &&
    isStr(v.status) &&
    MISSION_STATUSES.includes(v.status) &&
    isStr(v.startedAt) &&
    isStr(v.updatedAt) &&
    isStrOrNull(v.summary) &&
    isStrOrNull(v.storyId) &&
    isCount(v.checkpointCount) &&
    typeof v.checkpointsTruncated === 'boolean' &&
    Array.isArray(v.checkpoints) &&
    v.checkpoints.every(isHistoryCheckpoint)
  );
}

const HISTORY_EVENT_KINDS = ['mission_started', 'checkpoint', 'mission_finished'];
function isHistoryEvent(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.kind) &&
    HISTORY_EVENT_KINDS.includes(v.kind) &&
    isStr(v.at) &&
    isStr(v.missionId) &&
    isStr(v.missionTitle) &&
    isStrOrNull(v.checkpointId) &&
    isStrOrNull(v.summary) &&
    isStrOrNull(v.result)
  );
}

function isHistory(d: unknown): boolean {
  if (!isObj(d) || !isObj(d.counts)) return false;
  const c = d.counts;
  return (
    Array.isArray(d.missions) &&
    d.missions.every(isHistoryMission) &&
    isCount(d.totalMissions) &&
    typeof d.truncated === 'boolean' &&
    isCount(c.in_progress) &&
    isCount(c.completed) &&
    isCount(c.failed) &&
    isCount(c.cancelled) &&
    isCount(d.totalCheckpoints) &&
    isCount(d.orphanCheckpoints) &&
    Array.isArray(d.recent) &&
    d.recent.every(isHistoryEvent)
  );
}

const IDEA_STATUSES = ['inbox', 'planned', 'archived'];
function isIdea(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.title) &&
    isStr(v.status) &&
    IDEA_STATUSES.includes(v.status) &&
    isStr(v.createdAt) &&
    isStr(v.description) &&
    typeof v.descriptionTruncated === 'boolean' &&
    isStrOrNull(v.context) &&
    Array.isArray(v.tags) &&
    v.tags.every(isStr) &&
    Array.isArray(v.paths) &&
    v.paths.every(isStr) &&
    isStr(v.path)
  );
}

function isIdeas(d: unknown): boolean {
  return (
    isObj(d) &&
    Array.isArray(d.items) &&
    d.items.every(isIdea) &&
    Array.isArray(d.issues) &&
    d.issues.every((i) => isObj(i) && isStr(i.id) && (i.code === 'IDEA_CORRUPT' || i.code === 'IDEA_UNSAFE_PATH')) &&
    typeof d.truncated === 'boolean' &&
    typeof d.complete === 'boolean'
  );
}

function isOverview(d: unknown): boolean {
  return (
    isObj(d) &&
    isStrOrNull(d.name) &&
    isNumOrNull(d.stateRevision) &&
    (d.activeMissionCount === undefined || isCountOrNull(d.activeMissionCount)) &&
    (d.finishedMissionCount === undefined || isCountOrNull(d.finishedMissionCount)) &&
    (d.storyClaim === undefined || d.storyClaim === null || isStoryClaim(d.storyClaim)) &&
    (d.currentStory === null || (isObj(d.currentStory) && isStr(d.currentStory.excerpt) && isStr(d.currentStory.lineRange)))
  );
}

export function isDashboardReadModel(v: unknown): v is DashboardReadModel {
  if (!isObj(v)) return false;
  const diag = v.diagnostics;
  return (
    isSection(v.projectOverview, isOverview) &&
    isSection(v.currentMissions, (d) => isObj(d) && Array.isArray(d.active) && d.active.every(isMission)) &&
    isSection(
      v.checkpoints,
      (d) =>
        isObj(d) &&
        Array.isArray(d.byActiveMission) &&
        d.byActiveMission.every(
          (m) => isObj(m) && isStr(m.missionId) && isNum(m.count) && (m.latest === null || isCheckpoint(m.latest)),
        ),
    ) &&
    isSection(v.roadmap, (d) => isObj(d) && isStr(d.text) && (d.structured === undefined || isStructuredRoadmap(d.structured))) &&
    (v.storyIndex === undefined || isSection(v.storyIndex, isStructuredStoryIndex)) &&
    (v.history === undefined || isSection(v.history, isHistory)) &&
    (v.ideas === undefined || isSection(v.ideas, isIdeas)) &&
    (v.hypotheses === undefined || isSection(v.hypotheses, isKnowledgeData)) &&
    (v.decisions === undefined || isSection(v.decisions, isKnowledgeData)) &&
    isObj(diag) &&
    (diag.state === undefined || isProvenance(diag.state)) &&
    Array.isArray(diag.sources) &&
    diag.sources.every(isSourceReport) &&
    Array.isArray(diag.notes) &&
    diag.notes.every((n) => isObj(n) && isStr(n.code) && (n.severity === 'info' || n.severity === 'warn'))
  );
}
