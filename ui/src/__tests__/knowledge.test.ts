import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App.vue';
import DecisionsPanel from '../components/DecisionsPanel.vue';
import HypothesesPanel from '../components/HypothesesPanel.vue';
import { normalScenario } from '../fixtures/dashboard';
import { describeStatus, safeDocPath } from '../knowledge';
import { toDashboardData } from '../live/adapter';
import type { KnowledgeItem } from '../types/dashboard';
import { goTo } from './nav';

beforeEach(() => {
  window.history.replaceState({}, '', '/?mode=demo');
});

const item = (over: Partial<KnowledgeItem> = {}): KnowledgeItem =>
  ({ id: 'X-1', title: 'T', status: 'active', summary: null, path: null, ...over });

describe('helpers', () => {
  it('knows only the statuses the project declares', () => {
    expect(describeStatus('hypothesis', 'validated')).toMatchObject({ recognized: true, tone: 'ok' });
    expect(describeStatus('adr', 'Accepted')).toMatchObject({ recognized: true, label: 'accepted' });
    expect(describeStatus('adr', 'active')).toMatchObject({ recognized: false, tone: 'neutral' });
    expect(describeStatus('hypothesis', 'accepted')).toMatchObject({ recognized: false });
    expect(describeStatus('adr', 'constructor')).toMatchObject({ recognized: false });
  });

  it('never invents a status for missing values', () => {
    expect(describeStatus('adr', null)).toBeNull();
    expect(describeStatus('hypothesis', '  ')).toBeNull();
  });

  it('accepts only plain project-relative paths', () => {
    expect(safeDocPath('docs/adr/ADR-020.md')).toBe('docs/adr/ADR-020.md');
    for (const bad of ['/etc/passwd', '../x.md', 'a/../../b', 'C:\\x', 'file:///x', 'javascript:alert(1)', '~/x', 'a\\b', 'a//b', 'a\u0000b', '', 'x'.repeat(301)]) {
      expect(safeDocPath(bad), bad).toBeNull();
    }
    expect(safeDocPath(null)).toBeNull();
  });
});

