import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardReadModel } from '../../../src/readmodel/types';
import App from '../App.vue';
import { DASHBOARD_ENDPOINT, DashboardLoadError, fetchDashboard } from '../live/client';
import { toDashboardData } from '../live/adapter';

const src = (id: string, status = 'available', code: string | null = null) =>
  ({ id, path: `.monolith/${id}`, status, code }) as never;

function model(over: Partial<DashboardReadModel> = {}): DashboardReadModel {
  return {
    projectOverview: {
      data: {
        name: 'Real <b>Project</b>',
        monolithRoot: '.monolith',
        monolithRootSource: 'default',
        stateSchemaVersionOnDisk: 2,
        stateRevision: 7,
        activeMissionCount: 1,
        finishedMissionCount: 0,
        currentStory: { excerpt: '<img src=x onerror=alert(1)>\nStory text', lineRange: '3-4' },
      },
      sources: [src('config')],
    },
    currentMissions: {
      data: {
        active: [{
          id: 'MIS-0001', title: 'Live mission', system: 's', status: 'in_progress',
          startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', summary: null,
        }],
      },
      sources: [src('state')],
    },
    checkpoints: {
      data: {
        byActiveMission: [{
          missionId: 'MIS-0001', count: 1,
          latest: {
            id: 'MIS-0001-CKPT-0001', missionId: 'MIS-0001', createdAt: '2026-01-02T00:00:00.000Z',
            summary: 'Live checkpoint', remainingSteps: ['Live step'], context: null,
          },
        }],
      },
      sources: [src('state')],
    },
    roadmap: { data: { text: '<script>window.__pwn=1</script>\n# Live roadmap' }, sources: [src('roadmap')] },
    diagnostics: {
      validation: 'NOT_PERFORMED',
      sources: [src('config'), src('state'), src('activeStory'), src('roadmap')],
      notes: [{ code: 'MULTIPLE_ACTIVE_MISSIONS', severity: 'warn' }],
    },
    ...over,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function stubFetch(...responses: Array<Response | Error | (() => Response)>) {
  const spy = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected extra fetch');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(() => vi.unstubAllGlobals());

describe('fetchDashboard', () => {
  it('requests only the fixed endpoint, with no project root or credentials', async () => {
    const spy = stubFetch(json(model()));
    await fetchDashboard();
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DASHBOARD_ENDPOINT);
    expect(url).toBe('/api/dashboard');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.body).toBeUndefined();
  });

  it('rejects network errors, non-2xx, malformed JSON and a wrong shape', async () => {
    const cases: Array<[Response | Error, RegExp]> = [
      [new TypeError('Failed to fetch'), /unreachable/],
      [json({ error: { kind: 'security', code: 'HOST_NOT_ALLOWED' } }, 403), /HTTP 403, HOST_NOT_ALLOWED\)/],
      [json({ error: { kind: 'request', code: 'NOT_FOUND' } }, 404), /HTTP 404, NOT_FOUND\)/],
      [json({ error: { code: '/home/secret/path' } }, 500), /^Dashboard request failed \(HTTP 500\)\. Check whether the MONOLITH dev API is running\.$/],
      [json('<html>not json', 200), /not valid JSON/],
      [json({ projectOverview: {} }), /unexpected data shape/],
      [json([]), /unexpected data shape/],
      [json({ ...model(), diagnostics: null }), /unexpected data shape/],
    ];
    for (const [response, message] of cases) {
      stubFetch(response);
      const err = await fetchDashboard().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DashboardLoadError);
      expect((err as Error).message).toMatch(message);
    }
  });

  it('rejects a mission with an unknown status and a non-array remainingSteps', async () => {
    const bad = model();
    bad.currentMissions.data!.active[0].status = 'bogus' as never;
    stubFetch(json(bad));
    await expect(fetchDashboard()).rejects.toThrow(/unexpected data shape/);
    const bad2 = model();
    bad2.checkpoints.data!.byActiveMission[0].latest!.remainingSteps = 'x' as never;
    stubFetch(json(bad2));
    await expect(fetchDashboard()).rejects.toThrow(/unexpected data shape/);
  });
});

