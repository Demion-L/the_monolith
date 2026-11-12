import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardReadModel, SourceReport } from '../../../src/readmodel/types';
import App from '../App.vue';
import ProjectOverview from '../components/ProjectOverview.vue';
import { toDashboardData } from '../live/adapter';
import { isDashboardReadModel } from '../live/validate';

const rep = (id: string, status: SourceReport['status'] = 'available', code: SourceReport['code'] = null): SourceReport =>
  ({ id: id as SourceReport['id'], path: `.monolith/${id}`, status, code });

type Over = Partial<NonNullable<DashboardReadModel['projectOverview']['data']>>;

function model(over: Over = {}, story: SourceReport = rep('activeStory'), omit: string[] = []): DashboardReadModel {
  const data: Record<string, unknown> = {
    name: 'Proj', monolithRoot: '.monolith', monolithRootSource: 'default', stateSchemaVersionOnDisk: 2,
    stateRevision: 12, activeMissionCount: 2, finishedMissionCount: 5,
    currentStory: { excerpt: '**Story:** S-1 — t', lineRange: '3-3' }, storyClaim: { kind: 'ids', ids: ['S-1'] },
    ...over,
  };
  for (const k of omit) delete data[k];
  return {
    projectOverview: { data: data as never, sources: [] },
    currentMissions: { data: { active: [] }, sources: [] },
    checkpoints: { data: { byActiveMission: [] }, sources: [] },
    roadmap: { data: { text: '' }, sources: [] },
    diagnostics: { validation: 'NOT_PERFORMED', sources: [rep('config'), rep('state'), story, rep('roadmap')], notes: [] },
  };
}

const overview = (m: DashboardReadModel) => mount(ProjectOverview, { props: { overview: toDashboardData(m).overview } });
const state = (w: ReturnType<typeof overview>) => w.get('[data-testid="story-state"]').text();

