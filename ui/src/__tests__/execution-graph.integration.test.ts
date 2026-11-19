import { flushPromises, mount } from '@vue/test-utils';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDashboardServer } from '../../../src/http/server';
import type { DashboardServer } from '../../../src/http/server';
import { scaffoldInstance } from '../../../src/init/scaffold';
import App from '../App.vue';
import { goTo } from './nav';

// UI-008B: the Execution Graph against the real HTTP server and Core over a scaffolded project
// (files -> Core read model -> HTTP -> adapter -> graph).
const ROADMAP = '# Roadmap\n\n## Phases\n\n### Phase 1 — First\n\n**Status:** COMPLETED\n\n### Phase 2 — Second\n\n**Status:** IN PROGRESS\n\n## Current Focus\n\nActive Phase: 2 — Second\n';
const STORIES = '# Stories\n\n## Phase 1 — First\n\n### STORY 1.1 — One\n\n**Status:** COMPLETED\n\n### STORY 1.2 — Two\n\n**Status:** COMPLETED\n\n## Phase 9 — Ghost\n\n### STORY 9.1 — Lost\n\n**Status:** COMPLETED\n';
const ACTIVE = '# Active\n\n## Current Story\n\n**Story:** BETA-020\n**Status:** IN PROGRESS\n';
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
  write('.monolith/context/maps/roadmap-index.md', ROADMAP);
  write('.monolith/memory/working/story-index.md', STORIES);
  write('.monolith/memory/working/active.md', ACTIVE);
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

describe('Execution Graph (LIVE, real HTTP + Core)', () => {
  it('draws the real phases, stories and only the confirmed edges', async () => {
    const w = await mountLive();
    await goTo(w, 'graph');
    expect(w.findAll('[data-testid="graph-phase"]').map((p) => p.attributes('data-phase-id'))).toEqual(['1', '2']);
    expect(w.findAll('[data-testid="graph-story"]').map((p) => p.attributes('data-story-id'))).toEqual(['STORY 1.1', 'STORY 1.2', 'STORY 9.1']);
    // Phase 9 is not in the roadmap: its story stays visible but is not linked.
    expect(w.findAll('[data-testid="graph-edge"]')).toHaveLength(2);
    expect(w.text()).toContain('Phase not found in the roadmap (1)');
    // Phase 2 is CURRENT only because the roadmap's pointer says so.
    const cur = w.findAll('[data-testid="graph-phase"]').filter((p) => p.find('[data-testid="graph-current-phase"]').exists());
    expect(cur.map((p) => p.attributes('data-phase-id'))).toEqual(['2']);
    // The current story (from active.md) is not in the index: shown apart, without a phase.
    const outside = w.findAll('[data-testid="graph-current-outside"]');
    expect(outside).toHaveLength(1);
    expect(outside[0]!.text()).toContain('BETA-020');
  });

  it('opens details of a story from the live data', async () => {
    const w = await mountLive();
    await goTo(w, 'graph');
    await w.findAll('[data-testid="graph-story"]')[0]!.trigger('click');
    expect(w.get('[data-testid="detail-phase"]').text()).toContain('Phase 1');
    expect(w.get('[data-testid="detail-provenance"]').text()).toContain('REPORTED');
  });

  it('shows the story index as not available when the file is absent, not as an empty graph', async () => {
    rmSync(join(dir, '.monolith/memory/working/story-index.md'));
    const w = await mountLive();
    await goTo(w, 'graph');
    expect(w.find('[data-notice="STORY_INDEX_ABSENT"]').exists()).toBe(true);
    expect(w.findAll('[data-testid="graph-phase"]')).toHaveLength(2);
    expect(w.findAll('[data-testid="graph-edge"]')).toHaveLength(0);
  });

  it('keeps stories unlinked when the roadmap is unreadable', async () => {
    rmSync(join(dir, '.monolith/context/maps/roadmap-index.md'));
    const w = await mountLive();
    await goTo(w, 'graph');
    expect(w.find('[data-notice="ROADMAP_UNAVAILABLE"]').exists()).toBe(true);
    expect(w.findAll('[data-testid="graph-edge"]')).toHaveLength(0);
    expect(w.findAll('[data-testid="graph-story"]')).toHaveLength(3);
  });

  it('performs no write request and no extra fetch when opening the graph', async () => {
    const w = await mountLive();
    const before = calls.length;
    await goTo(w, 'graph');
    await w.findAll('[data-testid="graph-phase"]')[0]!.trigger('click');
    expect(calls.length).toBe(before);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
