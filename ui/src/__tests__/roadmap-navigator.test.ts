import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RoadmapPanel from '../components/RoadmapPanel.vue';
import { parseRoadmapPhases } from '../../../src/readmodel/roadmap';
import type { StructuredRoadmapView } from '../../../src/readmodel/types';

function roadmap(n: number, active?: string | number): string {
  const phases = Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    const status = k === n ? 'IN PROGRESS' : k % 5 === 0 ? 'COMPLETED (retrospectively verified by code + tests; no native stories)' : k % 7 === 0 ? 'Mystery' : 'COMPLETED';
    return `### Phase ${k} — Title ${k}${k === 3 ? ' Alpha' : ''}\n\n**Status:** ${status}\n**Goal:** goal ${k}\n\nBody ${k}\n`;
  }).join('\n');
  return `## Phases\n\n${phases}\n## Current Focus\n\n${active === undefined ? '' : `Active Phase: ${active} — x\n`}`;
}

function mountN(n: number, active?: string | number) {
  const text = roadmap(n, active);
  return mount(RoadmapPanel, { props: { text, structured: parseRoadmapPhases(text) as StructuredRoadmapView }, attachTo: document.body });
}
const ids = (w: ReturnType<typeof mountN>) => w.findAll('[data-testid="roadmap-phase"]').map((p) => p.attributes('data-phase-id'));
const count = (w: ReturnType<typeof mountN>) => w.get('[data-testid="roadmap-count"]').text();

beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(() => document.body.replaceChildren());

