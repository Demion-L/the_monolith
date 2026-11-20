/**
 * `runGovernanceCheck(projectRoot)` — read-only governance integrity report (GOV-EVOLUTION Phase 5).
 *
 * No second parser: every area is read from what Core already computes — the Mission Control
 * read model (`readDashboardModel`: Roadmap parser, Story Index parser, Story State Resolver,
 * ADR/Hypotheses/Ideas readers, Development History) and `validateProject` for the scaffold.
 * The only new logic is the structural check of story capsules (`capsules.ts`) and the mapping of
 * Core's own diagnostics onto INFO / WARNING / ERROR. Nothing is written, no LLM, no network,
 * no timestamps: unchanged files give an identical report.
 *
 * `monolith validate` keeps its contract (scaffold checks); this report is separate and is never
 * a precondition of `monolith finalize`.
 */

import { sanitizeSingleLine } from '../brief/sanitize.js';
import { compareStrings } from '../brief/selectors.js';
import { loadStoryAuthority, readDashboardModel, resolveStoryStateIn } from '../readmodel/index.js';
import type { DashboardReadModel, KnowledgeData, Section } from '../readmodel/index.js';
import { validateProject } from '../validate/index.js';
import { scanCapsules } from './capsules.js';
import type { GovernanceArea, GovernanceAreaId, GovernanceAreaStatus, GovernanceFinding, GovernanceReport, GovernanceSeverity } from './types.js';

const AREA_ORDER: GovernanceAreaId[] = ['instance', 'roadmap', 'activeStory', 'storyIndex', 'capsules', 'adr', 'hypotheses', 'missions', 'ideas'];
const AREA_LABEL: Record<GovernanceAreaId, string> = {
  instance: 'Instance structure',
  roadmap: 'Roadmap',
  activeStory: 'Active Story',
  storyIndex: 'Story Index',
  capsules: 'Story Capsules',
  adr: 'ADR',
  hypotheses: 'Hypotheses',
  missions: 'Missions',
  ideas: 'Ideas',
};
const SEV_RANK: Record<GovernanceSeverity, number> = { ERROR: 0, WARNING: 1, INFO: 2 };
const MAX_MESSAGE = 300;

const clean = (s: string): string => {
  const one = sanitizeSingleLine(s);
  return one.length <= MAX_MESSAGE ? one : `${one.slice(0, MAX_MESSAGE - 1)}…`;
};

/** Core diagnostic codes whose meaning is a contradiction or a duplicated identity: ERROR, not WARNING. */
const ERROR_CODES = new Set([
  'PHASE_STATUS_CONFLICT',
  'PHASE_ID_DUPLICATE',
  'PHASES_SECTION_DUPLICATED',
  'ACTIVE_PHASE_CONFLICT',
  'ACTIVE_PHASE_AMBIGUOUS_ID',
  'STORY_ID_DUPLICATE',
  'STORY_STATUS_CONFLICT',
  'STORY_PHASE_AMBIGUOUS',
  'ADR_ID_DUPLICATE',
  'ADR_ID_MISMATCH',
  'HYP_ID_DUPLICATE',
  'HYP_STATUS_CONFLICT',
]);

