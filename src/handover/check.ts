/**
 * `buildHandoverReport(projectRoot)` — read-only autonomous-development handover (ACCOUNTABILITY-001, Phase 5).
 *
 * Everything comes from sources Core already owns; nothing is written, no test is run, no LLM or network is
 * involved. The only subprocess is read-only `git` (HEAD / working-tree state) for evidence freshness.
 * Deterministic: unchanged files, unchanged git state and unchanged evidence give an identical report.
 */

import { sanitizeSingleLine } from '../brief/sanitize.js';
import { compareStrings } from '../brief/selectors.js';
import { buildGovernanceReport } from '../governance/check.js';
import { loadStoryAuthority, readDashboardModel, resolveStoryStateIn } from '../readmodel/index.js';
import type { DashboardReadModel, HistoryMissionView, KnowledgeItemView } from '../readmodel/index.js';
import { assessAll, evidenceStore, listEvidence, EVIDENCE_REL, type EvidenceLevel } from './evidence.js';
import { readGitView } from './git.js';
import type { GitView } from './git.js';
import {
  HANDOVER_SCHEMA,
  type HandoverEvidenceItem,
  type HandoverIssue,
  type HandoverMissionRef,
  type HandoverOwnerDecision,
  type HandoverReport,
  type HandoverStatus,
  type HandoverStory,
} from './types.js';

export const MAX_HANDOVER_STORIES = 200;
export const MAX_HANDOVER_ISSUES = 50;
export const MAX_HANDOVER_EVIDENCE = 100;
export const MAX_HANDOVER_REFS = 20;

const LIMITATIONS = [
  'This report restates what the project documents, Development History and recorded evidence say; it runs no tests.',
  'REPORTED evidence is somebody\'s statement and is not verification. VERIFIED means: MONOLITH itself ran the stated command, it passed, and the recorded revision still equals HEAD on a clean working tree.',
  'A matching revision shows the committed files are unchanged since the check; it does not show the check is adequate.',
  'A finished mission does not finalize its story. Finalization is a separate, owner-approved step (`monolith finalize`).',
  'No issue listed does not mean the project is correct.',
];

const clean = (s: string, max = 300): string => {
  const one = sanitizeSingleLine(s);
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
};

const CONFLICT_CODE_RE = /CONFLICT|DUPLICATE|MISMATCH|AMBIGUOUS|ACTIVE_AND_FINALIZED/;

function ref(m: HistoryMissionView): HandoverMissionRef {
  return { id: m.id, title: clean(m.title, 120), storyId: m.storyId, checkpointCount: m.checkpointCount };
}

function activePhase(model: DashboardReadModel): HandoverReport['project']['activePhase'] {
  const s = model.roadmap.data?.structured;
  if (s === undefined) return { kind: 'unknown', id: null };
  const a = s.activePhase;
  return { kind: a.kind, id: a.kind === 'phase' ? a.id : null };
}

function adrSummary(model: DashboardReadModel): { arch: HandoverReport['architecture']; proposed: KnowledgeItemView[] } {
  const sec = model.decisions;
  if (sec === undefined || sec.data === null) {
    return { arch: { available: false, total: 0, accepted: 0, proposed: 0, other: [], unrecognized: 0, missingMetadata: 0, complete: false }, proposed: [] };
  }
  const items = sec.data.items;
  const norm = (s: string | null): string => (s ?? '').trim().toLowerCase();
  const accepted = items.filter((i) => norm(i.status) === 'accepted').length;
  const proposedItems = items.filter((i) => norm(i.status) === 'proposed');
  const others = new Map<string, number>();
  for (const i of items) {
    const n = norm(i.status);
    if (n === 'accepted' || n === 'proposed') continue;
    const k = i.status === null ? '(none)' : clean(i.status, 60);
    others.set(k, (others.get(k) ?? 0) + 1);
  }
  const unrecognizedCodes = new Set(['ADR_FILENAME_UNRECOGNIZED', 'ADR_FILE_UNREADABLE', 'ADR_FRONTMATTER_MALFORMED']);
  const missingCodes = new Set(['ADR_FRONTMATTER_MISSING', 'ADR_ID_MISSING', 'ADR_ID_INVALID', 'ADR_STATUS_MISSING']);
  return {
    arch: {
      available: true,
      total: items.length,
      accepted,
      proposed: proposedItems.length,
      other: [...others.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => compareStrings(a.status, b.status)),
      unrecognized: sec.data.issues.filter((i) => unrecognizedCodes.has(i.code)).length,
      missingMetadata: sec.data.issues.filter((i) => missingCodes.has(i.code)).length,
      complete: sec.data.complete,
    },
    proposed: proposedItems,
  };
}

