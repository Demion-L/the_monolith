import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ProjectOverview from '../components/ProjectOverview.vue';
import RoadmapPanel from '../components/RoadmapPanel.vue';
import { isSectionId, sectionFromHash } from '../sections';
import { extractStoryFields } from '../storyFields';
import type { Mission, ProjectOverview as Ov, Section, StructuredRoadmapView, StructuredStoryIndexView } from '../types/dashboard';

const KNOWN = [
  '**Story:** BETA-020',
  '**Title:** MONOLITH v0.2.0-beta.1',
  '**Goal:** Interactive Mission Control & Project Universe',
  '**Status:** IN PROGRESS',
  '**Branch:** `feat/beta-020-development`',
  '**Current milestone:** Phase 3 — Interactive Diagnostics (Phase 2 accepted)',
  '',
  'Previous recorded story: **CONTEXT-001A**',
].join('\n');

describe('extractStoryFields (narrow adapter, known active.md labels only)', () => {
  it('reads the known labels and nothing else', () => {
    expect(extractStoryFields(KNOWN)).toEqual({
      title: 'MONOLITH v0.2.0-beta.1',
      objective: 'Interactive Mission Control & Project Universe',
      status: 'IN PROGRESS',
      milestone: 'Phase 3 — Interactive Diagnostics (Phase 2 accepted)',
      branch: 'feat/beta-020-development',
    });
  });
  it.each([
    ['null', null],
    ['empty', ''],
    ['free prose', 'We are working on something.\nNo labels here.'],
    ['unknown label only', '**Owner:** someone'],
    ['label without value', '**Title:**'],
    ['label not at line start', 'see **Title:** X'],
  ])('unknown format (%s) → null, never a guess', (_n, text) => {
    expect(extractStoryFields(text as string | null)).toBeNull();
  });
  it('first occurrence wins; partial data leaves the rest null', () => {
    const f = extractStoryFields('**Title:** A\n**Title:** B\n**Goal:** G');
    expect(f).toMatchObject({ title: 'A', objective: 'G', status: null, milestone: null, branch: null });
  });
  it('does not interpret status as a lifecycle state', () => {
    expect(extractStoryFields('**Status:** COMPLETED')!.status).toBe('COMPLETED');
  });
  it('bounds very long values', () => {
    expect(extractStoryFields(`**Goal:** ${'x'.repeat(1000)}`)!.objective!.length).toBeLessThanOrEqual(301);
  });
});

const ov = (excerpt: string | null, o: Partial<Ov> = {}): Ov => ({
  name: 'P', stateRevision: null,
  story: { kind: 'active', ids: ['BETA-020'], excerpt }, ...o,
});
const mnt = (props: Record<string, unknown>) => mount(ProjectOverview, { props: props as never });

describe('Current Mission card', () => {
  it('known format: id, title, status, objective, milestone, branch are separate elements; source stays reachable', () => {
    const w = mnt({ overview: ov(KNOWN) });
    expect(w.get('[data-testid="story-ids"]').text()).toBe('BETA-020');
    expect(w.get('[data-testid="story-title"]').text()).toBe('MONOLITH v0.2.0-beta.1');
    expect(w.get('[data-testid="story-status-text"]').text()).toBe('IN PROGRESS');
    expect(w.get('[data-testid="story-objective"]').text()).toContain('Interactive Mission Control');
    expect(w.get('[data-testid="story-milestone"]').text()).toContain('Phase 3');
    expect(w.get('[data-testid="story-branch"] code').text()).toBe('feat/beta-020-development');
    expect(w.get('[data-testid="story-fields-note"]').text()).toContain('Core confirms only the story identity');
    expect(w.get('[data-testid="current-story-full"]').element.textContent).toBe(KNOWN);
    expect(w.find('[data-testid="current-story"]').exists()).toBe(false);
  });
  it('the extracted status never changes the Core-derived state', () => {
    const w = mnt({ overview: ov('**Status:** COMPLETED\n**Title:** T') });
    expect(w.get('[data-testid="story-state"]').text()).toBe('Active');
    const none = mnt({ overview: ov('**Status:** IN PROGRESS', { story: { kind: 'none', excerpt: '**Status:** IN PROGRESS' } }) });
    // "No active story recorded" is a normal state: no empty card; the pulse states it
    expect(none.find('[data-testid="ov-focus"]').exists()).toBe(false);
    expect(none.get('[data-testid="pulse-story"]').text()).toBe('None recorded');
  });
  it('unknown format: plain source preview fallback, no structured fields', () => {
    const w = mnt({ overview: ov('Just some prose about the story.') });
    expect(w.find('[data-testid="story-title"]').exists()).toBe(false);
    expect(w.get('[data-testid="current-story"]').text()).toContain('Just some prose');
    expect(w.text()).toContain('format not recognised');
  });
  it('no story at all: honest state, no card fields', () => {
    const w = mnt({ overview: ov(null, { story: { kind: 'none', excerpt: null } }) });
    expect(w.find('[data-testid="ov-focus"]').exists()).toBe(false);
    expect(w.get('[data-testid="pulse-story"]').text()).toBe('None recorded');
    expect(w.find('[data-testid="story-objective"]').exists()).toBe(false);
  });
  it('untrusted text is escaped', () => {
    const w = mnt({ overview: ov('**Title:** <img src=x onerror=alert(1)>') });
    expect(w.find('img').exists()).toBe(false);
    expect(w.get('[data-testid="story-title"]').text()).toContain('<img');
    expect(readFileSync(join(__dirname, '../components/ProjectOverview.vue'), 'utf8')).not.toMatch(/v-html|innerHTML/);
  });
  it('operational missions appear in the overview only when active ones exist', () => {
    const ms: Mission[] = [
      { id: 'MIS-1', title: 'Active one', status: 'in_progress', summary: null, startedAt: null, updatedAt: null },
      { id: 'MIS-2', title: 'Done one', status: 'completed', summary: null, startedAt: null, updatedAt: null },
    ];
    const w = mnt({ overview: ov(KNOWN), missions: ms });
    expect(w.findAll('[data-testid="mission"]')).toHaveLength(1);
    expect(w.text()).toContain('Active one');
    expect(w.text()).not.toContain('Done one');
    expect(mnt({ overview: ov(KNOWN), missions: [] }).find('[data-testid="ov-mission-list"]').exists()).toBe(false);
    expect(mnt({ overview: ov(KNOWN), missions: null }).find('[data-testid="ov-mission-list"]').exists()).toBe(false);
  });
});

