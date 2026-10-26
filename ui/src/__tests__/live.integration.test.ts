import { flushPromises, mount } from '@vue/test-utils';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDashboardServer } from '../../../src/http/server';
import type { DashboardServer } from '../../../src/http/server';
import { ROADMAP_REL } from '../../../src/readmodel/dashboard';
import App from '../App.vue';

// Real MONOLITH HTTP server + real read model over real files; only the
// browser's relative URL is mapped to the server's ephemeral loopback port
// (the Vite proxy itself is covered by the manual smoke run).

let dir: string;
let server: DashboardServer;
const realFetch = globalThis.fetch;

function write(rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

beforeEach(async () => {
  window.history.replaceState({}, '', '/');
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'ui-live-')));
  const m = { id: 'MIS-0042', title: 'Integration mission', system: 'sys', status: 'in_progress', startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', summary: null };
  const c = { id: 'MIS-0042-CKPT-0001', missionId: 'MIS-0042', createdAt: '2026-01-02T00:00:00.000Z', summary: 'Integration checkpoint', remainingSteps: ['Integration step'], context: null };
  write('monolith.config.json', JSON.stringify({ project: { name: 'Integration Project' } }));
  write('.monolith/state.json', JSON.stringify({
    schemaVersion: 2, revision: 3, strategic: { systems: {} },
    tactical: { missions: { [m.id]: m }, checkpoints: { [c.id]: c } },
  }));
  write('.monolith/memory/working/active.md', '# Active\n\n## Current Story\n\nIntegration story.\n');
  write(`.monolith/${ROADMAP_REL}`, '# Integration roadmap\n');
  server = await startDashboardServer({ projectRoot: dir });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => realFetch(server.url + url, init));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('LIVE mode against the real HTTP API', () => {
  it('renders the project data served by startDashboardServer', async () => {
    const w = mount(App);
    await flushPromises();
    await vi.waitFor(() => expect(w.find('[data-testid="loading"]').exists()).toBe(false));
    expect(w.get('[data-testid="live-badge"]').text()).toBe('LIVE DATA');
    expect(w.text()).toContain('Integration Project');
    expect(w.text()).toContain('MIS-0042');
    expect(w.text()).toContain('Integration mission');
    expect(w.text()).toContain('Integration checkpoint');
    expect(w.text()).toContain('Integration step');
    expect(w.text()).toContain('Integration story.');
    expect(w.text()).toContain('Integration roadmap');
  });

  it('shows an error state (no demo data) once the server is gone, and recovers on retry', async () => {
    const w = mount(App);
    await vi.waitFor(() => expect(w.find('[data-testid="live-badge"]').text()).toBe('LIVE DATA'));
    const port = server.port;
    await server.close();
    await w.get('[data-testid="refresh"]').trigger('click');
    await vi.waitFor(() => expect(w.find('[data-testid="load-error"]').exists()).toBe(true));
    expect(w.text()).not.toContain('Integration mission');
    expect(w.text()).not.toContain('Tidewatch');

    server = await startDashboardServer({ projectRoot: dir, port });
    await w.get('[data-testid="retry"]').trigger('click');
    await vi.waitFor(() => expect(w.find('[data-testid="live-badge"]').text()).toBe('LIVE DATA'));
    expect(w.text()).toContain('Integration mission');
  });
});
