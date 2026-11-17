import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App.vue';
import DecisionsPanel from '../components/DecisionsPanel.vue';
import { LIST_PAGE_SIZE, matchesQuery } from '../list-controls';
import type { KnowledgeInfo, KnowledgeItem } from '../types/dashboard';
import { goTo } from './nav';

beforeEach(() => window.history.replaceState({}, '', '/?mode=demo'));

const adr = (n: number, over: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
  id: `ADR-${String(n).padStart(3, '0')}`, title: `Decision number ${n}`, status: 'accepted', summary: null, path: `docs/adr/ADR-${n}.md`, ...over,
});
const many = (n: number): KnowledgeItem[] => Array.from({ length: n }, (_, i) => adr(i + 1));
const mountPanel = (items: KnowledgeItem[] | null | undefined, info?: KnowledgeInfo) =>
  mount(DecisionsPanel, { props: { items, demo: false, info } });
const ids = (w: ReturnType<typeof mountPanel>) => w.findAll('[data-testid="knowledge-id"]').map((e) => e.text());
const search = async (w: ReturnType<typeof mountPanel>, q: string) => { await w.get('[data-testid="decisions-search"]').setValue(q); };

describe('matchesQuery', () => {
  it('is case-insensitive, trims, matches any field and never matches null', () => {
    expect(matchesQuery('  AdR-00 ', ['adr-001', null])).toBe(true);
    expect(matchesQuery('x', [null, undefined])).toBe(false);
    expect(matchesQuery('', [null])).toBe(true);
    expect(matchesQuery('   ', [])).toBe(true);
  });
});

describe('ADR search', () => {
  const items = [
    adr(1, { title: 'Cognitive Core Foundation', status: 'accepted' }),
    adr(2, { title: 'Safe Writes', status: 'Proposed' }),
    adr(3, { title: 'Weird one', status: 'experimental' }),
    adr(4, { id: null, title: null, status: null }),
  ];

  it('finds by ADR id, case-insensitively', async () => {
    const w = mountPanel(items);
    await search(w, 'adr-002');
    expect(ids(w)).toEqual(['ADR-002']);
    await search(w, 'ADR-00');
    expect(ids(w)).toHaveLength(3);
  });

  it('finds by title, case-insensitively', async () => {
    const w = mountPanel(items);
    await search(w, 'COGNITIVE core');
    expect(ids(w)).toEqual(['ADR-001']);
  });

  it('finds by status, including an unrecognized one (verbatim)', async () => {
    const w = mountPanel(items);
    await search(w, 'proposed');
    expect(ids(w)).toEqual(['ADR-002']);
    await search(w, 'EXPERIMENTAL');
    expect(ids(w)).toEqual(['ADR-003']);
    expect(w.get('[data-testid="knowledge-status"]').text()).toContain('unrecognized status');
  });

  it('shows a clear empty-results state and a way back', async () => {
    const w = mountPanel(items);
    await search(w, 'no-such-thing');
    expect(w.get('[data-testid="decisions-no-results"]').text()).toContain('no-such-thing');
    expect(w.find('[data-testid="knowledge-item"]').exists()).toBe(false);
    expect(w.find('[data-testid="decisions-footer"]').exists()).toBe(false);
    await w.get('[data-testid="decisions-search-clear"]').trigger('click');
    expect(w.findAll('[data-testid="knowledge-item"]')).toHaveLength(4);
  });

  it('a search never invents a match for items without id/title/status', async () => {
    const w = mountPanel(items);
    await search(w, 'null');
    expect(w.find('[data-testid="knowledge-item"]').exists()).toBe(false);
    await search(w, 'unknown');
    expect(w.find('[data-testid="knowledge-item"]').exists()).toBe(false);
  });

  it('keeps declared supersession and details on filtered cards', async () => {
    const w = mountPanel([adr(1, { supersededBy: ['ADR-009'] }), adr(2)]);
    await search(w, 'ADR-001');
    expect(w.get('[data-testid="knowledge-superseded-by"]').text()).toBe('ADR-009');
  });
});

