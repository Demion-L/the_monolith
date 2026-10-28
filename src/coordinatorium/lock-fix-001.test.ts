import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, linkSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import ts from 'typescript';
import {
  acquireLock,
  captureIdentity,
  formatLockRecord,
  MAX_LOCK_BYTES,
  judgeOwner,
  type LockRecord,
  type OwnerIdentity,
  type ProcOps,
} from './lock.js';
import { LockTimeoutError } from './errors.js';
import { readState, trustedDirectoryTarget } from './state-keeper.js';

// LOCK-FIX-001 — H1 (PID namespace / lost update) and M1 (recovery livelock).

const __dirname = dirname(fileURLToPath(import.meta.url));

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coordinatorium-lockfix-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const UUID_A = '11111111-2222-4333-8444-555555555555';
const UUID_B = '99999999-2222-4333-8444-555555555555';
const NS_A = 'pid:[4026531836]';
const NS_B = 'pid:[4026532944]';

/** A pid that existed and has exited. */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '0']).pid as number;
}

function record(pid: number, id: Partial<OwnerIdentity> = {}): LockRecord {
  return { pid, nonce: '0123456789abcdef', boot: UUID_A, pidns: NS_A, start: '100', ...id };
}

/** Fake `/proc` + `kill` for `judgeOwner`: `procs` maps pid → `/proc/<pid>/stat`
 * text; a pid absent from it is "no such process" for both oracles unless
 * `killSucceeds`/`killCode` says otherwise. */
function fakeProc(opts: {
  procs?: Record<number, { state?: string; start: string }>;
  kill?: Record<number, string | 'ok'>;
  ownPid?: number;
}): ProcOps {
  const procs = opts.procs ?? {};
  return {
    platform: 'linux',
    pid: opts.ownPid ?? 1,
    readText: (path) => {
      const m = /^\/proc\/(\d+)\/stat$/.exec(path);
      const p = m ? procs[Number(m[1])] : undefined;
      if (!p) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      // fields 4..21 (18 of them) sit between the state letter and the start time (field 22)
      const fill = Array.from({ length: 18 }, () => '0').join(' ');
      return `${m![1]} (we ird) name)) ${p.state ?? 'S'} ${fill} ${p.start} 0`;
    },
    readlink: () => {
      throw new Error('unused');
    },
    kill: (pid) => {
      const k = opts.kill?.[pid] ?? (procs[pid] ? 'ok' : 'ESRCH');
      if (k !== 'ok') throw Object.assign(new Error(k), { code: k });
    },
  };
}

const OURS: OwnerIdentity = { boot: UUID_A, pidns: NS_A, start: '7' };

// ---------------------------------------------------------------------------
// H1 — decision matrix (pure, no namespaces needed)
// ---------------------------------------------------------------------------

