import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ProjectOverview from '../components/ProjectOverview.vue';
import { lastCompleted, nextStep } from '../continuity';
import type { ContinuityInput } from '../continuity';
import type { DevelopmentHistory, HistoryMissionView, Mission, StructuredRoadmapView, StructuredStoryIndexView } from '../types/dashboard';

const ph = (id: string | null, status: string | null, title = `T${id}`) => ({ id, title, status: { value: status, recognized: true, provenance: 'REPORTED' as const }, goal: null, details: null });
const road = (phases: ReturnType<typeof ph>[], active: StructuredRoadmapView['activePhase'] = { kind: 'none' }, state: StructuredRoadmapView['state'] = 'ok'): StructuredRoadmapView =>
  ({ state, activePhase: active, diagnostics: [], phases: phases as never });
const hm = (id: string, status: HistoryMissionView['status'], updatedAt: string, title = `Title ${id}`): HistoryMissionView =>
  ({ id, title, system: 's', status, startedAt: '2026-01-01T00:00:00Z', updatedAt, summary: null, storyId: null, checkpointCount: 0, checkpoints: [], checkpointsTruncated: false });
const hist = (missions: HistoryMissionView[], truncated = false) => ({
  sources: [], data: { missions, totalMissions: missions.length, truncated, counts: { in_progress: 0, completed: 0, failed: 0, cancelled: 0 }, totalCheckpoints: 0, orphanCheckpoints: 0, recent: [] } as DevelopmentHistory,
});
const si = (stories: Array<[string, string, string | null]>, state: StructuredStoryIndexView['state'] = 'ok') => ({
  sources: [], data: { state, diagnostics: [], stories: stories.map(([id, status, date]) => ({ id, idStatus: 'unique', title: `T ${id}`, status: { value: status, recognized: true, provenance: 'REPORTED' }, date, phase: { kind: 'outside' } })) } as StructuredStoryIndexView,
});
const mission = (id: string): Mission => ({ id, title: `M ${id}`, status: 'in_progress', summary: null, startedAt: null, updatedAt: null });

describe('UX-003 last completed work', () => {
  it('mission, story and phase are three independent facts', () => {
    const l = lastCompleted({ history: hist([hm('MIS-1', 'completed', '2026-02-01T00:00:00Z')]), storyIndex: si([]), roadmap: road([ph('1', 'PLANNED')]) });
    expect(l.mission.kind).toBe('found'); // the completed mission does not make a story finalized or a phase complete
    expect(l.story.kind).toBe('none');
    expect(l.phase.kind).toBe('none');
  });

  it('picks the mission finished last, not merely the first listed', () => {
    const l = lastCompleted({ history: hist([hm('MIS-3', 'cancelled', '2026-05-01T00:00:00Z'), hm('MIS-2', 'completed', '2026-03-01T00:00:00Z'), hm('MIS-1', 'completed', '2026-02-01T00:00:00Z')]) });
    expect(l.mission.kind === 'found' && l.mission.item.id).toBe('MIS-2');
    expect(l.mission.kind === 'found' && l.mission.item.at).toBe('2026-03-01T00:00:00Z');
    expect(l.mission.kind === 'found' && l.mission.item.source).toContain('Development History');
  });

  it('story: latest dated finalized entry; undated falls back to document order with a caveat; non-final statuses are skipped', () => {
    const dated = lastCompleted({ storyIndex: si([['A', 'COMPLETED', '2026-01-02'], ['B', 'COMPLETED', '2026-01-09'], ['C', 'IN PROGRESS', '2026-02-01']]) });
    expect(dated.story.kind === 'found' && dated.story.item.id).toBe('B');
    const undated = lastCompleted({ storyIndex: si([['A', 'COMPLETED', '2026-01-02'], ['B', 'FINALIZED', null]]) });
    expect(undated.story.kind === 'found' && undated.story.item.id).toBe('B');
    expect(undated.story.kind === 'found' && undated.story.note).toContain('document order');
  });

  it('a finalized-stated status is shown as its state word plus a separate FINALIZED mark, verbatim text kept', () => {
    const l = lastCompleted({ roadmap: road([ph('9', 'COMPLETED (finalized 2026-11-20, owner acceptance)')]) });
    expect(l.phase.kind === 'found' && l.phase.item.status).toBe('COMPLETED');
    expect(l.phase.kind === 'found' && l.phase.item.finalized).toBe(true);
    expect(l.phase.kind === 'found' && l.phase.item.statusVerbatim).toContain('owner acceptance');
  });

  it('phase: last completed in roadmap order, with no invented date', () => {
    const l = lastCompleted({ roadmap: road([ph('0', 'COMPLETED (finalized 2026-11-20)'), ph('1', 'COMPLETED'), ph('2', 'PLANNED')]) });
    expect(l.phase.kind === 'found' && l.phase.item.id).toBe('Phase 1');
    expect(l.phase.kind === 'found' && l.phase.item.at).toBeNull();
  });

  it('missing or unreadable sources are UNKNOWN, never an empty success', () => {
    const l = lastCompleted({ history: { sources: [], data: null }, storyIndex: si([], 'error'), roadmap: road([], { kind: 'none' }, 'error') });
    expect([l.mission.kind, l.story.kind, l.phase.kind]).toEqual(['unknown', 'unknown', 'unknown']);
    expect(lastCompleted({}).mission.kind).toBe('unknown');
  });
});

