import { describe, it, expect } from 'vitest';
import { parseInitArgs } from './init-args.js';

describe('parseInitArgs', () => {
  it('accepts no arguments', () => {
    expect(parseInitArgs([])).toEqual({ ok: true, yes: false });
  });

  it('accepts --yes', () => {
    expect(parseInitArgs(['--yes'])).toEqual({ ok: true, yes: true });
  });

  it('accepts -y', () => {
    expect(parseInitArgs(['-y'])).toEqual({ ok: true, yes: true });
  });

  it('rejects an unknown positional argument with a non-ok result', () => {
    const result = parseInitArgs(['/tmp/some-scratch-dir']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('/tmp/some-scratch-dir');
      expect(result.message).toContain('no positional arguments');
    }
  });

  it('rejects a positional argument even when combined with --yes (the near-miss shape)', () => {
    // This is the exact invocation shape from LESSON-2026-0006:
    // `monolith init --yes <scratch-dir>` — the positional arg must never
    // be silently dropped.
    const result = parseInitArgs(['--yes', '/tmp/some-scratch-dir']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('/tmp/some-scratch-dir');
    }
  });

  it('rejects an unknown flag', () => {
    const result = parseInitArgs(['--force']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('--force');
    }
  });
});
