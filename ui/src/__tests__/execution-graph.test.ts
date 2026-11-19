import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ExecutionGraphPanel from '../components/ExecutionGraphPanel.vue';
import { projectExecutionGraph } from '../graph/projection';
import { isDashboardReadModel } from '../live/validate';
import { parseRoadmapPhases } from '../../../src/readmodel/roadmap';
import { parseStoryIndex } from '../../../src/readmodel/story-index';
import type { Section, SourceReport, StructuredRoadmapView, StructuredStoryIndexView } from '../../../src/readmodel/types';
import type { StoryState } from '../types/dashboard';

// Inputs are produced by Core's real parsers: the UI is tested against the contract it receives, not a re-implementation of it.

function roadmapDoc(phases: Array<[string, string]>, active?: string): string {
  const body = phases.map(([id, status]) => `### Phase ${id} — Title ${id}\n\n**Status:** ${status}\n`).join('\n');
  return `## Phases\n\n${body}\n## Current Focus\n\n${active === undefined ? '' : `Active Phase: ${active} — x\n`}`;
}
function storyDoc(groups: Array<{ phase?: string; stories: Array<[string, string?]> }>): string {
  return groups
    .map((g) => `${g.phase === undefined ? '' : `## Phase ${g.phase} — Name\n\n`}${g.stories.map(([id, status = 'COMPLETED']) => `### ${id} — Title ${id}\n\n**Date:** 2026-01-01\n**Status:** ${status}\n`).join('\n')}`)
    .join('\n');
}

const src: SourceReport = { id: 'storyIndex', path: '.monolith/memory/working/story-index.md', status: 'available', code: null };
function indexFor(text: string, road: StructuredRoadmapView): Section<StructuredStoryIndexView> {
  const ids = road.state === 'error' ? null : road.phases.flatMap((p) => (p.id === null ? [] : [p.id]));
  return { data: parseStoryIndex(text, ids, road.state !== 'partial'), sources: [src] };
}

interface Opts { roadmap: string | null; stories?: string | null | 'absent' | 'omitted'; story?: StoryState }
function mountGraph(o: Opts) {
  const road = o.roadmap === null ? undefined : parseRoadmapPhases(o.roadmap);
  let storyIndex: Section<StructuredStoryIndexView> | undefined;
  if (o.stories === 'absent') storyIndex = { data: null, sources: [{ ...src, status: 'absent', code: null }] };
  else if (o.stories !== undefined && o.stories !== 'omitted' && o.stories !== null && road !== undefined) storyIndex = indexFor(o.stories, road);
  else if (o.stories !== undefined && o.stories !== 'omitted' && o.stories !== null) storyIndex = { data: parseStoryIndex(o.stories, null, true), sources: [src] };
  const props = { roadmapText: o.roadmap, roadmap: road, storyIndex, story: o.story };
  return { w: mount(ExecutionGraphPanel, { props, attachTo: document.body }), road, storyIndex, props };
}
const phases = (w: ReturnType<typeof mountGraph>['w']) => w.findAll('[data-testid="graph-phase"]');
const stories = (w: ReturnType<typeof mountGraph>['w']) => w.findAll('[data-testid="graph-story"]');
const edges = (w: ReturnType<typeof mountGraph>['w']) => w.findAll('[data-testid="graph-edge"]').map((e) => `${e.attributes('data-from')}>${e.attributes('data-to')}`);
const storyEl = (w: ReturnType<typeof mountGraph>['w'], id: string) => w.findAll('[data-testid="graph-story"]').filter((s) => s.attributes('data-story-id') === id);

afterEach(() => document.body.replaceChildren());

const ROAD = roadmapDoc([['1', 'COMPLETED'], ['2', 'IN PROGRESS'], ['3', 'PLANNED']], '2');

describe('Execution Graph — nodes and edges', () => {
  it('shows phases from the roadmap with id, title, reported status and a CURRENT marker only on the active phase', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001']] }]) });
    expect(phases(w)).toHaveLength(3);
    expect(phases(w).map((p) => p.attributes('data-phase-id'))).toEqual(['1', '2', '3']);
    expect(phases(w)[0]!.text()).toContain('Phase 1 · Title 1');
    expect(phases(w)[0]!.text()).toContain('COMPLETED');
    expect(phases(w)[0]!.text()).not.toContain('REPORTED'); // provenance is shown in the details panel, not on the graph
    const current = phases(w).filter((p) => p.find('[data-testid="graph-current-phase"]').exists());
    expect(current.map((p) => p.attributes('data-phase-id'))).toEqual(['2']);
  });

  it('shows stories from the story index with id, title and status', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001'], ['UI-002', 'IN PROGRESS']] }]) });
    expect(stories(w)).toHaveLength(2);
    expect(stories(w)[0]!.text()).toContain('UI-001 · Title UI-001');
    expect(stories(w)[1]!.text()).toContain('IN PROGRESS');
  });

  it('draws one Phase → Story edge for every matched, unique story, and nothing else', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001'], ['UI-002']] }, { phase: '3', stories: [['UI-003']] }]) });
    expect(edges(w)).toEqual(['phase:0>story:0', 'phase:0>story:1', 'phase:2>story:2']);
    expect(w.get('[data-testid="graph-summary"]').text()).toContain('3 confirmed links');
  });

  it('draws no edge for an unmatched phase reference and says why', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '99', stories: [['UI-001']] }]) });
    expect(edges(w)).toEqual([]);
    expect(stories(w)).toHaveLength(1);
    expect(w.text()).toContain('Phase not found in the roadmap (1)');
  });

  it('draws no edge for an ambiguous phase reference (duplicate roadmap phase ids)', () => {
    const { w } = mountGraph({ roadmap: roadmapDoc([['1', 'COMPLETED'], ['1', 'COMPLETED']]), stories: storyDoc([{ phase: '1', stories: [['UI-001']] }]) });
    expect(edges(w)).toEqual([]);
    expect(w.text()).toContain('Phase id matches several roadmap phases (1)');
  });

  it('keeps unverified stories visible, unlinked, and does not call the phase missing', () => {
    const { w } = mountGraph({ roadmap: null, stories: storyDoc([{ phase: '1', stories: [['UI-001']] }]) });
    expect(edges(w)).toEqual([]);
    expect(stories(w)).toHaveLength(1);
    expect(w.text()).toContain('Phase not confirmed (roadmap unreadable) (1)');
    expect(w.find('[data-notice="ROADMAP_UNAVAILABLE"]').exists()).toBe(true);
  });

  it('keeps stories outside any phase visible and unlinked', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ stories: [['UI-001']] }]) });
    expect(edges(w)).toEqual([]);
    expect(w.text()).toContain('Not nested under any phase (1)');
  });

  it('draws no edge for a duplicated story id; every duplicate stays listed', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001'], ['UI-001'], ['UI-002']] }]) });
    expect(stories(w)).toHaveLength(3);
    expect(edges(w)).toEqual(['phase:0>story:2']);
    expect(w.text()).toContain('Story id declared more than once — no link drawn (2)');
  });

  it('never links by title or order: a phase with the same title but a different id is not a match', () => {
    const road = roadmapDoc([['1', 'COMPLETED']]);
    const { w } = mountGraph({ roadmap: road, stories: '## Phase 7 — Title 1\n### UI-001 — x\n**Status:** COMPLETED\n' });
    expect(edges(w)).toEqual([]);
  });
});

