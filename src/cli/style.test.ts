import { describe, it, expect } from 'vitest';
import { colorEnabled, paint, statusWord, tintStatuses, wrapLine, wrapWidth } from './style.js';

const ANSI = /\u001b\[/;

describe('CLI-UX-001 semantic colour', () => {
  it('is enabled only for an interactive terminal without opt-outs', () => {
    expect(colorEnabled({ isTTY: true }, {})).toBe(true);
    expect(colorEnabled({ isTTY: false }, {})).toBe(false); // pipe / redirect
    expect(colorEnabled({}, {})).toBe(false);
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: 'anything' })).toBe(false);
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: '' })).toBe(true); // per no-color.org: empty = unset
    expect(colorEnabled({ isTTY: true }, { TERM: 'dumb' })).toBe(false);
  });

  it('maps statuses to the documented palette and keeps the word visible', () => {
    expect(statusWord('PASS', true)).toBe('\u001b[32mPASS\u001b[0m');
    expect(statusWord('FRESH', true)).toContain('[32m');
    expect(statusWord('UNKNOWN', true)).toContain('[33m');
    expect(statusWord('NOT_VERIFIED', true)).toContain('[33m');
    expect(statusWord('FAIL', true)).toContain('[31m');
    expect(statusWord('CONFLICT', true)).toContain('[31m');
    expect(statusWord('STALE', true)).toContain('[31m');
    expect(statusWord('UNCHANGED', true)).toContain('[90m');
    expect(paint('MONOLITH', 'head', true)).toContain('[1;35m');
    for (const w of ['PASS', 'FAIL', 'STALE', 'UNKNOWN']) expect(statusWord(w, true).replace(/\u001b\[[0-9;]*m/g, '')).toBe(w);
  });

  it('disabled style and unknown words are returned unchanged', () => {
    expect(statusWord('PASS', false)).toBe('PASS');
    expect(statusWord('whatever', true)).toBe('whatever');
    expect(paint('x', 'bad', false)).toBe('x');
  });

  it('tintStatuses is byte-identical when disabled and only touches status tokens when enabled', () => {
    const text = 'Freshness: STALE\nCompleteness: COMPLETE\n  [PASS] integrity: ok\n  [weird] x\nFAIL in the middle stays plain\n';
    expect(tintStatuses(text, false, ['Freshness', 'Completeness'])).toBe(text);
    const on = tintStatuses(text, true, ['Freshness', 'Completeness']);
    expect(on).toContain('Freshness: \u001b[31mSTALE');
    expect(on).toContain('Completeness: \u001b[32mCOMPLETE');
    expect(on).toContain('[\u001b[32mPASS');
    expect(on).toContain('[weird] x'); // unknown marker untouched
    expect(on).toContain('FAIL in the middle stays plain');
    expect(on.replace(/\u001b\[[0-9;]*m/g, '')).toBe(text);
  });

  it('plain output never contains ANSI', () => {
    expect(ANSI.test(tintStatuses('[FAIL] x\nFreshness: STALE', false, ['Freshness']))).toBe(false);
  });
});

describe('BETA-001 presentation helpers', () => {
  it('ADD and UPDATE are cyan, COMPLETE green, INCOMPLETE yellow, SKIP dim, CONFLICT red', () => {
    expect(statusWord('ADD', true)).toBe('\u001b[36mADD\u001b[0m');
    expect(statusWord('UPDATE', true)).toBe('\u001b[36mUPDATE\u001b[0m');
    expect(statusWord('COMPLETE', true)).toContain('[32m');
    expect(statusWord('INCOMPLETE', true)).toContain('[33m');
    expect(statusWord('SKIP', true)).toContain('[90m');
    expect(statusWord('CONFLICT', true)).toContain('[31m');
  });

  it('wrapWidth: only an interactive terminal wraps, clamped to 40..100; pipes never', () => {
    expect(wrapWidth({ isTTY: false }, {})).toBeUndefined();
    expect(wrapWidth({ isTTY: true, columns: 20 }, {})).toBe(40);
    expect(wrapWidth({ isTTY: true, columns: 300 }, {})).toBe(100);
    expect(wrapWidth({ isTTY: true, columns: 72 }, {})).toBe(72);
    expect(wrapWidth({ isTTY: true }, { COLUMNS: '60' })).toBe(60);
  });

  it('wrapLine: no width leaves the line whole; with width it wraps with a hanging indent and loses no text', () => {
    expect(wrapLine('a b c', undefined, '- ')).toBe('- a b c');
    const text = 'alpha beta gamma delta epsilon zeta eta theta';
    const out = wrapLine(text, 20, '- ', '  ');
    expect(out.split('\n').every((l) => l.length <= 20)).toBe(true);
    expect(out.split('\n').slice(1).every((l) => l.startsWith('  '))).toBe(true);
    expect(out.replace(/\n\s*|^- /g, ' ').trim().replace(/\s+/g, ' ')).toBe(text);
    const long = wrapLine('x'.repeat(50), 20, '', '');
    expect(long.split('\n').every((l) => l.length <= 20)).toBe(true);
    expect(long.replace(/\n/g, '')).toBe('x'.repeat(50));
  });
});
