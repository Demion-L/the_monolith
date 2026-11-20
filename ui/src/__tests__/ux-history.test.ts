import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import HistoryPanel from '../components/HistoryPanel.vue';
import type { DevelopmentHistory, HistoryMissionView } from '../types/dashboard';

const LONG = 'Long result. '.repeat(60).trim();
const mk = (id: string, status: HistoryMissionView['status'], o: Partial<HistoryMissionView> = {}): HistoryMissionView => ({
  id, title: `Mission ${id}`, system: 'core', status, startedAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-02T10:00:00Z', summary: null,
  storyId: null, checkpointCount: 0, checkpoints: [], checkpointsTruncated: false, ...o,
});
const ck = (id: string) => ({ id, createdAt: '2026-01-01T11:00:00Z', summary: `did ${id}`, remainingSteps: ['next a', 'next b'], context: 'ctx text' });
const data = (missions: HistoryMissionView[]): { data: DevelopmentHistory; sources: never[] } => ({
  sources: [],
  data: { missions, totalMissions: missions.length, truncated: false, counts: { in_progress: 1, completed: 1, failed: 1, cancelled: 1 }, totalCheckpoints: 1, orphanCheckpoints: 0, recent: [] },
});
const all = () => data([
  mk('M-1', 'in_progress'),
  mk('M-2', 'completed', { storyId: 'S-9', summary: LONG, checkpointCount: 1, checkpoints: [ck('M-2-CKPT-0001')] as never }),
  mk('M-3', 'failed', { summary: 'boom' }),
  mk('M-4', 'cancelled', { summary: 'dropped' }),
]);
const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');