describe('panels (demo data)', () => {
  it('renders id, title and status for each item, plus the demo notice', () => {
    const w = mount(HypothesesPanel, { props: { items: normalScenario.hypotheses, demo: true } });
    const rows = w.findAll('[data-testid="knowledge-item"]');
    expect(rows).toHaveLength(5);
    expect(rows[0].get('[data-testid="knowledge-id"]').text()).toBe('HYP-001');
    expect(rows[0].get('[data-testid="knowledge-status"]').text()).toBe('active');
    expect(w.get('[data-testid="knowledge-demo"]').text()).toMatch(/not real/i);
  });

  it('flags an unrecognized status instead of mapping it', () => {
    const w = mount(HypothesesPanel, { props: { items: normalScenario.hypotheses, demo: true } });
    expect(w.findAll('[data-testid="knowledge-status"]')[4].text()).toContain('unrecognized');
  });

  it('shows supersession only when declared', () => {
    const w = mount(DecisionsPanel, { props: { items: normalScenario.decisions, demo: true } });
    const rows = w.findAll('[data-testid="knowledge-item"]');
    expect(rows[0].get('[data-testid="knowledge-superseded-by"]').text()).toBe('ADR-003');
    expect(rows[2].get('[data-testid="knowledge-supersedes"]').text()).toBe('ADR-001');
    expect(rows[1].find('[data-testid="knowledge-superseded-by"]').exists()).toBe(false);
    expect(rows[1].find('[data-testid="knowledge-supersedes"]').exists()).toBe(false);
  });

  it('rejects an unsafe path and shows no link', () => {
    const w = mount(DecisionsPanel, { props: { items: normalScenario.decisions, demo: true } });
    const last = w.findAll('[data-testid="knowledge-item"]')[4];
    expect(last.get('[data-testid="knowledge-path"]').text()).toContain('PATH REJECTED');
    expect(last.text()).not.toContain('passwd');
    expect(w.find('a').exists()).toBe(false);
  });

  it('shows a source path as text for a normal item', () => {
    const w = mount(DecisionsPanel, { props: { items: normalScenario.decisions, demo: true } });
    expect(w.findAll('[data-testid="knowledge-path"]')[1].text()).toBe('docs/adr/ADR-002-utc.md');
  });

  it('escapes markup in untrusted text', () => {
    const w = mount(HypothesesPanel, { props: { items: normalScenario.hypotheses, demo: true } });
    expect(w.find('b').exists()).toBe(false);
    expect(w.find('script').exists()).toBe(false);
    expect(w.text()).toContain('<script>alert(1)</script>');
  });

  it('keeps long titles inside the card (wrapping CSS applies via .card)', () => {
    const w = mount(HypothesesPanel, { props: { items: normalScenario.hypotheses, demo: true } });
    expect(w.findAll('[data-testid="knowledge-title"]')[4].text()).toContain('LongUnbrokenIdentifierSegment');
  });

  it('shows UNKNOWN for missing fields and never a default status', () => {
    const w = mount(DecisionsPanel, { props: { items: [item({ id: null, title: null, status: null })], demo: true } });
    expect(w.get('[data-testid="knowledge-id"]').text()).toBe('UNKNOWN');
    expect(w.get('[data-testid="knowledge-title"]').text()).toBe('UNKNOWN');
    expect(w.get('[data-testid="knowledge-status"]').text()).toBe('STATUS UNKNOWN');
    expect(w.text()).not.toMatch(/accepted|confirmed|validated/);
    expect(w.find('[data-testid="knowledge-nodetails"]').exists()).toBe(true);
  });

  it('distinguishes empty, unreadable and unprovided', () => {
    const empty = mount(HypothesesPanel, { props: { items: [], demo: true } });
    expect(empty.find('[data-testid="knowledge-empty"]').exists()).toBe(true);
    const bad = mount(HypothesesPanel, { props: { items: null, demo: true } });
    expect(bad.text()).toContain('NOT AVAILABLE');
    const none = mount(DecisionsPanel, { props: { items: undefined, demo: false } });
    expect(none.get('[data-testid="knowledge-unprovided"]').text()).toContain('NOT PROVIDED');
    expect(none.find('[data-testid="knowledge-item"]').exists()).toBe(false);
  });

  it('tolerates duplicate ids', () => {
    const w = mount(HypothesesPanel, { props: { items: [item(), item()], demo: true } });
    expect(w.findAll('[data-testid="knowledge-item"]')).toHaveLength(2);
  });
});

describe('in the dashboard', () => {
  it('lists both sections in navigation and renders them in DEMO', async () => {
    const w = mount(App);
    expect(w.findAll('.nav a').map((a) => a.text())).toEqual(expect.arrayContaining(['Knowledge Lab', 'Architecture Decisions']));
    await goTo(w, 'hypotheses');
    expect(w.find('[data-testid="hypotheses-panel"]').exists()).toBe(true);
    expect(w.findAll('[data-testid="knowledge-item"]').length).toBeGreaterThan(0);
    await goTo(w, 'decisions');
    expect(w.find('section#decisions').exists()).toBe(true);
  });

  it('the empty and partial scenarios show their states', async () => {
    const w = mount(App);
    await w.get('[data-testid="scenario-select"]').setValue('empty');
    await goTo(w, 'hypotheses');
    expect(w.find('[data-testid="knowledge-empty"]').exists()).toBe(true);
    await w.get('[data-testid="scenario-select"]').setValue('partial');
    expect(w.text()).toContain('NOT AVAILABLE');
  });
});

describe('live adapter', () => {
  it('provides no hypotheses/decisions, so LIVE never shows demo records', () => {
    const live = toDashboardData({
      projectOverview: { data: null, sources: [] }, currentMissions: { data: null, sources: [] },
      checkpoints: { data: null, sources: [] }, roadmap: { data: null, sources: [] },
      diagnostics: { validation: 'NOT_PERFORMED', sources: [], notes: [] },
    });
    expect(live.hypotheses).toBeUndefined();
    expect(live.decisions).toBeUndefined();
    expect(live.isDemo).toBe(false);
  });
});