const MESSAGES: Record<string, string> = {
  DOCUMENT_EMPTY: 'The document is empty.',
  PHASES_SECTION_MISSING: 'No "## Phases" section was found.',
  PHASES_SECTION_DUPLICATED: 'More than one "## Phases" section exists.',
  NO_PHASES_FOUND: 'The Phases section lists no phase.',
  PHASE_HEADING_MALFORMED: 'A phase heading is not in the form "### Phase <id> — <title>".',
  PHASES_TRUNCATED: 'Too many phases; the list was cut.',
  PHASE_STATUS_MISSING: 'A phase has no "**Status:**" line.',
  PHASE_STATUS_EMPTY: 'A phase has an empty status.',
  PHASE_STATUS_CONFLICT: 'A phase declares contradictory statuses.',
  PHASE_STATUS_UNRECOGNIZED: 'A phase status is not one of PLANNED, IN PROGRESS, COMPLETE, NOT DEFINED (READY FOR REVIEW is a Story state, not a Phase status).',
  PHASE_DETAILS_TRUNCATED: 'A phase description was shortened.',
  PHASE_ID_DUPLICATE: 'A phase id is declared more than once.',
  ACTIVE_PHASE_CONFLICT: 'Contradictory "Active Phase:" lines.',
  ACTIVE_PHASE_UNMATCHED: 'The "Active Phase:" pointer matches no phase. Write the bare id, e.g. "Active Phase: 6 — Title" (not "Phase 6").',
  ACTIVE_PHASE_AMBIGUOUS_ID: 'The "Active Phase:" id is declared by more than one phase.',
  ACTIVE_PHASE_REPORTED_COMPLETE: 'The active phase is reported COMPLETE.',
  STORIES_NOT_FOUND: 'No story entry was found in the story index.',
  NO_FINALIZED_STORIES: 'No story has been finalized yet (expected before the first finalization).',
  STORY_HEADING_MALFORMED: 'A story heading is not in the form "### STORY <id> — <title>".',
  STORIES_TRUNCATED: 'Too many stories; the list was cut.',
  STORY_ID_DUPLICATE: 'A story id is declared more than once.',
  STORY_OUTSIDE_PHASE: 'A story is not nested under a "## Phase <id>" heading.',
  STORY_STATUS_MISSING: 'A story entry has no "**Status:**" line.',
  STORY_STATUS_EMPTY: 'A story entry has an empty status.',
  STORY_STATUS_CONFLICT: 'A story entry declares contradictory statuses.',
  STORY_STATUS_UNRECOGNIZED: 'A story status is not a recognised value.',
  STORY_PHASE_UNMATCHED: 'A story is nested under a phase id that the Roadmap does not declare.',
  STORY_PHASE_AMBIGUOUS: 'A story is nested under a phase id that the Roadmap declares more than once.',
  STORY_PHASE_UNVERIFIED: 'The phase of a story could not be verified because the Roadmap is incomplete.',
  ITEMS_TRUNCATED: 'Too many items; the list was cut.',
  HYP_HEADING_MALFORMED: 'A hypothesis heading is not in the form "## Title {#HYP-NNN}".',
  HYP_ID_DUPLICATE: 'A hypothesis id is declared more than once.',
  HYP_STATUS_MISSING: 'A hypothesis has no "**Status:**" line.',
  HYP_STATUS_EMPTY: 'A hypothesis has an empty status.',
  HYP_STATUS_CONFLICT: 'A hypothesis declares contradictory statuses.',
  ADR_FILE_UNREADABLE: 'The ADR file could not be read.',
  ADR_FILENAME_UNRECOGNIZED: 'The file name does not match ADR-NNN-<slug>.md.',
  ADR_FRONTMATTER_MISSING: 'The ADR has no YAML frontmatter, so it is not listed. Expected a "---" block with at least id (equal to the file-name id) and status; see context/templates/adr-template.md.',
  ADR_FRONTMATTER_MALFORMED: 'The ADR frontmatter is not terminated or cannot be read, so the ADR is not listed.',
  ADR_ID_MISSING: 'The ADR frontmatter has no id, so it is not listed.',
  ADR_ID_INVALID: 'The ADR id has an invalid shape, so it is not listed.',
  ADR_ID_MISMATCH: 'The ADR frontmatter id differs from the id in the file name.',
  ADR_ID_DUPLICATE: 'Two ADR files declare the same id; neither is listed.',
  ADR_FIELD_DUPLICATE: 'An ADR frontmatter field is declared more than once.',
  ADR_STATUS_MISSING: 'The ADR frontmatter has no status.',
  ADR_LINK_INVALID: 'An ADR supersedes/superseded_by value is not an ADR id.',
  INTERNAL: 'The document could not be processed (internal fault).',
};

