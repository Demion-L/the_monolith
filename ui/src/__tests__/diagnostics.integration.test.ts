import { flushPromises, mount } from '@vue/test-utils';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDashboardServer } from '../../../src/http/server';
import type { DashboardServer } from '../../../src/http/server';
import { scaffoldInstance } from '../../../src/init/scaffold';
import App from '../App.vue';
import { goTo } from './nav';

// Real MONOLITH HTTP server + real Core over a real scaffolded project; only the
// browser's relative URL is mapped to the server's ephemeral loopback port.

let dir: string;
let server: DashboardServer;
const realFetch = globalThis.fetch;
const calls: { url: string; method: string }[] = [];

function write(rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function fingerprint(): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p}:${createHash('sha1').update(readFileSync(p)).digest('hex')}`);
    }
  };
  walk(dir);
  return out.join('\n');
}

beforeEach(async () => {
  window.history.replaceState({}, '', '/#diagnostics');
  calls.length = 0;
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'ui-diag-')));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await scaffoldInstance(dir, {
    projectName: 'Diag Project', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude',
    finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith',
  });
  vi.restoreAllMocks();
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

/** Mounts the app and waits for the real dashboard response to arrive and render the Diagnostics section. */
async function mountLive() {
  const w = mount(App);
  await vi.waitFor(() => expect(w.find('[data-testid="validation-card"]').exists()).toBe(true));
  return w;
}
const pillOf = (w: ReturnType<typeof mount>, card: string) => w.get(`[data-testid="${card}"] [data-testid="pill"]`).text();

describe('Diagnostics against the real HTTP API', () => {
  it('nothing is run on load: both cards are NOT RUN and only the dashboard was fetched', async () => {
    const w = await mountLive();
    expect(pillOf(w, 'validation-card')).toBe('NOT RUN');
    expect(pillOf(w, 'reconciliation-card')).toBe('NOT RUN');
    expect(calls).toEqual([{ url: '/api/dashboard', method: 'GET' }]);
  });

  it('Run Validation shows the real PASS, with the real provenance next to it, and changes no file', async () => {
    const w = await mountLive();
    const before = fingerprint();
    await w.get('[data-testid="run-validation"]').trigger('click');
    await vi.waitFor(() => expect(pillOf(w, 'validation-card')).toBe('PASS'));
    expect(w.findAll('[data-testid="validation-check"]')).toHaveLength(3);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ url: '/api/diagnostics/validate', method: 'POST' }]);
    // Operational state comes from the same dashboard model Phase 2 built.
    expect(w.get('[data-testid="opstate-mode"]').text()).toMatch(/^LOCAL — .*not in a git repository/);
    expect(w.get('[data-testid="opstate-path"]').text()).not.toContain(dir);
    expect(fingerprint()).toBe(before);
  });

  it('Run Reconciliation shows a real conflict between active.md and roadmap-index.md', async () => {
    write('.monolith/memory/working/active.md', '# Active\n\n## Current Story\n\nNo active story.\n');
    write('.monolith/context/maps/roadmap-index.md', '# Roadmap\n\nActive Story: SUPPORT-003\n');
    const w = await mountLive();
    const before = fingerprint();
    await w.get('[data-testid="run-reconciliation"]').trigger('click');
    await vi.waitFor(() => expect(pillOf(w, 'reconciliation-card')).not.toBe('RUNNING'));
    const conflict = w.get('[data-testid="conflict"]');
    expect(conflict.text()).toContain('STATE CONFLICT');
    expect(conflict.text()).toContain('active.md');
    expect(conflict.text()).toContain('No active story');
    expect(conflict.text()).toContain('roadmap-index.md');
    expect(conflict.text()).toContain('Active Story: SUPPORT-003');
    // Validation was not run by this.
    expect(pillOf(w, 'validation-card')).toBe('NOT RUN');
    expect(fingerprint()).toBe(before);
  });

  it('a result survives switching sections and coming back', async () => {
    const w = await mountLive();
    await w.get('[data-testid="run-validation"]').trigger('click');
    await vi.waitFor(() => expect(pillOf(w, 'validation-card')).toBe('PASS'));
    await goTo(w, 'overview');
    await goTo(w, 'diagnostics');
    await flushPromises();
    expect(pillOf(w, 'validation-card')).toBe('PASS');
    expect(w.get('[data-testid="validation-time"]').text()).toMatch(/Last run/);
  });

  it('a server that stops answering gives ERROR, not a stale PASS', async () => {
    const w = await mountLive();
    await server.close();
    await w.get('[data-testid="run-validation"]').trigger('click');
    await vi.waitFor(() => expect(pillOf(w, 'validation-card')).toBe('ERROR'));
    expect(w.text()).not.toContain('PASS');
  });
});