describe('UX-005 Development History', () => {
  it('toolbar: labelled Status and Search controls with real gaps, in one styled row', () => {
    const w = mount(HistoryPanel, { props: { history: all() } });
    const bar = w.get('.hist-toolbar');
    expect(bar.findAll('label')).toHaveLength(2);
    expect(bar.text()).toContain('Status');
    expect(bar.text()).toContain('Search');
    expect(w.get('[data-testid="history-search"]').attributes('placeholder')).toContain('Mission id');
    expect(css).toMatch(/\.hist-toolbar \{[^}]*gap: 16px 24px/);
    expect(css).toMatch(/\.hist-field select, \.hist-field input \{[^}]*min-height: 40px/);
  });

  it('status filter and search keep working and say how many are shown', async () => {
    const w = mount(HistoryPanel, { props: { history: all() } });
    expect(w.get('[data-testid="history-shown"]').text()).toBe('Showing 4 of 4');
    await w.get('[data-testid="history-status"]').setValue('failed');
    expect(w.findAll('[data-testid="history-mission"]')).toHaveLength(1);
    expect(w.get('[data-testid="history-shown"]').text()).toBe('Showing 1 of 4');
    await w.get('[data-testid="history-status"]').setValue('all');
    await w.get('[data-testid="history-search"]').setValue('s-9');
    expect(w.findAll('[data-testid="history-mission"]').map((m) => m.text())[0]).toContain('M-2');
  });

  it('timeline: every event kind has its own class, badge and colour token', () => {
    const w = mount(HistoryPanel, { props: { history: all() } });
    const kinds = (i: number) => w.findAll('[data-testid="history-mission"]')[i]!.findAll('[data-testid="history-event"]').map((e) => e.classes().find((c) => c.startsWith('ev-')));
    expect(kinds(0)).toEqual(['ev-started']);
    expect(kinds(1)).toEqual(['ev-started', 'ev-checkpoint', 'ev-completed']);
    expect(kinds(2)).toEqual(['ev-started', 'ev-failed']);
    expect(kinds(3)).toEqual(['ev-started', 'ev-cancelled']);
    const map = Object.fromEntries([...css.matchAll(/\.hist-event\.ev-(\w+) \{ --ev: var\((--[\w-]+)\); \}/g)].map((m) => [m[1], m[2]]));
    expect(map).toEqual({ started: '--ev-start', checkpoint: '--ev-checkpoint', completed: '--ok', failed: '--err', cancelled: '--ev-cancelled' });
    expect(new Set(Object.values(map)).size).toBe(5); // no shared colour between event kinds
    expect(css).toMatch(/--ev-start: #5ee6ff;/);
    expect(css).toMatch(/--ev-checkpoint: #a78bfa;/);
  });

  it('keeps the real order and every recorded datum: timestamps, checkpoint summary, context and remaining steps', () => {
    const w = mount(HistoryPanel, { props: { history: all() } });
    const m2 = w.findAll('[data-testid="history-mission"]')[1]!;
    const t = m2.get('[data-testid="history-timeline"]').text();
    expect(t.indexOf('STARTED')).toBeLessThan(t.indexOf('CHECKPOINT'));
    expect(t.indexOf('CHECKPOINT')).toBeLessThan(t.indexOf('COMPLETED'));
    for (const x of ['2026-01-01T10:00:00Z', '2026-01-02T10:00:00Z', '2026-01-01T11:00:00Z', 'did M-2-CKPT-0001', 'ctx text', 'next a', 'next b']) expect(t).toContain(x);
    for (const x of ['S-9', 'core']) expect(m2.text()).toContain(x);
  });

  it('no checkpoints is a neutral note, not a timeline event', () => {
    const w = mount(HistoryPanel, { props: { history: all() } });
    const m3 = w.findAll('[data-testid="history-mission"]')[2]!;
    expect(m3.get('[data-testid="history-no-checkpoints"]').text()).toBe('No checkpoints recorded.');
    expect(m3.get('[data-testid="history-timeline"]').find('[data-testid="history-no-checkpoints"]').exists()).toBe(false);
    expect(m3.findAll('[data-testid="history-event"]')).toHaveLength(2); // started + failed only
  });

  it('final summary is its own block; a long one is clamped, complete in the page, and expandable', async () => {
    const w = mount(HistoryPanel, { props: { history: all() } });
    const m2 = w.findAll('[data-testid="history-mission"]')[1]!;
    expect(m2.find('.hist-result [data-testid="history-summary"]').exists()).toBe(true);
    expect(m2.find('[data-testid="history-timeline"] [data-testid="history-summary"]').exists()).toBe(false);
    const p = m2.get('[data-testid="history-summary"]');
    expect(p.text()).toBe(LONG); // nothing truncated in the data
    expect(p.classes()).toContain('hist-clamp');
    const btn = m2.get('[data-testid="history-summary-toggle"]');
    expect(btn.text()).toBe('Show full summary');
    await btn.trigger('click');
    expect(m2.get('[data-testid="history-summary"]').classes()).not.toContain('hist-clamp');
    expect(m2.get('[data-testid="history-summary-toggle"]').attributes('aria-expanded')).toBe('true');
    const short = w.findAll('[data-testid="history-mission"]')[2]!;
    expect(short.find('[data-testid="history-summary-toggle"]').exists()).toBe(false);
  });

  it('the result block takes the colour of the mission outcome', () => {
    expect(css).toMatch(/\.hist-card\[data-status="failed"\] \.hist-result \{ border-left-color: var\(--err\)/);
    expect(css).toMatch(/\.hist-card\[data-status="cancelled"\] \.hist-result \{ border-left-color: var\(--ev-cancelled\)/);
  });

  it('a missing story stays stated but quiet', () => {
    const w = mount(HistoryPanel, { props: { history: all() } });
    const s = w.findAll('[data-testid="history-mission"]')[0]!.get('[data-testid="history-story"]');
    expect(s.text()).toContain('none recorded');
    expect(s.find('.hist-nostory').exists()).toBe(true);
    expect(css).toMatch(/\.hist-nostory \{[^}]*color: var\(--muted\)/);
  });

  it('long unbroken text cannot break the layout', () => {
    const w = mount(HistoryPanel, { props: { history: data([mk('M-X', 'completed', { title: 'x'.repeat(300), summary: 'y'.repeat(900) })]) } });
    expect(w.get('[data-testid="history-summary"]').text()).toHaveLength(900);
    expect(css).toMatch(/\.hist-summary \{[^}]*overflow-wrap: anywhere/);
  });
});
