import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RoadmapPanel from '../components/RoadmapPanel.vue';
import { toDashboardData } from '../live/adapter';
import { isDashboardReadModel } from '../live/validate';
import { parseRoadmapPhases } from '../../../src/readmodel/roadmap';
import type { DashboardReadModel, StructuredRoadmapView } from '../../../src/readmodel/types';

const repo = resolve(__dirname, '../../..');
const realText = readFileSync(resolve(repo, '.monolith/context/maps/roadmap-index.md'), 'utf8');
const templateText = readFileSync(resolve(repo, 'templates/default-instance/monolith/context/maps/roadmap-index.md'), 'utf8');

const src = (id: 'config' | 'state' | 'activeStory' | 'roadmap') => ({ id, path: `.monolith/${id}`, status: 'available' as const, code: null });

function model(roadmapData: unknown): unknown {
  return {
    projectOverview: { data: { name: 'P', monolithRoot: '.monolith', monolithRootSource: 'default', stateSchemaVersionOnDisk: null, stateRevision: null, activeMissionCount: 0, finishedMissionCount: 0, currentStory: null, storyClaim: null }, sources: [src('config')] },
    currentMissions: { data: { active: [] }, sources: [src('state')] },
    checkpoints: { data: { byActiveMission: [] }, sources: [src('state')] },
    roadmap: { data: roadmapData, sources: [src('roadmap')] },
    diagnostics: { validation: 'NOT_PERFORMED', sources: [src('config'), src('state'), src('activeStory'), src('roadmap')], notes: [] },
  };
}

const structured = (over: Partial<StructuredRoadmapView> = {}): StructuredRoadmapView => ({
  state: 'ok',
  phases: [
    { id: 'A', title: 'First <b>x</b>', status: { value: 'IN PROGRESS', recognized: true, provenance: 'REPORTED' }, goal: 'Goal <i>g</i>', details: 'Body <script>1</script>' },
    { id: 'B', title: 'Second', status: { value: 'Whatever', recognized: false, provenance: 'REPORTED' }, goal: null, details: null },
    { id: 'C', title: null, status: { value: null, recognized: false, provenance: 'REPORTED' }, goal: null, details: null },
  ],
  activePhase: { kind: 'phase', id: 'A' },
  diagnostics: [{ code: 'PHASE_STATUS_UNRECOGNIZED', severity: 'warn', phaseIndex: 1 }],
  ...over,
});

describe('structured roadmap DTO validation', () => {
  it('accepts a legacy DTO without the structured field', () => {
    expect(isDashboardReadModel(model({ text: 'x' }))).toBe(true);
  });
  it('accepts Core output for the real MONOLITH roadmap and the template', () => {
    for (const t of [realText, templateText]) {
      expect(isDashboardReadModel(model({ text: t, structured: parseRoadmapPhases(t) }))).toBe(true);
    }
  });
  it('accepts goalTruncated true/false and its absence (legacy DTO)', () => {
    const ph = structured().phases[0];
    for (const extra of [{ goalTruncated: true }, { goalTruncated: false }, {}]) {
      const s = structured({ phases: [{ ...ph, ...extra }], activePhase: { kind: 'none' }, diagnostics: [] });
      expect(isDashboardReadModel(model({ text: 'x', structured: s }))).toBe(true);
    }
  });
  it('accepts every non-ok state', () => {
    for (const t of ['', '# nothing', '## Phases\n']) {
      expect(isDashboardReadModel(model({ text: t, structured: parseRoadmapPhases(t) }))).toBe(true);
    }
  });
  it.each([
    ['structured is not an object', 'nope'],
    ['unknown parse state', { ...structured(), state: 'great' }],
    ['phases is not an array', { ...structured(), phases: {} }],
    ['phase without status', { ...structured(), phases: [{ id: 'A', title: 't', goal: null, details: null }] }],
    ['phase provenance is CONFIRMED', { ...structured(), phases: [{ id: 'A', title: 't', status: { value: 'X', recognized: false, provenance: 'CONFIRMED' }, goal: null, details: null }], activePhase: { kind: 'none' } }],
    ['null status flagged recognized', { ...structured(), phases: [{ id: 'A', title: 't', status: { value: null, recognized: true, provenance: 'REPORTED' }, goal: null, details: null }], activePhase: { kind: 'none' } }],
    ['wrong field type', { ...structured(), phases: [{ id: 5, title: 't', status: { value: 'X', recognized: false, provenance: 'REPORTED' }, goal: null, details: null }] }],
    ['active phase dangling', { ...structured(), activePhase: { kind: 'phase', id: 'ZZZ' } }],
    ['active phase id is duplicated', { ...structured(), phases: [structured().phases[0], structured().phases[0]] }],
    ['unknown active kind', { ...structured(), activePhase: { kind: 'first' } }],
    ['diagnostic bad severity', { ...structured(), diagnostics: [{ code: 'X', severity: 'fatal', phaseIndex: null }] }],
    ['diagnostic phaseIndex out of range', { ...structured(), diagnostics: [{ code: 'X', severity: 'info', phaseIndex: 9 }] }],
    ['goalTruncated is a string', { ...structured(), phases: [{ ...structured().phases[0], goalTruncated: 'true' }] }],
    ['goalTruncated is null', { ...structured(), phases: [{ ...structured().phases[0], goalTruncated: null }] }],
    ['phases present in an unrecognized parse', { ...structured(), state: 'unrecognized' }],
  ])('rejects: %s', (_n, bad) => {
    expect(isDashboardReadModel(model({ text: 'x', structured: bad }))).toBe(false);
  });
});

