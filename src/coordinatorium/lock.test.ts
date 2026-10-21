import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fork, type ChildProcess } from 'child_process';
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
}

interface WorkerMsg {
  type: string;
  [key: string]: unknown;
}

class Worker {
  readonly proc: ChildProcess;
  readonly messages: WorkerMsg[] = [];
  private readonly waiters: Array<{ pred: (m: WorkerMsg) => boolean; resolve: (m: WorkerMsg) => void }> = [];

  constructor(moduleDir: string, lockPath: string, timeoutMs: number, mode: string) {
    this.proc = fork(join(moduleDir, 'worker.mjs'), [lockPath, String(timeoutMs), mode], {
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
  return new Worker(moduleDir, lockPath, timeoutMs, mode);
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
