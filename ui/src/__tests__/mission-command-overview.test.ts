import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ProjectOverview from '../components/ProjectOverview.vue';
import type { Checkpoint, Diagnostic, ProjectOverview as Ov, Section, StateProvenanceView, StructuredRoadmapView, StructuredStoryIndexView } from '../types/dashboard';

const baseOv = (o: Partial<Ov> = {}): Ov => ({
  name: 'Proj', stateRevision: 7, activeMissionCount: 1, finishedMissionCount: 4,
  story: { kind: 'active', ids: ['BETA-020'], excerpt: '**Story:** BETA-020' }, ...o,
});
const roadmap = (active: StructuredRoadmapView['activePhase']): StructuredRoadmapView => ({
  state: 'ok', activePhase: active, diagnostics: [],
  phases: [{ id: '3', title: 'Interactive', status: { value: 'IN PROGRESS', recognized: true, provenance: 'REPORTED' }, goal: null, details: null } as never],
});
const idx = (n: number, state: StructuredStoryIndexView['state'] = 'ok'): Section<StructuredStoryIndexView> => ({
  sources: [],
  data: {
    state, diagnostics: [],
    stories: Array.from({ length: n }, (_, i) => ({ id: `S-${i}`, idStatus: 'unique', title: `T${i}`, status: { value: 'DONE', recognized: true, provenance: 'REPORTED' }, date: '2026-01-0' + (i + 1), phase: { kind: 'none' } }) as never),
  },
});
const mnt = (props: Record<string, unknown> = {}) => mount(ProjectOverview, { props: { overview: baseOv(), ...props } as never });

