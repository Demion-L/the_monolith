import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ExecutionGraphPanel from '../components/ExecutionGraphPanel.vue';
import { lifecycleTone, leadingStatus, statesFinalized } from '../statusTone';
import { parseRoadmapPhases } from '../../../src/readmodel/roadmap';
import { parseStoryIndex } from '../../../src/readmodel/story-index';
import type { Section, SourceReport } from '../../../src/readmodel/types';

const roadmapDoc = (phases: Array<[string, string]>): string =>
  `## Phases\n\n${phases.map(([id, st]) => `### Phase ${id} — Title ${id}\n\n**Status:** ${st}\n`).join('\n')}\n## Current Focus\n\n`;
const src: SourceReport = { id: 'storyIndex', path: 'story-index.md', status: 'available', code: null };

function mountGraph(text: string | null, stories?: string) {
  const road = text === null ? undefined : parseRoadmapPhases(text);
  const ids = road === undefined ? null : road.phases.flatMap((p) => (p.id === null ? [] : [p.id]));
  const storyIndex: Section<ReturnType<typeof parseStoryIndex>> | undefined =
    stories === undefined ? undefined : { data: parseStoryIndex(stories, ids, road?.state === 'ok'), sources: [src] };
  return mount(ExecutionGraphPanel, { props: { roadmapText: text, roadmap: road, storyIndex }, attachTo: document.body });
}
const seq = (w: VueWrapper) => w.findAll('[data-testid="graph-seq-edge"]');
const pair = (e: { attributes: (n: string) => string | undefined }) => `${e.attributes('data-from')}>${e.attributes('data-to')}`;

afterEach(() => document.body.replaceChildren());