export interface HandoverDeps {
  model?: DashboardReadModel;
  git?: GitView;
}

export function buildHandoverReport(projectRoot: string, deps: HandoverDeps = {}): HandoverReport {
  const model = deps.model ?? readDashboardModel(projectRoot);
  const overview = model.projectOverview.data;
  const base = emptyReport();
  if (overview === null) {
    return { ...base, status: 'UNKNOWN', statusReasons: ['INSTANCE_NOT_ESTABLISHED'], sources: ['monolith.config.json'] };
  }
  const root = overview.monolithRoot;
  const governance = buildGovernanceReport(projectRoot, model);
  const issues: HandoverIssue[] = [];
  const decisions: HandoverOwnerDecision[] = [];
  const reasons = new Set<string>();

  // ---- Governance ----
  for (const f of governance.findings) {
    if (f.severity === 'INFO') continue;
    issues.push({
      code: f.code,
      kind: f.severity === 'ERROR' && CONFLICT_CODE_RE.test(f.code) ? 'conflict' : 'attention',
      message: clean(`[${f.area}] ${f.message}`),
      basis: f.path ?? 'monolith governance check',
    });
  }

  // ---- Core sources available? ----
  const stateSrc = model.diagnostics.sources.find((s) => s.id === 'state');
  const coreSources: [string, boolean][] = [
    ['STATE_UNAVAILABLE', stateSrc?.status === 'available'],
    ['ROADMAP_UNAVAILABLE', model.roadmap.data !== null],
    ['STORY_INDEX_UNAVAILABLE', model.storyIndex?.data != null],
    ['ACTIVE_STORY_UNAVAILABLE', overview.currentStory !== null],
  ];
  for (const [code, ok] of coreSources) if (!ok) reasons.add(code);
  const incomplete = reasons.size > 0;

  // ---- Missions ----
  const hist = model.history?.data ?? null;
  const missionsBlock = base.missions;
  const byStory = new Map<string, HistoryMissionView[]>();
  if (hist !== null) {
    missionsBlock.total = hist.totalMissions;
    missionsBlock.inProgress = hist.counts.in_progress;
    missionsBlock.completed = hist.counts.completed;
    missionsBlock.failed = hist.counts.failed;
    missionsBlock.cancelled = hist.counts.cancelled;
    missionsBlock.checkpoints = hist.totalCheckpoints;
    missionsBlock.orphanCheckpoints = hist.orphanCheckpoints;
    missionsBlock.truncated = hist.truncated;
    missionsBlock.withoutStoryLink = hist.missions.filter((m) => m.storyId === null).length;
    const inProg = hist.missions.filter((m) => m.status === 'in_progress');
    missionsBlock.active = inProg.slice(0, MAX_HANDOVER_REFS).map(ref);
    missionsBlock.activeWithoutCheckpoint = inProg.filter((m) => m.checkpointCount === 0).slice(0, MAX_HANDOVER_REFS).map(ref);
    missionsBlock.failedMissions = hist.missions.filter((m) => m.status === 'failed').slice(0, MAX_HANDOVER_REFS).map(ref);
    for (const m of hist.missions) if (m.storyId !== null) byStory.set(m.storyId, [...(byStory.get(m.storyId) ?? []), m]);
    if (inProg.length > 0) issues.push({ code: 'MISSIONS_IN_PROGRESS', kind: 'attention', message: `${inProg.length} mission(s) are still in progress: ${inProg.slice(0, 5).map((m) => m.id).join(', ')}.`, basis: 'monolith mission list' });
    if (hist.counts.failed > 0) issues.push({ code: 'MISSIONS_FAILED', kind: 'attention', message: `${hist.counts.failed} mission(s) ended as failed: ${missionsBlock.failedMissions.slice(0, 5).map((m) => m.id).join(', ')}.`, basis: 'monolith mission list' });
    if (hist.truncated) issues.push({ code: 'MISSION_LIST_TRUNCATED', kind: 'attention', message: 'The mission list was cut; counts cover every mission, details only the newest.', basis: 'monolith mission list' });
  }

  // ---- Evidence ----
  const store = (() => {
    try {
      return evidenceStore(projectRoot);
    } catch {
      return null;
    }
  })();
  const evidenceDirRel = store?.dirRel ?? `${root}/${EVIDENCE_REL}`;
  const view = deps.git ?? readGitView(projectRoot, [evidenceDirRel]);
  const listing = listEvidence(projectRoot);
  const assessed = assessAll(projectRoot, listing.records, view, [evidenceDirRel]);
  const evCounts = { verified: 0, reported: 0, stale: 0, unknown: 0, failed: 0 };
  const key = (l: EvidenceLevel): keyof typeof evCounts => l.toLowerCase() as keyof typeof evCounts;
  for (const a of assessed) evCounts[key(a.level)]++;
  const evByStory = new Map<string, typeof evCounts>();
  for (const a of assessed) {
    if (a.record.storyId === null) continue;
    const c = evByStory.get(a.record.storyId) ?? { verified: 0, reported: 0, stale: 0, unknown: 0, failed: 0 };
    c[key(a.level)]++;
    evByStory.set(a.record.storyId, c);
  }
  if (evCounts.failed > 0) issues.push({ code: 'EVIDENCE_FAILED', kind: 'attention', message: `${evCounts.failed} recorded check(s) failed.`, basis: evidenceDirRel });
  if (evCounts.stale > 0) issues.push({ code: 'EVIDENCE_STALE', kind: 'attention', message: `${evCounts.stale} recorded check(s) predate later changes (potentially stale); re-run them.`, basis: evidenceDirRel });
  if (evCounts.unknown > 0) issues.push({ code: 'EVIDENCE_FRESHNESS_UNKNOWN', kind: 'attention', message: `${evCounts.unknown} recorded check(s) cannot be tied to the current files (dirty tree, no git or no recorded revision).`, basis: evidenceDirRel });
  if (listing.unreadable.length > 0) issues.push({ code: 'EVIDENCE_UNREADABLE', kind: 'attention', message: `${listing.unreadable.length} evidence file(s) could not be read as records.`, basis: evidenceDirRel });
  if (!view.available) issues.push({ code: 'GIT_UNAVAILABLE', kind: 'attention', message: 'No usable git repository: evidence freshness is UNKNOWN.', basis: 'git' });
  else if (view.dirty === true) issues.push({ code: 'WORKING_TREE_DIRTY', kind: 'attention', message: 'The working tree has uncommitted changes; checks recorded earlier may not describe it.', basis: 'git status' });

  // ---- Stories ----
  const ctx = loadStoryAuthority(projectRoot, root);
  const storyIds = new Set<string>();
  if (ctx !== null) {
    for (const r of ctx.roadmapRows) storyIds.add(r.storyId);
    for (const s of ctx.storyIndex?.stories ?? []) storyIds.add(s.id);
    if (ctx.activeClaim.kind === 'ids') for (const id of ctx.activeClaim.ids) storyIds.add(id);
  }
  for (const id of byStory.keys()) storyIds.add(id);
  const stories: HandoverStory[] = [];
  const counts = { planned: 0, active: 0, finalized: 0, listedNotFinal: 0, unknown: 0 };
  const awaiting: string[] = [];
  const unverifiedStories: string[] = [];
  if (ctx !== null) {
    const seen = new Set<string>();
    for (const raw of [...storyIds].sort(compareStrings)) {
      const r = resolveStoryStateIn(ctx, raw);
      if (seen.has(r.storyId)) continue;
      seen.add(r.storyId);
      const ms = byStory.get(raw) ?? byStory.get(r.storyId) ?? [];
      const ev = evByStory.get(raw) ?? evByStory.get(r.storyId) ?? { verified: 0, reported: 0, stale: 0, unknown: 0, failed: 0 };
      const entry = r.finalization.state === 'FINALIZED' || r.finalization.state === 'LISTED_NOT_FINAL' ? r.finalization.entries[0] : undefined;
      const indexStatus = entry?.status ?? null;
      const finalized = r.finalization.state === 'FINALIZED';
      const active = r.active.state === 'ACTIVE';
      if (finalized) counts.finalized++;
      else if (active) counts.active++;
      else if (r.finalization.state === 'LISTED_NOT_FINAL') counts.listedNotFinal++;
      else if (r.planning.state === 'PLANNED') counts.planned++;
      else counts.unknown++;
      if (r.finalization.state === 'LISTED_NOT_FINAL' && indexStatus !== null && indexStatus.trim().toUpperCase() === 'READY FOR REVIEW') awaiting.push(r.storyId);
      const completed = ms.filter((m) => m.status === 'completed').length;
      if (completed > 0 && ev.verified === 0) unverifiedStories.push(r.storyId);
      if (completed > 0 && !finalized) {
        decisions.push({
          code: 'FINALIZE_STORY',
          subject: r.storyId,
          message: `${completed} mission(s) completed on ${r.storyId}, but story-index.md does not report it finalized. Finalization needs the owner's approval (monolith finalize plan/apply).`,
          basis: `${root}/memory/working/story-index.md`,
        });
      }
      if (r.consistency === 'CONFLICT') decisions.push({ code: 'RESOLVE_CONFLICT', subject: r.storyId, message: `The state documents contradict each other about ${r.storyId}.`, basis: 'monolith governance check' });
      stories.push({
        id: r.storyId,
        planned: r.planning.state === 'PLANNED' ? 'PLANNED' : r.planning.state,
        active: r.active.state === 'ACTIVE' ? 'ACTIVE' : r.active.state,
        finalization: r.finalization.state,
        indexStatus: indexStatus === null ? null : clean(indexStatus, 60),
        consistency: r.consistency,
        missions: {
          total: ms.length,
          inProgress: ms.filter((m) => m.status === 'in_progress').length,
          completed,
          failed: ms.filter((m) => m.status === 'failed').length,
          cancelled: ms.filter((m) => m.status === 'cancelled').length,
        },
        evidence: ev,
      });
    }
  }
  for (const s of unverifiedStories) {
    issues.push({ code: 'COMPLETION_UNVERIFIED', kind: 'unverified', message: `Story ${s} has completed mission(s) but no VERIFIED evidence (the completion is a claim, not a verified fact).`, basis: 'monolith evidence list' });
  }

  // ---- ADR ----
  const { arch, proposed } = adrSummary(model);
  if (!arch.available) reasons.add('ADR_UNAVAILABLE');
  for (const p of proposed.slice(0, 10)) {
    decisions.push({ code: 'ADR_PROPOSED', subject: p.id ?? '(no id)', message: `${p.id ?? 'An ADR'} is declared "proposed" and awaits a decision.`, basis: p.path ?? 'docs/adr' });
  }
  if (arch.available && arch.missingMetadata + arch.unrecognized > 0) {
    issues.push({ code: 'ADR_METADATA', kind: 'attention', message: `${arch.unrecognized} ADR file(s) unrecognised and ${arch.missingMetadata} with missing metadata; the ADR list is not exhaustive.`, basis: 'docs/adr' });
  }

  // ---- Status ----
  const hasIssues = issues.length > 0 || governance.result === 'ISSUES_FOUND';
  if (stories.length === 0 && ctx !== null) reasons.add('NO_STORIES_KNOWN');
  if (hist === null) reasons.add('MISSIONS_UNAVAILABLE');
  const status: HandoverStatus = reasons.size > 0 ? 'INCOMPLETE' : hasIssues ? 'REVIEW_WITH_ISSUES' : 'READY_FOR_REVIEW';
  if (status === 'REVIEW_WITH_ISSUES') {
    for (const i of issues) reasons.add(i.code);
  }
  const trimmed = issues.length > MAX_HANDOVER_ISSUES;
  const sortedIssues = [...issues].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || compareStrings(a.code, b.code) || compareStrings(a.message, b.message));
  const shownIssues = sortedIssues.slice(0, MAX_HANDOVER_ISSUES);
  if (trimmed) shownIssues.push({ code: 'ISSUES_TRUNCATED', kind: 'attention', message: `${issues.length - MAX_HANDOVER_ISSUES} more issue(s) not shown; run \`monolith governance check\`.`, basis: 'monolith governance check' });

  const items: HandoverEvidenceItem[] = assessed.slice(-MAX_HANDOVER_EVIDENCE).map((a) => ({
    id: a.record.id,
    storyId: a.record.storyId,
    command: a.record.command,
    result: a.record.result,
    provenance: a.record.provenance,
    level: a.level,
    freshness: a.freshness,
    freshnessReason: a.reason,
    recordedAt: a.record.recordedAt,
    gitHead: a.record.gitHead,
    dirty: a.record.dirty,
    source: `${evidenceDirRel}/${a.record.id}.json`,
  }));

  const claim = overview.storyClaim;
  return {
    schema: HANDOVER_SCHEMA,
    status,
    statusReasons: [...reasons].sort(compareStrings),
    project: {
      name: overview.name,
      activePhase: activePhase(model),
      currentStory: claim === null ? { kind: 'unknown', ids: [] } : { kind: claim.kind, ids: claim.kind === 'ids' ? claim.ids.map((i) => clean(i, 80)) : [] },
      governance: { result: governance.result, errors: governance.counts.error, warnings: governance.counts.warning },
    },
    progress: {
      ...counts,
      awaitingReview: awaiting.sort(compareStrings),
      stories: stories.slice(0, MAX_HANDOVER_STORIES),
      storiesTruncated: stories.length > MAX_HANDOVER_STORIES,
    },
    missions: missionsBlock,
    architecture: arch,
    verification: {
      git: { available: view.available, head: view.head, dirty: view.dirty },
      counts: evCounts,
      items,
      unreadableRecords: listing.unreadable.length,
      recordsTruncated: listing.truncated,
      storiesWithoutVerifiedEvidence: unverifiedStories.sort(compareStrings),
    },
    outstanding: {
      issues: shownIssues,
      ownerDecisions: decisions.sort((a, b) => compareStrings(a.code, b.code) || compareStrings(a.subject, b.subject)).slice(0, MAX_HANDOVER_ISSUES),
    },
    sources: [
      `${root}/context/maps/roadmap-index.md`,
      `${root}/memory/working/story-index.md`,
      `${root}/memory/working/active.md`,
      'docs/adr',
      'operational state (monolith mission list)',
      evidenceDirRel,
      'git (HEAD, working tree; read-only)',
      'monolith governance check',
    ],
    limitations: LIMITATIONS,
  };
}

