import { describe, it, expect } from 'vitest';
import { parseBriefArgs } from './cli.js';
import { DEFAULT_MAX_CHARS } from './render.js';

describe('parseBriefArgs', () => {
  it('defaults to DEFAULT_MAX_CHARS and strict: false with no args', () => {
    expect(parseBriefArgs([])).toEqual({ ok: true, maxChars: DEFAULT_MAX_CHARS, strict: false });
  });

  it('parses --max-chars N', () => {
    expect(parseBriefArgs(['--max-chars', '1234'])).toEqual({ ok: true, maxChars: 1234, strict: false });
  });

  it('parses --strict', () => {
    expect(parseBriefArgs(['--strict'])).toEqual({ ok: true, maxChars: DEFAULT_MAX_CHARS, strict: true });
  });

  it('parses --strict --max-chars N together, in either order', () => {
    expect(parseBriefArgs(['--strict', '--max-chars', '500'])).toEqual({ ok: true, maxChars: 500, strict: true });
    expect(parseBriefArgs(['--max-chars', '500', '--strict'])).toEqual({ ok: true, maxChars: 500, strict: true });
  });

  it('rejects --max-chars with no value', () => {
    const result = parseBriefArgs(['--max-chars']);
    expect(result.ok).toBe(false);
  });

  it('rejects a non-integer --max-chars value', () => {
    expect(parseBriefArgs(['--max-chars', 'abc']).ok).toBe(false);
    expect(parseBriefArgs(['--max-chars', '12.5']).ok).toBe(false);
  });

  it('rejects a zero or negative --max-chars value', () => {
    expect(parseBriefArgs(['--max-chars', '0']).ok).toBe(false);
    expect(parseBriefArgs(['--max-chars', '-10']).ok).toBe(false);
  });

  it('rejects unknown flags', () => {
    const result = parseBriefArgs(['--bogus']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('--bogus');
  });

  it('rejects stray positional arguments', () => {
    expect(parseBriefArgs(['foo']).ok).toBe(false);
  });
});