describe('H1 — judgeOwner: ESRCH alone is never proof of death', () => {
  it('same boot and PID namespace, absent from /proc and ESRCH: dead (two oracles agree)', () => {
    expect(judgeOwner(record(500), OURS, fakeProc({}))).toMatchObject({ verdict: 'dead', reason: 'absent-by-two-oracles' });
  });

  it('ANOTHER PID namespace: ESRCH and an absent /proc entry still give unknown', () => {
    const v = judgeOwner(record(500, { pidns: NS_B }), OURS, fakeProc({}));
    expect(v).toEqual({ verdict: 'unknown', reason: 'pidns-mismatch' });
  });

  it('another boot or host: unknown', () => {
    expect(judgeOwner(record(500, { boot: UUID_B }), OURS, fakeProc({})).verdict).toBe('unknown');
  });

  it('a record without boot or namespace identity: unknown', () => {
    expect(judgeOwner(record(500, { boot: null }), OURS, fakeProc({})).verdict).toBe('unknown');
    expect(judgeOwner(record(500, { pidns: null }), OURS, fakeProc({})).verdict).toBe('unknown');
  });

  it('we cannot identify ourselves (non-Linux, foreign /proc): unknown', () => {
    expect(judgeOwner(record(500), { boot: null, pidns: null, start: null }, fakeProc({})).verdict).toBe('unknown');
    const ours = captureIdentity({ ...fakeProc({}), platform: 'darwin' });
    expect(ours).toEqual({ boot: null, pidns: null, start: null });
    const foreignProc = captureIdentity({ ...fakeProc({}), platform: 'linux', readlink: () => '424242', pid: 7 });
    expect(foreignProc).toEqual({ boot: null, pidns: null, start: null });
  });

  it('PID reuse: the pid is alive but with a different start time: dead', () => {
    const procs = { 500: { start: '999' } };
    expect(judgeOwner(record(500, { start: '100' }), OURS, fakeProc({ procs })).reason).toBe('pid-reused');
    expect(judgeOwner(record(500, { start: '100' }), OURS, fakeProc({ procs })).verdict).toBe('dead');
  });

  it('same pid and start time: alive; unknown start time cannot rule out reuse: alive', () => {
    const procs = { 500: { start: '100' } };
    expect(judgeOwner(record(500), OURS, fakeProc({ procs })).verdict).toBe('alive');
    expect(judgeOwner(record(500, { start: null }), OURS, fakeProc({ procs })).verdict).toBe('alive');
  });

  it('EPERM means alive; zombie and disagreeing oracles mean unknown', () => {
    const procs = { 500: { start: '100' } };
    expect(judgeOwner(record(500), OURS, fakeProc({ procs, kill: { 500: 'EPERM' } })).verdict).toBe('alive');
    expect(judgeOwner(record(500), OURS, fakeProc({ procs: { 500: { start: '100', state: 'Z' } } })).verdict).toBe('unknown');
    // kill() says it exists, /proc says it does not (hidepid-like): not a death signal
    expect(judgeOwner(record(500), OURS, fakeProc({ kill: { 500: 'ok' } })).verdict).toBe('unknown');
    // /proc lists it, kill() says ESRCH
    expect(judgeOwner(record(500), OURS, fakeProc({ procs, kill: { 500: 'ESRCH' } })).verdict).toBe('unknown');
  });

  it('the same process is alive (a second attempt inside this process)', () => {
    expect(judgeOwner(record(1), OURS, fakeProc({ ownPid: 1 })).verdict).toBe('alive');
  });
});

// ---------------------------------------------------------------------------
// H1 — through acquireLock, deterministic fault injection (no namespace support needed)
// ---------------------------------------------------------------------------