describe('ADR pagination', () => {
  it('shows 10 per page with counters and Show more', async () => {
    const w = mountPanel(many(25));
    expect(ids(w)).toHaveLength(LIST_PAGE_SIZE);
    expect(w.get('[data-testid="decisions-count"]').text()).toBe('Showing 10 of 25 decisions');
    expect(w.get('[data-testid="decisions-more"]').text()).toBe('Show 10 more');
    await w.get('[data-testid="decisions-more"]').trigger('click');
    expect(ids(w)).toHaveLength(20);
    expect(w.get('[data-testid="decisions-more"]').text()).toBe('Show 5 more');
    await w.get('[data-testid="decisions-more"]').trigger('click');
    expect(ids(w)).toHaveLength(25);
    expect(w.find('[data-testid="decisions-more"]').exists()).toBe(false);
    expect(w.find('[data-testid="decisions-end"]').exists()).toBe(true);
  });

  it('never renders an ADR twice and keeps source order', async () => {
    const w = mountPanel(many(25));
    await w.get('[data-testid="decisions-more"]').trigger('click');
    await w.get('[data-testid="decisions-more"]').trigger('click');
    const got = ids(w);
    expect(new Set(got).size).toBe(25);
    expect(got).toEqual(many(25).map((i) => i.id));
  });

  it('shows no pagination button when everything fits', () => {
    const w = mountPanel(many(10));
    expect(w.find('[data-testid="decisions-more"]').exists()).toBe(false);
    expect(w.get('[data-testid="decisions-count"]').text()).toBe('Showing 10 of 10 decisions');
  });

  it('a new search resets the window to the first page', async () => {
    const w = mountPanel(many(40));
    await w.get('[data-testid="decisions-more"]').trigger('click');
    await w.get('[data-testid="decisions-more"]').trigger('click');
    expect(ids(w)).toHaveLength(30);
    await search(w, 'Decision number'); // matches all 40
    expect(ids(w)).toHaveLength(LIST_PAGE_SIZE);
    await w.get('[data-testid="decisions-more"]').trigger('click');
    await search(w, 'ADR-03'); // 030..039 = 10 matches
    expect(ids(w)).toHaveLength(10);
    expect(w.get('[data-testid="decisions-count"]').text()).toBe('Showing 10 of 10 decisions (filtered from 40)');
    expect(w.find('[data-testid="decisions-more"]').exists()).toBe(false);
  });

  it('counts filtered results against the whole list', async () => {
    const w = mountPanel(many(40));
    await search(w, 'ADR-01'); // 010..019
    expect(w.get('[data-testid="decisions-count"]').text()).toBe('Showing 10 of 10 decisions (filtered from 40)');
  });
});

describe('ADR panel states are unchanged', () => {
  it('undefined / null / [] keep their distinct messages and show no search', () => {
    expect(mountPanel(undefined).find('[data-testid="knowledge-unprovided"]').exists()).toBe(true);
    const err = mountPanel(null, { availability: 'error', code: 'SOURCE_UNREADABLE', complete: false, issues: [] });
    expect(err.find('[data-testid="decisions-search"]').exists()).toBe(false);
    const empty = mountPanel([]);
    expect(empty.find('[data-testid="knowledge-empty"]').exists()).toBe(true);
    expect(empty.find('[data-testid="decisions-search"]').exists()).toBe(false);
  });

  it('keeps the incompleteness notice next to a filtered list', () => {
    const w = mountPanel(many(3), { availability: 'available', code: null, complete: false, issues: [{ code: 'ADR_ID_MISSING', severity: 'warn', path: 'docs/adr/x.md', id: null }] });
    expect(w.text()).toMatch(/ADR_ID_MISSING|incomplete|not exhaustive/i);
  });
});

describe('ADR search in DEMO mode', () => {
  it('works inside the app and stays on demo data', async () => {
    const w = mount(App);
    await goTo(w, 'decisions');
    expect(w.get('[data-testid="knowledge-demo"]').text()).toMatch(/not real/i);
    const all = w.findAll('[data-testid="knowledge-item"]').length;
    expect(all).toBeGreaterThan(0);
    await w.get('[data-testid="decisions-search"]').setValue('zzz-nothing');
    expect(w.find('[data-testid="decisions-no-results"]').exists()).toBe(true);
  });
});