describe('Roadmap Navigator', () => {
  it('shows 10 phases, newest first, from a 2003-phase roadmap; the DOM stays small', () => {
    const w = mountN(2003, 2003);
    expect(ids(w)).toEqual(Array.from({ length: 10 }, (_, i) => String(2003 - i)));
    expect(w.findAll('[data-testid="roadmap-phase"]')).toHaveLength(10);
    expect(count(w)).toBe('Showing 10 of 2003 phases');
  });

  it('shows all of a small roadmap and says the list ended', () => {
    const w = mountN(7, 7);
    expect(ids(w)).toHaveLength(7);
    expect(w.find('[data-testid="roadmap-more"]').exists()).toBe(false);
    expect(w.get('[data-testid="roadmap-end"]').text()).toBe('End of the list.');
  });

  it('"Show 10 more" appends the next 10 without duplicates, up to the end', async () => {
    const w = mountN(25, 25);
    await w.get('[data-testid="roadmap-more"]').trigger('click');
    expect(ids(w)).toHaveLength(20);
    await w.get('[data-testid="roadmap-more"]').trigger('click');
    const all = ids(w);
    expect(all).toHaveLength(25);
    expect(new Set(all).size).toBe(25);
    expect(w.get('[data-testid="roadmap-footer"]').text()).toContain('Showing 25 of 25');
    expect(w.find('[data-testid="roadmap-more"]').exists()).toBe(false);
  });

  it('sorts by Read Model order, not by the text of the number (10 after 9, not after 1)', async () => {
    const w = mountN(12, 12);
    await w.get('[data-testid="roadmap-sort"]').setValue('oldest');
    expect(ids(w)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    await w.get('[data-testid="roadmap-sort"]').setValue('newest');
    expect(ids(w)[0]).toBe('12');
  });

  it('search covers the whole roadmap, case-insensitively, by id, number and title', async () => {
    const w = mountN(2003, 2003);
    const input = w.get('[data-testid="roadmap-search"]');
    await input.setValue('title 1999');
    expect(ids(w)).toEqual(['1999']);
    await input.setValue('PHASE 1500');
    expect(ids(w)).toEqual(['1500']);
    await input.setValue('alpha');
    expect(ids(w)).toEqual(['3']);
    await input.setValue('1999');
    expect(ids(w)).toContain('1999');
    expect(count(w)).toContain('filtered from 2003');
  });

  it('search combines with sorting', async () => {
    const w = mountN(120, 120);
    await w.get('[data-testid="roadmap-search"]').setValue('title 11');
    expect(ids(w)[0]).toBe('119');
    await w.get('[data-testid="roadmap-sort"]').setValue('oldest');
    expect(ids(w)[0]).toBe('11');
    expect(ids(w).every((id) => `title ${id}`.includes('title 11'))).toBe(true);
  });

  it('empty results have their own state, and clearing restores the list', async () => {
    const w = mountN(30, 30);
    await w.get('[data-testid="roadmap-search"]').setValue('zzz-nothing');
    expect(w.get('[data-testid="roadmap-no-results"]').text()).toContain('zzz-nothing');
    expect(w.find('[data-testid="roadmap-phase"]').exists()).toBe(false);
    await w.get('[data-testid="roadmap-search-clear"]').trigger('click');
    expect(ids(w)).toHaveLength(10);
    expect(w.find('[data-testid="roadmap-no-results"]').exists()).toBe(false);
  });

  it('a new search or sort restarts the window at 10', async () => {
    const w = mountN(60, 60);
    await w.get('[data-testid="roadmap-more"]').trigger('click');
    expect(ids(w)).toHaveLength(20);
    await w.get('[data-testid="roadmap-sort"]').setValue('oldest');
    expect(ids(w)).toHaveLength(10);
  });

  it('Go to Current Phase reveals a far-away phase, clears a hiding search, selects and marks it', async () => {
    const w = mountN(300, 4);
    await w.get('[data-testid="roadmap-search"]').setValue('title 250');
    await w.get('[data-testid="roadmap-go-current"]').trigger('click');
    await flushPromises();
    expect((w.get('[data-testid="roadmap-search"]').element as HTMLInputElement).value).toBe('');
    const cur = w.get('[data-phase-id="4"]');
    expect(cur.classes()).toContain('phase-selected');
    expect(cur.classes()).toContain('phase-active');
    expect(new URLSearchParams(window.location.search).get('phase')).toBe('4');
    // Only a small window around the target is in the DOM, never the roadmap up to it.
    expect(w.findAll('[data-testid="roadmap-phase"]').length).toBeLessThanOrEqual(30);
    expect(w.find('[data-testid="roadmap-earlier"]').exists()).toBe(true);
    expect(w.get('[data-testid="roadmap-current"]').text()).toContain('Phase 4');
  });

  it('Show earlier extends the window upward without duplicates', async () => {
    const w = mountN(300, 4);
    await w.get('[data-testid="roadmap-go-current"]').trigger('click');
    await flushPromises();
    const before = ids(w).length;
    await w.get('[data-testid="roadmap-earlier"]').trigger('click');
    const all = ids(w);
    expect(all.length).toBe(before + 10);
    expect(new Set(all).size).toBe(all.length);
    expect(all[0]).toBe(String(Number(ids(w)[10]) + 10));
  });

  it('the selection survives a sort change and stays visible', async () => {
    const w = mountN(300, 4);
    await w.get('[data-testid="roadmap-go-current"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="roadmap-sort"]').setValue('oldest');
    expect(w.get('[data-phase-id="4"]').classes()).toContain('phase-selected');
  });

  it.each([
    ['not declared', undefined],
    ['unmatched', 'ZZ'],
    ['none', '—'],
  ])('current phase %s: honest message, no guess from IN PROGRESS, nothing selected', async (_n, active) => {
    const w = mountN(50, active as string | undefined);
    await w.get('[data-testid="roadmap-go-current"]').trigger('click');
    expect(w.get('[data-testid="roadmap-notice"]').text()).toBe('Current phase could not be identified from the roadmap.');
    expect(w.find('.phase-selected').exists()).toBe(false);
    expect(w.find('[data-testid="roadmap-current"]').exists()).toBe(false);
    expect(new URLSearchParams(window.location.search).has('phase')).toBe(false);
  });

  it('?phase=<id> selects and reveals that phase on entry; an unknown id is reported, not guessed', async () => {
    window.history.replaceState({}, '', '/?phase=40');
    const w = mountN(100, 100);
    await flushPromises();
    expect(w.get('[data-phase-id="40"]').classes()).toContain('phase-selected');
    document.body.replaceChildren();
    window.history.replaceState({}, '', '/?phase=nope');
    const w2 = mountN(100, 100);
    await flushPromises();
    expect(w2.get('[data-testid="roadmap-notice"]').text()).toContain('not available');
    expect(w2.find('.phase-selected').exists()).toBe(false);
  });

  it('Select toggles the selection and the ?phase parameter (the navigation contract); other query parameters are kept', async () => {
    window.history.replaceState({}, '', '/?mode=demo#roadmap');
    const w = mountN(20, 20);
    await w.get('[data-phase-id="20"] [data-testid="phase-select"]').trigger('click');
    expect(window.location.search).toBe('?mode=demo&phase=20');
    expect(window.location.hash).toBe('#roadmap');
    await w.get('[data-phase-id="20"] [data-testid="phase-select"]').trigger('click');
    expect(window.location.search).toBe('?mode=demo');
  });

  it('splits a long status: short label, provenance and diagnostics apart; the full text sits in the details', () => {
    const w = mountN(10, 10);
    const p5 = w.get('[data-phase-id="5"]');
    expect(p5.get('[data-testid="phase-status"]').text()).toBe('COMPLETED');
    expect(p5.get('[data-testid="phase-provenance"]').text()).toBe('REPORTED');
    expect(p5.get('[data-testid="phase-unrecognized"]').text()).toBe('UNRECOGNIZED');
    expect(p5.get('[data-testid="phase-full-status"]').text()).toContain('retrospectively verified by code + tests');
    const p7 = w.get('[data-phase-id="7"]');
    expect(p7.get('[data-testid="phase-status"]').text()).toBe('Mystery');
    expect(p7.find('[data-testid="phase-unrecognized"]').exists()).toBe(true);
    // A recognised, short status carries no diagnostic badge.
    expect(w.get('[data-phase-id="10"]').find('[data-testid="phase-unrecognized"]').exists()).toBe(false);
  });

  it('a truncated roadmap says so; it never claims to be whole', () => {
    const text = roadmap(30, 30);
    const s = parseRoadmapPhases(text);
    const w = mount(RoadmapPanel, { props: { text, structured: { ...s, state: 'partial', diagnostics: [...s.diagnostics, { code: 'PHASES_TRUNCATED', severity: 'warn', phaseIndex: null }] } } });
    expect(w.get('[data-testid="roadmap-truncated"]').text()).toContain('INCOMPLETE');
    expect(w.get('[data-testid="roadmap-count"]').text()).toContain('roadmap truncated');
  });

  it('thousands of per-phase diagnostics become a few grouped rows, not thousands of DOM rows', () => {
    const w = mountN(2003, 2003);
    expect(w.findAll('[data-testid="roadmap-diagnostics"] li').length).toBeLessThan(5);
    expect(w.get('[data-testid="roadmap-diagnostic-group"]').text()).toMatch(/\(\d+ phases;/);
  });
});
