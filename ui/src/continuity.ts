import type {
  DevelopmentHistory,
  Mission,
  RoadmapPhaseView,
  Section,
  StoryState,
  StructuredRoadmapView,
  StructuredStoryIndexView,
} from './types/dashboard';
import type { SectionId } from './sections';
import { lifecycleTone, statesFinalized } from './statusTone';

/**
 * Project continuity (UX-003): "what was completed last" and "what to do next", derived ONLY from records Core already
 * returns. Presentation logic, deterministic, no I/O. The three kinds of completed work are independent facts: a
 * completed mission does not finalize a story, and a finalized story does not complete a phase. Nothing is invented:
 * where a source is silent the result says so.
 */
export interface DoneItem {
  id: string;
  title: string | null;
  /** The status text exactly as the source states it. */
  status: string;
  at: string | null;
  source: string;
}
export type DoneSlot =
  | { kind: 'found'; item: DoneItem; note: string | null }
  | { kind: 'none'; text: string }
  | { kind: 'unknown'; text: string };

export interface LastCompleted {
  mission: DoneSlot;
  story: DoneSlot;
  phase: DoneSlot;
}

export type NextKind = 'continue_mission' | 'continue_story' | 'resolve_conflict' | 'continue_phase' | 'next_phase' | 'no_next' | 'start' | 'unknown';
export interface NextStep {
  kind: NextKind;
  headline: string;
  /** Why this is suggested (or why nothing can be). Always present. */
  reason: string;
  /** Where the recommendation comes from. */
  source: string;
  actions: { label: string; target: SectionId }[];
}

export interface ContinuityInput {
  roadmap?: StructuredRoadmapView;
  storyIndex?: Section<StructuredStoryIndexView>;
  history?: Section<DevelopmentHistory>;
  missions?: Mission[] | null;
  activeMissionCount?: number | null;
  story?: StoryState | null;
}

