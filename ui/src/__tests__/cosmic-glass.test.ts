import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Visual output is verified in a real browser (see the UI-002D visual review);
// these tests only guard the invariants that can be checked from source.
const SCOPE = ':root[data-skin="cosmic-glass"]';
const ASSET_FILE = 'cosmic-glass-bg.webp';
const src = resolve(__dirname, '..');
const assetPath = resolve(src, 'assets', ASSET_FILE);
// Read as plain text: vitest does not hand raw CSS to `?raw` imports.
const baseCss = readFileSync(resolve(src, 'styles/main.css'), 'utf8');
const skinCss = readFileSync(resolve(src, 'styles/skins/cosmic-glass.css'), 'utf8');

function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  // Rule preludes: text before a `{` that is not an at-rule.
  for (const m of stripped.matchAll(/(?:^|[{};])\s*([^@\s{}][^{}]*)\{/g)) {
    for (const part of m[1].split(',')) found.push(part.trim());
  }
  return found;
}

describe('cosmic glass skin css', () => {
  it('scopes every rule to data-skin="cosmic-glass"', () => {
    const all = selectors(skinCss);
    expect(all.length).toBeGreaterThan(10);
    expect(all.filter((s) => !s.startsWith(SCOPE))).toEqual([]);
  });

  it('draws the background on a non-interactive fixed layer', () => {
    const rule = skinCss.match(/body::before\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain(`url('../../assets/${ASSET_FILE}')`);
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('pointer-events: none');
    expect(rule).not.toContain('background-attachment');
  });

  it('keeps a readable fallback when backdrop-filter is unsupported', () => {
    expect(skinCss).toContain('@supports not ((backdrop-filter');
  });

  it('only animates when motion is allowed', () => {
    const transitions = skinCss.match(/transition:/g) ?? [];
    expect(transitions.length).toBeGreaterThan(0);
    const reduced = skinCss.split('@media (prefers-reduced-motion: no-preference)')[1] ?? '';
    expect(reduced).toContain('transition:');
    expect(skinCss.split('@media (prefers-reduced-motion: no-preference)')[0]).not.toContain('transition:');
  });
});

describe('classic skin', () => {
  it('has no knowledge of the cosmic background or skin', () => {
    expect(baseCss).not.toContain('cosmic');
    expect(baseCss).not.toContain('.webp');
    expect(baseCss).not.toContain('data-skin');
  });
});

describe('production background asset', () => {
  it('is a WebP file of production size', () => {
    const bytes = readFileSync(assetPath);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(statSync(assetPath).size).toBeLessThan(400 * 1024);
  });
});