describe('Execution Graph — active phase', () => {
  const none = (ro: string) => mountGraph({ roadmap: ro, stories: storyDoc([{ phase: '1', stories: [['UI-001']] }]) }).w.findAll('[data-testid="graph-current-phase"]');

  it('marks nothing CURRENT when the roadmap declares no active phase', () => {
    expect(none(roadmapDoc([['1', 'IN PROGRESS'], ['2', 'PLANNED']]))).toHaveLength(0);
  });
  it('marks nothing CURRENT for an explicit "none"', () => {
    expect(none(roadmapDoc([['1', 'IN PROGRESS']], 'none'))).toHaveLength(0);
  });
  it('marks nothing CURRENT when the pointer is unmatched, and does not fall back to the first unfinished phase', () => {
    expect(none(roadmapDoc([['1', 'IN PROGRESS'], ['2', 'PLANNED']], '77'))).toHaveLength(0);
  });
  it('marks nothing CURRENT when the pointed id is duplicated (ambiguous)', () => {
    expect(none(roadmapDoc([['1', 'IN PROGRESS'], ['1', 'PLANNED']], '1'))).toHaveLength(0);
  });
  it('explains why no phase is current', () => {
    const { w } = mountGraph({ roadmap: roadmapDoc([['1', 'IN PROGRESS']]), stories: 'omitted' });
    expect(w.text()).toContain('does not declare an active phase');
  });
});