const isoDay = (s: string | null): string | null => (s !== null && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const phaseLabel = (p: RoadmapPhaseView): string => (p.id === null ? 'Phase (no id)' : `Phase ${p.id}`);

function lastMission(h: Section<DevelopmentHistory> | undefined): DoneSlot {
  if (h === undefined) return { kind: 'unknown', text: 'Mission history is not provided by this data source.' };
  if (h.data === null) return { kind: 'unknown', text: 'Mission history is not available from Core.' };
  const done = h.data.missions.filter((m) => m.status === 'completed');
  if (done.length === 0) {
    return { kind: 'none', text: h.data.truncated ? 'No completed mission among the most recent missions listed.' : 'No completed mission recorded.' };
  }
  // Newest by the recorded finish time; ties keep Core's order (newest first).
  let best = done[0]!;
  for (const m of done) if (m.updatedAt > best.updatedAt) best = m;
  return {
    kind: 'found',
    item: { id: best.id, title: best.title, status: 'COMPLETED', at: best.updatedAt, source: 'Development History (operational state)' },
    note: h.data.truncated ? 'Chosen among the most recent missions listed; older ones are not shown.' : null,
  };
}

function lastStory(si: Section<StructuredStoryIndexView> | undefined): DoneSlot {
  if (si === undefined) return { kind: 'unknown', text: 'The story index is not provided by this data source.' };
  const d = si.data;
  if (d === null || d.state === 'error' || d.state === 'unrecognized') return { kind: 'unknown', text: 'The story index could not be read.' };
  const done = d.stories.filter((s) => lifecycleTone(s.status.value) === 'ok' || statesFinalized(s.status.value));
  if (done.length === 0) return { kind: 'none', text: 'No finalized story is reported by the story index.' };
  // Latest date when every candidate has one; otherwise the last entry in document order (not a verified timeline).
  let best = done[done.length - 1]!;
  if (done.every((s) => isoDay(s.date) !== null)) {
    for (const s of done) if (isoDay(s.date)! >= isoDay(best.date)!) best = s;
  }
  return {
    kind: 'found',
    item: { id: best.id, title: best.title, status: best.status.value ?? 'status not stated', at: best.date, source: 'story-index.md (REPORTED)' },
    note: done.every((s) => isoDay(s.date) !== null) ? null : 'Some entries carry no date, so this is the last entry in document order.',
  };
}

function lastPhase(r: StructuredRoadmapView | undefined): DoneSlot {
  if (r === undefined) return { kind: 'unknown', text: 'The roadmap is not provided by this data source.' };
  if (r.state === 'error' || r.state === 'unrecognized') return { kind: 'unknown', text: 'The roadmap could not be read.' };
  const done = r.phases.filter((p) => lifecycleTone(p.status.value) === 'ok');
  if (done.length === 0) return { kind: 'none', text: 'No completed phase is reported by the roadmap.' };
  const p = done[done.length - 1]!;
  return {
    kind: 'found',
    item: { id: phaseLabel(p), title: p.title, status: p.status.value ?? 'status not stated', at: null, source: 'roadmap-index.md (REPORTED)' },
    note: 'The roadmap carries no completion date; this is the last completed phase in roadmap order.',
  };
}

export function lastCompleted(i: ContinuityInput): LastCompleted {
  return { mission: lastMission(i.history), story: lastStory(i.storyIndex), phase: lastPhase(i.roadmap) };
}

const ROADMAP = 'roadmap-index.md (REPORTED)';

export function nextStep(i: ContinuityInput): NextStep {
  const active = (i.missions ?? []).filter((m) => m.status === 'in_progress');
  // 1. An active mission is the working context.
  if (active.length > 0 || (i.activeMissionCount ?? 0) > 0) {
    const m = active[0];
    return {
      kind: 'continue_mission',
      headline: m === undefined ? 'Continue the active mission' : `Continue mission ${m.id}${m.title ? ` — ${m.title}` : ''}`,
      reason: 'Suggested because a mission is in progress in the operational state.',
      source: 'Coordinatorium (operational state)',
      actions: [{ label: 'Open Development History', target: 'history' }],
    };
  }
  // 2. An active story without an active mission.
  if (i.story != null && i.story.kind === 'active') {
    return {
      kind: 'continue_story',
      headline: `Continue or review story ${i.story.ids.join(', ')}`,
      reason: 'Suggested because the Current Story section names it and no mission is in progress.',
      source: 'active.md (REPORTED)',
      actions: [{ label: 'Open Execution Graph', target: 'graph' }, { label: 'Open Roadmap', target: 'roadmap' }],
    };
  }
  const r = i.roadmap;
  // 3. A conflict in the records that prevents choosing a phase.
  if (r !== undefined && (r.activePhase.kind === 'unmatched' || r.activePhase.kind === 'ambiguous' || r.state === 'error' || r.state === 'unrecognized')) {
    return {
      kind: 'resolve_conflict',
      headline: 'Resolve the conflicting project records first',
      reason: r.activePhase.kind === 'unmatched' || r.activePhase.kind === 'ambiguous'
        ? 'The roadmap\'s active-phase pointer is uncertain, so no next phase can be chosen reliably.'
        : 'The roadmap could not be interpreted, so no next phase can be chosen.',
      source: ROADMAP,
      actions: [{ label: 'Open Diagnostics', target: 'diagnostics' }, { label: 'Open Roadmap', target: 'roadmap' }],
    };
  }
  if (r === undefined) {
    return {
      kind: 'unknown',
      headline: 'MONOLITH cannot determine the next step',
      reason: 'This data source provides no structured roadmap.',
      source: 'dashboard data',
      actions: [{ label: 'Open Diagnostics', target: 'diagnostics' }],
    };
  }
  // Only a phase with a stated, unique id can be suggested: an id-less or duplicated heading is ambiguous.
  const idCount = new Map<string, number>();
  for (const p of r.phases) if (p.id !== null) idCount.set(p.id, (idCount.get(p.id) ?? 0) + 1);
  const phases = r.phases;
  const usable = (p: RoadmapPhaseView): boolean => p.id !== null && idCount.get(p.id) === 1;
  // 4. A phase that is in progress (the declared active phase first).
  const activeId = r.activePhase.kind === 'phase' ? r.activePhase.id : null;
  const inProgress =
    phases.find((p) => usable(p) && p.id === activeId && lifecycleTone(p.status.value) === 'progress') ??
    phases.find((p) => usable(p) && lifecycleTone(p.status.value) === 'progress');
  if (inProgress !== undefined) {
    return {
      kind: 'continue_phase',
      headline: `Continue ${phaseLabel(inProgress)}${inProgress.title ? ` — ${inProgress.title}` : ''}`,
      reason: `Suggested because ${phaseLabel(inProgress)} is stated as ${inProgress.status.value} in the roadmap and no mission or story is active.`,
      source: ROADMAP,
      actions: [{ label: 'Open Roadmap', target: 'roadmap' }, { label: 'Open Execution Graph', target: 'graph' }],
    };
  }
  // 5. The next planned phase after the last completed one.
  let lastDone = -1;
  phases.forEach((p, idx) => { if (lifecycleTone(p.status.value) === 'ok') lastDone = idx; });
  const planned = phases.findIndex((p, idx) => idx > lastDone && usable(p) && lifecycleTone(p.status.value) === 'planned');
  if (planned >= 0) {
    const p = phases[planned]!;
    const prev = lastDone >= 0 ? phases[lastDone]! : null;
    return {
      kind: 'next_phase',
      headline: `Review ${phaseLabel(p)}${p.title ? ` — ${p.title}` : ''}`,
      reason: prev !== null
        ? `Suggested because ${phaseLabel(prev)} is COMPLETED and ${phaseLabel(p)} is the next PLANNED phase in roadmap order.`
        : `Suggested because ${phaseLabel(p)} is the first PLANNED phase in the roadmap.`,
      source: ROADMAP,
      actions: [{ label: 'Open Roadmap', target: 'roadmap' }, { label: 'Open Execution Graph', target: 'graph' }],
    };
  }
  // 6. Nothing planned.
  if (phases.length === 0) {
    return {
      kind: 'start',
      headline: 'Start your project plan',
      reason: 'Nothing is recorded yet: the roadmap lists no phases. Add the first phase to roadmap-index.md, then record work with `monolith mission start`.',
      source: ROADMAP,
      actions: [{ label: 'Open Roadmap', target: 'roadmap' }],
    };
  }
  const allDone = phases.every((p) => lifecycleTone(p.status.value) === 'ok');
  return {
    kind: 'no_next',
    headline: 'No next phase is defined in the current roadmap',
    reason: allDone
      ? `All ${phases.length} listed ${phases.length === 1 ? 'phase is' : 'phases are'} COMPLETED and none is PLANNED. This is not an error: define the next plan when you are ready.`
      : 'No phase is stated as PLANNED or IN PROGRESS, so MONOLITH does not suggest one. Check the phase statuses in the roadmap.',
    source: ROADMAP,
    actions: [{ label: 'Open Roadmap', target: 'roadmap' }, { label: 'Open Development History', target: 'history' }],
  };
}
