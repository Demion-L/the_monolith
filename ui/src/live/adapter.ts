import type { DashboardReadModel, KnowledgeData, Section, SourceReport, SourceStatus } from '../../../src/readmodel/types';
import type { Checkpoint, DashboardData, Diagnostic, DiagnosticSeverity, KnowledgeInfo, KnowledgeItem, StoryState } from '../types/dashboard';

/**
 * Presentation adapter: `DashboardReadModel` (API) -> `DashboardData` (the
 * view-model the existing components already render). It invents nothing: a
 * section whose source failed becomes `null` ("not available"), never an empty
 * list, so a read failure cannot look like "no missions". Diagnostic text is
 * composed from fixed codes and project-relative paths only.
 */

const SOURCE_SEVERITY: Record<SourceReport['status'], DiagnosticSeverity> = {
  available: 'info',
  absent: 'warning',
  corrupt: 'error',
  forbidden: 'error',
  unreadable: 'error',
};

function sourceMessage(s: SourceReport): string {
  const where = s.path === null ? 'path unknown' : s.path;
  return `${s.id} (${where}): ${s.status}${s.code === null ? '' : ` [${s.code}]`}`;
}

/**
 * Derives the story state from the Core-classified claim and the activeStory
 * source report. A missing `storyClaim` (older DTO) never invents a classification.
 */
function toStoryState(model: DashboardReadModel): StoryState {
  const src = model.diagnostics.sources.find((s) => s.id === 'activeStory');
  if (src === undefined) return { kind: 'source', status: 'unavailable', code: null };
  if (src.status !== 'available') return { kind: 'source', status: src.status, code: src.code };
  const o = model.projectOverview.data;
  if (o === null) return { kind: 'source', status: 'unavailable', code: null };
  const excerpt = o.currentStory?.excerpt ?? null;
  if (o.currentStory === null) return { kind: 'no_section' };
  const claim = o.storyClaim;
  if (claim === undefined || claim === null) return { kind: 'unknown', excerpt };
  if (claim.kind === 'ids') return { kind: 'active', ids: claim.ids, excerpt };
  return { kind: claim.kind, excerpt };
}

/**
 * Knowledge section -> list + info. `undefined` (older server) stays `undefined`: the panel says "not provided".
 * A failed source is `null` (never `[]`); `absent` = not available, anything else = error.
 */
function toKnowledge(sec: Section<KnowledgeData> | undefined): { items?: KnowledgeItem[] | null; info?: KnowledgeInfo } {
  if (sec === undefined) return {};
  const src = sec.sources[0];
  if (sec.data === null) {
    const absent = src !== undefined && src.status === 'absent';
    return { items: null, info: { availability: absent ? 'not_available' : 'error', code: src?.code ?? null, complete: false, issues: [] } };
  }
  return {
    items: sec.data.items.map((i): KnowledgeItem => ({
      id: i.id,
      title: i.title,
      status: i.status,
      summary: i.summary,
      path: i.path,
      ...(i.supersedes ? { supersedes: [...i.supersedes] } : {}),
      ...(i.supersededBy ? { supersededBy: [...i.supersededBy] } : {}),
    })),
    info: {
      availability: 'available',
      code: null,
      complete: sec.data.complete,
      issues: sec.data.issues.map((x) => ({ code: x.code, severity: x.severity, path: x.path, id: x.id })),
    },
  };
}

/** How Core reported the canonical state file (`sources[id=state]`); omitted when no such report exists. */
function stateSourceOf(model: DashboardReadModel): { stateSource?: SourceStatus } {
  const s = model.diagnostics.sources.find((x) => x.id === 'state');
  return s === undefined ? {} : { stateSource: s.status };
}

export function toDashboardData(model: DashboardReadModel): DashboardData {
  const overview = model.projectOverview.data;
  const missions = model.currentMissions.data;
  const checkpoints = model.checkpoints.data;
  const roadmap = model.roadmap.data;
  const hyp = toKnowledge(model.hypotheses);
  const dec = toKnowledge(model.decisions);

  const diagnostics: Diagnostic[] = [
    { severity: 'info', message: 'Source availability only; this is not a validation result.' },
    ...model.diagnostics.sources.map((s) => ({ severity: SOURCE_SEVERITY[s.status], message: sourceMessage(s) })),
    ...model.diagnostics.notes.map((n) => ({
      severity: (n.severity === 'warn' ? 'warning' : 'info') as DiagnosticSeverity,
      message: n.code,
    })),
  ];

  return {
    isDemo: false,
    overview: {
      name: overview?.name ?? null,
      stateRevision: overview?.stateRevision ?? null,
      currentStory: overview === null ? null : (overview.currentStory?.excerpt ?? null),
      story: toStoryState(model),
      activeMissionCount: overview?.activeMissionCount ?? null,
      finishedMissionCount: overview?.finishedMissionCount ?? null,
    },
    missions: missions === null ? null : missions.active.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      summary: m.summary,
      startedAt: m.startedAt,
      updatedAt: m.updatedAt,
    })),
    // The read model carries the latest checkpoint and the total count per active mission.
    checkpoints: checkpoints === null ? null : checkpoints.byActiveMission.flatMap((m): Checkpoint[] =>
      m.latest === null
        ? []
        : [{
            id: m.latest.id,
            missionId: m.latest.missionId,
            createdAt: m.latest.createdAt,
            summary: m.latest.summary,
            remainingSteps: m.latest.remainingSteps,
            recordedCount: m.count,
          }],
    ),
    roadmapText: roadmap === null ? null : roadmap.text,
    // Present only when Core supplied it; an older DTO yields `undefined` (legacy fallback), never invented phases.
    roadmap: roadmap?.structured,
    // Passed through untouched: the Execution Graph reads Core's relations, the adapter adds none.
    ...(model.storyIndex !== undefined ? { storyIndex: model.storyIndex } : {}),
    ...(model.history !== undefined ? { history: model.history } : {}),
    ...(model.ideas !== undefined ? { ideas: model.ideas } : {}),
    ...(hyp.items !== undefined ? { hypotheses: hyp.items, hypothesesInfo: hyp.info } : {}),
    ...(dec.items !== undefined ? { decisions: dec.items, decisionsInfo: dec.info } : {}),
    diagnostics,
    sources: {
      total: model.diagnostics.sources.length,
      available: model.diagnostics.sources.filter((s) => s.status === 'available').length,
    },
    provenance: model.diagnostics.state,
    ...stateSourceOf(model),
  };
}