describe('UX-001 status colour semantics', () => {
  it('classifies lifecycle text without changing it', () => {
    expect(lifecycleTone('COMPLETED (finalized 2026-11-20, owner acceptance)')).toBe('ok');
    expect(lifecycleTone('COMPLETE')).toBe('ok');
    expect(lifecycleTone('IN PROGRESS')).toBe('progress');
    expect(lifecycleTone('PLANNED')).toBe('planned');
    expect(lifecycleTone('NOT DEFINED')).toBe('unknown');
    expect(lifecycleTone('whatever')).toBe('unknown');
    expect(lifecycleTone(null)).toBe('unknown');
    expect(leadingStatus('COMPLETED (finalized 2026-11-20, owner acceptance)')).toBe('COMPLETED');
    expect(statesFinalized('COMPLETED (finalized 2026-11-20)')).toBe(true);
    expect(statesFinalized('COMPLETED, not finalized')).toBe(false);
    expect(statesFinalized('COMPLETED')).toBe(false);
  });

  it('shows a COMPLETED phase green with a separate FINALIZED mark, and keeps the diagnostic apart', () => {
    const w = mountGraph(roadmapDoc([['0', 'COMPLETED (finalized 2026-11-20, owner acceptance; review pending)'], ['1', 'COMPLETED']]));
    const [p0, p1] = w.findAll('[data-testid="graph-phase"]');
    const st0 = p0!.get('[data-testid="graph-status"]');
    expect(st0.classes()).toContain('xg-st-ok');
    expect(st0.text()).toBe('COMPLETED');
    expect(st0.attributes('title')).toContain('finalized'); // the full verbatim value stays reachable
    expect(p0!.find('[data-testid="graph-finalized"]').exists()).toBe(true);
    expect(p1!.get('[data-testid="graph-status"]').classes()).toContain('xg-st-ok');
    expect(p1!.find('[data-testid="graph-finalized"]').exists()).toBe(false);
    // the unrecognised parenthetical value is a diagnostic (its own badge), not a red lifecycle state
    expect(p0!.find('[data-testid="graph-diag-badge"]').exists()).toBe(true);
  });

  it('IN PROGRESS, PLANNED and unknown states get their own classes', () => {
    const w = mountGraph(roadmapDoc([['1', 'IN PROGRESS'], ['2', 'PLANNED'], ['3', 'NOT DEFINED']]));
    expect(w.findAll('[data-testid="graph-phase"]').map((p) => p.get('[data-testid="graph-status"]').classes().find((c) => c.startsWith('xg-st-')))).toEqual(['xg-st-progress', 'xg-st-planned', 'xg-st-unknown']);
  });

  it('the stylesheet colours completion green, diagnostics amber, and never red for an unrecognised status', () => {
    const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');
    expect(css).toMatch(/\.xg-status\.xg-st-ok \{ color: #4ade80/);
    expect(css).toMatch(/\.xg-status\.xg-st-progress \{ color: #5ee6ff/);
    expect(css).toMatch(/\.xg-meta \.diag-badge \{[^}]*color: #fbbf24/);
    expect(css).not.toMatch(/\.xg-status\.status-unrecognized \{[^}]*#f87171/);
  });
});

describe('UX-002 phase continuity', () => {
  it('N consecutive phases give N-1 sequence links in roadmap order, and story links stay', () => {
    const w = mountGraph(roadmapDoc([['0', 'COMPLETED'], ['1', 'COMPLETED'], ['2', 'IN PROGRESS'], ['3', 'PLANNED']]),
      '## Phase 1 — Name\n\n### S-1 — Title\n\n**Date:** 2026-01-01\n**Status:** COMPLETED\n');
    const keys = w.findAll('[data-testid="graph-phase"]').map((p) => p.attributes('data-key')!);
    expect(seq(w).map(pair)).toEqual([`${keys[0]}>${keys[1]}`, `${keys[1]}>${keys[2]}`, `${keys[2]}>${keys[3]}`]);
    expect(w.findAll('[data-testid="graph-edge"]')).toHaveLength(1); // the confirmed Story→Phase link
    expect(w.find('[data-testid="legend-seq"]').text()).toContain('Roadmap sequence');
    expect(w.find('[data-testid="legend-member"]').text()).toContain('Confirmed membership');
  });

  it('a single phase and an empty roadmap draw no sequence link and do not fail', () => {
    const one = mountGraph(roadmapDoc([['1', 'PLANNED']]));
    expect(seq(one)).toHaveLength(0);
    expect(one.find('[data-testid="legend-seq"]').exists()).toBe(false);
    expect(one.find('[data-testid="legend-member"]').exists()).toBe(true);
    const none = mountGraph(null);
    expect(seq(none)).toHaveLength(0);
  });

  it('a duplicated phase id breaks the chain: nothing is bridged or invented', () => {
    const w = mountGraph(roadmapDoc([['1', 'COMPLETED'], ['2', 'COMPLETED'], ['2', 'PLANNED'], ['3', 'PLANNED'], ['4', 'PLANNED']]));
    expect(seq(w)).toHaveLength(1); // only 3 -> 4 remains between two unique phases
  });

  it('follows a dragged phase and returns on Reset layout', async () => {
    const w = mountGraph(roadmapDoc([['1', 'COMPLETED'], ['2', 'PLANNED']]));
    const d0 = seq(w)[0]!.attributes('d');
    const node = w.findAll('[data-testid="graph-phase"]')[1]!;
    await node.trigger('pointerdown', { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    await node.trigger('pointermove', { clientX: 420, clientY: 360, pointerId: 1 });
    await node.trigger('pointerup', { clientX: 420, clientY: 360, pointerId: 1 });
    expect(seq(w)[0]!.attributes('d')).not.toBe(d0);
    await w.get('[data-testid="graph-reset-layout"]').trigger('click');
    expect(seq(w)[0]!.attributes('d')).toBe(d0);
  });

  it('is drawn in a layer behind the nodes, with an arrowhead', () => {
    const w = mountGraph(roadmapDoc([['1', 'COMPLETED'], ['2', 'PLANNED']]));
    expect(seq(w)[0]!.attributes('marker-end')).toBe('url(#xg-arrow)');
    const html = w.get('[data-testid="graph-canvas"]').html();
    expect(html.indexOf('graph-seq-layer')).toBeLessThan(html.indexOf('data-testid="graph-phase"'));
  });
});