class Collector {
  readonly list: GovernanceFinding[] = [];
  add(area: GovernanceAreaId, severity: GovernanceSeverity, code: string, message: string, path: string | null): void {
    this.list.push({ area, severity, code, message: clean(message), path });
  }
  /** Core's own diagnostic (`info` | `warn`) onto the three severities. */
  core(area: GovernanceAreaId, sev: 'info' | 'warn', code: string, path: string | null, extra = ''): void {
    const severity: GovernanceSeverity = sev === 'info' ? 'INFO' : ERROR_CODES.has(code) ? 'ERROR' : 'WARNING';
    this.add(area, severity, code, `${MESSAGES[code] ?? code}${extra}`, path);
  }
}

function knowledge(c: Collector, area: 'adr' | 'hypotheses', sec: Section<KnowledgeData> | undefined, sourceName: string): { status: GovernanceAreaStatus } {
  if (sec === undefined) return { status: 'NOT_CHECKED' };
  const src = sec.sources[0];
  if (sec.data === null) {
    if (src?.status === 'absent') {
      c.add(area, 'INFO', 'SOURCE_ABSENT', `${sourceName} does not exist (nothing recorded yet).`, src.path);
      return { status: 'ABSENT' };
    }
    c.add(area, 'ERROR', src?.code ?? 'SOURCE_UNREADABLE', `${sourceName} could not be read (${src?.status ?? 'unknown'}).`, src?.path ?? null);
    return { status: 'ISSUES' };
  }
  for (const i of sec.data.issues) c.core(area, i.severity, i.code, i.path, i.id ? ` (${i.id})` : '');
  return { status: sec.data.items.length === 0 && sec.data.issues.length === 0 ? 'EMPTY' : 'AVAILABLE' };
}

function finish(findings: GovernanceFinding[], statuses: Map<GovernanceAreaId, GovernanceAreaStatus>, project: string | null): GovernanceReport {
  const areas: GovernanceArea[] = AREA_ORDER.map((id) => {
    const worst = findings.some((f) => f.area === id && f.severity !== 'INFO');
    return { id, label: AREA_LABEL[id], status: worst ? 'ISSUES' : (statuses.get(id) ?? 'NOT_CHECKED') };
  });
  const order = (a: GovernanceFinding): number => AREA_ORDER.indexOf(a.area);
  const sorted = [...findings].sort(
    (a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
      order(a) - order(b) ||
      compareStrings(a.path ?? '', b.path ?? '') ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.message, b.message),
  );
  const count = (s: GovernanceSeverity): number => sorted.filter((f) => f.severity === s).length;
  const counts = { error: count('ERROR'), warning: count('WARNING'), info: count('INFO') };
  return { project, areas, findings: sorted, counts, result: counts.error + counts.warning > 0 ? 'ISSUES_FOUND' : 'NO_ISSUES' };
}

function instance(c: Collector, projectRoot: string): GovernanceAreaStatus {
  try {
    const report = validateProject(projectRoot);
    for (const chk of report.checks) {
      if (!chk.passed) c.add('instance', 'ERROR', `VALIDATE_${chk.id.toUpperCase()}`, `${chk.label}: ${chk.error ?? 'failed'}`.split(projectRoot).join('<project>'), null);
    }
    if (report.warning !== null) c.add('instance', 'WARNING', 'WRITE_ARTIFACTS_PRESENT', report.warning.split(projectRoot).join('<project>'), null);
    return report.passed ? 'PASS' : 'ISSUES';
  } catch {
    c.add('instance', 'ERROR', 'VALIDATE_FAILED_TO_RUN', 'The instance structure check could not run.', null);
    return 'ISSUES';
  }
}