const kindRank = (k: HandoverIssue['kind']): number => (k === 'conflict' ? 0 : k === 'unverified' ? 1 : 2);

function emptyReport(): HandoverReport {
  return {
    schema: HANDOVER_SCHEMA,
    status: 'UNKNOWN',
    statusReasons: [],
    project: { name: null, activePhase: { kind: 'unknown', id: null }, currentStory: { kind: 'unknown', ids: [] }, governance: { result: 'NOT_CHECKED', errors: 0, warnings: 0 } },
    progress: { planned: 0, active: 0, finalized: 0, listedNotFinal: 0, awaitingReview: [], unknown: 0, stories: [], storiesTruncated: false },
    missions: { total: 0, inProgress: 0, completed: 0, failed: 0, cancelled: 0, checkpoints: 0, orphanCheckpoints: 0, withoutStoryLink: 0, activeWithoutCheckpoint: [], failedMissions: [], active: [], truncated: false },
    architecture: { available: false, total: 0, accepted: 0, proposed: 0, other: [], unrecognized: 0, missingMetadata: 0, complete: false },
    verification: { git: { available: false, head: null, dirty: null }, counts: { verified: 0, reported: 0, stale: 0, unknown: 0, failed: 0 }, items: [], unreadableRecords: 0, recordsTruncated: false, storiesWithoutVerifiedEvidence: [] },
    outstanding: { issues: [], ownerDecisions: [] },
    sources: [],
    limitations: LIMITATIONS,
  };
}
