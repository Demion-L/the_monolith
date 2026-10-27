import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import SkinSwitcher from '../components/SkinSwitcher.vue';
import { applySkin, initSkin, readSavedSkin, setSkin, SKIN_STORAGE_KEY } from '../skin';

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.skin;
  window.history.replaceState({}, '', '/?mode=demo');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('skin manager', () => {
  it('defaults to classic', () => {
    expect(readSavedSkin()).toBe('classic');
  });

  it('restores saved skins', () => {
    window.localStorage.setItem(SKIN_STORAGE_KEY, 'classic');
    expect(readSavedSkin()).toBe('classic');
    window.localStorage.setItem(SKIN_STORAGE_KEY, 'cosmic-glass');
    expect(readSavedSkin()).toBe('cosmic-glass');
  });

  it('replaces an unknown id with classic', () => {
    window.localStorage.setItem(SKIN_STORAGE_KEY, 'neon');
    expect(readSavedSkin()).toBe('classic');
    expect(initSkin()).toBe('classic');
    expect(document.documentElement.dataset.skin).toBe('classic');
  });

  it('falls back to classic when reading storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSavedSkin()).toBe('classic');
  });

  it('does not throw when writing storage fails, and still applies the skin', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => setSkin('cosmic-glass')).not.toThrow();
    expect(document.documentElement.dataset.skin).toBe('cosmic-glass');
  });

  it('applies the skin to data-skin', () => {
    applySkin('cosmic-glass');
    expect(document.documentElement.dataset.skin).toBe('cosmic-glass');
  });

  it('initSkin applies the saved skin before mount', () => {
    window.localStorage.setItem(SKIN_STORAGE_KEY, 'cosmic-glass');
    initSkin();
    expect(document.documentElement.dataset.skin).toBe('cosmic-glass');
  });

  it('switching persists and does not reload the page', () => {
    const before = window.location.href;
    setSkin('cosmic-glass');
    expect(window.localStorage.getItem(SKIN_STORAGE_KEY)).toBe('cosmic-glass');
    expect(window.location.href).toBe(before);
  });
});

describe('SkinSwitcher', () => {
  it('lists both skins', () => {
    const options = mount(SkinSwitcher).findAll('option');
    expect(options.map((o) => o.element.value)).toEqual(['classic', 'cosmic-glass']);
    expect(options.map((o) => o.text())).toEqual(['Classic', 'Cosmic Glass']);
  });

  it('reflects the active skin', () => {
    applySkin('cosmic-glass');
    const select = mount(SkinSwitcher).get<HTMLSelectElement>('select');
    expect(select.element.value).toBe('cosmic-glass');
  });

  it('has an accessible name', () => {
    expect(mount(SkinSwitcher).get('select').attributes('aria-label')).toBe('Skin');
  });

  it('applies and persists the chosen skin', async () => {
    const w = mount(SkinSwitcher);
    await w.get('select').setValue('cosmic-glass');
    expect(document.documentElement.dataset.skin).toBe('cosmic-glass');
    expect(window.localStorage.getItem(SKIN_STORAGE_KEY)).toBe('cosmic-glass');
    await w.get('select').setValue('classic');
    expect(document.documentElement.dataset.skin).toBe('classic');
  });

  it('is available in LIVE loading and error states and in DEMO', async () => {
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const loading = mount(App);
    expect(loading.find('[data-testid="loading"]').exists()).toBe(true);
    expect(loading.find('[data-testid="skin-select"]').exists()).toBe(true);

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    const failed = mount(App);
    await vi.waitFor(() => expect(failed.find('[data-testid="load-error"]').exists()).toBe(true));
    expect(failed.find('[data-testid="skin-select"]').exists()).toBe(true);

    window.history.replaceState({}, '', '/?mode=demo');
    expect(mount(App).find('[data-testid="skin-select"]').exists()).toBe(true);
  });
});