describe('Execution Graph — current story', () => {
  const claim = (...ids: string[]): StoryState => ({ kind: 'active', ids, excerpt: null });

  it('shows the current story separately when it is not in the index, without a phase and not completed', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001']] }]), story: claim('BETA-020') });
    const cur = w.findAll('[data-testid="graph-current-outside"]');
    expect(cur).toHaveLength(1);
    expect(cur[0]!.text()).toContain('BETA-020');
    expect(cur[0]!.text()).not.toContain('COMPLETED');
    expect(edges(w)).toEqual(['phase:0>story:0']);
  });

  it('does not duplicate a current story that is already in the index; it is marked CURRENT in place', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001'], ['UI-002']] }]), story: claim('UI-002') });
    expect(w.findAll('[data-testid="graph-current-outside"]')).toHaveLength(0);
    expect(storyEl(w, 'UI-002')).toHaveLength(1);
    expect(storyEl(w, 'UI-002')[0]!.find('[data-testid="graph-current-story"]').exists()).toBe(true);
    expect(storyEl(w, 'UI-001')[0]!.find('[data-testid="graph-current-story"]').exists()).toBe(false);
  });

  it('marks no entry when the current story id is duplicated in the index', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-002'], ['UI-002']] }]), story: claim('UI-002') });
    expect(w.findAll('[data-testid="graph-current-story"]')).toHaveLength(0);
    expect(w.findAll('[data-testid="graph-current-outside"]')).toHaveLength(0);
    expect(w.find('[data-notice="CURRENT_STORY_DUPLICATE"]').exists()).toBe(true);
  });

  it('does not pick an arbitrary story from an ambiguous claim', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001'], ['UI-002']] }]), story: claim('UI-001', 'UI-002') });
    expect(w.findAll('[data-testid="graph-current-story"]')).toHaveLength(0);
    expect(w.find('[data-notice="CURRENT_STORY_AMBIGUOUS"]').exists()).toBe(true);
  });

  it('shows the current story even when the story index is absent', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: 'absent', story: claim('BETA-020') });
    expect(w.findAll('[data-testid="graph-current-outside"]')).toHaveLength(1);
    expect(w.find('[data-notice="STORY_INDEX_ABSENT"]').exists()).toBe(true);
  });
});

