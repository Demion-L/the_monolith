import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import { DEFAULT_SECTION, SECTIONS, sectionFromHash } from '../sections';
import { SKIN_STORAGE_KEY } from '../skin';
import { goTo } from './nav';

const IDS = SECTIONS.map((s) => s.id);

function resetUrl(search = '?mode=demo', hash = ''): void {
  window.history.replaceState({}, '', `/${search}${hash}`);
}

const visible = (w: ReturnType<typeof mount>) => w.findAll('main section').map((s) => s.attributes('id'));
const current = (w: ReturnType<typeof mount>) =>
  w.findAll('.nav a[aria-current]').map((a) => a.attributes('href'));

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.skin;
  resetUrl();
});
afterEach(() => vi.unstubAllGlobals());

describe('sectionFromHash', () => {
  it('accepts every real section and falls back to the default otherwise', () => {
    for (const id of IDS) expect(sectionFromHash(`#${id}`)).toBe(id);
    for (const bad of ['', '#', '#nope', '#OVERVIEW', '#overview/x', '#__proto__']) {
      expect(sectionFromHash(bad)).toBe(DEFAULT_SECTION);
    }
  });
});

describe('section navigation', () => {
  it('shows only the first section by default and marks its link current', () => {
    const w = mount(App);
    expect(visible(w)).toEqual([IDS[0]]);
    expect(current(w)).toEqual([`#${IDS[0]}`]);
    expect(w.get('.nav a[aria-current]').attributes('aria-current')).toBe('location');
  });

  it('shows the chosen section and hides the others', async () => {
    const w = mount(App);
    await goTo(w, 'roadmap');
    expect(visible(w)).toEqual(['roadmap']);
    expect(w.find('section#overview').exists()).toBe(false);
    expect(current(w)).toEqual(['#roadmap']);
  });

  it('updates the URL hash', async () => {
    const w = mount(App);
    await goTo(w, 'checkpoints');
    expect(window.location.hash).toBe('#checkpoints');
  });

  it('opens the section named by the URL hash', () => {
    resetUrl('?mode=demo', '#diagnostics');
    const w = mount(App);
    expect(visible(w)).toEqual(['diagnostics']);
    expect(current(w)).toEqual(['#diagnostics']);
  });

  it('opens the default section for an invalid hash and replaces it in the URL', () => {
    resetUrl('?mode=demo', '#does-not-exist');
    const w = mount(App);
    expect(visible(w)).toEqual([DEFAULT_SECTION]);
    expect(window.location.hash).toBe(`#${DEFAULT_SECTION}`);
  });

  it('follows hashchange (Back/Forward and manual edits)', async () => {
    const w = mount(App);
    await goTo(w, 'mission');
    await goTo(w, 'roadmap');
    window.history.replaceState({}, '', '/?mode=demo#checkpoints');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(visible(w)).toEqual(['checkpoints']);
    expect(current(w)).toEqual(['#checkpoints']);
  });

  it('replaces an invalid hash typed in later with the default section', async () => {
    const w = mount(App);
    await goTo(w, 'roadmap');
    window.history.replaceState({}, '', '/?mode=demo#bogus');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(visible(w)).toEqual([DEFAULT_SECTION]);
    expect(window.location.hash).toBe(`#${DEFAULT_SECTION}`);
  });

  it('follows real history traversal without looping', async () => {
    const w = mount(App);
    const push = vi.spyOn(window.history, 'pushState');
    await goTo(w, 'mission');
    await goTo(w, 'roadmap');
    expect(push).toHaveBeenCalledTimes(2);
    window.history.back();
    await vi.waitFor(() => expect(visible(w)).toEqual(['mission']));
    window.history.back();
    await vi.waitFor(() => expect(visible(w)).toEqual([IDS[0]]));
    window.history.forward();
    await vi.waitFor(() => expect(visible(w)).toEqual(['mission']));
    // Traversal never pushes new entries.
    expect(push).toHaveBeenCalledTimes(2);
    push.mockRestore();
  });

  it('does not push a new entry when the current section is chosen again', async () => {
    const w = mount(App);
    await goTo(w, 'roadmap');
    const push = vi.spyOn(window.history, 'pushState');
    await goTo(w, 'roadmap');
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it('leaves modified clicks to the browser', async () => {
    const w = mount(App);
    const link = w.get('.nav a[href="#roadmap"]');
    await link.trigger('click', { ctrlKey: true });
    expect(visible(w)).toEqual([IDS[0]]);
  });

  it('closes the mobile menu after a choice', async () => {
    const w = mount(App);
    const toggle = w.get('[data-testid="nav-toggle"]');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    await goTo(w, 'mission');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(visible(w)).toEqual(['mission']);
  });

  it('keeps the active section when the skin changes', async () => {
    const w = mount(App);
    await goTo(w, 'roadmap');
    await w.get('aside [data-testid="skin-select"]').setValue('cosmic-glass');
    expect(document.documentElement.dataset.skin).toBe('cosmic-glass');
    expect(window.localStorage.getItem(SKIN_STORAGE_KEY)).toBe('cosmic-glass');
    expect(visible(w)).toEqual(['roadmap']);
    expect(current(w)).toEqual(['#roadmap']);
  });

  it('removes its window listeners on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    mount(App).unmount();
    const names = remove.mock.calls.map((c) => c[0]);
    expect(names).toContain('hashchange');
    expect(names).toContain('popstate');
    remove.mockRestore();
  });

  it('has no duplicate ids in any section', async () => {
    const w = mount(App);
    for (const id of IDS) {
      await goTo(w, id);
      const ids = w.findAll('[id]').map((e) => e.attributes('id'));
      expect(new Set(ids).size, id).toBe(ids.length);
    }
  });

  it('keeps DEMO mode and its badge while navigating', async () => {
    const w = mount(App);
    await goTo(w, 'roadmap');
    expect(w.get('[data-testid="demo-badge"]').text()).toBe('DEMO DATA');
    expect(w.find('[data-testid="live-badge"]').exists()).toBe(false);
  });
});

describe('section navigation in LIVE', () => {
  const dto = {
    projectOverview: { data: { name: 'P', monolithRoot: '.monolith', monolithRootSource: 'default', stateSchemaVersionOnDisk: 2, stateRevision: 1, activeMissionCount: 0, finishedMissionCount: 0, currentStory: null }, sources: [] },
    currentMissions: { data: { active: [] }, sources: [] },
    checkpoints: { data: { byActiveMission: [] }, sources: [] },
    roadmap: { data: { text: 'road' }, sources: [] },
    diagnostics: { validation: 'NOT_PERFORMED', sources: [], notes: [] },
  };
  const ok = () => new Response(JSON.stringify(dto), { status: 200, headers: { 'content-type': 'application/json' } });

  beforeEach(() => resetUrl('', ''));

  it('does not refetch when sections change, and keeps the section over a refresh', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(ok()));
    vi.stubGlobal('fetch', fetchSpy);
    const w = mount(App);
    await flushPromises();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const id of IDS) await goTo(w, id);
    await goTo(w, 'roadmap');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(w.get('[data-testid="live-badge"]').text()).toBe('LIVE DATA');

    await w.get('[data-testid="refresh"]').trigger('click');
    await flushPromises();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(visible(w)).toEqual(['roadmap']);
    expect(current(w)).toEqual(['#roadmap']);
  });

  it('shows loading and error UI regardless of the hash, with no section links', async () => {
    resetUrl('', '#roadmap');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    const w = mount(App);
    expect(w.find('[data-testid="loading"]').exists()).toBe(true);
    await flushPromises();
    expect(w.find('[data-testid="load-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="retry"]').exists()).toBe(true);
    expect(w.find('main section#roadmap').exists()).toBe(false);
    expect(w.find('.nav').exists()).toBe(false);
    expect(w.find('[data-testid="demo-badge"]').exists()).toBe(false);
  });

  it('opens the hash section once data arrives', async () => {
    resetUrl('', '#roadmap');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok())));
    const w = mount(App);
    await flushPromises();
    expect(visible(w)).toEqual(['roadmap']);
  });
});

describe('motion', () => {
  const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');

  it('animates only opacity and transform, with the specified timings', () => {
    expect(css).toContain('.section-fade-enter-active { transition: opacity 220ms ease-out, transform 220ms ease-out; }');
    expect(css).toContain('.section-fade-leave-active { transition: opacity 150ms ease-in, transform 150ms ease-in; }');
    expect(css).not.toMatch(/section-fade[^}]*(height|box-shadow|backdrop-filter|background)/);
  });

  it('disables the transition under prefers-reduced-motion', () => {
    const block = css.split('@media (prefers-reduced-motion: reduce)')[1] ?? '';
    expect(block).toContain('.section-fade-enter-active, .section-fade-leave-active { transition: none; }');
    expect(block).toContain('.section-fade-enter-from, .section-fade-leave-to { opacity: 1; transform: none; }');
  });

  it('uses the Vue Transition in out-in mode', () => {
    const app = readFileSync(resolve(__dirname, '../App.vue'), 'utf8');
    expect(app).toContain('<Transition name="section-fade" mode="out-in"');
    expect(app).not.toMatch(/setTimeout/);
  });
});