describe('H1 — acquireLock with injected PID-namespace probes', () => {
  /** Probes of a process living in ANOTHER pid namespace on the same kernel: it has its own
   * namespace id, and the owner's pid does not exist in its /proc nor to kill(). */
  const otherNamespaceProbes = (): Partial<ProcOps> => ({
    platform: 'linux',
    readlink: (p: string) => {
      if (p === '/proc/self') return String(process.pid);
      if (p === '/proc/self/ns/pid') return NS_B;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    readText: (p: string) => {
      if (p === '/proc/sys/kernel/random/boot_id') return `${UUID_A}\n`;
      if (p === '/proc/self/stat') return fakeProc({ procs: { [process.pid]: { start: '7' } } }).readText(`/proc/${process.pid}/stat`);
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    kill: () => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    },
  });

  it('a LIVE owner from another namespace (pid invisible, ESRCH) is not recovered; the lock is untouched', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const body = formatLockRecord(record(424242, { pidns: NS_A, start: '100' }));
    writeFileSync(lockPath, body);

    const err = await acquireLock(lockPath, { timeoutMs: 300, retryDelayMs: 20 }, { procOps: otherNamespaceProbes() }).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect((err as Error).message).toMatch(/unknown \(pidns-mismatch\)/);
    expect(readFileSync(lockPath, 'utf8')).toBe(body);
  });

  it('control: the same dead owner IS recovered when we share its boot and namespace', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, formatLockRecord(record(deadPid(), captureIdentity())));
    const release = await acquireLock(lockPath, { timeoutMs: 2000, retryDelayMs: 10 });
    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('PID reuse: a recorded owner whose pid now belongs to a different process is recovered', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    // process.ppid is alive; claim the recorded owner started at tick 1, which it did not.
    writeFileSync(lockPath, formatLockRecord(record(process.ppid, { ...captureIdentity(), start: '1' })));
    const release = await acquireLock(lockPath, { timeoutMs: 2000, retryDelayMs: 10 });
    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('NO LEGACY: an old `pid:nonce` lock of a dead pid is never judged, never deleted', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const legacy = `${deadPid()}:deadbeefdeadbeef`;
    writeFileSync(lockPath, legacy);
    const err = await acquireLock(lockPath, { timeoutMs: 300, retryDelayMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect((err as Error).message).toMatch(/unrecognised format/);
    expect(readFileSync(lockPath, 'utf8')).toBe(legacy);
  });

  it('an unrecognised v:3 record or one with extra keys is not recovered either', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const body = JSON.stringify({ ...JSON.parse(formatLockRecord(record(deadPid(), captureIdentity()))), v: 3 });
    writeFileSync(lockPath, body);
    await expect(acquireLock(lockPath, { timeoutMs: 200, retryDelayMs: 20 })).rejects.toBeInstanceOf(LockTimeoutError);
    expect(readFileSync(lockPath, 'utf8')).toBe(body);
  });

  it('lock age is irrelevant: an old file of a non-provable owner survives', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const body = formatLockRecord(record(424242, { pidns: NS_B }));
    writeFileSync(lockPath, body);
    const { utimesSync } = await import('fs');
    utimesSync(lockPath, 1, 1); // 1970
    await expect(acquireLock(lockPath, { timeoutMs: 200, retryDelayMs: 20 })).rejects.toBeInstanceOf(LockTimeoutError);
    expect(readFileSync(lockPath, 'utf8')).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// M1 — recovery livelock
// ---------------------------------------------------------------------------

describe('M1 — a persistently failing unlink ends in a typed timeout', () => {
  it('times out at the deadline, is not a tight loop, and keeps the unlink error', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const body = formatLockRecord(record(deadPid(), captureIdentity()));
    writeFileSync(lockPath, body);

    let unlinkCalls = 0;
    const started = Date.now();
    const cpuBefore = process.cpuUsage();
    const err = await acquireLock(
      lockPath,
      { timeoutMs: 600, retryDelayMs: 20 },
      {
        unlinkLock: () => {
          unlinkCalls++;
          throw Object.assign(new Error('EACCES: permission denied, unlink'), { code: 'EACCES' });
        },
      },
    ).catch((e) => e);
    const elapsed = Date.now() - started;
    const cpuMs = (process.cpuUsage(cpuBefore).user + process.cpuUsage(cpuBefore).system) / 1000;

    expect(err).toBeInstanceOf(LockTimeoutError);
    expect((err as LockTimeoutError).code).toBe('LOCK_TIMEOUT');
    expect(elapsed).toBeGreaterThanOrEqual(550);
    expect(elapsed).toBeLessThan(1500);
    // Bounded backoff: with 20 ms doubling to a cap of 160 ms, 600 ms allows only a handful of attempts.
    expect(unlinkCalls).toBeGreaterThan(1);
    expect(unlinkCalls).toBeLessThan(15);
    expect(cpuMs).toBeLessThan(elapsed * 0.8);
    // The original cause is in the diagnostics, as message text and as `cause`.
    expect((err as Error).message).toMatch(/EACCES/);
    expect((err as Error).message).toMatch(/dead owner/);
    expect(((err as LockTimeoutError).lastFailure as NodeJS.ErrnoException).code).toBe('EACCES');
    expect((err as Error).cause).toBe((err as LockTimeoutError).lastFailure);
    // Nothing was removed.
    expect(readFileSync(lockPath, 'utf8')).toBe(body);
    expect(existsSync(`${lockPath}.recovery`)).toBe(false);
  }, 10_000);

  it('ENOENT from unlink (already gone) is still recovery, not a failure', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, formatLockRecord(record(deadPid(), captureIdentity())));
    const { unlinkSync } = await import('fs');
    const release = await acquireLock(
      lockPath,
      { timeoutMs: 2000, retryDelayMs: 10 },
      {
        unlinkLock: (p) => {
          unlinkSync(p);
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      },
    );
    release();
  });

  it('a recovery that keeps being aborted cannot outlive the deadline either (no `continue` bypass)', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const body = formatLockRecord(record(deadPid(), captureIdentity()));
    writeFileSync(lockPath, body);
    // The owner looks dead to the first probe of each attempt and alive to the re-check made under
    // the recovery mutex, so every recovery ends 'aborted' and nothing is ever removed.
    let kills = 0;
    const started = Date.now();
    const err = await acquireLock(
      lockPath,
      { timeoutMs: 400, retryDelayMs: 20 },
      {
        procOps: {
          kill: () => {
            if (kills++ % 2 === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
          },
        },
      },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect((err as Error).message).toMatch(/recovery aborted/);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(kills).toBeLessThan(40);
    expect(readFileSync(lockPath, 'utf8')).toBe(body);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// LOCK-FIX-002 — monotonic deadline, jitter, observed recovery, strict records
// ---------------------------------------------------------------------------

/** Deterministic clock: `sleep` is the only thing that advances it. */
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    hooks: {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    },
  };
}

describe('M1 — deadline is monotonic, backoff is bounded, jitter stays in range', () => {
  it('a wall-clock that jumps backwards neither extends nor shortens the wait', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, 'garbage, not a record'); // unknown owner: wait until the deadline
    const real = Date.now();
    let calls = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => real - 3_600_000 * ++calls);
    const started = performance.now();
    try {
      const err = await acquireLock(lockPath, { timeoutMs: 300, retryDelayMs: 10 }).catch((e) => e);
      expect(err).toBeInstanceOf(LockTimeoutError);
    } finally {
      spy.mockRestore();
    }
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(1500);
  });

  it('a wall-clock that jumps far forward does not cut the wait short', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, 'garbage, not a record');
    const real = Date.now();
    let calls = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => real + 3_600_000 * ++calls);
    const started = performance.now();
    try {
      await acquireLock(lockPath, { timeoutMs: 300, retryDelayMs: 10 }).catch((e) => e);
    } finally {
      spy.mockRestore();
    }
    expect(performance.now() - started).toBeGreaterThanOrEqual(250);
  });

  it('backoff doubles to a cap of 8 x base; jitter 0 gives half, jitter ~1 gives the full delay; last sleep is truncated to the time remaining', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, 'garbage');
    const lo = fakeClock();
    await acquireLock(lockPath, { timeoutMs: 1000, retryDelayMs: 20 }, { ...lo.hooks, random: () => 0 }).catch(() => undefined);
    // delays 20,40,80,160,160,...: half of each (jitter 0), then the remainder
    expect(lo.sleeps.slice(0, 6)).toEqual([10, 20, 40, 80, 80, 80]);
    expect(lo.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);

    const hi = fakeClock();
    await acquireLock(lockPath, { timeoutMs: 1000, retryDelayMs: 20 }, { ...hi.hooks, random: () => 0.999999 }).catch(() => undefined);
    expect(hi.sleeps[0]).toBeGreaterThan(19.9);
    expect(hi.sleeps[0]).toBeLessThanOrEqual(20);
    for (const ms of hi.sleeps) expect(ms).toBeLessThanOrEqual(160);
    // the total never overshoots the deadline: the last sleep is cut to what remains
    expect(hi.sleeps.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 3);
  });

  it('jitter sleeps always lie in [delay/2, delay] for arbitrary random values', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, 'garbage');
    const clock = fakeClock();
    let i = 0;
    const seq = [0.1, 0.9, 0.5, 0.0, 0.99, 0.3];
    await acquireLock(lockPath, { timeoutMs: 2000, retryDelayMs: 16 }, { ...clock.hooks, random: () => seq[i++ % seq.length]! }).catch(() => undefined);
    let delay = 16;
    for (const ms of clock.sleeps.slice(0, -1)) {
      expect(ms).toBeGreaterThanOrEqual(delay / 2);
      expect(ms).toBeLessThanOrEqual(delay);
      delay = Math.min(delay * 2, 128);
    }
  });

  it('timeoutMs 0: one attempt, no sleep, typed timeout', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, 'garbage');
    const clock = fakeClock();
    const err = await acquireLock(lockPath, { timeoutMs: 0, retryDelayMs: 25 }, clock.hooks).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect((err as Error).message).toMatch(/\(1 attempts\)/);
    expect(clock.sleeps.length).toBeLessThanOrEqual(1);
  });

  it('a huge timeout is not an infinite loop by itself: iterations are paced by the backoff', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, 'garbage');
    const clock = fakeClock();
    const err = await acquireLock(lockPath, { timeoutMs: 60_000, retryDelayMs: 25 }, { ...clock.hooks, random: () => 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    // at the 200 ms cap, 60 s allows at most ~300 attempts
    expect(clock.sleeps.length).toBeLessThan(320);
    expect(clock.sleeps.length).toBeGreaterThan(250);
  });
});

