import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf8');
const main = read('../styles/main.css');
const cosmic = read('../styles/skins/cosmic-glass.css');
const switcher = read('../components/SkinSwitcher.vue');

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!m) throw new Error(`unsupported colour: ${value}`);
  const p = m[1].split(',').map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}

function token(css: string, name: string): Rgba {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`missing token ${name}`);
  return parse(m[1]);
}

const blend = (fg: Rgba, bg: Rgba): Rgba => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as Rgba;

function luminance([r, g, b]: Rgba): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('control boundaries (V-3)', () => {
  it('Classic: select and button borders reach 3:1 on both neighbouring surfaces', () => {
    const border = token(main, '--control-border');
    expect(contrast(border, token(main, '--surface'))).toBeGreaterThanOrEqual(3);
    expect(contrast(border, token(main, '--surface-2'))).toBeGreaterThanOrEqual(3);
  });

  it('Cosmic Glass: translucent border reaches 3:1 even over the plain page background', () => {
    const border = token(cosmic, '--control-border');
    expect(border[3]).toBeLessThan(1); // stays translucent (glass), not an opaque outline
    expect(contrast(blend(border, token(cosmic, '--bg')), token(cosmic, '--bg'))).toBeGreaterThanOrEqual(3);
  });

  it('select and button take their boundary from --control-border, not the decorative --border', () => {
    expect(main).toMatch(/\.scenario select\s*\{[^}]*border:\s*1px solid var\(--control-border\)/);
    expect(main).toMatch(/\nbutton\s*\{[^}]*border:\s*1px solid var\(--control-border\)/);
    expect(switcher).toMatch(/\.skin-switcher select\s*\{[^}]*border:\s*1px solid var\(--control-border\)/);
    expect(cosmic).toMatch(/button,\s*\n[^{]*select\s*\{[^}]*border-color:\s*var\(--control-border\)/);
  });
});