describe('adapter', () => {
  it('passes Core structure through untouched', () => {
    const s = structured();
    expect(toDashboardData(model({ text: 'x', structured: s }) as DashboardReadModel).roadmap).toEqual(s);
  });
  it('does not invent goalTruncated for a legacy phase', () => {
    const d = toDashboardData(model({ text: 'x', structured: structured() }) as DashboardReadModel);
    expect(d.roadmap?.phases[0]).not.toHaveProperty('goalTruncated');
  });
  it('legacy DTO: no phases invented, raw text kept', () => {
    const d = toDashboardData(model({ text: '### Phase 1 — A\n**Status:** COMPLETE' }) as DashboardReadModel);
    expect(d.roadmap).toBeUndefined();
    expect(d.roadmapText).toContain('Phase 1');
  });
  it('source error: neither text nor structure', () => {
    const m = model(null) as DashboardReadModel;
    const d = toDashboardData(m);
    expect(d.roadmapText).toBeNull();
    expect(d.roadmap).toBeUndefined();
  });
});

describe('RoadmapPanel', () => {
  const mountS = (s: StructuredRoadmapView | undefined, text: string | null = 'RAW <b>md</b>') => mount(RoadmapPanel, { props: { text, structured: s } });

  it.each([
    ['true', { goalTruncated: true }, true],
    ['false', { goalTruncated: false }, false],
    ['unknown (field absent)', {}, false],
  ])('Truncated marker, goalTruncated %s', (_n, extra, shown) => {
    const base = structured();
    const w = mountS({ ...base, phases: [{ ...base.phases[0], ...extra }, ...base.phases.slice(1)] });
    const first = w.findAll('[data-testid="roadmap-phase"]')[0];
    expect(first.find('[data-testid="goal-truncated"]').exists()).toBe(shown);
    if (shown) expect(first.get('[data-testid="goal-truncated"]').text()).toBe('Truncated');
    expect(w.text()).toContain('RAW <b>md</b>');
  });

  it('lists phases in order with REPORTED status, goal and active marker', () => {
    const w = mountS(structured());
    const phases = w.findAll('[data-testid="roadmap-phase"]');
    expect(phases.map((p) => p.get('h3').text())).toEqual(['Phase A · First <b>x</b>', 'Phase B · Second', 'Phase C']);
    expect(phases[0].get('[data-testid="phase-status"]').text()).toBe('IN PROGRESS · REPORTED');
    expect(phases[0].find('[data-testid="phase-active"]').exists()).toBe(true);
    expect(phases[1].find('[data-testid="phase-active"]').exists()).toBe(false);
    expect(phases[0].get('[data-testid="phase-goal"]').text()).toContain('Goal <i>g</i>');
  });

  it('marks unknown and missing statuses explicitly', () => {
    const w = mountS(structured());
    const st = w.findAll('[data-testid="phase-status"]').map((e) => e.text());
    expect(st[1]).toBe('Whatever · REPORTED · UNRECOGNIZED');
    expect(st[2]).toBe('STATUS NOT STATED');
  });

  it('renders HTML-like text as text only', () => {
    const w = mountS(structured());
    expect(w.find('script').exists()).toBe(false);
    expect(w.find('b').exists()).toBe(false);
    expect(w.find('i').exists()).toBe(false);
    expect(w.get('[data-testid="phase-details"] pre').element.textContent).toBe('Body <script>1</script>');
    expect(w.get('[data-testid="roadmap-text"]').element.textContent).toBe('RAW <b>md</b>');
  });

  it('details and raw Markdown are native <details> with a <summary> (keyboard operable)', () => {
    const w = mountS(structured());
    const d = w.get('[data-testid="phase-details"]');
    expect(d.element.tagName).toBe('DETAILS');
    expect(d.get('summary').text()).toBe('Details');
    expect((d.element as HTMLDetailsElement).open).toBe(false);
    (d.element as HTMLDetailsElement).open = true;
    expect((d.element as HTMLDetailsElement).open).toBe(true);
    const raw = w.get('[data-testid="roadmap-raw"]');
    expect(raw.element.tagName).toBe('DETAILS');
    expect(raw.get('summary').text()).toBe('View original Markdown');
    // Phases without details have no empty expander.
    expect(w.findAll('[data-testid="phase-details"]')).toHaveLength(1);
  });

  it.each([
    ['none', 'no active phase'],
    ['not_declared', 'does not declare an active phase'],
    ['unmatched', 'not among the recognised phases'],
    ['ambiguous', 'ambiguous or contradictory'],
  ] as const)('active=%s: no phase marked active, reason shown', (kind, msg) => {
    const w = mountS(structured({ activePhase: { kind } }));
    expect(w.find('[data-testid="phase-active"]').exists()).toBe(false);
    expect(w.get('[data-testid="roadmap-active-note"]').text()).toContain(msg);
  });

  it.each([
    ['empty', 'EMPTY', 'available but empty'],
    ['no_phases', 'NO PHASES', 'no phase could be read'],
    ['unrecognized', 'UNRECOGNIZED', 'structure was not recognised'],
    ['error', 'ERROR', 'could not be interpreted'],
  ] as const)('state %s is its own message, not "no roadmap"', (state, label, msg) => {
    const w = mountS({ state, phases: [], activePhase: { kind: 'not_declared' }, diagnostics: [] });
    const t = w.get('[data-testid="roadmap-state"]').text();
    expect(t).toContain(label);
    expect(t).toContain(msg);
    expect(w.find('[data-testid="roadmap-phases"]').exists()).toBe(false);
    expect(w.text()).not.toMatch(/no roadmap/i);
    expect(w.find('[data-testid="roadmap-raw"]').exists()).toBe(true);
  });

  it('partial parse shows phases plus a partial notice', () => {
    const w = mountS(structured({ state: 'partial' }));
    expect(w.get('[data-testid="roadmap-state"]').text()).toContain('PARTIAL');
    expect(w.findAll('[data-testid="roadmap-phase"]')).toHaveLength(3);
  });

  it('diagnostics use fixed labels attached to the phase', () => {
    const w = mountS(structured());
    expect(w.get('[data-testid="roadmap-diagnostics"]').text()).toContain('Phase B · Second: The phase status is not a recognised value.');
  });

  it('source unavailable: NOT AVAILABLE and no structure even if supplied', () => {
    const w = mountS(structured(), null);
    expect(w.text()).toContain('NOT AVAILABLE');
    expect(w.find('[data-testid="roadmap-phases"]').exists()).toBe(false);
  });

  it('legacy: raw text with an explicit notice, no phases', () => {
    const w = mountS(undefined);
    expect(w.get('[data-testid="roadmap-legacy"]').text()).toContain('not provided');
    expect(w.find('[data-testid="roadmap-text"]').exists()).toBe(true);
    expect(w.find('[data-testid="roadmap-phases"]').exists()).toBe(false);
  });

  it('renders the real MONOLITH roadmap and the template end to end', () => {
    const r = mountS(parseRoadmapPhases(realText), realText);
    expect(r.findAll('[data-testid="roadmap-phase"]')).toHaveLength(2);
    expect(r.find('[data-testid="phase-active"]').exists()).toBe(true);
    const t = mountS(parseRoadmapPhases(templateText), templateText);
    expect(t.findAll('[data-testid="roadmap-phase"]')).toHaveLength(1);
    expect(t.find('[data-testid="phase-active"]').exists()).toBe(false);
  });
});

describe('themes and responsive css', () => {
  const css = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  it('base (Classic) styles keep the phase list shrinkable and wrapping', () => {
    const base = css('styles/main.css');
    expect(base).toMatch(/\.phase\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
    expect(base).toMatch(/\.phase-details \.roadmap, \.raw \.roadmap\s*\{[^}]*overflow-x:\s*auto/);
  });
  it('Cosmic Glass has scoped rules for the phase list', () => {
    const skin = css('styles/skins/cosmic-glass.css');
    for (const sel of ['.phase {', '.phase-active', '.status-badge {']) {
      expect(skin).toContain(`:root[data-skin="cosmic-glass"] ${sel}`);
    }
  });
  it('phase text uses theme variables, not hard-coded colours', () => {
    const base = css('styles/main.css');
    const block = base.slice(base.indexOf('/* Structured roadmap'), base.indexOf('.diag li'));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