describe('navigation without the duplicate Current Mission entry', () => {
  it('#mission is no longer a section and falls back to the overview', () => {
    expect(isSectionId('mission')).toBe(false);
    expect(sectionFromHash('#mission')).toBe('overview');
  });
});

const status = (v: string | null) => ({ value: v, recognized: v !== null, provenance: 'REPORTED' as const });
const rm = (): StructuredRoadmapView => ({
  state: 'ok', diagnostics: [], activePhase: { kind: 'phase', id: '1' },
  phases: [
    { id: '1', title: 'Core', status: status('IN PROGRESS'), goal: 'Build the core', details: '| Story | Title |\n| 1.1 | X |' },
    { id: '2+', title: null, status: status('NOT DEFINED'), goal: null, details: null },
  ],
});
const idx = (): Section<StructuredStoryIndexView> => ({
  sources: [],
  data: {
    state: 'ok', diagnostics: [],
    stories: [
      { id: 'STORY 1.1', idStatus: 'unique', title: 'Foundation', status: status('COMPLETED'), date: '2026-06-26', phase: { kind: 'matched', phaseId: '1', token: '1' } },
      { id: 'LOST-1', idStatus: 'unique', title: 'Elsewhere', status: status('COMPLETED'), date: null, phase: { kind: 'unmatched', token: '9' } },
    ],
  },
});

describe('Roadmap phase explorer', () => {
  it('shows objective, Core-matched stories with reported status, and notes behind a fold', () => {
    const w = mount(RoadmapPanel, { props: { text: '# raw', structured: rm(), storyIndex: idx() } as never });
    const first = w.findAll('[data-testid="roadmap-phase"]').find((p) => p.attributes('data-phase-id') === '1')!;
    expect(first.get('[data-testid="phase-goal"]').text()).toContain('Build the core');
    const rows = first.findAll('[data-testid="phase-story"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('STORY 1.1');
    expect(rows[0].text()).toContain('COMPLETED');
    expect(first.text()).toContain('not verified');
    expect(first.text()).not.toContain('LOST-1');
    expect(first.get('[data-testid="phase-details"]').element.tagName).toBe('DETAILS');
    expect(first.get('[data-testid="phase-details"] pre').text()).toContain('| 1.1 | X |');
    expect(w.get('[data-testid="roadmap-raw"] pre').text()).toBe('# raw');
  });
  it('phase without stories and missing story index are stated honestly', () => {
    const w = mount(RoadmapPanel, { props: { text: '#', structured: rm(), storyIndex: idx() } as never });
    const second = w.findAll('[data-testid="roadmap-phase"]').find((p) => p.attributes('data-phase-id') === '2+')!;
    expect(second.find('[data-testid="phase-stories-none"]').exists()).toBe(true);
    expect(second.find('[data-testid="phase-goal"]').exists()).toBe(false);
    const w2 = mount(RoadmapPanel, { props: { text: '#', structured: rm() } as never });
    expect(w2.findAll('[data-testid="phase-stories-unavailable"]').length).toBe(2);
    const bad = idx(); bad.data!.state = 'error';
    expect(mount(RoadmapPanel, { props: { text: '#', structured: rm(), storyIndex: bad } as never }).findAll('[data-testid="phase-story"]')).toHaveLength(0);
  });
  it('does not claim completion from roadmap text', () => {
    const r = rm(); r.phases[0].details = 'COMPLETED everything';
    const w = mount(RoadmapPanel, { props: { text: 'COMPLETED', structured: r } as never });
    expect(w.findAll('[data-testid="phase-status"]').map((x) => x.text())).toEqual(['NOT DEFINED', 'IN PROGRESS']);
    expect(w.findAll('[data-testid="phase-story"]')).toHaveLength(0);
  });
});

import { statusBadgeTone } from '../knowledge';
describe('status badge tone', () => {
  it.each([
    ['IN PROGRESS', true, 'progress'], ['IN PROGRESS (phase 3)', true, 'progress'], ['NOT DEFINED', true, 'warn'],
    ['COMPLETED', true, 'done'], ['COMPLETE', true, 'done'], ['PLANNED', true, 'planned'],
    ['IN PROGRESS', false, 'neutral'], ['WEIRD', true, 'neutral'], [null, false, 'neutral'],
  ])('%s (recognized=%s) → %s', (v, r, t) => {
    expect(statusBadgeTone(v as string | null, r as boolean)).toBe(t);
  });
  it('is rendered on the roadmap badges', () => {
    const w = mount(RoadmapPanel, { props: { text: '#', structured: rm(), storyIndex: idx() } as never });
    const cls = w.findAll('[data-testid="phase-status"]').map((x) => x.classes());
    expect(cls[0]).toContain('tone-warn');
    expect(cls[1]).toContain('tone-progress');
  });
});