describe('Project Overview — structured story state', () => {
  it('active story: shows identity', () => {
    const w = overview(model());
    expect(w.get('[data-testid="story-ids"]').text()).toBe('S-1');
    expect(state(w)).toContain('Active');
    expect(w.get('[data-testid="ov-focus"] dd').attributes('data-story-kind')).toBe('active');
  });

  it('none: "no active story" is not UNKNOWN and not "completed"', () => {
    const w = overview(model({ currentStory: { excerpt: 'No active story recorded.', lineRange: '1-1' }, storyClaim: { kind: 'none' } }));
    expect(state(w)).toBe('No active story recorded');
    expect(w.get('[data-testid="ov-focus"]').text()).not.toMatch(/UNKNOWN|complete/i);
    expect(w.get('[data-testid="ov-focus"] dd').attributes('data-story-kind')).toBe('none');
  });

  it('unknown claim: UNKNOWN, excerpt kept as text', () => {
    const w = overview(model({ currentStory: { excerpt: 'something free-form', lineRange: '1-1' }, storyClaim: { kind: 'unknown' } }));
    expect(state(w)).toContain('UNKNOWN');
    expect(w.get('[data-testid="current-story"]').text()).toBe('something free-form');
  });

  it('readable source without a Current Story section: UNKNOWN, distinct from none', () => {
    const w = overview(model({ currentStory: null, storyClaim: null }));
    expect(state(w)).toContain('no usable');
    expect(w.get('[data-testid="ov-focus"] dd').attributes('data-story-kind')).toBe('no_section');
  });

  it.each([
    ['absent', 'SOURCE_ABSENT', 'Source absent'],
    ['corrupt', 'SOURCE_EMPTY', 'Source corrupt'],
    ['forbidden', 'SOURCE_SYMLINK', 'Source forbidden'],
    ['unreadable', 'SOURCE_UNREADABLE', 'Source unreadable'],
  ] as const)('source %s is reported, not masked', (status, code, label) => {
    const w = overview(model({ currentStory: null, storyClaim: null }, rep('activeStory', status, code)));
    expect(state(w)).toContain('NOT AVAILABLE');
    expect(state(w)).toContain(label);
    expect(state(w)).toContain(code);
    expect(w.find('[data-testid="current-story"]').exists()).toBe(false);
  });

  it('mission counters', () => {
    const w = overview(model());
    expect(w.get('[data-testid="mission-active"]').text()).toBe('2');
    expect(w.get('[data-testid="mission-finished"]').text()).toBe('5');
    const zero = overview(model({ activeMissionCount: 0, finishedMissionCount: 0 }));
    expect(zero.get('[data-testid="mission-active"]').text()).toBe('0');
    const unk = overview(model({ activeMissionCount: null, finishedMissionCount: null }));
    expect(unk.get('[data-testid="mission-active"]').text()).toBe('UNKNOWN');
  });

  it('shows identity, revision, and no description or health/progress figures', () => {
    const w = overview(model());
    expect(w.text()).toContain('Proj');
    expect(w.text()).toContain('12');
    expect(w.text()).not.toContain('Description');
    expect(w.text()).not.toMatch(/health|%|progress/i);
  });

  it('HTML-like project text stays text', () => {
    const w = overview(model({
      name: '<b>N</b>',
      currentStory: { excerpt: '<img src=x onerror=alert(1)>', lineRange: '1-1' }, storyClaim: { kind: 'unknown' },
    }));
    expect(w.find('img').exists()).toBe(false);
    expect(w.find('b').exists()).toBe(false);
    expect(w.get('[data-testid="current-story"]').element.textContent).toBe('<img src=x onerror=alert(1)>');
    const ids = overview(model({ storyClaim: { kind: 'ids', ids: ['<i>x</i>'] } }));
    expect(ids.find('i').exists()).toBe(false);
  });

  it('old DTO (no storyClaim / counters): validates, never invents a classification', () => {
    const old = model({}, rep('activeStory'), ['storyClaim', 'activeMissionCount', 'finishedMissionCount']);
    expect(isDashboardReadModel(old)).toBe(true);
    const w = overview(old);
    expect(w.get('[data-testid="ov-focus"] dd').attributes('data-story-kind')).toBe('unknown');
    expect(w.get('[data-testid="mission-active"]').text()).toBe('UNKNOWN');
  });

  it('validator rejects a malformed storyClaim and counters', () => {
    expect(isDashboardReadModel(model({ storyClaim: { kind: 'bogus' } as never }))).toBe(false);
    expect(isDashboardReadModel(model({ storyClaim: { kind: 'ids', ids: [1] } as never }))).toBe(false);
    expect(isDashboardReadModel(model({ activeMissionCount: 'x' as never }))).toBe(false);
  });

  it('component has no v-html', () => {
    const src = readFileSync(join(__dirname, '../components/ProjectOverview.vue'), 'utf8');
    expect(src).not.toMatch(/v-html|innerHTML/);
  });
});

describe('Project Overview — skins and layout', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));
  afterEach(() => vi.unstubAllGlobals());

  it('renders in the live app and under both skins without skin-specific markup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(model()), { status: 200, headers: { 'content-type': 'application/json' } })));
    const w = mount(App);
    await flushPromises();
    for (const skin of ['classic', 'cosmic-glass']) {
      document.documentElement.setAttribute('data-skin', skin);
      expect(w.find('[data-testid="ov-identity"]').exists()).toBe(true);
      expect(w.find('[data-testid="ov-focus"]').exists()).toBe(true);
      expect(w.find('[data-testid="ov-missions"]').exists()).toBe(true);
    }
    document.documentElement.removeAttribute('data-skin');
  });

  it('uses the existing responsive .facts grid (collapses to one column on narrow screens)', () => {
    const css = readFileSync(join(__dirname, '../styles/main.css'), 'utf8');
    expect(css).toContain('.facts { grid-template-columns: 1fr; }');
    expect(css).toMatch(/\.ov-block \+ \.ov-block/);
  });
});