describe('M1 / CPU-spin — recovery is confirmed by observation, not by the absence of an exception', () => {
  it('an unlink that "succeeds" without effect is a failure: bounded attempts, typed timeout, lock untouched', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const body = formatLockRecord(record(deadPid(), captureIdentity()));
    writeFileSync(lockPath, body);
    const clock = fakeClock();
    let unlinks = 0;
    const err = await acquireLock(
      lockPath,
      { timeoutMs: 1000, retryDelayMs: 25 },
      { ...clock.hooks, random: () => 0.5, unlinkLock: () => { unlinks++; } },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect((err as Error).message).toMatch(/still present/);
    expect(unlinks).toBeGreaterThan(1);
    expect(unlinks).toBeLessThan(20); // paced by the backoff, not a spin
    expect(clock.sleeps.length).toBeGreaterThanOrEqual(unlinks - 1);
    expect(readFileSync(lockPath, 'utf8')).toBe(body);
    expect(existsSync(`${lockPath}.recovery`)).toBe(false);
  });

  it('a lock that keeps reappearing after every verified recovery still gets a wait at least every 4th iteration', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const pid = deadPid();
    const ident = captureIdentity();
    const fresh = (n: number): string =>
      formatLockRecord({ pid, nonce: n.toString(16).padStart(16, '0'), ...ident });
    writeFileSync(lockPath, fresh(1));
    const clock = fakeClock();
    let n = 1;
    let kept = 0;
    let unlinks = 0;
    const err = await acquireLock(
      lockPath,
      { timeoutMs: 500, retryDelayMs: 25 },
      {
        ...clock.hooks,
        random: () => 0,
        unlinkLock: (p) => {
          unlinks++;
          // Keep the old inode alive under another name so the replacement cannot reuse it,
          // then put a NEW dead owner's lock in its place.
          linkSync(p, `${p}.keep${kept++}`);
          unlinkSync(p);
          writeFileSync(p, fresh(++n));
        },
      },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    // Without the guard the fake clock would never advance (only sleep moves it) and this would hang.
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(unlinks).toBeGreaterThanOrEqual(clock.sleeps.length);
    expect(unlinks).toBeLessThanOrEqual(4 * clock.sleeps.length + 4);
  }, 20_000);

  it('a verified recovery lets the next iteration run immediately and acquire', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, formatLockRecord(record(deadPid(), captureIdentity())));
    const clock = fakeClock();
    const release = await acquireLock(lockPath, { timeoutMs: 2000, retryDelayMs: 25 }, clock.hooks);
    expect(clock.sleeps).toEqual([]); // no pause between a confirmed removal and the retry
    release();
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('H1 — strict record parsing and supporting probes', () => {
  const ident = (): OwnerIdentity => captureIdentity();
  const canonical = (pid: number): string => formatLockRecord(record(pid, ident()));

  it.each([
    ['trailing newline', (b: string) => `${b}\n`],
    ['padded with spaces', (b: string) => b.replace('{"v"', '{ "v"')],
    ['duplicate key (last wins in JSON.parse)', (b: string) => b.replace('"v":2,', '"v":2,"pid":1,')],
    ['reordered keys', (b: string) => { const o = JSON.parse(b); return JSON.stringify({ nonce: o.nonce, v: o.v, pid: o.pid, boot: o.boot, pidns: o.pidns, start: o.start }); }],
    ['__proto__ key', (b: string) => b.replace('"v":2,', '"__proto__":{"x":1},"v":2,')],
  ])('a dead owner\'s record that is not byte-canonical (%s) is unknown: never recovered, never deleted', async (_name, mutate) => {
    if (typeof ident().boot !== 'string') return; // identity unavailable here: covered by the injected-probe tests
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const body = mutate(canonical(deadPid()));
    writeFileSync(lockPath, body);
    const err = await acquireLock(lockPath, { timeoutMs: 250, retryDelayMs: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect(readFileSync(lockPath, 'utf8')).toBe(body);
  });

  it('the largest possible record still fits MAX_LOCK_BYTES', () => {
    const worst = formatLockRecord({
      pid: 2 ** 31 - 1,
      nonce: 'ffffffffffffffff',
      boot: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      pidns: 'pid:[18446744073709551615]',
      start: '18446744073709551615',
    });
    expect(Buffer.byteLength(worst)).toBeLessThanOrEqual(MAX_LOCK_BYTES);
  });

  it('no /proc at all (boot_id unreadable): we cannot identify ourselves, so nothing is judged dead', () => {
    const noProc: ProcOps = {
      platform: 'linux',
      pid: 1,
      readText: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      readlink: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      kill: () => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); },
    };
    const ours = captureIdentity(noProc);
    expect(ours).toEqual({ boot: null, pidns: null, start: null });
    expect(judgeOwner(record(4242), ours, noProc)).toEqual({ verdict: 'unknown', reason: 'no-local-identity' });
  });

  it('/proc entry hidden (ENOENT) while kill() says the process exists: sources disagree, unknown', () => {
    const ops = fakeProc({ kill: { 4242: 'ok' } });
    expect(judgeOwner(record(4242), OURS, ops)).toEqual({ verdict: 'unknown', reason: 'oracle-disagreement' });
  });

  it('an unreadable /proc/<pid>/stat (EACCES) is not a death signal', () => {
    const ops = fakeProc({ kill: { 4242: 'ok' } });
    ops.readText = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
    expect(judgeOwner(record(4242), OURS, ops).verdict).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// H1 — real PID namespaces (skipped, loudly, when `unshare` cannot be used)
// ---------------------------------------------------------------------------

const MODULES = ['types', 'errors', 'lock', 'state-keeper', 'mission'];

function transpileTo(destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };
  const t = (file: string, name: string) =>
    ts.transpileModule(readFileSync(join(__dirname, '..', file), 'utf8'), { compilerOptions, fileName: name }).outputText;
  writeFileSync(
    join(destDir, 'root.mjs'),
    t('root/index.ts', 'index.ts').split(`'./safe-write.js'`).join(`'./safe-write.mjs'`).split(`'./write-artifacts.js'`).join(`'./write-artifacts.mjs'`),
  );
  writeFileSync(join(destDir, 'safe-write.mjs'), t('root/safe-write.ts', 'safe-write.ts'));
  writeFileSync(join(destDir, 'write-artifacts.mjs'), t('root/write-artifacts.ts', 'write-artifacts.ts'));
  for (const name of MODULES) {
    let js = t(`coordinatorium/${name}.ts`, `${name}.ts`).split(`'../root/index.js'`).join(`'./root.mjs'`);
    for (const mod of MODULES) js = js.split(`'./${mod}.js'`).join(`'./${mod}.mjs'`);
    writeFileSync(join(destDir, `${name}.mjs`), js);
  }
  // Both workers run a real mutateState that registers a mission, computing its ID from the
  // state read INSIDE the critical section (as startMission does), and record when they
  // entered/left that section. argv: <stateDir> <markerPrefix> <holdMs> <timeoutMs>
  writeFileSync(
    join(destDir, 'mutator.mjs'),
    `
import { writeFileSync } from 'fs';
import { mutateState, trustedDirectoryTarget } from './state-keeper.mjs';
const [stateDir, prefix, holdMs, timeoutMs] = process.argv.slice(2);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
try {
  const { result } = await mutateState(trustedDirectoryTarget(stateDir), (draft) => {
    writeFileSync(prefix + '.entered', String(Date.now()));
    const id = 'MIS-' + String(Object.keys(draft.tactical.missions).length + 1).padStart(4, '0');
    sleepSync(Number(holdMs));
    draft.tactical.missions[id] = { id, title: prefix, system: 's', status: 'in_progress', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), summary: null };
    writeFileSync(prefix + '.left', String(Date.now()));
    return id;
  }, { timeoutMs: Number(timeoutMs), retryDelayMs: 10 });
  process.stdout.write(JSON.stringify({ ok: true, id: result }));
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, code: err.code ?? null, message: err.message }));
}
`,
  );
}

function run(cmd: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    // External timeout: a hung child must fail the test, not hang the suite.
    const killer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ code, stdout, stderr });
    });
  });
}