export function buildGovernanceReport(projectRoot: string, model: DashboardReadModel = readDashboardModel(projectRoot)): GovernanceReport {
  const c = new Collector();
  const statuses = new Map<GovernanceAreaId, GovernanceAreaStatus>();
  statuses.set('instance', instance(c, projectRoot));

  const overview = model.projectOverview.data;
  const project = overview?.name ?? null;
  if (overview === null) {
    // The instance root could not be trusted: nothing below it was read, so nothing below it is judged.
    c.add('instance', 'ERROR', 'ROOT_UNTRUSTED', 'The MONOLITH instance root could not be established (configuration missing, corrupt or unsafe); no governance document was read.', null);
    return finish(c.list, statuses, project);
  }
  const root = overview.monolithRoot;

  // ---- Roadmap ----
  const rm = model.roadmap;
  const rmSrc = rm.sources[0];
  if (rm.data === null) {
    if (rmSrc?.status === 'absent') c.add('roadmap', 'WARNING', 'SOURCE_ABSENT', 'roadmap-index.md does not exist.', rmSrc.path);
    else c.add('roadmap', 'ERROR', rmSrc?.code ?? 'SOURCE_UNREADABLE', `roadmap-index.md could not be read (${rmSrc?.status ?? 'unknown'}).`, rmSrc?.path ?? null);
    statuses.set('roadmap', rmSrc?.status === 'absent' ? 'ABSENT' : 'ISSUES');
  } else {
    const s = rm.data.structured;
    if (s === undefined) {
      c.add('roadmap', 'WARNING', 'ROADMAP_NOT_INTERPRETED', 'The roadmap was read but not interpreted.', rmSrc?.path ?? null);
    } else {
      for (const d of s.diagnostics) {
        const phase = d.phaseIndex === null ? null : s.phases[d.phaseIndex];
        c.core('roadmap', d.severity, d.code, rmSrc?.path ?? null, phase ? ` (phase ${phase.id ?? '?'})` : '');
      }
      if (s.state === 'unrecognized') c.add('roadmap', 'ERROR', 'ROADMAP_UNRECOGNIZED', 'The roadmap has no "## Phases" section, so no phase can be read.', rmSrc?.path ?? null);
      if (s.state === 'error') c.add('roadmap', 'ERROR', 'ROADMAP_ERROR', 'The roadmap could not be processed; its structure must not be trusted.', rmSrc?.path ?? null);
      if (s.activePhase.kind === 'not_declared') c.add('roadmap', 'INFO', 'ACTIVE_PHASE_NOT_DECLARED', 'The roadmap declares no "Active Phase:" pointer (write "Active Phase: —" for none).', rmSrc?.path ?? null);
    }
    statuses.set('roadmap', s !== undefined && s.state === 'ok' ? 'PASS' : 'AVAILABLE');
  }

  // ---- Active story (the Story State Resolver's own consistency verdict) ----
  const claim = overview.storyClaim;
  const activeSrc = model.diagnostics.sources.find((x) => x.id === 'activeStory');
  if (activeSrc !== undefined && activeSrc.status !== 'available') {
    c.add('activeStory', activeSrc.status === 'absent' ? 'WARNING' : 'ERROR', activeSrc.code ?? 'SOURCE_UNREADABLE', `active.md is ${activeSrc.status}.`, activeSrc.path);
    statuses.set('activeStory', activeSrc.status === 'absent' ? 'ABSENT' : 'ISSUES');
  } else if (overview.currentStory === null) {
    c.add('activeStory', 'WARNING', 'ACTIVE_MD_NO_CURRENT_STORY', 'active.md has no usable "## Current Story" section.', activeSrc?.path ?? null);
  } else if (claim?.kind === 'none') {
    c.add('activeStory', 'INFO', 'NO_ACTIVE_STORY', 'No active story is declared.', activeSrc?.path ?? null);
    statuses.set('activeStory', 'EMPTY');
  } else if (claim?.kind === 'ids') {
    const resolved = model.storyState?.data?.activeStory ?? null;
    if (resolved === null) {
      c.add('activeStory', 'WARNING', 'ACTIVE_STORY_UNRESOLVED', `${claim.ids.length} story ids are declared; exactly one is required.`, activeSrc?.path ?? null);
    } else {
      for (const d of resolved.diagnostics) {
        const sev: GovernanceSeverity = d.level === 'conflict' ? 'ERROR' : d.level === 'info' ? 'INFO' : 'WARNING';
        c.add('activeStory', sev, d.code, d.message, d.sources[0] ? documentPath(root, d.sources[0].document) : null);
      }
      statuses.set('activeStory', 'PASS');
    }
  } else {
    c.add('activeStory', 'WARNING', 'ACTIVE_STORY_UNCLASSIFIED', 'The "## Current Story" section declares neither "No active story." nor exactly one "**Story:** <id>" line.', activeSrc?.path ?? null);
  }
  if (!statuses.has('activeStory')) statuses.set('activeStory', 'AVAILABLE');

  // ---- Story index ----
  const si = model.storyIndex;
  const siSrc = si?.sources[0];
  if (si === undefined) {
    statuses.set('storyIndex', 'NOT_CHECKED');
  } else if (si.data === null) {
    if (siSrc?.status === 'absent') c.add('storyIndex', 'WARNING', 'SOURCE_ABSENT', 'story-index.md does not exist.', siSrc.path);
    else c.add('storyIndex', 'ERROR', siSrc?.code ?? 'SOURCE_UNREADABLE', `story-index.md could not be read (${siSrc?.status ?? 'unknown'}).`, siSrc?.path ?? null);
    statuses.set('storyIndex', siSrc?.status === 'absent' ? 'ABSENT' : 'ISSUES');
  } else {
    for (const d of si.data.diagnostics) {
      const story = d.storyIndex === null ? null : si.data.stories[d.storyIndex];
      c.core('storyIndex', d.severity, d.code, siSrc?.path ?? null, story ? ` (${story.id})` : '');
    }
    if (si.data.state === 'unrecognized') c.add('storyIndex', 'ERROR', 'STORY_INDEX_UNRECOGNIZED', 'story-index.md has no "# Stories" section and no story entries; its structure is not recognised (see context/templates and protocols/governance/document-formats.md).', siSrc?.path ?? null);
    if (si.data.state === 'error') c.add('storyIndex', 'ERROR', 'STORY_INDEX_ERROR', 'story-index.md could not be processed; its structure must not be trusted.', siSrc?.path ?? null);
    statuses.set('storyIndex', si.data.state === 'none_finalized' ? 'EMPTY' : si.data.state === 'ok' ? 'PASS' : 'AVAILABLE');
  }

  // ---- Story capsules ----
  const cap = scanCapsules(projectRoot, root);
  c.list.push(...cap.findings);
  statuses.set('capsules', cap.absent || cap.examined === 0 ? 'EMPTY' : 'PASS');
  if (cap.absent || cap.examined === 0) c.add('capsules', 'INFO', 'NO_CAPSULES', 'No story capsule exists yet (expected before the first finalization).', null);

  // ---- ADR / Hypotheses ----
  statuses.set('adr', knowledge(c, 'adr', model.decisions, 'docs/adr').status);
  statuses.set('hypotheses', knowledge(c, 'hypotheses', model.hypotheses, 'hypotheses.md').status);

  // ---- Missions (Durable State, read-only) ----
  const stateSrc = model.diagnostics.sources.find((x) => x.id === 'state');
  if (model.history?.data) {
    const h = model.history.data;
    statuses.set('missions', h.totalMissions === 0 ? 'EMPTY' : 'AVAILABLE');
    if (h.orphanCheckpoints > 0) c.add('missions', 'WARNING', 'ORPHAN_CHECKPOINTS', `${h.orphanCheckpoints} checkpoint(s) belong to no recorded mission.`, null);
  } else if (stateSrc !== undefined && stateSrc.status !== 'available') {
    c.add('missions', 'ERROR', stateSrc.code ?? 'SOURCE_UNREADABLE', `The operational state is ${stateSrc.status}.`, null);
    statuses.set('missions', 'ISSUES');
  } else {
    statuses.set('missions', 'NOT_CHECKED');
  }
  if (model.history?.data) missionStoryLinks(c, projectRoot, root, model.history.data.missions);
  for (const n of model.diagnostics.notes) {
    if (n.code === 'STATE_SPLIT_BRAIN') c.add('missions', 'WARNING', n.code, 'Independent operational states exist next to the shared one; MONOLITH does not choose between them.', null);
    if (n.code === 'MULTIPLE_ACTIVE_MISSIONS') c.add('missions', 'INFO', n.code, 'More than one mission is in progress.', null);
  }

  // ---- Ideas ----
  const ideas = model.ideas;
  if (ideas === undefined) {
    statuses.set('ideas', 'NOT_CHECKED');
  } else if (ideas.data === null) {
    const s = ideas.sources[0];
    if (s?.status === 'absent') {
      c.add('ideas', 'INFO', 'SOURCE_ABSENT', 'No idea has been captured yet.', s.path);
      statuses.set('ideas', 'ABSENT');
    } else {
      c.add('ideas', 'WARNING', s?.code ?? 'SOURCE_UNREADABLE', `The ideas directory could not be read (${s?.status ?? 'unknown'}).`, s?.path ?? null);
    }
  } else {
    for (const i of ideas.data.issues) c.add('ideas', 'WARNING', i.code, `${i.id} could not be read as an idea.`, `${root}/memory/long-term/ideas/${i.id}.md`);
    statuses.set('ideas', ideas.data.items.length === 0 && ideas.data.issues.length === 0 ? 'EMPTY' : 'AVAILABLE');
  }

  return finish(c.list, statuses, project);
}

