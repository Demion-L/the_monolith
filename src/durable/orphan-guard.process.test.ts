/**
 * DURABLE-FIX-002 / N-1, N-2, TEST-1, TEST-2, TEST-4 with REAL OS processes: SIGSTOP / SIGCONT / SIGKILL.
 * Barriers are files; the only wall-clock wait is the (short) grace period the scenario is about.
 *
 * The invariant checked at the end is the one that matters for execution: no ACTIVE task whose parent is pruned can be
 * claimed or offered by `findResumable`, however the processes were scheduled or killed.
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
import { TaskOrphanedError, TaskPrunedError } from './errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');
const GRACE = 300;
let build: string;
const dirs: string[] = [];
const kids: ChildProcess[] = [];

function compileTree(from: string, to: string): void {
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, e.name);
    if (e.isDirectory()) compileTree(src, join(to, e.name));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
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
const [dir, ctl, mode, id, jitter] = process.argv.slice(2);
const inner = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
const touch = (n) => writeFileSync(join(ctl, n), '');
const until = async (n) => { while (!existsSync(join(ctl, n))) await new Promise((r) => setTimeout(r, 3)); };
const store = {
  readLog: (...a) => inner.readLog(...a), listTaskIds: () => inner.listTaskIds(), compact: (...a) => inner.compact(...a),
  prune: (...a) => inner.prune(...a), sweepCompacted: (...a) => inner.sweepCompacted(...a), markPruned: (...a) => inner.markPruned(...a),
  withdrawTombstone: (...a) => inner.withdrawTombstone(...a), listReferences: (...a) => inner.listReferences(...a),
  pinReference: async (...a) => {
    const r = await inner.pinReference(...a);
    if (mode === 'freeze-creator') { touch('pinned'); await until('go'); }
    return r;
  },
  append: async (e) => {
    const r = await inner.append(e);
    if (mode === 'freeze-creator' && r === 'appended') { touch('appended'); await new Promise(() => {}); } // killed here
    return r;
  },
};
const rt = new DurableTasks({ store, referenceGraceMs: ${GRACE} });
const say = (s) => process.stdout.write(s + '\\n');
if (jitter) { await until('start'); await new Promise((r) => setTimeout(r, +jitter)); }
try {
  if (mode === 'prune') { await rt.pruneTask('P', { terminalRetentionMs: 0 }); say('RESULT PRUNED'); }
  else { const r = await rt.createTask({ taskId: id, kind: 'k', goal: 'g', parentTaskId: 'P' }); say('RESULT CREATED ' + r.state.status); }
} catch (e) { say('RESULT ' + (e.code ?? e.name)); }
`;

beforeAll(() => {
  build = mkdtempSync(join(tmpdir(), 'durable-orphan-build-'));
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

const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
const openRt = (dir: string, now?: () => Date): DurableTasks =>
  new DurableTasks({ store: new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }), referenceGraceMs: GRACE, ...(now ? { now } : {}) });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const waitFor = async (p: string, ms = 15000): Promise<void> => {
  const t0 = Date.now();
  while (!existsSync(p)) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${p}`);
    await sleep(5);
  }
};

function run(dir: string, ctl: string, mode: string, id: string, jitter = ''): { proc: ChildProcess; out: Promise<string> } {
  const proc = spawn(process.execPath, [join(build, 'child.mjs'), dir, ctl, mode, id, jitter], { stdio: ['ignore', 'pipe', 'pipe'] });
  kids.push(proc);
  let o = '';
  proc.stdout!.on('data', (d) => (o += d));
  proc.stderr!.on('data', (d) => (o += `STDERR ${d}`));
  return { proc, out: new Promise((r) => proc.on('close', () => r(o.trim()))) };
}

async function finishedParent(dir: string): Promise<void> {
  const rt = openRt(dir);
  await rt.createTask({ taskId: 'P', kind: 'k', goal: 'g' });
  const f = await rt.claim('P', { owner: 'w' });
  await rt.complete(f, 1);
}

/** The execution invariant, via every public path. */
async function expectNoExecutableOrphan(dir: string, childIds: string[]): Promise<void> {
  const rt = openRt(dir);
  const parentGone = await rt.getState('P').then(() => false, (e) => e instanceof TaskPrunedError);
  const offered = new Set((await rt.findResumable()).map((x) => x.taskId));
  for (const id of childIds) {
    const st = await rt.getState(id).then((s) => s.status, () => null);
    if (st === null) continue; // never published
    if (parentGone && st === 'active') {
      await expect(rt.claim(id, { owner: 'x' })).rejects.toBeInstanceOf(TaskOrphanedError);
    }
    if (parentGone) expect(offered.has(id)).toBe(false);
  }
  expect((await rt.verify()).every((r) => r.ok)).toBe(true);
}