describe('F-1: checkpoint count', () => {
  const withCount = (count: number) => {
    const m = model();
    m.checkpoints.data!.byActiveMission[0].count = count;
    return m;
  };

  it('adapter keeps count next to the latest checkpoint', () => {
    expect(toDashboardData(withCount(5)).checkpoints![0].recordedCount).toBe(5);
  });

  it('count 5: shows the latest checkpoint, says it is only the latest, shows the total', async () => {
    stubFetch(json(withCount(5)));
    const w = mount(App);
    await flushPromises();
    const panel = w.get('#checkpoints');
    expect(panel.text()).toContain('Latest checkpoint per active mission');
    expect(panel.text()).toContain('Live checkpoint');
    expect(panel.get('[data-testid="checkpoint-count"]').text()).toBe('5 recorded checkpoints');
    expect(panel.findAll('[data-testid="checkpoint"]')).toHaveLength(1);
  });

  it('count 1 is singular', async () => {
    stubFetch(json(withCount(1)));
    const w = mount(App);
    await flushPromises();
    expect(w.get('[data-testid="checkpoint-count"]').text()).toBe('1 recorded checkpoint');
  });

  it('EMPTY stays "No checkpoints recorded."; UNAVAILABLE never becomes a count', async () => {
    const empty = model();
    empty.checkpoints.data!.byActiveMission[0] = { missionId: 'MIS-0001', count: 0, latest: null };
    stubFetch(json(empty));
    let w = mount(App);
    await flushPromises();
    expect(w.get('#checkpoints').text()).toContain('No checkpoints recorded.');
    expect(w.get('#checkpoints').text()).not.toContain('NOT AVAILABLE');

    stubFetch(json(model({ checkpoints: { data: null, sources: [src('state', 'corrupt', 'PARSE_ERROR')] } })));
    w = mount(App);
    await flushPromises();
    expect(w.get('#checkpoints').text()).toContain('NOT AVAILABLE');
    expect(w.get('#checkpoints').text()).not.toMatch(/recorded checkpoint|0 recorded/);
    expect(w.find('[data-testid="checkpoint-count"]').exists()).toBe(false);
  });
});

describe('toDashboardData', () => {
  it('maps a section whose source failed to null, not to an empty list', () => {
    const d = toDashboardData(model({
      currentMissions: { data: null, sources: [src('state', 'corrupt', 'PARSE_ERROR')] },
      checkpoints: { data: null, sources: [] },
      roadmap: { data: null, sources: [] },
    }));
    expect(d.missions).toBeNull();
    expect(d.checkpoints).toBeNull();
    expect(d.roadmapText).toBeNull();
    expect(d.isDemo).toBe(false);
  });
});

