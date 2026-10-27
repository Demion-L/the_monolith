/**
 * DURABLE-FIX-001 — regression tests that need REAL OS processes: races that a single event loop cannot
 * produce (D-1 across processes, D-7 prune vs. child creation). Interleavings are forced with file barriers,
 * never with sleeps that the assertion depends on.
 *
 * Same technique as process.test.ts: the library is transpiled once into a temp directory and the
 * children import that copy.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import ts from 'typescript';
import { DurableTasks } from './runtime.js';
import { FsEventStore } from './fs-store.js';

const initStore = (s: FsEventStore): FsEventStore => (s.initializeProtocolSync(), s);

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');
let build: string;
const dirs: string[] = [];
const kids: ChildProcess[] = [];

function compileTree(from: string, to: string): void {
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, e.name);
    if (e.isDirectory()) {
      compileTree(src, join(to, e.name));
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      mkdirSync(to, { recursive: true });
      const out = ts.transpileModule(readFileSync(src, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      writeFileSync(join(to, e.name.replace(/\.ts$/, '.js')), out.outputText);
    }
  }
}

const CHILD = `
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DurableTasks, FsEventStore } from './durable/index.js';

const [dir, mode, ctl, id, extra] = process.argv.slice(2);
const inner = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
const touch = (name) => writeFileSync(join(ctl, name), '');
const has = (name) => existsSync(join(ctl, name));
const until = async (pred, ms = 15000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('barrier timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const gate = async (signal, release) => { touch(signal); await until(() => has(release)); };

// A store that waits at the boundaries named by the test. It works against the old store too (no markPruned/pins).
const store = {
  readLog: (...a) => inner.readLog(...a),
  append: (...a) => inner.append(...a),
  listTaskIds: () => inner.listTaskIds(),
  compact: (...a) => inner.compact(...a),
  sweepCompacted: (...a) => inner.sweepCompacted(...a),
  prune: async (t) => {
    if (!inner.markPruned) await gate('prune-reached', 'go-prune'); // old store: the single commit point
    return inner.prune(t);
  },
};
if (inner.markPruned) {
  store.markPruned = async (t) => {
    await gate('prune-reached', 'go-prune');
    await inner.markPruned(t);
    await gate('marked', 'go-scan');
  };
  store.withdrawTombstone = (...a) => inner.withdrawTombstone(...a);
  store.listReferences = (...a) => inner.listReferences(...a);
  store.pinReference = async (...a) => {
    const r = await inner.pinReference(...a);
    if (mode === 'create-child' && extra === 'gate-after-pin') await gate('pinned', 'go-publish');
    return r;
  };
}
const rt = new DurableTasks({ store });
const say = (s) => process.stdout.write(s + '\\n');

if (mode === 'effect-race') {
  // Both processes hold the SAME fence (extra = fence JSON) and call runEffect at the same moment.
  const fence = JSON.parse(extra);
  touch('ready.' + id);
  await until(() => has('ready.0') && has('ready.1'));
  try {
    const out = await rt.runEffect(fence, 'pay-1', async () => {
      touch('exec.' + id);
      touch('entered.' + id);
      // stay inside fn until the peer has been in fn too (the defect) or the parent released us
      await until(() => has('entered.' + (id === '0' ? '1' : '0')) || has('release'));
      return { by: id };
    }, { description: 'pay' });
    say('RESULT OK replayed=' + out.replayed);
  } catch (e) {
    say('RESULT ' + (e.code ?? e.name));
  }
} else if (mode === 'effect-crash') {
  // claim, announce an effect, start it, and block forever inside fn (the parent SIGKILLs us there)
  const fence = await rt.claim('job1', { owner: 'worker-a', leaseMs: 300 });
  touch('claimed');
  await rt.runEffect(fence, 'charge', async () => {
    touch('exec.crashing');
    touch('entered.crashing');
    await new Promise(() => {});
  }, { description: 'charge' });
} else if (mode === 'prune') {
  try {
    await rt.pruneTask(id, { terminalRetentionMs: 0 });
    say('RESULT PRUNED');
  } catch (e) {
    say('RESULT ' + (e.code ?? e.name));
  }
} else if (mode === 'create-child') {
  try {
    const r = await rt.createTask({ taskId: id, kind: 'k', goal: 'g', parentTaskId: 'P' });
    say('RESULT OK created=' + r.created);
  } catch (e) {
    say('RESULT ' + (e.code ?? e.name));
  }
} else if (mode === 'effect-takeover') {
  const fence = await rt.claim('job1', { owner: 'worker-b' });
  try {
    await rt.runEffect(fence, 'charge', async () => {
      touch('exec.takeover');
      return { again: true };
    }, { description: 'charge' });
    say('RESULT OK');
  } catch (e) {
    say('RESULT ' + (e.code ?? e.name));
  }
}
`;

beforeAll(() => {
  build = mkdtempSync(join(tmpdir(), 'durable-fix-build-'));
  writeFileSync(join(build, 'package.json'), '{"type":"module"}');
  compileTree(join(srcRoot, 'durable'), join(build, 'durable'));
  compileTree(join(srcRoot, 'root'), join(build, 'root'));
  writeFileSync(join(build, 'child.mjs'), CHILD);
});

afterAll(() => rmSync(build, { recursive: true, force: true }));
afterEach(() => {
  for (const k of kids.splice(0)) if (k.exitCode === null && k.signalCode === null) k.kill('SIGKILL');
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const tmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
const openRt = (dir: string): DurableTasks => new DurableTasks({ store: initStore(new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' })) });

interface Child {
  proc: ChildProcess;
  lines: string[];
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Resolves with the first line that starts with `prefix`. */
  line: (prefix: string) => Promise<string>;
}
function spawnChild(args: string[]): Child {
  const proc = spawn(process.execPath, [join(build, 'child.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  kids.push(proc);
  const lines: string[] = [];
  const waiters: Array<{ prefix: string; resolve: (l: string) => void }> = [];
  let buf = '';
  let stderr = '';
  proc.stdout!.on('data', (d) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      lines.push(l);
      for (const w of [...waiters]) if (l.startsWith(w.prefix)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(l));
    }
  });
  proc.stderr!.on('data', (d) => (stderr += d));
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    proc.on('close', (code, signal) => {
      if (code && stderr) lines.push(`STDERR ${stderr.slice(0, 500)}`);
      resolve({ code, signal });
    }),
  );
  return {
    proc,
    lines,
    done,
    line: (prefix) =>
      new Promise((resolve, reject) => {
        const hit = lines.find((l) => l.startsWith(prefix));
        if (hit) return resolve(hit);
        waiters.push({ prefix, resolve });
        void done.then(() => reject(new Error(`child exited before printing "${prefix}": ${lines.join(' | ')}`)));
      }),
  };
}
async function waitFor(pred: () => boolean, ms = 15_000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for a condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const execCount = (ctl: string): number => readdirSync(ctl).filter((n) => n.startsWith('exec.')).length;

describe('D-1 across real processes', () => {
  it('two processes holding one fence and calling runEffect together: fn runs in exactly one of them', async () => {
    const dir = tmp('durable-d1-');
    const ctl = tmp('durable-d1-ctl-');
    const rt = openRt(dir);
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const fence = await rt.claim('job1', { owner: 'shared-owner' });

    const a = spawnChild([dir, 'effect-race', ctl, '0', JSON.stringify(fence)]);
    const b = spawnChild([dir, 'effect-race', ctl, '1', JSON.stringify(fence)]);
    // The first RESULT to appear is the refused caller (on the defective code nobody finishes until both
    // are inside fn, which releases them). Releasing the winner after that is deterministic.
    await Promise.race([a.line('RESULT'), b.line('RESULT')]);
    writeFileSync(join(ctl, 'release'), '');
    await Promise.all([a.done, b.done]);

    const results = [...a.lines, ...b.lines].filter((l) => l.startsWith('RESULT'));
    expect(results).toHaveLength(2);
    expect(execCount(ctl)).toBe(1);
    expect(results.filter((l) => l.startsWith('RESULT OK'))).toHaveLength(1);
    expect(results.filter((l) => /RESULT EFFECT_(CONFLICT|IN_DOUBT)/.test(l))).toHaveLength(1);

    const log = await openRt(dir).getLog('job1');
    expect(log.events.filter((e) => e.type === 'effect.intended')).toHaveLength(1);
    expect(log.events.filter((e) => e.type === 'effect.completed')).toHaveLength(1);
    expect((await openRt(dir).verify('job1'))[0]).toMatchObject({ ok: true });
  }, 60_000);

  it('a process killed inside fn, then a new owner: the effect is in doubt and fn is not run again', async () => {
    const dir = tmp('durable-d1-');
    const ctl = tmp('durable-d1-ctl-');
    await openRt(dir).createTask({ taskId: 'job1', kind: 'k', goal: 'g' });

    const first = spawnChild([dir, 'effect-crash', ctl, 'a']);
    await waitFor(() => existsSync(join(ctl, 'entered.crashing')));
    first.proc.kill('SIGKILL');
    await first.done;
    await new Promise((r) => setTimeout(r, 400)); // the 300 ms lease of the dead worker runs out

    const second = spawnChild([dir, 'effect-takeover', ctl, 'b']);
    await second.done;
    expect(second.lines.find((l) => l.startsWith('RESULT'))).toBe('RESULT EFFECT_IN_DOUBT');
    expect(execCount(ctl)).toBe(1);

    const state = await openRt(dir).getState('job1');
    expect(state.effects['charge']).toMatchObject({ status: 'intended', intendedEpoch: 1 });
    const a = await openRt(dir).assess('job1');
    expect(a.mode).toBe('recovery');
    expect(a.reasons.map((r) => r.code)).toContain('EFFECT_IN_DOUBT');
  }, 60_000);
});

describe('D-7 across real processes', () => {
  async function finishedParent(dir: string): Promise<DurableTasks> {
    const rt = openRt(dir);
    await rt.createTask({ taskId: 'P', kind: 'k', goal: 'g' });
    const f = await rt.claim('P', { owner: 'w' });
    await rt.complete(f, { r: 1 });
    return rt;
  }
  const exists = (ctl: string, name: string): boolean => existsSync(join(ctl, name));

  it('a child created in full by another process between the prune check and the removal is not orphaned', async () => {
    const dir = tmp('durable-d7-');
    const ctl = tmp('durable-d7-ctl-');
    const rt = await finishedParent(dir);

    const pruner = spawnChild([dir, 'prune', ctl, 'P']);
    await waitFor(() => exists(ctl, 'prune-reached')); // the pruner has decided and is about to commit
    const creator = spawnChild([dir, 'create-child', ctl, 'C']);
    expect(await creator.line('RESULT')).toBe('RESULT OK created=true'); // the whole creation happens inside the window
    writeFileSync(join(ctl, 'go-prune'), '');
    writeFileSync(join(ctl, 'go-scan'), '');
    const verdict = await pruner.line('RESULT');
    await Promise.all([pruner.done, creator.done]);

    expect(verdict).toBe('RESULT RETENTION_REFUSED');
    const fresh = openRt(dir);
    expect((await fresh.getState('P')).status).toBe('completed'); // parent still there
    expect((await fresh.getState('C'))).toMatchObject({ status: 'active', parentTaskId: 'P' });
    expect(existsSync(join(dir, 'tasks', 'P', 'tombstone.json'))).toBe(false);
    expect((await fresh.verify()).every((r) => r.ok)).toBe(true);
    void rt;
  }, 60_000);

  it('a creator that pinned before the tombstone and publishes while it is up: the pruner withdraws, the creator succeeds', async () => {
    const dir = tmp('durable-d7-');
    const ctl = tmp('durable-d7-ctl-');
    await finishedParent(dir);

    const pruner = spawnChild([dir, 'prune', ctl, 'P']);
    await waitFor(() => exists(ctl, 'prune-reached')); // pruner's first look is done
    const creator = spawnChild([dir, 'create-child', ctl, 'C', 'gate-after-pin']);
    await waitFor(() => exists(ctl, 'pinned')); // pin published, child not yet
    writeFileSync(join(ctl, 'go-prune'), '');
    await waitFor(() => exists(ctl, 'marked')); // the prune attempt is open
    expect(existsSync(join(dir, 'tasks', 'P', 'prune-1.prepare.json'))).toBe(true);
    expect(existsSync(join(dir, 'tasks', 'P', 'tombstone.json'))).toBe(false); // published only from a commit
    writeFileSync(join(ctl, 'go-publish'), ''); // the creator publishes while the tombstone is up
    await waitFor(() => existsSync(join(dir, 'tasks', 'C', 'events', '000000001.json')));
    writeFileSync(join(ctl, 'go-scan'), ''); // now the pruner looks again

    expect(await pruner.line('RESULT')).toBe('RESULT RETENTION_REFUSED');
    expect(await creator.line('RESULT')).toBe('RESULT OK created=true');
    await Promise.all([pruner.done, creator.done]);
    const fresh = openRt(dir);
    expect((await fresh.getState('P')).status).toBe('completed');
    expect((await fresh.getState('C')).status).toBe('active');
    expect(existsSync(join(dir, 'tasks', 'P', 'tombstone.json'))).toBe(false);
  }, 60_000);

  it('a creator arriving after the tombstone is refused and publishes nothing; the prune completes', async () => {
    const dir = tmp('durable-d7-');
    const ctl = tmp('durable-d7-ctl-');
    await finishedParent(dir);

    const pruner = spawnChild([dir, 'prune', ctl, 'P']);
    await waitFor(() => exists(ctl, 'prune-reached'));
    writeFileSync(join(ctl, 'go-prune'), '');
    await waitFor(() => exists(ctl, 'marked')); // tombstone up, data not yet removed
    const creator = spawnChild([dir, 'create-child', ctl, 'C']);
    expect(await creator.line('RESULT')).toBe('RESULT VALIDATION');
    writeFileSync(join(ctl, 'go-scan'), '');
    expect(await pruner.line('RESULT')).toBe('RESULT PRUNED');
    await Promise.all([pruner.done, creator.done]);

    const fresh = openRt(dir);
    await expect(fresh.getState('C')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    await expect(fresh.getState('P')).rejects.toMatchObject({ code: 'TASK_PRUNED' });
    expect(existsSync(join(dir, 'tasks', 'C'))).toBe(false);
  }, 60_000);

  it('SIGKILL of the pruner right after the tombstone: the next prune call does not strand a child that appeared', async () => {
    const dir = tmp('durable-d7-');
    const ctl = tmp('durable-d7-ctl-');
    await finishedParent(dir);

    const pruner = spawnChild([dir, 'prune', ctl, 'P']);
    await waitFor(() => exists(ctl, 'prune-reached'));
    const creator = spawnChild([dir, 'create-child', ctl, 'C']);
    expect(await creator.line('RESULT')).toBe('RESULT OK created=true');
    writeFileSync(join(ctl, 'go-prune'), '');
    await waitFor(() => exists(ctl, 'marked'));
    pruner.proc.kill('SIGKILL'); // dies with the tombstone up and the second look not done
    await pruner.done;

    const fresh = openRt(dir);
    await expect(fresh.getState('P')).rejects.toMatchObject({ code: 'TASK_PRUNED' }); // transient: tombstone, data intact
    await expect(fresh.pruneTask('P', { terminalRetentionMs: 0 })).rejects.toMatchObject({ code: 'RETENTION_REFUSED' });
    expect((await openRt(dir).getState('P')).status).toBe('completed');
    expect((await openRt(dir).getState('C')).status).toBe('active');
  }, 60_000);
});