const UNSHARE = ['-Urpf', '--mount-proc'];
const unshareUsable =
  process.platform === 'linux' &&
  spawnSync('unshare', [...UNSHARE, 'true'], { timeout: 5000 }).status === 0;
if (!unshareUsable) {
  // eslint-disable-next-line no-console
  console.warn('SKIP: LOCK-FIX-001 real PID-namespace test — `unshare -Urpf --mount-proc` is unavailable here. The fault-injection tests above still cover H1.');
}

describe.skipIf(!unshareUsable)('H1 — two processes, different PID namespaces, one project (real mutateState)', () => {
  it('the second process waits for the first: no overlap, no lost update, no duplicate mission id', async () => {
    const stateDir = makeTempDir();
    const moduleDir = makeTempDir();
    const markers = makeTempDir();
    transpileTo(moduleDir);
    const script = join(moduleDir, 'mutator.mjs');

    // Holder: host PID namespace, sits inside the critical section for 1.5 s.
    const holder = run(process.execPath, [script, stateDir, join(markers, 'holder'), '1500', '5000']);
    const t0 = Date.now();
    while (!existsSync(join(markers, 'holder.entered'))) {
      if (Date.now() - t0 > 10_000) throw new Error('holder never entered the critical section');
      await new Promise((r) => setTimeout(r, 10));
    }

    // Challenger: a NEW PID namespace (own /proc). From there the holder's pid does not exist.
    const challenger = await run('unshare', [...UNSHARE, process.execPath, script, stateDir, join(markers, 'challenger'), '0', '8000']);
    const h = await holder;

    expect(JSON.parse(h.stdout)).toMatchObject({ ok: true, id: 'MIS-0001' });
    expect(JSON.parse(challenger.stdout), challenger.stderr).toMatchObject({ ok: true, id: 'MIS-0002' });

    // Mutual exclusion: the challenger entered only after the holder had left.
    const holderLeft = Number(readFileSync(join(markers, 'holder.left'), 'utf8'));
    const challengerEntered = Number(readFileSync(join(markers, 'challenger.entered'), 'utf8'));
    expect(challengerEntered).toBeGreaterThanOrEqual(holderLeft);

    // Both writes survive.
    const state = await readState(trustedDirectoryTarget(stateDir));
    expect(Object.keys(state.tactical.missions).sort()).toEqual(['MIS-0001', 'MIS-0002']);
    expect(state.revision).toBe(2);
  }, 40_000);

  it('a challenger with a short timeout gets LockTimeoutError and never enters', async () => {
    const stateDir = makeTempDir();
    const moduleDir = makeTempDir();
    const markers = makeTempDir();
    transpileTo(moduleDir);
    const script = join(moduleDir, 'mutator.mjs');

    const holder = run(process.execPath, [script, stateDir, join(markers, 'holder'), '2000', '5000']);
    const t0 = Date.now();
    while (!existsSync(join(markers, 'holder.entered'))) {
      if (Date.now() - t0 > 10_000) throw new Error('holder never entered the critical section');
      await new Promise((r) => setTimeout(r, 10));
    }
    const challenger = await run('unshare', [...UNSHARE, process.execPath, script, stateDir, join(markers, 'challenger'), '0', '500']);
    await holder;

    expect(JSON.parse(challenger.stdout)).toMatchObject({ ok: false, code: 'LOCK_TIMEOUT' });
    expect(existsSync(join(markers, 'challenger.entered'))).toBe(false);
    const state = await readState(trustedDirectoryTarget(stateDir));
    expect(Object.keys(state.tactical.missions)).toEqual(['MIS-0001']);
  }, 40_000);
});

