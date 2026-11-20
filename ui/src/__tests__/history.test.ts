// @vitest-environment jsdom
/** GOV-EVOLUTION Phase 3: Development History panel, Recent Activity and legacy hash links. */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import HistoryPanel from '../components/HistoryPanel.vue';
import ProjectOverview from '../components/ProjectOverview.vue';
import { isKnownHash, sectionFromHash } from '../sections';
import { isDashboardReadModel } from '../live/validate';
import type { DevelopmentHistory, Section } from '../types/dashboard';

const src = [{ id: 'state' as const, path: 'x', status: 'available' as const, code: null }];
function mission(n: number, status: 'completed' | 'failed' | 'in_progress', withCkpt: boolean, storyId: string | null = null) {
  const id = `MIS-000${n}`;
  return {
    id, title: `Mission ${n}`, system: 'kairos', status, startedAt: `2026-02-0${n}T10:00:00.000Z`, updatedAt: `2026-02-0${n}T11:00:00.000Z`,
    summary: status === 'in_progress' ? null : `final ${n}`, storyId, checkpointCount: withCkpt ? 1 : 0, checkpointsTruncated: false,
    checkpoints: withCkpt ? [{ id: `${id}-CKPT-0001`, createdAt: `2026-02-0${n}T10:30:00.000Z`, summary: `progress ${n}`, remainingSteps: ['next step'], context: null }] : [],
  };
}
function history(over: Partial<DevelopmentHistory> = {}): Section<DevelopmentHistory> {
  const missions = [mission(3, 'in_progress', false), mission(2, 'failed', true, 'S-2'), mission(1, 'completed', true)];
  return {
    sources: src,
    data: {
      missions, totalMissions: 3, truncated: false, counts: { in_progress: 1, completed: 1, failed: 1, cancelled: 0 }, totalCheckpoints: 2, orphanCheckpoints: 0,
      recent: [{ kind: 'checkpoint', at: '2026-02-02T10:30:00.000Z', missionId: 'MIS-0002', missionTitle: 'Mission 2', checkpointId: 'MIS-0002-CKPT-0001', summary: 'progress 2', result: null }],
      ...over,
    },
  };
}

describe('HistoryPanel', () => {
  it('shows finished missions with story, timeline, checkpoints and final summary', () => {
    const w = mount(HistoryPanel, { props: { history: history() } });
    const cards = w.findAll('[data-testid="history-mission"]');
    expect(cards).toHaveLength(3);
    expect(w.get('[data-testid="history-counts"]').text()).toContain('1 completed');
    const failed = cards[1];
    expect(failed.text()).toContain('FAILED');
    expect(failed.get('[data-testid="history-story"]').text()).toContain('S-2');
    expect(failed.text()).toContain('MIS-0002-CKPT-0001');
    expect(failed.get('[data-testid="history-summary"]').text()).toBe('final 2');
  });

  it('never invents: no story, no checkpoint and no summary are stated as missing', () => {
    const w = mount(HistoryPanel, { props: { history: history() } });
    const active = w.findAll('[data-testid="history-mission"]')[0];
    expect(active.get('[data-testid="history-story"]').text()).toContain('none recorded');
    expect(active.get('[data-testid="history-no-checkpoints"]').text()).toBe('No checkpoints recorded.');
    expect(active.get('[data-testid="history-summary"]').text()).toBe('Not finished yet.');
  });

  it('filters by status and by search text', async () => {
    const w = mount(HistoryPanel, { props: { history: history() } });
    await w.get('[data-testid="history-status"]').setValue('completed');
    expect(w.findAll('[data-testid="history-mission"]')).toHaveLength(1);
    await w.get('[data-testid="history-status"]').setValue('all');
    await w.get('[data-testid="history-search"]').setValue('s-2');
    expect(w.findAll('[data-testid="history-mission"]')).toHaveLength(1);
    await w.get('[data-testid="history-search"]').setValue('zzz');
    expect(w.find('[data-testid="history-no-match"]').exists()).toBe(true);
  });

  it('says so when the list is cut, when nothing is recorded and when the state is unavailable', () => {
    expect(mount(HistoryPanel, { props: { history: history({ truncated: true }) } }).find('[data-testid="history-truncated"]').exists()).toBe(true);
    const empty = history({ missions: [], totalMissions: 0, totalCheckpoints: 0, recent: [], counts: { in_progress: 0, completed: 0, failed: 0, cancelled: 0 } });
    expect(mount(HistoryPanel, { props: { history: empty } }).get('[data-testid="history-empty"]').text()).toBe('No missions recorded.');
    const bad = mount(HistoryPanel, { props: { history: { data: null, sources: [{ ...src[0], status: 'corrupt', code: 'PARSE_ERROR' }] } } });
    expect(bad.get('[data-testid="history-unavailable"]').text()).toContain('NOT AVAILABLE');
    expect(bad.text()).not.toContain('No missions recorded.');
  });

  it('renders untrusted text escaped', () => {
    const h = history();
    h.data!.missions[0].title = '<img src=x onerror=alert(1)>';
    const w = mount(HistoryPanel, { props: { history: h } });
    expect(w.find('img').exists()).toBe(false);
    expect(w.text()).toContain('<img src=x');
  });
});

describe('Recent activity (Project Overview)', () => {
  const overview = { name: 'P', stateRevision: 1 };
  it('lists the latest recorded events from the same model', () => {
    const w = mount(ProjectOverview, { props: { overview, history: history() } });
    expect(w.findAll('[data-testid="recent-event"]')).toHaveLength(1);
    expect(w.get('[data-testid="recent-event"]').text()).toContain('MIS-0002-CKPT-0001');
  });
  it('is hidden when the source predates history, and says so when empty or unavailable', () => {
    expect(mount(ProjectOverview, { props: { overview } }).find('[data-testid="ov-recent"]').exists()).toBe(false);
    const empty = history({ recent: [] });
    expect(mount(ProjectOverview, { props: { overview, history: empty } }).find('[data-testid="recent-empty"]').exists()).toBe(true);
    expect(mount(ProjectOverview, { props: { overview, history: { data: null, sources: src } } }).find('[data-testid="recent-unavailable"]').exists()).toBe(true);
  });
});

describe('hash links', () => {
  it('the earlier #checkpoints link opens Development History', () => {
    expect(sectionFromHash('#checkpoints')).toBe('history');
    expect(isKnownHash('checkpoints')).toBe(true);
    expect(isKnownHash('__proto__')).toBe(false);
  });
});

describe('DTO validation', () => {
  it('accepts a history section and rejects a malformed one', () => {
    const base = {
      projectOverview: { data: null, sources: [] }, currentMissions: { data: null, sources: [] }, checkpoints: { data: null, sources: [] },
      roadmap: { data: null, sources: [] }, diagnostics: { validation: 'NOT_PERFORMED', sources: [], notes: [] },
    };
    expect(isDashboardReadModel({ ...base, history: history() })).toBe(true);
    const broken = history();
    (broken.data!.missions[0] as unknown as { status: string }).status = 'weird';
    expect(isDashboardReadModel({ ...base, history: broken })).toBe(false);
  });
});
