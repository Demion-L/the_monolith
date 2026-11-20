import { flushPromises, mount } from '@vue/test-utils';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDashboardServer } from '../../../src/http/server';
import type { DashboardServer } from '../../../src/http/server';
import { scaffoldInstance } from '../../../src/init/scaffold';
import App from '../App.vue';
import { SECTIONS } from '../sections';
import { goTo } from './nav';

// UI-006: the unified Mission Control against the real HTTP server and Core over a scaffolded project.
let dir: string;
let server: DashboardServer;
const realFetch = globalThis.fetch;
const calls: { url: string; method: string }[] = [];

function write(rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}
const adrDoc = (n: number, status = 'accepted') =>
  `---\ntype: adr\nid: ADR-${String(n).padStart(3, '0')}\ntitle: Decision ${n} about ${n % 2 === 0 ? 'storage' : 'networking'}\nstatus: ${status}\n---\n\n# ADR-${n}\n\nBody ${n}.\n`;

beforeEach(async () => {
  window.history.replaceState({}, '', '/');
  calls.length = 0;
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'ui-mc-')));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await scaffoldInstance(dir, {
    projectName: 'MC Project', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude',
    finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith',
  });
  vi.restoreAllMocks();
  for (let n = 1; n <= 13; n++) write(`docs/adr/ADR-${String(n).padStart(3, '0')}-d${n}.md`, adrDoc(n, n === 13 ? 'experimental' : 'accepted'));
  write('.monolith/memory/long-term/hypotheses.md', '# H\n\n## Live one {#HYP-001}\n\n**Status:** active\n\n## Live two {#HYP-002}\n\n**Status:** validated\n');
  write('.monolith/context/maps/roadmap-index.md', '# Roadmap\n\n## Phases\n\n### Phase 1 — First\n\n**Status:** complete\n\n### Phase 2 — Second\n\n**Status:** active\n');
  server = await startDashboardServer({ projectRoot: dir });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return realFetch(server.url + url, init);
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await server.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

async function mountLive() {
  const w = mount(App);
  await vi.waitFor(() => expect(w.find('nav.nav, .nav').exists()).toBe(true));
  await vi.waitFor(() => expect(w.find('[data-testid="load-error"]').exists()).toBe(false));
  await flushPromises();
  return w;
}

describe('Unified Mission Control (LIVE, real HTTP)', () => {
  it('lists every section in the navigation and each one opens', async () => {
    const w = await mountLive();
    expect(SECTIONS.map((s) => s.id)).toEqual(['overview', 'history', 'roadmap', 'graph', 'hypotheses', 'decisions', 'diagnostics']);
    for (const { id } of SECTIONS) {
      await goTo(w, id);
      expect(w.find(`section#${id}`).exists(), id).toBe(true);
    }
  });

  it('shows the real roadmap, hypotheses and ADRs, with no demo marker anywhere', async () => {
    const w = await mountLive();
    await goTo(w, 'roadmap');
    expect(w.findAll('[data-testid="roadmap-phase"]')).toHaveLength(2);
    await goTo(w, 'hypotheses');
    expect(w.findAll('[data-testid="knowledge-id"]').map((e) => e.text()).sort()).toEqual(['HYP-001', 'HYP-002']);
    await goTo(w, 'decisions');
    expect(w.findAll('[data-testid="knowledge-item"]')).toHaveLength(10);
    expect(w.get('[data-testid="decisions-count"]').text()).toBe('Showing 10 of 13 decisions');
    expect(w.find('[data-testid="knowledge-demo"]').exists()).toBe(false);
    expect(w.text()).not.toMatch(/fictional|Demonstration data/i);
  });

  it('ADR search and Show more work on the real documents', async () => {
    const w = await mountLive();
    await goTo(w, 'decisions');
    await w.get('[data-testid="decisions-more"]').trigger('click');
    expect(w.findAll('[data-testid="knowledge-item"]')).toHaveLength(13);
    await w.get('[data-testid="decisions-search"]').setValue('EXPERIMENTAL');
    expect(w.findAll('[data-testid="knowledge-id"]').map((e) => e.text())).toEqual(['ADR-013']);
    expect(w.get('[data-testid="knowledge-status"]').text()).toContain('unrecognized status');
    await w.get('[data-testid="decisions-search"]').setValue('adr-00');
    expect(w.findAll('[data-testid="knowledge-item"]')).toHaveLength(9);
  });

  it('Diagnostics keeps operational state and the on-demand cards next to the knowledge sections', async () => {
    const w = await mountLive();
    await goTo(w, 'diagnostics');
    expect(w.find('[data-testid="validation-card"]').exists()).toBe(true);
    expect(w.find('[data-testid="reconciliation-card"]').exists()).toBe(true);
    expect(w.find('[data-testid="opstate-mode"]').exists()).toBe(true);
    await w.get('[data-testid="run-validation"]').trigger('click');
    await vi.waitFor(() => expect(w.get('[data-testid="validation-card"] [data-testid="pill"]').text()).toBe('PASS'));
  });

  it('makes only the dashboard GET on load (no hidden POST)', async () => {
    await mountLive();
    expect(calls).toEqual([{ url: '/api/dashboard', method: 'GET' }]);
  });

  it('the dashboard JSON carries all merged fields', async () => {
    const res = await realFetch(`${server.url}/api/dashboard`);
    const body = (await res.json()) as Record<string, unknown> & { diagnostics: Record<string, unknown> };
    for (const k of ['projectOverview', 'currentMissions', 'checkpoints', 'roadmap', 'hypotheses', 'decisions', 'diagnostics']) expect(body, k).toHaveProperty(k);
    expect(body.diagnostics).toHaveProperty('state');
  });
});

describe('DEMO stays separate from LIVE', () => {
  it('demo mode never calls the server and labels its data', async () => {
    window.history.replaceState({}, '', '/?mode=demo');
    const w = mount(App);
    await goTo(w, 'decisions');
    expect(w.get('[data-testid="knowledge-demo"]').text()).toMatch(/not real/i);
    expect(calls).toEqual([]);
    expect(w.text()).not.toContain('ADR-013');
  });
});
