import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import SideNav from '../components/SideNav.vue';
import { SKIN_STORAGE_KEY } from '../skin';
import { goTo } from './nav';

const SECTION_IDS = ['overview', 'mission', 'checkpoints', 'roadmap', 'diagnostics'];

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.skin;
  window.history.replaceState({}, '', '/?mode=demo');
});
afterEach(() => vi.unstubAllGlobals());

describe('layout shell', () => {
  it('renders the sidebar with brand, section links and the skin switcher', () => {
    const w = mount(App);
    const sidebar = w.get('aside.sidebar');
    expect(sidebar.text()).toContain('MONOLITH');
    expect(sidebar.find('nav[aria-label="Sections"]').exists()).toBe(true);
    expect(sidebar.find('[data-testid="skin-select"]').exists()).toBe(true);
  });

  it('keeps the existing links and their anchor targets', async () => {
    const w = mount(App);
    const hrefs = w.findAll('.nav a').map((a) => a.attributes('href'));
    expect(hrefs).toEqual(SECTION_IDS.map((id) => `#${id}`));
    for (const id of SECTION_IDS) {
      await goTo(w, id);
      expect(w.find(`section#${id}`).exists(), id).toBe(true);
    }
  });

  it('puts the skin switcher at the top of the sidebar, before the section links', () => {
    const w = mount(App);
    const panel = w.get('.sidebar-panel').element;
    const children = Array.from(panel.children);
    const switcher = panel.querySelector('.skin-switcher')!;
    const nav = panel.querySelector('nav.nav')!;
    expect(children.indexOf(switcher)).toBe(0);
    expect(children.indexOf(switcher)).toBeLessThan(children.indexOf(nav));
    expect(w.findAll('[data-testid="skin-select"]')).toHaveLength(1);
    expect(switcher.textContent).toContain('Appearance');
  });

  it('reserves the scrollbar gutter on the viewport scroller (no horizontal shift)', () => {
    const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');
    expect(css).toMatch(/(^|\n)html\s*\{[^}]*scrollbar-gutter:\s*stable/);
  });

  it('has no duplicate ids', () => {
    const w = mount(App);
    const ids = w.findAll('[id]').map((e) => e.attributes('id'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('still switches skins from the sidebar', async () => {
    const w = mount(App);
    await w.get('aside [data-testid="skin-select"]').setValue('cosmic-glass');
    expect(document.documentElement.dataset.skin).toBe('cosmic-glass');
    expect(window.localStorage.getItem(SKIN_STORAGE_KEY)).toBe('cosmic-glass');
  });

  it('keeps the topbar indicators: project name, scenario and DEMO badge', () => {
    const w = mount(App);
    const bar = w.get('header.topbar');
    expect(bar.find('[data-testid="demo-badge"]').text()).toBe('DEMO DATA');
    expect(bar.find('[data-testid="scenario-select"]').exists()).toBe(true);
    expect(bar.find('.project').text()).not.toBe('');
  });
});

describe('layout shell in LIVE', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));

  it('loading: no section links, but the sidebar and switcher stay available', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const w = mount(App);
    expect(w.find('[data-testid="loading"]').exists()).toBe(true);
    expect(w.find('.nav').exists()).toBe(false);
    expect(w.find('aside [data-testid="skin-select"]').exists()).toBe(true);
    expect(w.find('[data-testid="live-badge"]').text()).toBe('LIVE · NO DATA');
  });

  it('error: no section links, retry and switcher available, no demo badge', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    const w = mount(App);
    await vi.waitFor(() => expect(w.find('[data-testid="load-error"]').exists()).toBe(true));
    expect(w.find('.nav').exists()).toBe(false);
    expect(w.find('[data-testid="retry"]').exists()).toBe(true);
    expect(w.find('aside [data-testid="skin-select"]').exists()).toBe(true);
    expect(w.find('[data-testid="demo-badge"]').exists()).toBe(false);
  });
});

describe('mobile navigation', () => {
  it('is closed by default and toggles aria-expanded', async () => {
    const w = mount(SideNav, { props: { sections: true } });
    const toggle = w.get('[data-testid="nav-toggle"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-controls')).toBe('sidebar-panel');
    expect(w.get('aside').classes()).not.toContain('open');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(w.get('aside').classes()).toContain('open');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(w.get('aside').classes()).not.toContain('open');
  });

  it('closes after a link is chosen', async () => {
    const w = mount(SideNav, { props: { sections: true } });
    await w.get('[data-testid="nav-toggle"]').trigger('click');
    await w.get('.nav a[href="#roadmap"]').trigger('click');
    expect(w.get('[data-testid="nav-toggle"]').attributes('aria-expanded')).toBe('false');
  });

  it('closes on Escape', async () => {
    const w = mount(SideNav, { props: { sections: true } });
    await w.get('[data-testid="nav-toggle"]').trigger('click');
    await w.get('aside').trigger('keydown', { key: 'Escape' });
    expect(w.get('[data-testid="nav-toggle"]').attributes('aria-expanded')).toBe('false');
  });

  it('has an accessible toggle label and exposes the skin switcher', () => {
    const w = mount(SideNav, { props: { sections: false } });
    expect(w.get('[data-testid="nav-toggle"]').text()).not.toBe('');
    expect(w.find('[data-testid="skin-select"]').exists()).toBe(true);
    expect(w.find('.nav').exists()).toBe(false);
  });
});