describe('orphan guard with real processes', () => {
  it('TEST-1: creator pins, is SIGSTOPped; pruner removes the parent after the grace; creator resumes, publishes, is SIGKILLed', async () => {
    const dir = tmp('og-store-');
    const ctl = tmp('og-ctl-');
    await finishedParent(dir);
    const creator = run(dir, ctl, 'freeze-creator', 'C');
    await waitFor(join(ctl, 'pinned'));
    creator.proc.kill('SIGSTOP');
    await sleep(GRACE + 150);
    await openRt(dir).pruneTask('P', { terminalRetentionMs: 0 }); // pin ignorable now
    await expect(openRt(dir).getState('P')).rejects.toBeInstanceOf(TaskPrunedError);
    creator.proc.kill('SIGCONT');
    writeFileSync(join(ctl, 'go'), '');
    await waitFor(join(ctl, 'appended'));
    creator.proc.kill('SIGKILL');
    await creator.out;

    const rt = openRt(dir);
    expect((await rt.getState('C')).status).toBe('active'); // the log really holds it: the crash left no compensation
    await expect(rt.claim('C', { owner: 'w2' })).rejects.toBeInstanceOf(TaskOrphanedError);
    expect((await rt.getState('C')).status).toBe('cancelled');
    expect(await rt.findResumable()).toEqual([]);
    await expectNoExecutableOrphan(dir, ['C']);
  }, 60_000);

  it('TEST-2: a pruner whose clock is ahead (no waiting) cannot leave an executable orphan', async () => {
    const dir = tmp('og-store-');
    const ctl = tmp('og-ctl-');
    await finishedParent(dir);
    const creator = run(dir, ctl, 'freeze-creator', 'C');
    await waitFor(join(ctl, 'pinned'));
    creator.proc.kill('SIGSTOP');
    const ahead = (): Date => new Date(Date.now() + GRACE + 50); // creator frozen for ~0 ms of its own time
    await openRt(dir, ahead).pruneTask('P', { terminalRetentionMs: 0 });
    creator.proc.kill('SIGCONT');
    writeFileSync(join(ctl, 'go'), '');
    await waitFor(join(ctl, 'appended'));
    creator.proc.kill('SIGKILL');
    await creator.out;
    const rt = openRt(dir);
    await expect(rt.claim('C', { owner: 'w2' })).rejects.toBeInstanceOf(TaskOrphanedError);
    await expectNoExecutableOrphan(dir, ['C']);
  }, 60_000);

  it.each([
    ['2 creators + 1 pruner', 2, 1],
    ['3 creators + 2 pruners', 3, 2],
  ])('TEST-4: %s, repeated rounds, random timing', async (_n, creators, pruners) => {
    for (let round = 0; round < 6; round++) {
      const dir = tmp('og-store-');
      const ctl = tmp('og-ctl-');
      await finishedParent(dir);
      const procs = [
        ...Array.from({ length: creators }, (_, i) => run(dir, ctl, 'create', `c${i}`, String(Math.floor(Math.random() * 25)))),
        ...Array.from({ length: pruners }, () => run(dir, ctl, 'prune', 'p', String(Math.floor(Math.random() * 25)))),
      ];
      await sleep(250);
      writeFileSync(join(ctl, 'start'), '');
      const outs = await Promise.all(procs.map((p) => p.out));
      for (const o of outs) expect(o).toMatch(/RESULT (CREATED active|PRUNED|VALIDATION|RETENTION_REFUSED|TASK_PRUNED|TASK_EXISTS)/);
      await expectNoExecutableOrphan(dir, Array.from({ length: creators }, (_, i) => `c${i}`));
    }
  }, 120_000);

  it('TEST-4: a pruner SIGSTOPped between its tombstone and its look at the references, then resumed', async () => {
    // covered in-process by prune-race.test.ts with hooks at this exact boundary; here the real process variant:
    const dir = tmp('og-store-');
    const ctl = tmp('og-ctl-');
    await finishedParent(dir);
    const pr = run(dir, ctl, 'prune', 'p', '0');
    writeFileSync(join(ctl, 'start'), '');
    pr.proc.kill('SIGSTOP'); // frozen wherever it happens to be (possibly before, possibly after the tombstone)
    const c = run(dir, ctl, 'create', 'c0', '0');
    await c.out;
    pr.proc.kill('SIGCONT');
    await pr.out;
    await expectNoExecutableOrphan(dir, ['c0']);
  }, 60_000);

  it('TEST-5: with a live parent a child is created, offered and claimed as before', async () => {
    const dir = tmp('og-store-');
    const ctl = tmp('og-ctl-');
    await finishedParent(dir);
    const c = run(dir, ctl, 'create', 'c0');
    expect(await c.out).toContain('RESULT CREATED active');
    const rt = openRt(dir);
    expect((await rt.findResumable()).map((x) => x.taskId)).toEqual(['c0']);
    await rt.claim('c0', { owner: 'w' });
  }, 60_000);
});