describe('Execution Graph — selection and details', () => {
  it('selects a phase, highlights it and its links, and shows its details', async () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001'], ['UI-002']] }, { phase: '3', stories: [['UI-003']] }]) });
    await phases(w)[0]!.trigger('click');
    expect(phases(w)[0]!.classes()).toContain('xg-selected');
    expect(phases(w)[0]!.attributes('aria-pressed')).toBe('true');
    const d = w.get('[data-testid="graph-details"]');
    expect(d.get('[data-testid="detail-id"]').text()).toBe('1');
    expect(d.get('[data-testid="detail-status"]').text()).toContain('COMPLETED');
    expect(d.get('[data-testid="detail-status"]').text()).toContain('REPORTED');
    expect(d.get('[data-testid="detail-linked"]').text()).toContain('2 confirmed');
    expect(w.findAll('[data-testid="graph-edge"]').filter((e) => e.classes().includes('xg-edge-hot'))).toHaveLength(2);
    expect(storyEl(w, 'UI-001')[0]!.classes()).toContain('xg-related');
    expect(storyEl(w, 'UI-003')[0]!.classes()).toContain('xg-dim');
  });

  it('shows the current-phase fact in the phase details', async () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: 'omitted' });
    await phases(w)[1]!.trigger('click');
    expect(w.get('[data-testid="detail-current"]').text()).toContain('Yes');
    await phases(w)[0]!.trigger('click');
    expect(w.get('[data-testid="detail-current"]').text()).toBe('No');
  });

  it('selects a story and shows its provenance, phase relation and linked phase', async () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001']] }]) });
    await stories(w)[0]!.trigger('click');
    const d = w.get('[data-testid="graph-details"]');
    expect(d.get('[data-testid="detail-id"]').text()).toBe('UI-001');
    expect(d.get('[data-testid="detail-provenance"]').text()).toContain('REPORTED');
    expect(d.get('[data-testid="detail-provenance"]').text()).toContain('not independently verified');
    expect(d.get('[data-testid="detail-phase-relation"]').text()).toContain('Matched');
    expect(d.get('[data-testid="detail-phase"]').text()).toContain('Phase 1');
  });

  it('explains an unmatched relation in the story details', async () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '99', stories: [['UI-001']] }]) });
    await stories(w)[0]!.trigger('click');
    expect(w.get('[data-testid="detail-phase-relation"]').text()).toContain('matches no roadmap phase');
    expect(w.find('[data-testid="detail-phase"]').exists()).toBe(false);
    expect(w.get('[data-testid="detail-diagnostics"]').text()).toContain('matches no phase of the roadmap');
  });

  it('shows the duplicate-id warning in the details of a duplicated story', async () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001'], ['UI-001']] }]) });
    await stories(w)[0]!.trigger('click');
    expect(w.get('[data-testid="detail-duplicate"]').text()).toContain('2 times');
  });

  it('shows the current story that is not in the index in the details, without a phase', async () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: 'omitted', story: { kind: 'active', ids: ['BETA-020'], excerpt: null } });
    await w.get('[data-testid="graph-current-outside"]').trigger('click');
    expect(w.get('[data-testid="detail-phase-relation"]').text()).toContain('no phase is assigned');
    expect(w.get('[data-testid="detail-status"]').text()).toContain('not completed');
  });

  it('clears the selection by the button, by the toolbar button and by Escape', async () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001']] }]) });
    for (const how of ['details', 'toolbar', 'escape'] as const) {
      await stories(w)[0]!.trigger('click');
      expect(w.find('[data-testid="graph-details-empty"]').exists()).toBe(false);
      if (how === 'details') await w.get('[data-testid="graph-details-clear"]').trigger('click');
      else if (how === 'toolbar') await w.get('[data-testid="graph-clear"]').trigger('click');
      else await w.get('[data-testid="graph-viewport"]').trigger('keydown', { key: 'Escape' });
      expect(w.find('[data-testid="graph-details-empty"]').exists(), how).toBe(true);
      expect(storyEl(w, 'UI-001')[0]!.classes()).not.toContain('xg-selected');
    }
  });

  it('clicking the selected node again deselects it', async () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: 'omitted' });
    await phases(w)[0]!.trigger('click');
    await phases(w)[0]!.trigger('click');
    expect(w.find('[data-testid="graph-details-empty"]').exists()).toBe(true);
  });

  it('selecting one of two duplicated stories selects only that entry', async () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001'], ['UI-001']] }]) });
    await stories(w)[1]!.trigger('click');
    expect(stories(w)[1]!.classes()).toContain('xg-selected');
    expect(stories(w)[0]!.classes()).not.toContain('xg-selected');
  });
});