describe('Mission Command Overview', () => {
  it('identity: name, confirmed phase, revision', () => {
    const w = mnt({ roadmap: roadmap({ kind: 'phase', id: '3' }) });
    expect(w.get('[data-testid="ov-name"]').text()).toBe('Proj');
    expect(w.get('[data-testid="chip-phase"]').text()).toContain('Phase 3');
    expect(w.get('[data-testid="chip-revision"]').text()).toContain('7');
  });

  it('unknown revision: neutral caption, no number invented, no error styling', () => {
    const w = mnt({ overview: baseOv({ stateRevision: null }) });
    expect(w.get('[data-testid="revision-unavailable"]').text()).toBe('Revision unavailable');
    expect(w.get('[data-testid="chip-revision"]').text()).not.toMatch(/\d/);
    expect(w.get('[data-testid="revision-note"]').text()).toContain('not an error');
    expect(w.find('[data-testid="chip-revision"] .unknown').exists()).toBe(false);
  });

  it.each([
    [{ kind: 'none' }, 'No active phase declared'],
    [{ kind: 'not_declared' }, 'Not declared'],
    [{ kind: 'unmatched' }, 'Uncertain'],
    [{ kind: 'ambiguous' }, 'Uncertain'],
  ] as const)('active phase %j is never CURRENT', (kind, text) => {
    const w = mnt({ roadmap: roadmap(kind as never) });
    expect(w.get('[data-testid="pulse-phase"]').text()).toContain(text);
    expect(w.get('[data-testid="pulse-phase"]').text()).not.toContain('CURRENT');
  });

  it('CURRENT only for kind: phase; missing roadmap is Unavailable', () => {
    expect(mnt({ roadmap: roadmap({ kind: 'phase', id: '3' }) }).get('[data-testid="pulse-phase"]').text()).toContain('CURRENT');
    const w = mnt();
    expect(w.get('[data-testid="pulse-phase"]').text()).toBe('Unavailable');
    // with no active work the continuity block states why nothing can be suggested
    const idle = mnt({ overview: baseOv({ activeMissionCount: 0, story: { kind: 'none', excerpt: null } }) });
    expect(idle.get('[data-testid="next-reason"]').text()).toContain('no structured roadmap');
    expect(idle.get('[data-testid="next-kind"]').text()).toBe('UNKNOWN');
  });

  it('active story comes from the story claim only', () => {
    const w = mnt({ roadmap: roadmap({ kind: 'phase', id: '3' }) });
    expect(w.get('[data-testid="pulse-story"]').text()).toBe('BETA-020');
    expect(w.get('[data-testid="story-ids"]').text()).toBe('BETA-020');
  });

  it('empty current story: honest state, no status invented', () => {
    const w = mnt({ overview: baseOv({ story: { kind: 'none', excerpt: null } }) });
    expect(w.get('[data-testid="story-state"]').text()).toBe('No active story recorded');
    expect(w.find('[data-testid="current-story"]').exists()).toBe(false);
    expect(w.get('[data-testid="pulse-story"]').text()).toBe('None recorded');
    expect(w.text()).not.toMatch(/IN PROGRESS|COMPLETED/);
  });

  it('completed stories: count from Core story index; missing index is Unavailable, not 0', () => {
    expect(mnt({ storyIndex: idx(3) }).get('[data-testid="pulse-stories"]').text()).toContain('3');
    expect(mnt({ storyIndex: idx(0, 'no_stories') }).get('[data-testid="pulse-stories"]').text()).toContain('0');
    for (const si of [undefined, { data: null, sources: [{ id: 'storyIndex', path: 'p', status: 'absent', code: null }] }, idx(2, 'error')]) {
      const t = mnt({ storyIndex: si }).get('[data-testid="pulse-stories"]').text();
      expect(t).toContain('Unavailable');
      expect(t).not.toMatch(/^0/);
    }
    expect(mnt({ storyIndex: idx(3) }).get('[data-testid="pulse-stories"]').text()).toContain('not overall project completion');
  });

  it('diagnostics: Core severities shown as given in a compact indicator, not a duplicated list', () => {
    const d: Diagnostic[] = [
      { severity: 'info', message: 'Source availability only' },
      { severity: 'error', message: 'activeStory (p): corrupt [SOURCE_EMPTY]' },
      { severity: 'warning', message: 'MULTIPLE_ACTIVE_MISSIONS' },
    ];
    const w = mnt({ diagnostics: d, roadmap: roadmap({ kind: 'none' }), storyIndex: idx(1) });
    expect(w.get('[data-testid="pulse-errors"]').text()).toBe('1 error(s)');
    expect(w.get('[data-testid="pulse-warnings"]').text()).toBe('1 warning(s)');
    expect(w.text()).not.toContain('SOURCE_EMPTY'); // the full list lives in Diagnostics
    const ok = mnt({ diagnostics: [d[0]!], roadmap: roadmap({ kind: 'none' }), storyIndex: idx(1) });
    expect(ok.get('[data-testid="pulse-diagnostics"]').text()).toBe('No problems reported');
    expect(ok.find('[data-testid="pulse-errors"]').exists()).toBe(false);
  });

  it('the Attention required and Project records blocks are gone; nothing is shown twice', () => {
    const w = mnt({ diagnostics: [{ severity: 'warning', message: 'W' }], checkpoints: [{ id: 'CP-1', missionId: 'M', createdAt: '2026-01-01', summary: 'did it', remainingSteps: null }], storyIndex: idx(5) });
    for (const id of ['ov-attention', 'attention-item', 'attention-empty', 'ov-activity', 'activity-checkpoints', 'activity-stories']) {
      expect(w.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
    }
    expect(w.text()).not.toMatch(/attention required|project records/i);
  });

  it('an unclassifiable story keeps its card and the pulse says Unresolved (nothing is hidden)', () => {
    const w = mnt({ diagnostics: [], overview: baseOv({ activeMissionCount: 0, story: { kind: 'unknown', excerpt: 'x' } }) });
    expect(w.get('[data-testid="story-state"]').text()).toContain('UNKNOWN');
    expect(w.get('[data-testid="pulse-story"]').text()).toBe('Unresolved');
  });

  it('split-brain reported by Core stays visible as a compact indicator in the pulse', () => {
    const provenance = { splitBrain: { detected: true, localStates: [] } } as unknown as StateProvenanceView;
    expect(mnt({ provenance, diagnostics: [] }).get('[data-testid="pulse-splitbrain"]').text()).toContain('Split-brain');
  });

  it('long markdown: bounded preview, full text reachable, nothing lost, no v-html', () => {
    const long = '**Story:** ' + 'x'.repeat(2000);
    const w = mnt({ overview: baseOv({ story: { kind: 'active', ids: ['A'], excerpt: long } }) });
    expect(w.get('[data-testid="current-story"]').text().length).toBeLessThan(300);
    expect(w.get('[data-testid="current-story-full"]').element.textContent).toBe(long);
    expect(w.get('[data-testid="story-full"]').element.tagName).toBe('DETAILS');
    const src = readFileSync(join(__dirname, '../components/ProjectOverview.vue'), 'utf8');
    expect(src).not.toMatch(/v-html|innerHTML/);
  });

  it('preview drops paired ** and ` markers; full text and unpaired text stay raw', async () => {
    const { stripDecorativeMarkers: strip } = await import('../knowledge');
    expect(strip('**Story:** BETA-020\n**Branch:** `feat/x`')).toBe('Story: BETA-020\nBranch: feat/x');
    for (const keep of ['src/**/*.ts', '2 ** 3 ** 4', 'a lone ` tick', '** spaced **', '*italic*', '# Heading', '- item', '[l](u)']) {
      expect(strip(keep)).toBe(keep);
    }
    const raw = '**Story:** BETA-020 ' + 'x'.repeat(400);
    const w = mnt({ overview: baseOv({ story: { kind: 'active', ids: ['BETA-020'], excerpt: raw } }) });
    expect(w.get('[data-testid="current-story"]').text()).toMatch(/^Story: BETA-020/);
    expect(w.get('[data-testid="current-story"]').text()).not.toContain('**');
    expect(w.get('[data-testid="current-story-full"]').element.textContent).toBe(raw);
  });

  it('incomplete DTO: renders with every optional prop absent', () => {
    const w = mnt({ overview: { name: null, stateRevision: null } });
    expect(w.get('[data-testid="ov-name"]').text()).toBe('UNKNOWN');
    expect(w.get('[data-testid="pulse-diagnostics"]').text()).toBe('Unavailable');
    expect(w.get('[data-testid="pulse-freshness"]').text()).toBe('Not reported by Core');
  });

  it('navigation emits section ids', async () => {
    const w = mnt();
    await w.get('[data-testid="go-graph"]').trigger('click');
    await w.get('[data-testid="go-diagnostics"]').trigger('click');
    expect(w.emitted('navigate')!.map((e) => e[0])).toEqual(['graph', 'diagnostics']);
  });

  it('theme compatibility: styling uses theme tokens, no hard-coded colour outside the Cosmic Glass skin block', () => {
    const css = readFileSync(join(__dirname, '../styles/main.css'), 'utf8');
    const block = css.slice(css.indexOf('Mission Command Overview (UI-009)'));
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(block).not.toMatch(/animation|transition/);
  });
});
