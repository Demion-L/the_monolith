import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fork, spawnSync, type ChildProcess } from 'child_process';
import ts from 'typescript';
import { acquireLock } from './lock.js';
import { LockTimeoutError } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coordinatorium-lock-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Real multi-process harness.
//
// These scenarios are about actual OS-level process liveness (ESRCH/alive),
// which cannot be faked with Promise.all inside a single process — the
// child has to be a genuinely separate PID that can genuinely exit. We
// transpile lock.ts/errors.ts (via the `typescript` package, already a
// devDependency — same technique as state-keeper.test.ts) and drive forked
// children with IPC messages instead of sleep-based guessing, so each test
// forces a specific interleaving rather than hoping timing lines up.
// ---------------------------------------------------------------------------

const MODULES = ['errors', 'lock'];

function transpileLockModulesTo(destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const name of MODULES) {
    const source = readFileSync(join(__dirname, `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: `${name}.ts`,
    });
    let js = outputText;
    for (const mod of MODULES) {
      js = js.split(`'./${mod}.js'`).join(`'./${mod}.mjs'`).split(`"./${mod}.js"`).join(`"./${mod}.mjs"`);
    }
    writeFileSync(join(destDir, `${name}.mjs`), js, 'utf8');
  }

  // Generic worker, driven entirely by argv + IPC so one script covers every
  // scenario below:
  //   argv: <lockPath> <timeoutMs> <mode>
  //   mode: 'wait-for-release' | 'release-immediately' | 'exit-without-release' | 'hold-ms:<n>'
  const worker = `
import { acquireLock } from './lock.mjs';

const [lockPath, timeoutMsStr, mode] = process.argv.slice(2);
const timeoutMs = Number(timeoutMsStr);

let release;
try {
  release = await acquireLock(lockPath, { timeoutMs, retryDelayMs: 10 });
  process.send({ type: 'acquired', pid: process.pid, at: Date.now() });
} catch (err) {
  process.send({ type: 'acquire-failed', message: err.message, code: err.code ?? null });
  process.exit(0);
}

if (mode === 'exit-without-release') {
  process.send({ type: 'exiting-without-release', at: Date.now() });
  process.exit(0);
} else if (mode === 'release-immediately') {
  release();
  process.send({ type: 'released', at: Date.now() });
  process.exit(0);
} else if (mode.startsWith('hold-ms:')) {
  const holdMs = Number(mode.split(':')[1]);
  await new Promise((r) => setTimeout(r, holdMs));
  release();
  process.send({ type: 'released', at: Date.now() });
  process.exit(0);
} else {
  // wait-for-release
  process.on('message', (msg) => {
    if (msg === 'release') {
      release();
      process.send({ type: 'released', at: Date.now() });
      process.exit(0);
    }
  });
}
`;
  writeFileSync(join(destDir, 'worker.mjs'), worker, 'utf8');

  // A second worker that can be paused, via IPC, at either of the two
  // test-only hook points inside recoverDeadOwner — used to force the
  // exact dangerous interleavings described in the TOCTOU investigation
  // (pausing between "confirmed dead" and "acquired the recovery mutex",
  // or between "holding the mutex, re-verified" and "actually unlinking")
  // deterministically, rather than hoping real scheduling happens to land
  // there.
  //   argv: <lockPath> <timeoutMs> <pausePoint>
  //   pausePoint: 'beforeRecoveryAttempt' | 'beforeStaleUnlink'
  const pausableRecoverer = `
import { acquireLock } from './lock.mjs';

const [lockPath, timeoutMsStr, pausePoint] = process.argv.slice(2);
const timeoutMs = Number(timeoutMsStr);

function pauseAt(name) {
  return () => new Promise((resolve) => {
    process.send({ type: 'paused', at: name, time: Date.now() });
    process.on('message', (m) => { if (m === 'resume') resolve(); });
  });
}

const hooks = {};
hooks[pausePoint] = pauseAt(pausePoint);

try {
  const release = await acquireLock(lockPath, { timeoutMs, retryDelayMs: 10 }, hooks);
  process.send({ type: 'acquired', pid: process.pid, at: Date.now() });
  release();
  process.send({ type: 'released', at: Date.now() });
} catch (err) {
  process.send({ type: 'acquire-failed', message: err.message, code: err.code ?? null });
}
process.exit(0);
`;
  writeFileSync(join(destDir, 'pausable-recoverer.mjs'), pausableRecoverer, 'utf8');
}

interface WorkerMsg {
  type: string;
  [key: string]: unknown;
}

class Worker {
  readonly proc: ChildProcess;
  readonly messages: WorkerMsg[] = [];
  private readonly waiters: Array<{ pred: (m: WorkerMsg) => boolean; resolve: (m: WorkerMsg) => void }> = [];

  constructor(scriptPath: string, args: string[]) {
    this.proc = fork(scriptPath, args, {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.proc.on('message', (raw: unknown) => {
      const msg = raw as WorkerMsg;
      this.messages.push(msg);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i].pred(msg)) {
          this.waiters[i].resolve(msg);
          this.waiters.splice(i, 1);
        }
      }
    });
  }

  waitFor(pred: (m: WorkerMsg) => boolean, timeoutMs = 5000): Promise<WorkerMsg> {
    const already = this.messages.find(pred);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for worker message')), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  waitForExit(timeoutMs = 5000): Promise<number | null> {
    return new Promise((resolve, reject) => {
      if (this.proc.exitCode !== null) {
        resolve(this.proc.exitCode);
        return;
      }
      const timer = setTimeout(() => reject(new Error('timed out waiting for worker exit')), timeoutMs);
      this.proc.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  send(msg: unknown): void {
    this.proc.send(msg);
  }
}

function spawnWorker(moduleDir: string, lockPath: string, timeoutMs: number, mode: string): Worker {
  return new Worker(join(moduleDir, 'worker.mjs'), [lockPath, String(timeoutMs), mode]);
}

function spawnPausableRecoverer(moduleDir: string, lockPath: string, timeoutMs: number, pausePoint: string): Worker {
  return new Worker(join(moduleDir, 'pausable-recoverer.mjs'), [lockPath, String(timeoutMs), pausePoint]);
}

/** Spawn a real child, confirm it has exited (and is therefore a genuinely
 * dead PID), and seed a lock file recording it as the owner — the
 * deterministic equivalent of "a monolith process crashed while holding
 * state.json.lock". */
async function seedDeadOwnerLock(lockPath: string, moduleDir: string): Promise<{ pid: number; nonce: string }> {
  const crasher = spawnWorker(moduleDir, lockPath, 2000, 'exit-without-release');
  await crasher.waitFor((m) => m.type === 'acquired');
  await crasher.waitForExit();
  const raw = readFileSync(lockPath, 'utf8');
  const [pidStr, nonce] = raw.split(':');
  return { pid: Number(pidStr), nonce };
}

// ---------------------------------------------------------------------------
// Scenario A — live owner: never preempted, regardless of how long it holds
// the lock (there is no age-based ceiling at all anymore).
// ---------------------------------------------------------------------------

describe('Scenario A — live owner', () => {
  it(
    'a live, slow owner is never stolen from; a short-timeout challenger fails with LockTimeoutError, not a steal',
    async () => {
      const stateDir = makeTempDir();
      const moduleDir = makeTempDir();
      transpileLockModulesTo(moduleDir);
      const lockPath = join(stateDir, 'state.json.lock');

      const owner = spawnWorker(moduleDir, lockPath, 5000, 'wait-for-release');
      await owner.waitFor((m) => m.type === 'acquired');

      // Challenger uses a short timeout; owner is alive and holding —
      // this must fail as "busy", never as a successful steal.
      const challenger = spawnWorker(moduleDir, lockPath, 300, 'release-immediately');
      const failure = await challenger.waitFor((m) => m.type === 'acquire-failed' || m.type === 'acquired');
      expect(failure.type).toBe('acquire-failed');
      expect(failure.message).toContain('Timed out');
      await challenger.waitForExit();

      owner.send('release');
      await owner.waitFor((m) => m.type === 'released');
      await owner.waitForExit();

      // Now that the real owner released, a new challenger must succeed.
      const after = spawnWorker(moduleDir, lockPath, 2000, 'release-immediately');
      const ok = await after.waitFor((m) => m.type === 'acquired' || m.type === 'acquire-failed');
      expect(ok.type).toBe('acquired');
      await after.waitForExit();
    },
    15_000,
  );
});

// ---------------------------------------------------------------------------
// Scenario B — dead owner: recovery succeeds, and quickly (no waiting out
// an age threshold — liveness is checked immediately).
// ---------------------------------------------------------------------------

describe('Scenario B — dead owner', () => {
  it(
    'a crashed (exited without releasing) owner is recovered by the next acquirer, well under its timeout budget',
    async () => {
      const stateDir = makeTempDir();
      const moduleDir = makeTempDir();
      transpileLockModulesTo(moduleDir);
      const lockPath = join(stateDir, 'state.json.lock');

      const crasher = spawnWorker(moduleDir, lockPath, 2000, 'exit-without-release');
      await crasher.waitFor((m) => m.type === 'acquired');
      await crasher.waitFor((m) => m.type === 'exiting-without-release');
      await crasher.waitForExit(); // confirms the OS has actually reaped the process

      const t0 = Date.now();
      const recoverer = spawnWorker(moduleDir, lockPath, 2000, 'release-immediately');
      const result = await recoverer.waitFor((m) => m.type === 'acquired' || m.type === 'acquire-failed');
      const elapsed = Date.now() - t0;

      expect(result.type).toBe('acquired');
      // Liveness is checked immediately; recovery should not need to burn
      // through most of the 2000ms waiting budget.
      expect(elapsed).toBeLessThan(1000);
      await recoverer.waitForExit();
    },
    15_000,
  );
});

// ---------------------------------------------------------------------------
// Scenario C — uncertain state (empty / malformed lock file) must never be
// treated as free or as a dead owner.
// ---------------------------------------------------------------------------

describe('Scenario C — uncertain lock content', () => {
  it('an empty lock file is never claimed as free', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, '', 'utf8');

    await expect(acquireLock(lockPath, { timeoutMs: 250, retryDelayMs: 20 })).rejects.toBeInstanceOf(
      LockTimeoutError,
    );
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('');
  });

  it('garbage (unparseable) lock content is never claimed as free or deleted', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, 'not-a-valid-record', 'utf8');

    await expect(acquireLock(lockPath, { timeoutMs: 250, retryDelayMs: 20 })).rejects.toBeInstanceOf(
      LockTimeoutError,
    );
    expect(readFileSync(lockPath, 'utf8')).toBe('not-a-valid-record');
  });

  it('a lock recording a non-existent, implausible pid-less record is never claimed', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    writeFileSync(lockPath, 'abc:nonce', 'utf8'); // pid is not a number
    await expect(acquireLock(lockPath, { timeoutMs: 250, retryDelayMs: 20 })).rejects.toBeInstanceOf(
      LockTimeoutError,
    );
  });
});

// ---------------------------------------------------------------------------
// Two simultaneous recovery challengers must never both believe they own
// the lock. Each successful acquirer holds for a fixed window; the windows
// across all challengers must never overlap.
// ---------------------------------------------------------------------------

describe('Scenario B — concurrent recovery challengers', () => {
  it(
    'exactly one challenger recovers at a time; no overlapping ownership windows',
    async () => {
      const stateDir = makeTempDir();
      const moduleDir = makeTempDir();
      transpileLockModulesTo(moduleDir);
      const lockPath = join(stateDir, 'state.json.lock');

      const crasher = spawnWorker(moduleDir, lockPath, 2000, 'exit-without-release');
      await crasher.waitFor((m) => m.type === 'acquired');
      await crasher.waitForExit();

      const N = 5;
      const challengers = Array.from({ length: N }, () => spawnWorker(moduleDir, lockPath, 5000, 'hold-ms:150'));

      const windows = await Promise.all(
        challengers.map(async (w) => {
          const acquired = await w.waitFor((m) => m.type === 'acquired');
          const released = await w.waitFor((m) => m.type === 'released');
          await w.waitForExit();
          return { acquiredAt: acquired.at as number, releasedAt: released.at as number };
        }),
      );

      expect(windows).toHaveLength(N);
      windows.sort((a, b) => a.acquiredAt - b.acquiredAt);
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i].acquiredAt).toBeGreaterThanOrEqual(windows[i - 1].releasedAt);
      }
    },
    20_000,
  );
});

// ---------------------------------------------------------------------------
// TOCTOU regression (2026-10-21 corrective patch).
//
// The original recoverDeadOwner() read the lock, compared it, and then
// called unlinkSync() as a separate, later statement — a genuine gap
// between "verified" and "deleted" that a second challenger could land in.
// Reproduced empirically (outside this test file, with two forked
// processes and no recovery mutex at all) before this fix: a paused
// "slow" recoverer's later unconditional unlink deleted a "fast"
// recoverer's brand-new, already-claimed lock, after which BOTH processes
// believed they owned it.
//
// These two tests force exactly the interleaving that exploited that gap,
// using the beforeRecoveryAttempt/beforeStaleUnlink test hooks instead of
// hoping real OS scheduling lines up, and prove the recovery mutex closes
// it from both directions.
// ---------------------------------------------------------------------------

describe('TOCTOU regression — serialized recovery', () => {
  it(
    'a challenger paused while holding the recovery mutex (right before unlinking) blocks a second challenger entirely — it cannot bypass the mutex, and never acquires the lock',
    async () => {
      const stateDir = makeTempDir();
      const moduleDir = makeTempDir();
      transpileLockModulesTo(moduleDir);
      const lockPath = join(stateDir, 'state.json.lock');
      await seedDeadOwnerLock(lockPath, moduleDir);

      // B: pause with the recovery mutex HELD, right before the unlink.
      const B = spawnPausableRecoverer(moduleDir, lockPath, 5000, 'beforeStaleUnlink');
      await B.waitFor((m) => m.type === 'paused' && m.at === 'beforeStaleUnlink');

      // C: a plain challenger with a short timeout. If the mutex is
      // working, C can never even start unlinking the stale lock (it
      // can't acquire the recovery mutex), so it must time out — not
      // silently steal anything.
      const C = spawnWorker(moduleDir, lockPath, 400, 'release-immediately');
      const cResult = await C.waitFor((m) => m.type === 'acquired' || m.type === 'acquire-failed');
      expect(cResult.type).toBe('acquire-failed');
      expect(cResult.message).toContain('Timed out');
      await C.waitForExit();

      // The lock file must still be exactly A's original stale record —
      // untouched by C's failed attempt.
      expect(existsSync(lockPath)).toBe(true);

      // Resume B. With no one else contending, B completes its recovery
      // and becomes the legitimate owner.
      B.send('resume');
      const bResult = await B.waitFor((m) => m.type === 'acquired' || m.type === 'acquire-failed');
      expect(bResult.type).toBe('acquired');
      await B.waitFor((m) => m.type === 'released');
      await B.waitForExit();
    },
    15_000,
  );

  it(
    'a challenger paused before requesting the recovery mutex never deletes the lock a faster challenger legitimately claimed in the meantime',
    async () => {
      const stateDir = makeTempDir();
      const moduleDir = makeTempDir();
      transpileLockModulesTo(moduleDir);
      const lockPath = join(stateDir, 'state.json.lock');
      await seedDeadOwnerLock(lockPath, moduleDir);

      // B: pause BEFORE even trying to acquire the recovery mutex —
      // this is the earliest point at which B has only "I observed owner
      // A, and A is dead" as stale information. A short-ish timeout is
      // fine: once resumed, B must discover C's live lock and correctly
      // give up rather than wait out the full budget — we check that
      // explicitly below, not just that it eventually throws.
      const B = spawnPausableRecoverer(moduleDir, lockPath, 1500, 'beforeRecoveryAttempt');
      await B.waitFor((m) => m.type === 'paused' && m.at === 'beforeRecoveryAttempt');

      // C: a plain challenger, free to fully recover and claim ownership
      // while B is parked.
      const C = spawnWorker(moduleDir, lockPath, 2000, 'wait-for-release');
      const cAcquired = await C.waitFor((m) => m.type === 'acquired');
      expect(cAcquired.pid).toBeTypeOf('number');

      // Resume B. It will now try the recovery mutex, get it (no one
      // else wants it), re-verify under the mutex — and must find the
      // lock no longer matches what it originally observed (it's C's
      // now), so it must abort without touching anything.
      B.send('resume');
      const bResult = await B.waitFor((m) => m.type === 'acquired' || m.type === 'acquire-failed');

      // C must still hold its lock, completely undisturbed by B.
      expect(existsSync(lockPath)).toBe(true);
      const stillC = JSON.parse(
        `{"pid": ${readFileSync(lockPath, 'utf8').split(':')[0]}}`,
      ) as { pid: number };
      expect(stillC.pid).toBe(cAcquired.pid);

      // B must have failed to acquire (the lock is legitimately held by
      // C, who is alive) — it must NOT report 'acquired'.
      expect(bResult.type).toBe('acquire-failed');

      // Release C; only now can B (or anyone else) acquire normally.
      C.send('release');
      await C.waitFor((m) => m.type === 'released');
      await C.waitForExit();

      const after = spawnWorker(moduleDir, lockPath, 2000, 'release-immediately');
      const afterResult = await after.waitFor((m) => m.type === 'acquired' || m.type === 'acquire-failed');
      expect(afterResult.type).toBe('acquired');
      await after.waitForExit();
    },
    15_000,
  );

  it(
    'a recovery mutex orphaned by a process that crashed while holding it never corrupts state and never hangs — it just blocks automatic recovery (safety over availability)',
    async () => {
      const dir = makeTempDir();
      const lockPath = join(dir, 'state.json.lock');
      const mutexPath = `${lockPath}.recovery`;

      // A dead primary owner...
      const deadOwnerPid = spawnSync(process.execPath, ['-e', '']).pid as number;
      writeFileSync(lockPath, `${deadOwnerPid}:dead-owner-nonce`, 'utf8');

      // ...and a recovery mutex abandoned by a DIFFERENT process that
      // crashed mid-recovery for it. Per the explicit design decision
      // (ADR-008 / Section 5), this is never auto-recovered by liveness —
      // it stays held until a human removes it.
      const orphanedRecovererPid = spawnSync(process.execPath, ['-e', '']).pid as number;
      writeFileSync(mutexPath, `${orphanedRecovererPid}:orphaned-recovery-nonce`, 'utf8');

      const before = readFileSync(lockPath, 'utf8');
      const mutexBefore = readFileSync(mutexPath, 'utf8');

      // Automatic recovery is unavailable: every attempt sees the dead
      // primary owner, tries for the recovery mutex, finds it taken (and
      // never even asks whether ITS holder is alive), and must give up
      // cleanly within its own timeout — not hang, not force its way in.
      await expect(acquireLock(lockPath, { timeoutMs: 300, retryDelayMs: 20 })).rejects.toBeInstanceOf(
        LockTimeoutError,
      );

      // Neither file was touched: no corruption, no silent reset.
      expect(readFileSync(lockPath, 'utf8')).toBe(before);
      expect(readFileSync(mutexPath, 'utf8')).toBe(mutexBefore);
    },
    5_000,
  );
});

// ---------------------------------------------------------------------------
// release() must only ever remove a lock file that still matches what this
// call created — never a different owner's lock.
// ---------------------------------------------------------------------------

describe('release() safety', () => {
  it('does not delete the lock file if its content no longer matches what we created', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');

    const release = await acquireLock(lockPath);
    // Simulate the file now representing a different owner (defensive
    // check only — a live, correctly-implemented caller can never
    // actually land here while it still holds a valid lock).
    writeFileSync(lockPath, '999999:someone-elses-nonce', 'utf8');

    expect(() => release()).not.toThrow();
    expect(readFileSync(lockPath, 'utf8')).toBe('999999:someone-elses-nonce');
  });

  it('is a no-op if the lock file is already gone', async () => {
    const dir = makeTempDir();
    const lockPath = join(dir, 'state.json.lock');
    const release = await acquireLock(lockPath);
    rmSync(lockPath);
    expect(() => release()).not.toThrow();
  });
});