describe('UX-003 what is next (deterministic, with a reason)', () => {
  const base: ContinuityInput = { roadmap: road([ph('0', 'COMPLETED'), ph('1', 'PLANNED'), ph('2', 'PLANNED')]) };

  it('1. an active mission comes first', () => {
    const n = nextStep({ ...base, missions: [mission('MIS-7')], story: { kind: 'active', ids: ['S'], excerpt: null } });
    expect(n.kind).toBe('continue_mission');
    expect(n.headline).toContain('MIS-7');
    expect(n.actions.map((a) => a.target)).toContain('history');
  });

  it('2. an active story without an active mission', () => {
    const n = nextStep({ ...base, story: { kind: 'active', ids: ['S-1'], excerpt: null } });
    expect(n.kind).toBe('continue_story');
    expect(n.reason).toContain('no mission is in progress');
  });

  it('3. a conflicting roadmap pointer blocks the suggestion instead of guessing', () => {
    for (const r of [road(base.roadmap!.phases as never, { kind: 'ambiguous' }), road([], { kind: 'none' }, 'error')]) {
      const n = nextStep({ roadmap: r });
      expect(n.kind).toBe('resolve_conflict');
      expect(n.actions[0]!.target).toBe('diagnostics');
    }
  });

  it('4. an IN PROGRESS phase, the declared active one first', () => {
    const n = nextStep({ roadmap: road([ph('1', 'IN PROGRESS'), ph('2', 'IN PROGRESS'), ph('3', 'PLANNED')], { kind: 'phase', id: '2' }) });
    expect(n.kind).toBe('continue_phase');
    expect(n.headline).toContain('Phase 2');
  });

  it('5. the next PLANNED phase after the last completed one, with the reason', () => {
    const n = nextStep(base);
    expect(n.kind).toBe('next_phase');
    expect(n.headline).toContain('Phase 1');
    expect(n.reason).toContain('Phase 0 is COMPLETED');
    expect(n.source).toContain('roadmap-index.md');
  });

  it('6. nothing planned is a calm statement, not an error; an empty roadmap is a start', () => {
    const all = nextStep({ roadmap: road([ph('0', 'COMPLETED'), ph('1', 'COMPLETED')]) });
    expect(all.kind).toBe('no_next');
    expect(all.headline).toBe('No next phase is defined in the current roadmap');
    expect(all.reason).toContain('not an error');
    expect(nextStep({ roadmap: road([]) }).kind).toBe('start');
  });

  it('no roadmap at all: UNKNOWN with the reason, no invented task', () => {
    const n = nextStep({});
    expect(n.kind).toBe('unknown');
    expect(n.reason).toContain('no structured roadmap');
  });

  it('an unrecognised story state or odd phase statuses never produce a recommendation of their own', () => {
    const n = nextStep({ roadmap: road([ph('1', 'Mystery'), ph(null, 'PLANNED')]), story: { kind: 'unknown', excerpt: 'x' } });
    expect(n.kind).toBe('no_next');
  });
});

describe('UX-003/004 Project Overview hierarchy', () => {
  const props = (o: Record<string, unknown>) => ({ overview: { name: 'P', stateRevision: 1, activeMissionCount: 0, finishedMissionCount: 2, story: { kind: 'none', excerpt: null } }, ...o });

  it('without active work: Last completed and What\'s next lead, before the pulse; no empty story card', () => {
    const w = mount(ProjectOverview, { props: props({ roadmap: road([ph('0', 'COMPLETED'), ph('1', 'PLANNED')]), history: hist([hm('MIS-1', 'completed', '2026-02-01T00:00:00Z')]) }) as never });
    const html = w.html();
    expect(html.indexOf('ov-last-completed')).toBeGreaterThan(-1);
    expect(html.indexOf('ov-last-completed')).toBeLessThan(html.indexOf('ov-pulse'));
    expect(html.indexOf('ov-next')).toBeLessThan(html.indexOf('ov-pulse'));
    expect(w.find('[data-testid="ov-focus"]').exists()).toBe(false);
    expect(w.get('[data-testid="last-mission"]').text()).toContain('MIS-1');
    expect(w.get('[data-testid="next-headline"]').text()).toContain('Phase 1');
    expect(w.get('[data-testid="next-reason"]').text()).toContain('COMPLETED');
  });

  it('with an active mission the working context stays first and continuity follows', () => {
    const w = mount(ProjectOverview, { props: props({ overview: { name: 'P', stateRevision: 1, activeMissionCount: 1, story: { kind: 'active', ids: ['S'], excerpt: null } }, missions: [mission('MIS-9')] }) as never });
    const html = w.html();
    expect(html.indexOf('ov-focus')).toBeLessThan(html.indexOf('ov-last-completed'));
    expect(w.get('[data-testid="next-kind"]').text()).toBe('ACTIVE MISSION');
  });

  it('action buttons use the existing navigation', async () => {
    const w = mount(ProjectOverview, { props: props({ roadmap: road([ph('0', 'COMPLETED'), ph('1', 'PLANNED')]) }) as never });
    await w.get('[data-testid="next-go-roadmap"]').trigger('click');
    await w.get('[data-testid="last-go-history"]').trigger('click');
    expect(w.emitted('navigate')!.map((e) => e[0])).toEqual(['roadmap', 'history']);
  });

  it('a brand-new project gets a clear start and honest empty slots', () => {
    const w = mount(ProjectOverview, { props: props({ roadmap: road([]), history: hist([]), storyIndex: si([], 'none_finalized') }) as never });
    expect(w.get('[data-testid="next-kind"]').text()).toBe('GETTING STARTED');
    expect(w.get('[data-testid="last-mission"]').text()).toContain('No completed mission recorded');
    expect(w.get('[data-testid="last-story"]').text()).toContain('No finalized story');
  });
});