function documentPath(root: string, document: string): string | null {
  switch (document) {
    case 'active.md':
      return `${root}/memory/working/active.md`;
    case 'roadmap-index.md':
      return `${root}/context/maps/roadmap-index.md`;
    case 'story-index.md':
      return `${root}/memory/working/story-index.md`;
    default:
      return null;
  }
}

/**
 * Workflow integrity (ACCOUNTABILITY-001): Mission → Story links, checked only against what the Story State
 * Resolver can state definitively. A link is flagged only when every authoritative document was read and none
 * lists the story (`NOT_LISTED` + `NOT_ACTIVE` + `NOT_FINALIZED`); an unreadable document leaves the fact UNKNOWN
 * and produces no finding. Nothing is inferred: a mission without a `storyId` is not an error (exploratory work),
 * a finished mission does not finalize its story, and a story awaiting review is not finalized.
 */
function missionStoryLinks(c: Collector, projectRoot: string, root: string, missions: { id: string; status: string; storyId: string | null }[]): void {
  const linked = missions.filter((m) => m.storyId !== null);
  if (linked.length === 0) return;
  const ctx = loadStoryAuthority(projectRoot, root);
  if (ctx === null) return;
  const byStory = new Map<string, typeof linked>();
  for (const m of linked) byStory.set(m.storyId as string, [...(byStory.get(m.storyId as string) ?? []), m]);
  for (const storyId of [...byStory.keys()].sort(compareStrings)) {
    const ms = byStory.get(storyId) ?? [];
    const ids = ms.slice(0, 5).map((m) => m.id).join(', ') + (ms.length > 5 ? ', …' : '');
    const r = resolveStoryStateIn(ctx, storyId);
    const notListed = r.planning.state === 'NOT_LISTED' && r.active.state === 'NOT_ACTIVE' && r.finalization.state === 'NOT_FINALIZED';
    if (notListed) {
      c.add('missions', 'WARNING', 'MISSION_STORY_UNKNOWN', `Mission(s) ${ids} reference story ${storyId}, which the roadmap, active.md and story-index.md do not list (the link is recorded, not verified).`, null);
    }
    const inProgress = ms.filter((m) => m.status === 'in_progress');
    if (inProgress.length > 0 && r.finalization.state === 'FINALIZED') {
      c.add('missions', 'WARNING', 'MISSION_ACTIVE_ON_FINALIZED_STORY', `Mission(s) ${inProgress.map((m) => m.id).join(', ')} are in progress on story ${storyId}, which story-index.md reports as finalized.`, null);
    }
  }
}
