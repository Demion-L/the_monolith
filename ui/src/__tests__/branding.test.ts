import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App.vue';

const UI_ROOT = resolve(__dirname, '../..');
const html = readFileSync(resolve(UI_ROOT, 'index.html'), 'utf8');

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.skin;
  window.history.replaceState({}, '', '/?mode=demo');
});

describe('sidebar brand', () => {
  it('shows a decorative logo inside the existing .brand, without a second title', () => {
    const w = mount(App);
    const brand = w.get('aside.sidebar .brand');
    const img = brand.get('img.brand-logo');
    expect(img.attributes('alt')).toBe('');
    expect(img.attributes('aria-hidden')).toBeUndefined();
    expect(brand.findAll('strong')).toHaveLength(1);
    expect(brand.text().match(/MONOLITH/g)).toHaveLength(1);
    expect(brand.text()).toContain('Mission Control');
    // The logo comes first (left of the text).
    expect(brand.element.firstElementChild).toBe(img.element);
  });

  it('keeps the Appearance switcher and the section navigation', () => {
    const w = mount(App);
    expect(w.find('[data-testid="skin-select"]').exists()).toBe(true);
    expect(w.findAll('.nav a')).toHaveLength(5);
  });
});

describe('favicon', () => {
  it('is linked from index.html with relative paths that exist in ui/public', () => {
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs).toEqual(
      expect.arrayContaining(['./favicon.ico', './favicon-32x32.png', './favicon-16x16.png', './apple-touch-icon.png']),
    );
    for (const href of hrefs) {
      expect(href.startsWith('./'), href).toBe(true);
      expect(existsSync(resolve(UI_ROOT, 'public', href)), href).toBe(true);
    }
  });

  it('ships an .ico containing 16, 32 and 48 px images', () => {
    const ico = readFileSync(resolve(UI_ROOT, 'public/favicon.ico'));
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16]!).sort((a, b) => a - b);
    expect(sizes).toEqual([16, 32, 48]);
  });
});