describe('Execution Graph — empty, missing and damaged sources', () => {
  it('says "no graph data" instead of drawing an empty graph when nothing is available', () => {
    const { w } = mountGraph({ roadmap: null, stories: 'omitted' });
    expect(w.find('[data-testid="graph-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="graph-canvas"]').exists()).toBe(false);
    expect(w.find('[data-notice="ROADMAP_UNAVAILABLE"]').exists()).toBe(true);
    expect(w.find('[data-notice="STORY_INDEX_NOT_PROVIDED"]').exists()).toBe(true);
  });

  it('tells an older server (no storyIndex) apart from an absent story index file', () => {
    const older = mountGraph({ roadmap: ROAD, stories: 'omitted' }).w;
    expect(older.find('[data-notice="STORY_INDEX_NOT_PROVIDED"]').exists()).toBe(true);
    expect(older.find('[data-notice="STORY_INDEX_ABSENT"]').exists()).toBe(false);
    expect(phases(older)).toHaveLength(3); // phases still shown
    const absent = mountGraph({ roadmap: ROAD, stories: 'absent' }).w;
    expect(absent.find('[data-notice="STORY_INDEX_ABSENT"]').exists()).toBe(true);
    expect(absent.find('[data-notice="STORY_INDEX_NOT_PROVIDED"]').exists()).toBe(false);
  });

  it('reports an unreadable story index as an error, with its code, never as "no stories"', () => {
    const road = parseRoadmapPhases(ROAD);
    const w = mount(ExecutionGraphPanel, {
      props: { roadmapText: ROAD, roadmap: road, storyIndex: { data: null, sources: [{ ...src, status: 'forbidden', code: 'SOURCE_NOT_REGULAR' }] } },
    });
    const n = w.get('[data-notice="STORY_INDEX_ERROR"]');
    expect(n.classes()).toContain('xg-error');
    expect(n.text()).toContain('SOURCE_NOT_REGULAR');
  });

  it('says so when the story index has no stories', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: '## Phase 1 — X\n' });
    expect(w.find('[data-notice="STORY_INDEX_NO_STORIES"]').exists()).toBe(true);
    expect(w.get('[data-testid="graph-summary"]').text()).toContain('no stories to link');
    expect(phases(w)).toHaveLength(3);
  });

  it('says so when the story index is empty', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: '' });
    expect(w.find('[data-notice="STORY_INDEX_EMPTY"]').exists()).toBe(true);
  });

  it('flags a partial roadmap and warns that "not found" is not proof of absence', () => {
    const partial = '## Phases\n\n### Phase 1 — A\n\n**Status:** COMPLETED\n\n### Phase\n\n**Status:** COMPLETE\n';
    const road = parseRoadmapPhases(partial);
    // Only assert the scenario when Core really calls it partial; otherwise the test would prove nothing.
    expect(road.state).toBe('partial');
    const { w } = mountGraph({ roadmap: partial, stories: storyDoc([{ phase: '9', stories: [['UI-001']] }]) });
    expect(w.find('[data-notice="ROADMAP_PARTIAL"]').exists()).toBe(true);
    expect(w.find('[data-notice="ROADMAP_LIMITS_MATCHING"]').exists()).toBe(true);
  });

  it('does not show the limited-roadmap warning for a fully read roadmap', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '99', stories: [['UI-001']] }]) });
    expect(w.find('[data-notice="ROADMAP_LIMITS_MATCHING"]').exists()).toBe(false);
  });

  it('shows an unrecognised roadmap as a limitation and keeps the stories visible', () => {
    const { w } = mountGraph({ roadmap: '# just prose, no phases section\n', stories: storyDoc([{ phase: '1', stories: [['UI-001']] }]) });
    expect(w.find('[data-notice="ROADMAP_UNRECOGNIZED"]').exists()).toBe(true);
    expect(phases(w)).toHaveLength(0);
    expect(stories(w)).toHaveLength(1);
    expect(edges(w)).toEqual([]);
    expect(w.find('[data-notice="ROADMAP_LIMITS_MATCHING"]').exists()).toBe(true);
  });

  it('renders malformed text from documents as escaped text, never as markup', () => {
    const { w } = mountGraph({ roadmap: roadmapDoc([['1', 'COMPLETED']]), stories: '## Phase 1 — X\n### UI-001 — <img src=x onerror=alert(1)>\n**Status:** COMPLETED\n' });
    expect(w.find('img').exists()).toBe(false);
    expect(stories(w)[0]!.text()).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows an unknown story status as unrecognised, not as completed', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: storyDoc([{ phase: '1', stories: [['UI-001', 'Mystery']] }]) });
    expect(stories(w)[0]!.text()).toContain('Mystery');
    expect(stories(w)[0]!.find('.status-unrecognized').exists()).toBe(true);
  });

  it('shows a missing story status as "status not stated"', () => {
    const { w } = mountGraph({ roadmap: ROAD, stories: '## Phase 1 — X\n### UI-001 — a\n' });
    expect(stories(w)[0]!.text()).toContain('STATUS NOT STATED');
  });
});

