import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { acquireLock, type LockOptions } from './lock.js';
import { LockTimeoutError, ValidationError } from './errors.js';

// LOCK-FIX-002 F-1 — option validation: a bad or `undefined` option must never
// turn the bounded wait into an unbounded one.

const tempDirs: string[] = [];
function lockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coordinatorium-lockopts-'));
  tempDirs.push(dir);
  return join(dir, 'state.json.lock');
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

/** Settles within `ms`, or fails the test instead of hanging it on a regression. */
async function settle(p: Promise<unknown>, ms = 3000): Promise<{ ok: true } | { err: unknown }> {
  let timer: NodeJS.Timeout | undefined;
  const hang = new Promise<'hang'>((r) => (timer = setTimeout(() => r('hang'), ms)));
  try {
    const r = await Promise.race([p.then(() => 'ok' as const, (err: unknown) => ({ err })), hang]);
    if (r === 'hang') throw new Error(`acquireLock did not settle within ${ms}ms (unbounded wait)`);
    return r === 'ok' ? { ok: true } : r;
  } finally {
    clearTimeout(timer);
  }
}

describe('acquireLock option validation (F-1)', () => {
  it.each([
    ['timeoutMs: undefined', { timeoutMs: undefined }],
    ['retryDelayMs: undefined', { retryDelayMs: undefined }],
    ['both undefined', { timeoutMs: undefined, retryDelayMs: undefined }],
  ] as [string, LockOptions][])('%s uses the default and acquires a free lock', async (_n, opts) => {
    const p = lockPath();
    const r = await settle(acquireLock(p, opts).then((release) => release()));
    expect(r).toEqual({ ok: true });
  });

  it.each([
    ['timeoutMs: undefined', { timeoutMs: undefined, retryDelayMs: 5 }],
    ['retryDelayMs: undefined', { timeoutMs: 100, retryDelayMs: undefined }],
  ] as [string, LockOptions][])('%s on a held lock ends in a typed timeout, not a hang', async (_n, opts) => {
    const p = lockPath();
    const release = await acquireLock(p, { timeoutMs: 100 });
    try {
      // `timeoutMs: undefined` gets the 5000 ms default; stay well inside the guard.
      const r = await settle(acquireLock(p, opts), opts.timeoutMs === undefined ? 8000 : 3000);
      expect('err' in r && r.err).toBeInstanceOf(LockTimeoutError);
    } finally {
      release();
    }
  }, 15000);

  it.each([
    ['timeoutMs: NaN', { timeoutMs: NaN }],
    ['timeoutMs: Infinity', { timeoutMs: Infinity }],
    ['timeoutMs: -Infinity', { timeoutMs: -Infinity }],
    ['timeoutMs: -1', { timeoutMs: -1 }],
    ['retryDelayMs: NaN', { retryDelayMs: NaN }],
    ['retryDelayMs: Infinity', { retryDelayMs: Infinity }],
    ['retryDelayMs: -Infinity', { retryDelayMs: -Infinity }],
    ['retryDelayMs: -1', { retryDelayMs: -1 }],
    ['timeoutMs: non-number', { timeoutMs: '100' as unknown as number }],
    ['retryDelayMs: null', { retryDelayMs: null as unknown as number }],
  ] as [string, LockOptions][])('%s is rejected with ValidationError before any lock is touched', async (_n, opts) => {
    const p = lockPath();
    const r = await settle(acquireLock(p, opts));
    expect('err' in r && r.err).toBeInstanceOf(ValidationError);
    // Nothing was acquired: a normal acquire succeeds immediately.
    expect(await settle(acquireLock(p, { timeoutMs: 100 }).then((rel) => rel()))).toEqual({ ok: true });
  });

  it('timeoutMs: 0 keeps its semantics: one attempt, then a typed timeout', async () => {
    const p = lockPath();
    const release = await acquireLock(p);
    try {
      const r = await settle(acquireLock(p, { timeoutMs: 0 }));
      expect('err' in r && r.err).toBeInstanceOf(LockTimeoutError);
    } finally {
      release();
    }
    // ...and on a free lock it still acquires.
    expect(await settle(acquireLock(p, { timeoutMs: 0 }).then((rel) => rel()))).toEqual({ ok: true });
  });

  it('retryDelayMs: 0 is accepted and does not busy-loop (floored to 1 ms)', async () => {
    const p = lockPath();
    const release = await acquireLock(p);
    try {
      const t = performance.now();
      const r = await settle(acquireLock(p, { timeoutMs: 60, retryDelayMs: 0 }));
      expect('err' in r && r.err).toBeInstanceOf(LockTimeoutError);
      expect(performance.now() - t).toBeGreaterThanOrEqual(55);
    } finally {
      release();
    }
  });

  it('concurrent acquirers with valid options are mutually exclusive and all finish', async () => {
    const p = lockPath();
    let inside = 0;
    let maxInside = 0;
    const worker = async (): Promise<void> => {
      const release = await acquireLock(p, { timeoutMs: 5000, retryDelayMs: 2 });
      inside++;
      maxInside = Math.max(maxInside, inside);
      await new Promise((r) => setTimeout(r, 5));
      inside--;
      release();
    };
    const r = await settle(Promise.all(Array.from({ length: 6 }, worker)), 10000);
    expect(r).toEqual({ ok: true });
    expect(maxInside).toBe(1);
  }, 15000);
});
