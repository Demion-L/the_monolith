/**
 * DURABLE-FIX-003 / N-6 with REAL OS processes: SIGSTOP / SIGCONT / SIGKILL of a pruner that has published its
 * tombstone. Barriers are files; the only wall-clock wait is a pause longer than the old settle window (~1 s), which
 * is exactly what used to turn a stopped pruner into a cancelled child.
 *
 * Invariant: a child that was active and valid BEFORE any prune started is never cancelled and never left unclaimable
 * for good, however the pruner was stopped or killed; and it never runs on a parent that is being deleted.
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
import { RetentionRefusedError } from './errors.js';

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
  prune: (...a) => inner.prune(...a), sweepCompacted: (...a) => inner.sweepCompacted(...a),
  withdrawTombstone: (...a) => inner.withdrawTombstone(...a), listReferences: (...a) => inner.listReferences(...a),
  pinReference: (...a) => inner.pinReference(...a), append: (...a) => inner.append(...a),
  markPruned: async (...a) => {
    if (mode === 'prune-hold') { touch('at-mark'); await until('go-mark'); } // the child is created in this window
    await inner.markPruned(...a);
    if (mode === 'prune-hold') { touch('marked'); await until('go-pruner'); } // stopped / killed here by the test
  },
};
const rt = new DurableTasks({ store, referenceGraceMs: ${GRACE} });
const say = (s) => process.stdout.write(s + '\\n');
if (jitter) { await until('start'); await new Promise((r) => setTimeout(r, +jitter)); }
try {
  if (mode === 'create') { const r = await rt.createTask({ taskId: id, kind: 'k', goal: 'g', parentTaskId: 'P' }); say('RESULT CREATED ' + r.state.status); }
  else if (mode === 'claim') { const f = await rt.claim(id, { owner: 'o-' + process.pid }); say('RESULT CLAIMED ' + f.epoch); }
  else { await rt.pruneTask('P', { terminalRetentionMs: 0 }); say('RESULT PRUNED'); }
} catch (e) { say('RESULT ' + (e.code ?? e.name) + (e.code === 'STORE_IO' ? ' ' + e.message : '')); }
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


async function parentWithChildren(dir: string, children: string[]): Promise<void> {
  const rt = openRt(dir);
  await rt.createTask({ taskId: 'P', kind: 'k', goal: 'g' });
  await rt.complete(await rt.claim('P', { owner: 'w' }), 1);
  for (const c of children) await rt.createTask({ taskId: c, kind: 'k', goal: 'g', parentTaskId: 'P' });
}
/**
 * The audit's schedule. The pruner passes its "no active referrer" check, stops before publishing the tombstone;
 * the children are created (their pins see no tombstone); the pruner publishes the tombstone and stops again.
 */
async function prunerStoppedAfterTombstone(dir: string, ctl: string, children: string[]): Promise<{ proc: ChildProcess; out: Promise<string> }> {
  await parentWithChildren(dir, []);
  const pruner = run(dir, ctl, 'prune-hold', 'p');
  await waitFor(join(ctl, 'at-mark'));
  const rt = openRt(dir);
  for (const c of children) await rt.createTask({ taskId: c, kind: 'k', goal: 'g', parentTaskId: 'P' });
  writeFileSync(join(ctl, 'go-mark'), '');
  await waitFor(join(ctl, 'marked'));
  return pruner;
}
const types = async (dir: string, id: string): Promise<string[]> => (await openRt(dir).getLog(id)).events.map((e) => e.type);