describe('Execution Graph — projection invariants', () => {
  it('is read-only: the input objects are not mutated', () => {
    const road = parseRoadmapPhases(ROAD);
    const si = indexFor(storyDoc([{ phase: '1', stories: [['UI-001']] }]), road);
    const before = JSON.stringify([road, si]);
    projectExecutionGraph({ roadmapText: ROAD, roadmap: road, storyIndex: si, story: { kind: 'active', ids: ['X-1'], excerpt: null } });
    expect(JSON.stringify([road, si])).toBe(before);
  });

  it('does not trust a payload that calls a repeated story id unique (no edge is drawn)', () => {
    const road = parseRoadmapPhases(ROAD);
    const si = indexFor(storyDoc([{ phase: '1', stories: [['UI-001'], ['UI-001']] }]), road);
    for (const s of si.data!.stories) s.idStatus = 'unique';
    const g = projectExecutionGraph({ roadmapText: ROAD, roadmap: road, storyIndex: si, story: undefined });
    expect(g.edges).toEqual([]);
  });

  it('every edge connects a matched story to the one phase with that id', () => {
    const road = parseRoadmapPhases(ROAD);
    const si = indexFor(storyDoc([{ phase: '1', stories: [['A-1']] }, { phase: '2', stories: [['A-2']] }, { phase: '8', stories: [['A-3']] }, { stories: [['A-4']] }]), road);
    const g = projectExecutionGraph({ roadmapText: ROAD, roadmap: road, storyIndex: si, story: undefined });
    expect(g.edges).toHaveLength(2);
    for (const e of g.edges) {
      const p = g.phases.find((x) => x.key === e.from)!;
      const s = g.stories.find((x) => x.key === e.to)!;
      expect(s.phaseRef.kind === 'matched' && s.phaseRef.phaseId === p.id).toBe(true);
    }
  });
});

describe('Execution Graph — payload validation', () => {
  const road = parseRoadmapPhases(ROAD);
  function model(storyIndex: unknown) {
    const s = (id: string) => ({ data: null, sources: [{ id, path: null, status: 'absent', code: null }] });
    return {
      projectOverview: { data: { name: 'p', monolithRoot: '.monolith', monolithRootSource: 'config', stateSchemaVersionOnDisk: null, stateRevision: null, activeMissionCount: null, finishedMissionCount: null, currentStory: null, storyClaim: null }, sources: [] },
      currentMissions: s('state'),
      checkpoints: s('state'),
      roadmap: { data: { text: ROAD, structured: road }, sources: [] },
      ...(storyIndex === undefined ? {} : { storyIndex }),
      diagnostics: { sources: [], notes: [] },
    };
  }
  const good = () => indexFor(storyDoc([{ phase: '1', stories: [['UI-001']] }]), road);

  it('accepts a payload with, and without, a story index', () => {
    expect(isDashboardReadModel(model(undefined))).toBe(true);
    expect(isDashboardReadModel(model(good()))).toBe(true);
    expect(isDashboardReadModel(model({ data: null, sources: [{ ...src, status: 'absent' }] }))).toBe(true);
  });

  it.each<[string, (m: ReturnType<typeof good>) => unknown]>([
    ['unknown state', (m) => ({ ...m, data: { ...m.data!, state: 'weird' } })],
    ['stories under a failed state', (m) => ({ ...m, data: { ...m.data!, state: 'error' } })],
    ['story without id', (m) => ({ ...m, data: { ...m.data!, stories: [{ ...m.data!.stories[0]!, id: 5 }] } })],
    ['unknown phase reference kind', (m) => ({ ...m, data: { ...m.data!, stories: [{ ...m.data!.stories[0]!, phase: { kind: 'guess', token: '1' } }] } })],
    ['matched without a phase id', (m) => ({ ...m, data: { ...m.data!, stories: [{ ...m.data!.stories[0]!, phase: { kind: 'matched', token: '1' } }] } })],
    ['status claimed CONFIRMED', (m) => ({ ...m, data: { ...m.data!, stories: [{ ...m.data!.stories[0]!, status: { value: 'COMPLETED', recognized: true, provenance: 'CONFIRMED' } }] } })],
    ['diagnostic pointing past the list', (m) => ({ ...m, data: { ...m.data!, diagnostics: [{ code: 'STORY_ID_DUPLICATE', severity: 'warn', storyIndex: 4 }] } })],
    ['unknown diagnostic code', (m) => ({ ...m, data: { ...m.data!, diagnostics: [{ code: 'MADE_UP', severity: 'warn', storyIndex: null }] } })],
    ['repeated id called unique', (m) => ({ ...m, data: { ...m.data!, stories: [m.data!.stories[0]!, { ...m.data!.stories[0]!, idStatus: 'unique' }] } })],
    ['not an object', () => 'nope'],
  ])('rejects a malformed story index: %s', (_name, mutate) => {
    expect(isDashboardReadModel(model(mutate(good())))).toBe(false);
  });
});