describe('App in LIVE mode (default)', () => {
  it('shows loading, then real DTO data with the LIVE DATA badge', async () => {
    let release!: (r: Response) => void;
    const spy = stubFetch(() => { throw new Error('unused'); });
    spy.mockImplementationOnce(() => new Promise<Response>((r) => { release = r; }));
    const w = mount(App);
    expect(w.find('[data-testid="loading"]').exists()).toBe(true);
    expect(w.get('[data-testid="live-badge"]').text()).not.toBe('LIVE DATA');
    expect(w.find('section#overview').exists()).toBe(false);

    release(json(model()));
    await flushPromises();
    expect(w.get('[data-testid="live-badge"]').text()).toBe('LIVE DATA');
    expect(w.find('[data-testid="demo-badge"]').exists()).toBe(false);
    expect(w.find('[data-testid="scenario-select"]').exists()).toBe(false);
    for (const id of ['overview', 'mission', 'checkpoints', 'roadmap', 'diagnostics']) {
      expect(w.find(`section#${id}`).exists(), id).toBe(true);
    }
    expect(w.text()).toContain('MIS-0001');
    expect(w.text()).toContain('Live mission');
    expect(w.text()).toContain('Live checkpoint');
    expect(w.text()).toContain('Live step');
    expect(w.text()).toContain('MULTIPLE_ACTIVE_MISSIONS');
    expect(w.text()).not.toContain('Tidewatch');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('renders untrusted DTO text as plain text', async () => {
    stubFetch(json(model()));
    const w = mount(App);
    await flushPromises();
    expect(w.get('[data-testid="roadmap-text"]').element.textContent).toContain('<script>window.__pwn=1</script>');
    expect(w.get('[data-testid="current-story"]').element.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(w.text()).toContain('Real <b>Project</b>');
    expect(w.find('script').exists()).toBe(false);
    expect(w.find('img').exists()).toBe(false);
    expect(w.find('b').exists()).toBe(false);
    expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
  });

  it('shows NOT AVAILABLE, not "none", for a section whose source failed', async () => {
    stubFetch(json(model({
      currentMissions: { data: null, sources: [src('state', 'corrupt', 'PARSE_ERROR')] },
      checkpoints: { data: null, sources: [src('state', 'corrupt', 'PARSE_ERROR')] },
    })));
    const w = mount(App);
    await flushPromises();
    expect(w.get('#mission').text()).toContain('NOT AVAILABLE');
    expect(w.get('#mission').text()).not.toContain('No active missions.');
    expect(w.get('#checkpoints').text()).toContain('NOT AVAILABLE');
  });

  it.each([
    ['network error', new TypeError('Failed to fetch'), /unreachable/],
    ['HTTP 403', json({ error: { code: 'HOST_NOT_ALLOWED' } }, 403), /HTTP 403/],
    ['HTTP 404', json({ error: { code: 'NOT_FOUND' } }, 404), /HTTP 404/],
    ['HTTP 500', json({ error: { code: 'INTERNAL_ERROR' } }, 500), /HTTP 500/],
    ['malformed JSON', json('{oops', 200), /not valid JSON/],
    ['invalid DTO', json({ nope: true }), /unexpected data shape/],
  ])('%s -> error state with retry, no data, no DEMO fallback', async (_n, response, message) => {
    const spy = stubFetch(response);
    const w = mount(App);
    await flushPromises();
    const err = w.get('[data-testid="load-error"]');
    expect(err.text()).toMatch(message);
    expect(w.find('[data-testid="retry"]').exists()).toBe(true);
    expect(w.find('[data-testid="demo-badge"]').exists()).toBe(false);
    expect(w.get('[data-testid="live-badge"]').text()).not.toBe('LIVE DATA');
    expect(w.find('section#overview').exists()).toBe(false);
    expect(w.text()).not.toContain('Tidewatch');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Retry performs a new request and recovers', async () => {
    const spy = stubFetch(new TypeError('down'), json(model()));
    const w = mount(App);
    await flushPromises();
    expect(w.find('[data-testid="load-error"]').exists()).toBe(true);
    await w.get('[data-testid="retry"]').trigger('click');
    await flushPromises();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(w.get('[data-testid="live-badge"]').text()).toBe('LIVE DATA');
    expect(w.find('[data-testid="load-error"]').exists()).toBe(false);
  });

  it('Refresh fetches updated data', async () => {
    const updated = model();
    updated.currentMissions.data!.active[0].title = 'Updated title';
    const spy = stubFetch(json(model()), json(updated));
    const w = mount(App);
    await flushPromises();
    expect(w.text()).toContain('Live mission');
    await w.get('[data-testid="refresh"]').trigger('click');
    await flushPromises();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(w.text()).toContain('Updated title');
    expect(w.text()).not.toContain('Live mission');
  });

  it('a failed refresh drops the old snapshot instead of masking it as current', async () => {
    stubFetch(json(model()), json({ error: { code: 'INTERNAL_ERROR' } }, 500));
    const w = mount(App);
    await flushPromises();
    expect(w.text()).toContain('Live mission');
    await w.get('[data-testid="refresh"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="load-error"]').exists()).toBe(true);
    expect(w.text()).not.toContain('Live mission');
    expect(w.text()).not.toContain('MIS-0001');
    expect(w.get('[data-testid="live-badge"]').text()).not.toBe('LIVE DATA');
  });

  it('?scenario= alone does not switch to DEMO', async () => {
    window.history.replaceState({}, '', '/?scenario=empty');
    const spy = stubFetch(new TypeError('down'));
    const w = mount(App);
    await flushPromises();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(w.find('[data-testid="demo-badge"]').exists()).toBe(false);
  });
});