describe('pending prune with real processes (N-6)', () => {
  it('TEST-1: pruner SIGSTOPped after its tombstone; claim after >1 s keeps the child; the resumed pruner backs off', async () => {
    const dir = tmp('pp-store-');
    const ctl = tmp('pp-ctl-');
    const pruner = await prunerStoppedAfterTombstone(dir, ctl, ['C']);
    pruner.proc.kill('SIGSTOP');
    await sleep(1500); // longer than the old SETTLE window
    const rt = openRt(dir);
    const fence = await rt.claim('C', { owner: 'w2' }); // used to throw TaskOrphanedError and cancel C
    expect(fence.epoch).toBe(1);
    expect((await rt.getState('C')).status).toBe('active');
    expect(await types(dir, 'C')).toEqual(['task.created', 'run.claimed']);
    pruner.proc.kill('SIGCONT');
    writeFileSync(join(ctl, 'go-pruner'), '');
    expect(await pruner.out).toBe('RESULT RETENTION_REFUSED');
    expect((await openRt(dir).getState('P')).status).toBe('completed'); // referential integrity kept
    // liveness: once the child is done the parent can be pruned normally
    await rt.complete(fence, 1);
    await expect(rt.pruneTask('P', { terminalRetentionMs: 0 })).resolves.toBeTruthy();
    expect((await rt.verify()).every((r) => r.ok)).toBe(true);
  }, 60_000);

  it('TEST-2: pruner SIGKILLed after its tombstone; a restarted runtime offers and claims the child', async () => {
    const dir = tmp('pp-store-');
    const ctl = tmp('pp-ctl-');
    const pruner = await prunerStoppedAfterTombstone(dir, ctl, ['C']);
    pruner.proc.kill('SIGKILL');
    await pruner.out;
    expect(existsSync(join(dir, 'tasks', 'P', 'tombstone.json'))).toBe(true);
    const rt = openRt(dir); // "restart"
    expect((await rt.assess('C')).claimable).toBe(false); // read-only view: pending
    expect(existsSync(join(dir, 'tasks', 'P', 'tombstone.json'))).toBe(true);
    expect((await rt.findResumable()).map((x) => x.taskId)).toEqual(['C']);
    expect((await rt.claim('C', { owner: 'w' })).epoch).toBe(1);
    expect(existsSync(join(dir, 'tasks', 'P', 'tombstone.json'))).toBe(false);
    expect((await rt.verify()).every((r) => r.ok)).toBe(true);
  }, 60_000);

  it('TEST-2: pruner SIGKILLed with no referrer at all: the next retention pass finishes the prune, twice is harmless', async () => {
    const dir = tmp('pp-store-');
    const ctl = tmp('pp-ctl-');
    const pruner = await prunerStoppedAfterTombstone(dir, ctl, []);
    pruner.proc.kill('SIGKILL');
    await pruner.out;
    const rt = openRt(dir);
    expect((await rt.applyRetention({ terminalRetentionMs: 0 })).applied.map((a) => a.action)).toEqual(['prune']);
    expect((await rt.applyRetention({ terminalRetentionMs: 0 })).applied).toEqual([]);
    expect((await rt.verify()).every((r) => r.ok)).toBe(true);
  }, 60_000);

  it('TEST-4: several processes recover the same killed prune at once (repeated, random timing)', async () => {
    for (let round = 0; round < 5; round++) {
      const dir = tmp('pp-store-');
      const ctl = tmp('pp-ctl-');
      const ids = ['c0', 'c1', 'c2'];
      const pruner = await prunerStoppedAfterTombstone(dir, ctl, ids);
      pruner.proc.kill('SIGKILL');
      await pruner.out;
      const claimers = [...ids, 'c0'].map((id) => run(dir, ctl, 'claim', id, String(Math.floor(Math.random() * 20))));
      await sleep(250);
      writeFileSync(join(ctl, 'start'), '');
      const outs = await Promise.all(claimers.map((c) => c.out));
      expect(outs[1]).toBe('RESULT CLAIMED 1');
      expect(outs[2]).toBe('RESULT CLAIMED 1');
      // c0 was claimed by two owners at once: exactly one of them wins, the other is told the lease is held
      expect([outs[0], outs[3]].sort()).toEqual(['RESULT CLAIMED 1', 'RESULT LEASE_HELD']);
      const rt = openRt(dir);
      expect(existsSync(join(dir, 'tasks', 'P', 'tombstone.json'))).toBe(false);
      for (const id of ids) expect((await rt.getState(id)).status).toBe('active');
      expect((await rt.verify()).every((r) => r.ok)).toBe(true);
    }
  }, 120_000);

  it('TEST-5: creator and pruners race, one pruner is killed or stopped at a random moment: a child that exists is never lost', async () => {
    let existed = 0;
    for (let round = 0; round < 10; round++) {
      const dir = tmp('pp-store-');
      const ctl = tmp('pp-ctl-');
      await parentWithChildren(dir, []);
      const creator = run(dir, ctl, 'create', 'C', String(Math.floor(Math.random() * 15)));
      const pruners = [run(dir, ctl, 'prune', 'p', String(Math.floor(Math.random() * 15))), run(dir, ctl, 'prune', 'p', String(Math.floor(Math.random() * 15)))];
      await sleep(250);
      writeFileSync(join(ctl, 'start'), '');
      await sleep(Math.floor(Math.random() * 25));
      pruners[0]!.proc.kill(round % 2 === 0 ? 'SIGKILL' : 'SIGSTOP');
      const created = await creator.out;
      // STORE_IO: pinReference raced with the pruner removing refs/ (ENOENT on link; outcome unknown, nothing published).
      // Present at 2366502 as well (see the spec, F-1); a creator-side liveness issue, never a lost or orphaned child.
      expect(created).toMatch(/RESULT (CREATED active|VALIDATION|TASK_EXISTS|STORE_IO)/);
      pruners[0]!.proc.kill('SIGCONT');
      pruners[0]!.proc.kill('SIGKILL');
      await Promise.all(pruners.map((p) => p.out));
      const rt = openRt(dir);
      const c = await rt.getState('C').then((x) => x, () => null);
      if (c) {
        existed++;
        expect(c.status).toBe('active'); // never TASK_ORPHANED / cancelled
        expect((await rt.getState('P')).status).toBe('completed' as const); // the parent it needs survived (rolled back or never marked)
        expect((await rt.claim('C', { owner: 'w' })).epoch).toBe(1);
      } else {
        // creation was refused: the parent may be pruned or pending, nothing may be executable
        expect(await rt.findResumable()).toEqual([]);
      }
      expect((await rt.verify()).every((r) => r.ok)).toBe(true);
    }
    expect(existed).toBeGreaterThan(0); // the race must really produce children, or the test proves nothing
  }, 180_000);

  it('a prune of a parent whose child is done is unaffected (no regression of the happy path)', async () => {
    const dir = tmp('pp-store-');
    await parentWithChildren(dir, ['C']);
    const rt = openRt(dir);
    await rt.cancel('C', 'done');
    await expect(rt.pruneTask('P', { terminalRetentionMs: 0 })).resolves.toBeTruthy();
    await expect(rt.pruneTask('P', { terminalRetentionMs: 0 })).resolves.toBeTruthy(); // idempotent finish
    expect(RetentionRefusedError).toBeTruthy();
  }, 60_000);
});
