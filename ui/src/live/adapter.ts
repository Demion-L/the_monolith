import type { DashboardReadModel, SourceReport } from '../../../src/readmodel/types';
import type { Checkpoint, DashboardData, Diagnostic, DiagnosticSeverity, StoryState } from '../types/dashboard';

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

export function toDashboardData(model: DashboardReadModel): DashboardData {
  const overview = model.projectOverview.data;
  const missions = model.currentMissions.data;
  const checkpoints = model.checkpoints.data;
  const roadmap = model.roadmap.data;

  const diagnostics: Diagnostic[] = [
    { severity: 'info', message: 'Source availability only; monolith validate was not run.' },
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
    diagnostics,
  };
}