// ---------------------------------------------------------------------------
// LOCK-FIX-002 — several real writers in one namespace, and SIGKILL of the owner
// ---------------------------------------------------------------------------

describe('real processes, one PID namespace (real mutateState)', () => {
  it('four concurrent writers: every update survives, ids are unique, critical sections never overlap', async () => {
    const stateDir = makeTempDir();
    const moduleDir = makeTempDir();
    const markers = makeTempDir();
    transpileTo(moduleDir);
    const script = join(moduleDir, 'mutator.mjs');
    const names = ['w1', 'w2', 'w3', 'w4'];
    const results = await Promise.all(names.map((n) => run(process.execPath, [script, stateDir, join(markers, n), '60', '20000'])));
    const ids = results.map((r) => JSON.parse(r.stdout) as { ok: boolean; id?: string });
    expect(ids.every((r) => r.ok), results.map((r) => r.stdout + r.stderr).join('|')).toBe(true);
    expect(new Set(ids.map((r) => r.id)).size).toBe(4);
    const spans = names
      .map((n) => [Number(readFileSync(join(markers, `${n}.entered`), 'utf8')), Number(readFileSync(join(markers, `${n}.left`), 'utf8'))] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBeGreaterThanOrEqual(spans[i - 1]![1]);
    const state = await readState(trustedDirectoryTarget(stateDir));
    expect(Object.keys(state.tactical.missions).sort()).toEqual(['MIS-0001', 'MIS-0002', 'MIS-0003', 'MIS-0004']);
    expect(state.revision).toBe(4);
  }, 60_000);

  it('an owner SIGKILLed inside its critical section is recovered by the next writer (same namespace)', async () => {
    if (captureIdentity().boot === null) return; // no verifiable identity here: recovery is deliberately off
    const stateDir = makeTempDir();
    const moduleDir = makeTempDir();
    const markers = makeTempDir();
    transpileTo(moduleDir);
    const script = join(moduleDir, 'mutator.mjs');
    const victim = spawn(process.execPath, [script, stateDir, join(markers, 'victim'), '60000', '5000'], { stdio: 'ignore' });
    const t0 = Date.now();
    while (!existsSync(join(markers, 'victim.entered'))) {
      if (Date.now() - t0 > 10_000) throw new Error('victim never entered the critical section');
      await new Promise((r) => setTimeout(r, 10));
    }
    victim.kill('SIGKILL');
    await new Promise((r) => victim.once('close', r));
    const next = await run(process.execPath, [script, stateDir, join(markers, 'next'), '0', '10000']);
    expect(JSON.parse(next.stdout), next.stderr).toMatchObject({ ok: true, id: 'MIS-0001' });
    const state = await readState(trustedDirectoryTarget(stateDir));
    expect(Object.keys(state.tactical.missions)).toEqual(['MIS-0001']);
  }, 40_000);
});
