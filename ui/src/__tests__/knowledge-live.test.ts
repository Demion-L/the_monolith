import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardReadModel, KnowledgeData, KnowledgeItemView, Section } from '../../../src/readmodel/types';
import App from '../App.vue';
import { fetchDashboard } from '../live/client';
import { toDashboardData } from '../live/adapter';
import { goTo } from './nav';

const src = (id: string, status = 'available', code: string | null = null) => ({ id, path: `.monolith/${id}`, status, code }) as never;

const base = (): DashboardReadModel => ({
  projectOverview: { data: null, sources: [] },
  currentMissions: { data: null, sources: [] },
  checkpoints: { data: null, sources: [] },
  roadmap: { data: null, sources: [] },
  diagnostics: { validation: 'NOT_PERFORMED', sources: [], notes: [] },
});

const view = (over: Partial<KnowledgeItemView> = {}): KnowledgeItemView =>
  ({ id: 'HYP-001', title: 'Real hypothesis', status: 'active', summary: 'Real summary', path: '.monolith/memory/long-term/hypotheses.md', ...over });
const sec = (items: KnowledgeItemView[], issues: KnowledgeData['issues'] = []): Section<KnowledgeData> => ({
  data: { items, issues, complete: !issues.some((i) => i.severity === 'warn') },
  sources: [src('x')],
});
const failed = (status: string, code: string): Section<KnowledgeData> => ({ data: null, sources: [src('x', status, code)] });
const issue = (code: string, severity: 'info' | 'warn' = 'warn', path: string | null = 'docs/adr/ADR-022-x.md') =>
  ({ code, severity, path, id: null, reason: null }) as KnowledgeData['issues'][number];

function stubFetch(body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', spy);
  return spy;
}
async function live(m: DashboardReadModel) {
  const spy = stubFetch(m);
  const w = mount(App);
  await flushPromises();
  return { w, spy };
}

beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(() => vi.unstubAllGlobals());

describe('LIVE knowledge', () => {
  it('shows the real hypotheses with status and source path', async () => {
    const { w } = await live({ ...base(), hypotheses: sec([view(), view({ id: 'HYP-002', status: 'rejected', title: 'Second' })]) });
    await goTo(w, 'hypotheses');
    const rows = w.findAll('[data-testid="knowledge-item"]');
    expect(rows.map((r) => r.get('[data-testid="knowledge-id"]').text())).toEqual(['HYP-001', 'HYP-002']);
    expect(rows[1].get('[data-testid="knowledge-status"]').text()).toBe('rejected');
    expect(rows[0].get('[data-testid="knowledge-path"]').text()).toBe('.monolith/memory/long-term/hypotheses.md');
    expect(w.find('[data-testid="knowledge-demo"]').exists()).toBe(false);
    expect(w.text()).not.toMatch(/fictional|Demonstration data/);
  });

  it('shows the real ADRs with declared supersession only', async () => {
    const adr = (id: string, extra: Partial<KnowledgeItemView> = {}) => view({ id, title: `T ${id}`, status: 'accepted', path: `docs/adr/${id}.md`, ...extra });
    const { w } = await live({
      ...base(),
      decisions: sec([adr('ADR-007', { status: 'superseded', supersededBy: ['ADR-020'] }), adr('ADR-020', { supersedes: ['ADR-007'] }), adr('ADR-021')]),
    });
    await goTo(w, 'decisions');
    const rows = w.findAll('[data-testid="knowledge-item"]');
    expect(rows[0].get('[data-testid="knowledge-superseded-by"]').text()).toBe('ADR-020');
    expect(rows[1].get('[data-testid="knowledge-supersedes"]').text()).toBe('ADR-007');
    expect(rows[2].find('[data-testid="knowledge-superseded-by"]').exists()).toBe(false);
    expect(rows[2].find('[data-testid="knowledge-supersedes"]').exists()).toBe(false);
  });

  it('keeps empty, not-available and error apart', async () => {
    const empty = await live({ ...base(), hypotheses: sec([]), decisions: failed('absent', 'SOURCE_ABSENT') });
    await goTo(empty.w, 'hypotheses');
    expect(empty.w.get('[data-testid="knowledge-empty"]').text()).toBe('No hypotheses recorded.');
    expect(empty.w.text()).not.toMatch(/NOT AVAILABLE|ERROR/);
    await goTo(empty.w, 'decisions');
    expect(empty.w.get('[data-testid="knowledge-unavailable"]').text()).toContain('NOT AVAILABLE');
    expect(empty.w.find('[data-testid="knowledge-empty"]').exists()).toBe(false);

    const err = await live({ ...base(), hypotheses: failed('forbidden', 'SOURCE_SYMLINK'), decisions: failed('unreadable', 'SOURCE_UNREADABLE') });
    await goTo(err.w, 'hypotheses');
    const t = err.w.get('[data-testid="knowledge-unavailable"]').text();
    expect(t).toContain('ERROR');
    expect(t).toContain('SOURCE_SYMLINK');
    expect(t).not.toContain('NOT AVAILABLE');
    expect(err.w.find('[data-testid="knowledge-empty"]').exists()).toBe(false);
    await goTo(err.w, 'decisions');
    expect(err.w.get('[data-testid="knowledge-unavailable"]').text()).toContain('SOURCE_UNREADABLE');
  });

  it('flags an incomplete list and lists the issues next to the items', async () => {
    const { w } = await live({ ...base(), decisions: sec([view({ id: 'ADR-001', path: 'docs/adr/ADR-001.md' })], [issue('ADR_ID_MISMATCH'), issue('ADR_FRONTMATTER_MISSING', 'info', 'docs/adr/ADR-017-followups.md')]) });
    await goTo(w, 'decisions');
    expect(w.get('[data-testid="knowledge-incomplete"]').text()).toContain('INCOMPLETE');
    expect(w.findAll('[data-testid="knowledge-issue"]').map((i) => i.text())).toEqual([
      expect.stringContaining('ADR_ID_MISMATCH'), expect.stringContaining('ADR_FRONTMATTER_MISSING'),
    ]);
    expect(w.findAll('[data-testid="knowledge-item"]')).toHaveLength(1);
  });

  it('info-only issues do not claim incompleteness', async () => {
    const { w } = await live({ ...base(), decisions: sec([view({ id: 'ADR-001' })], [issue('ADR_FRONTMATTER_MISSING', 'info')]) });
    await goTo(w, 'decisions');
    expect(w.find('[data-testid="knowledge-incomplete"]').exists()).toBe(false);
    expect(w.find('[data-testid="knowledge-issue"]').exists()).toBe(true);
  });

  it('an older server without the sections still shows NOT PROVIDED (no demo data)', async () => {
    const { w } = await live(base());
    await goTo(w, 'hypotheses');
    expect(w.find('[data-testid="knowledge-unprovided"]').exists()).toBe(true);
    expect(w.find('[data-testid="knowledge-item"]').exists()).toBe(false);
  });

  it('long titles, unknown statuses, unsafe paths and markup stay safe', async () => {
    const { w } = await live({
      ...base(),
      hypotheses: sec([view({ title: `<b>${'L'.repeat(300)}</b>`, status: 'maybe', summary: '<script>window.__x=1</script>', path: '../../etc/passwd' })]),
    });
    await goTo(w, 'hypotheses');
    expect(w.find('b').exists()).toBe(false);
    expect(w.find('script').exists()).toBe(false);
    expect(w.get('[data-testid="knowledge-status"]').text()).toContain('unrecognized');
    expect(w.get('[data-testid="knowledge-path"]').text()).toContain('PATH REJECTED');
    expect(w.text()).not.toContain('passwd');
    expect(w.get('[data-testid="knowledge-title"]').text()).toContain('LLLL');
  });

  it('makes no network request besides the one dashboard call', async () => {
    const { spy } = await live({ ...base(), hypotheses: sec([view()]), decisions: sec([]) });
    expect(spy.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['/api/dashboard']);
  });

  it('DEMO stays isolated from LIVE', async () => {
    window.history.replaceState({}, '', '/?mode=demo');
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const w = mount(App);
    await goTo(w, 'hypotheses');
    expect(w.get('[data-testid="knowledge-demo"]').text()).toMatch(/not real/i);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('adapter and validation', () => {
  it('maps failed sources to null (never []) with the right availability', () => {
    const d = toDashboardData({ ...base(), hypotheses: failed('absent', 'SOURCE_ABSENT'), decisions: failed('corrupt', 'INTERNAL') });
    expect(d.hypotheses).toBeNull();
    expect(d.hypothesesInfo).toMatchObject({ availability: 'not_available' });
    expect(d.decisions).toBeNull();
    expect(d.decisionsInfo).toMatchObject({ availability: 'error', code: 'INTERNAL' });
  });

  it('copies supersession only when present', () => {
    const d = toDashboardData({ ...base(), decisions: sec([view({ id: 'ADR-001' }), view({ id: 'ADR-002', supersedes: ['ADR-001'] })]) });
    expect(d.decisions![0]).not.toHaveProperty('supersedes');
    expect(d.decisions![1].supersedes).toEqual(['ADR-001']);
  });

  it('rejects malformed knowledge payloads', async () => {
    const bad: unknown[] = [
      { ...base(), hypotheses: { data: { items: [{ id: 1 }], issues: [], complete: true }, sources: [] } },
      { ...base(), hypotheses: { data: { items: [], issues: [], complete: 'yes' }, sources: [] } },
      { ...base(), decisions: { data: { items: [], issues: [{ code: 'MADE_UP', severity: 'warn', path: null, id: null, reason: null }], complete: false }, sources: [] } },
      // complete:true next to a warning is a contradiction
      { ...base(), decisions: { data: { items: [], issues: [issue('ADR_ID_MISMATCH')], complete: true }, sources: [] } },
      { ...base(), decisions: { data: { items: [view({ supersedes: 'ADR-001' as never })], issues: [], complete: true }, sources: [] } },
    ];
    for (const m of bad) {
      stubFetch(m);
      await expect(fetchDashboard()).rejects.toThrow(/unexpected data shape/);
    }
  });
});
