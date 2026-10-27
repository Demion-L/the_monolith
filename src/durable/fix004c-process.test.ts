/**
 * DURABLE-FIX-004C: process crash and concurrency verification of Design A (Mode A: process crash, not OS crash).
 *
 * Every scenario runs REAL, independent Node.js processes (`fix004c-worker.mjs`), each with its own FsEventStore on one
 * shared filesystem directory. The parent only sets up fixtures, orchestrates barriers, kills with SIGKILL and inspects.
 *
 * Barriers are files. A worker blocks synchronously at a hook around `fs.linkSync` / `fs.unlinkSync` of the real library
 * (the equivalent of SIGSTOP at that point), writes `<barrier>.<id>.ready`, and continues only when the parent writes
 * `<barrier>.release`. The parent verifies EVERY participant reached the barrier (or fails with an explicit timeout)
 * before it releases anything. No sleep is used as proof of concurrency; SIGKILL is a real signal sent to a process that
 * the parent has seen standing at the barrier.
 *
 * Out of scope here: OS crash / power loss (Mode B), FIX-004D/E items.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, statSync } from 'fs';
import { tmpdir, platform, release, type } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import ts from 'typescript';
import { FsEventStore } from './fs-store.js';
import { DurableTasks } from './runtime.js';
import { stampEvent } from './log.js';
import { GENESIS_HASH, type TaskEvent, type Tombstone } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

// ---------------------------------------------------------------------------------------------------------------------
// Build: the library is transpiled once into a temp directory; children import that copy.
// ---------------------------------------------------------------------------------------------------------------------

let build: string;

function compileTree(from: string, to: string): void {
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, e.name);
    if (e.isDirectory()) compileTree(src, join(to, e.name));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      mkdirSync(to, { recursive: true });
      const out = ts.transpileModule(readFileSync(src, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
      writeFileSync(join(to, e.name.replace(/\.ts$/, '.js')), out.outputText);
    }
  }
}

beforeAll(() => {
  build = mkdtempSync(join(tmpdir(), 'fix004c-build-'));
  writeFileSync(join(build, 'package.json'), '{"type":"module"}');
  compileTree(join(srcRoot, 'durable'), join(build, 'durable'));
  compileTree(join(srcRoot, 'root'), join(build, 'root'));
  copyFileSync(join(here, 'fix004c-worker.mjs'), join(build, 'worker.mjs'));
  copyFileSync(join(here, 'fix004c-probe-worker.mjs'), join(build, 'probe-worker.mjs'));
});
afterAll(() => rmSync(build, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------------------------------

interface Hook {
  op: 'link' | 'unlink' | 'open' | 'close' | 'readdir';
  match: string;
  phase: 'before' | 'after';
  barrier: string;
  nth?: number;
  /** Counts only after a link to a destination matching `link` has completed in the same process. */
  since?: { link: string };
}
interface Rec {
  i?: number;
  op?: string;
  ok?: boolean;
  value?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  error?: { name: string; code: string | null; message: string };
  done?: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BARRIER_TIMEOUT_MS = 20_000;

class Proc {
  readonly child: ChildProcess;
  private exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  readonly exited: Promise<void>;
  stderr = '';
  constructor(private readonly run: Run, readonly id: string, cfgPath: string, script: string) {
    this.child = spawn(process.execPath, [join(build, script), cfgPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child.stderr?.on('data', (d) => (this.stderr += d));
    this.exited = new Promise((resolve) =>
      this.child.on('close', (code, signal) => {
        this.exit = { code, signal };
        resolve();
      }),
    );
  }
  /** Waits until this process stands at `barrier`. A process that exits first, or never arrives, is a hard failure. */
  async ready(barrier: string, ms = BARRIER_TIMEOUT_MS): Promise<void> {
    const f = join(this.run.ctl, `${barrier}.${this.id}.ready`);
    const t0 = Date.now();
    while (!existsSync(f)) {
      if (this.exit) throw new Error(`${this.id} exited (${this.exit.code}/${this.exit.signal}) before reaching barrier "${barrier}"\n${this.stderr}\n${this.rawLog()}`);
      if (Date.now() - t0 > ms) throw new Error(`BARRIER TIMEOUT: ${this.id} never reached "${barrier}" within ${ms} ms\n${this.stderr}\n${this.rawLog()}`);
      await sleep(1);
    }
  }
  release(barrier: string): void {
    writeFileSync(join(this.run.ctl, `${barrier}.${this.id}.release`), '');
  }
  async kill(): Promise<void> {
    this.child.kill('SIGKILL');
    await this.exited;
    expect(this.exit?.signal, `${this.id} must die of SIGKILL`).toBe('SIGKILL');
  }
  /** Waits for a normal end and returns the step records. */
  async finish(ms = 30_000): Promise<Rec[]> {
    const timer = sleep(ms).then(() => 'timeout' as const);
    if ((await Promise.race([this.exited.then(() => 'ok' as const), timer])) === 'timeout') throw new Error(`TIMEOUT: ${this.id} did not finish within ${ms} ms\n${this.rawLog()}`);
    expect(this.exit?.code, `${this.id} exit code\n${this.stderr}\n${this.rawLog()}`).toBe(0);
    return this.steps();
  }
  rawLog(): string {
    const f = join(this.run.ctl, `${this.id}.log`);
    return existsSync(f) ? readFileSync(f, 'utf8') : '(no log)';
  }
  steps(): Rec[] {
    return this.rawLog()
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l) as Rec)
      .filter((r) => !r.done);
  }
}

const dirsToRemove: string[] = [];
const allRuns: Run[] = [];
let procSeq = 0;

class Run {
  readonly dir = mkdtempSync(join(tmpdir(), 'fix004c-store-'));
  readonly ctl = mkdtempSync(join(tmpdir(), 'fix004c-ctl-'));
  readonly procs: Proc[] = [];
  constructor() {
    dirsToRemove.push(this.dir, this.ctl);
    allRuns.push(this);
  }
  /** Parent-side store, used for fixtures and read-only inspection. It is never one of the competing participants. */
  store(): FsEventStore {
    const s = new FsEventStore({ target: { scope: 'trusted-directory', dir: this.dir }, durability: 'file' });
    s.initializeProtocolSync();
    return s;
  }
  spawn(name: string, steps: object[], hooks: Hook[] = []): Proc {
    const id = `${name}-${++procSeq}`;
    const cfgPath = join(this.ctl, `${id}.cfg.json`);
    writeFileSync(cfgPath, JSON.stringify({ id, dir: this.dir, ctl: this.ctl, hooks, steps, barrierTimeoutMs: 40_000 }));
    const p = new Proc(this, id, cfgPath, 'worker.mjs');
    this.procs.push(p);
    return p;
  }
  releaseAll(barrier: string): void {
    writeFileSync(join(this.ctl, `${barrier}.release`), '');
  }
  /** All named processes must have reached `barrier`; only then is it opened for everybody. */
  async rendezvous(barrier: string, ps: Proc[]): Promise<void> {
    for (const p of ps) await p.ready(barrier);
    this.releaseAll(barrier);
  }
  killAll(): void {
    for (const p of this.procs) p.child.kill('SIGKILL');
  }
}

afterEach(() => {
  for (const r of allRuns.splice(0)) r.killAll();
  while (dirsToRemove.length) rmSync(dirsToRemove.pop() as string, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------

const pad9 = (n: number): string => String(n).padStart(9, '0');
const evRe = (seq: number): string => `/events/${pad9(seq)}\\.json$`;
const ANY_EV = '/events/\\d{9}\\.json$';
const ANY_SEG = '/segments/S\\d+-\\d+\\.jsonl$';

function chain(taskId: string, n: number): TaskEvent[] {
  const out: TaskEvent[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const e =
      seq === 1
        ? stampEvent(taskId, 1, '2026-01-01T00:00:00.000Z', prev, {
            type: 'task.created', actor: null, data: { kind: 'k', goal: 'g', input: null, parentTaskId: null, dependsOn: [], labels: {} },
          })
        : stampEvent(taskId, seq, `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`, prev, {
            type: 'fact.observed', actor: 'x', data: { key: `k${seq}`, fingerprint: `f${seq}`, value: seq, source: null },
          });
    out.push(e);
    prev = e.hash;
  }
  return out;
}
/** A different event for the same slot (same predecessor, other bytes). */
const rival = (evs: TaskEvent[], seq: number): TaskEvent =>
  stampEvent(evs[0]!.taskId, seq, '2026-02-02T00:00:00.000Z', seq === 1 ? GENESIS_HASH : evs[seq - 2]!.hash, {
    type: 'fact.observed', actor: 'rival', data: { key: 'other', fingerprint: 'zz', value: 1, source: null },
  });
const tombstoneOf = (evs: TaskEvent[]): Tombstone => ({
  v: 1, taskId: evs[0]!.taskId, kind: 'k', finalStatus: 'completed', createdAt: 'a', closedAt: 'b', prunedAt: 'c',
  headSeq: evs.length, headHash: evs[evs.length - 1]!.hash, outcomeDigest: 'd',
});
async function seed(run: Run, id: string, n: number): Promise<TaskEvent[]> {
  const s = run.store();
  const evs = chain(id, n);
  for (const e of evs) expect(await s.append(e)).toBe('appended');
  return evs;
}
const taskDir = (run: Run, id: string): string => join(run.dir, 'tasks', id);
const names = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort() : []);
const looseSeqs = (run: Run, id: string): number[] =>
  names(join(taskDir(run, id), 'events')).filter((n) => /^\d{9}\.json$/.test(n)).map((n) => Number(n.slice(0, 9)));
const segments = (run: Run, id: string): string[] => names(join(taskDir(run, id), 'segments')).filter((n) => /^S\d+-\d+\.jsonl$/.test(n));
const hashesOf = (evs: TaskEvent[]): string[] => evs.map((e) => e.hash);

const val = (r: Rec | undefined): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!r) return 'NO-RECORD';
  return r.ok ? r.value : `ERR:${r.error?.name}`;
};
const step = (recs: Rec[], op: string, nth = 0): Rec | undefined => recs.filter((r) => r.op === op)[nth];

/** A FRESH process opens the store and reports what it sees. */
async function observe(run: Run, id: string, extra: object[] = []): Promise<Rec[]> {
  const p = run.spawn('obs', [{ op: 'pruneState', taskId: id, tolerate: true }, { op: 'readLog', taskId: id, tolerate: true }, ...extra]);
  return p.finish();
}

// =====================================================================================================================
// Criterion 12: prune vs append (G1 / G2), real processes
// =====================================================================================================================

describe('criterion 12 — prune vs append across processes', () => {
  it('prepare+commit and append released together (6 rounds): either the event is confirmed and the task lives, or the append is refused and the prune commits', async () => {
    const tally = { appended: 0, pruned: 0 };
    for (let round = 0; round < 6; round++) {
      const run = new Run();
      const id = `pa${round}`;
      const evs = await seed(run, id, 3);
      const e4 = chain(id, 4)[3]!;
      const tomb = tombstoneOf(evs);
      const A = run.spawn('pruner', [
        { op: 'prepare', tombstone: tomb },
        { op: 'barrier', name: 'go' },
        { op: 'decide', outcome: 'commit', tombstone: tomb, tolerate: true },
        { op: 'prune', tombstone: tomb, requireCommit: true, tolerate: true },
      ]);
      const B = run.spawn('writer', [{ op: 'append', event: e4 }], [{ op: 'link', match: evRe(4), phase: 'before', barrier: 'go' }]);
      await run.rendezvous('go', [A, B]); // both standing at the barrier, then released together
      const a = await A.finish();
      const b = await B.finish();
      const decided = val(step(a, 'decide'));
      const appendOut = val(step(b, 'append'));
      const obs = await observe(run, id, [{ op: 'prune', tombstone: tomb, requireCommit: true, tolerate: true }, { op: 'pruneState', taskId: id }]);

      if (appendOut === 'appended') {
        tally.appended++;
        expect(decided, `round ${round}: writer confirmed, the register must say abort`).toBe('abort');
        expect(val(step(obs, 'pruneState', 0)).kind).toBe('live');
        expect(val(step(obs, 'readLog')).seqs, 'a confirmed event must be in the log').toEqual([1, 2, 3, 4]);
        expect(existsSync(join(taskDir(run, id), 'tombstone.json'))).toBe(false);
      } else {
        tally.pruned++;
        expect(['ERR:TaskPrunedError', 'ERR:AppendOutcomeUnknownError'], `round ${round}: the only other legal outcomes`).toContain(appendOut);
        expect(decided).toBe('commit');
        expect(val(step(obs, 'pruneState', 0)).kind).toBe('committed');
        // criterion 13/33: commit records and the task directory stay; the sweeper (prune roll-forward) leaves no loose event
        expect(names(taskDir(run, id))).toEqual(expect.arrayContaining(['prune-1.prepare.json', 'prune-1.decision.json', 'tombstone.json']));
        expect(looseSeqs(run, id)).toEqual([]);
      }
    }
    expect(tally.appended + tally.pruned).toBe(6);
  }, 180_000);

  it('a writer stopped before its publication while another process commits and deletes: on resume it is refused, nothing is resurrected', async () => {
    const run = new Run();
    const id = 'stopped-before';
    const evs = await seed(run, id, 3);
    const e4 = chain(id, 4)[3]!;
    const tomb = tombstoneOf(evs);
    const B = run.spawn('writer', [{ op: 'append', event: e4 }], [{ op: 'link', match: evRe(4), phase: 'before', barrier: 'stopped' }]);
    await B.ready('stopped'); // G1 passed (LIVE), the writer stands right before its link
    const A = run.spawn('pruner', [{ op: 'prepare', tombstone: tomb }, { op: 'decide', outcome: 'commit', tombstone: tomb }, { op: 'prune', tombstone: tomb, requireCommit: true }]);
    const a = await A.finish();
    expect(a.map(val)).toEqual([expect.objectContaining({ created: true }), 'commit', expect.anything()]);
    B.release('stopped');
    const b = await B.finish();
    // The writer holds a handle of a directory that no longer exists: safe-write cannot tell "never linked" from "unknown",
    // so the legal outcomes are TaskPrunedError or AppendOutcomeUnknownError (section 24.4) — never 'appended'/'adopted'.
    expect(['ERR:TaskPrunedError', 'ERR:AppendOutcomeUnknownError'], B.rawLog()).toContain(val(step(b, 'append')));
    // The unknown outcome resolves deterministically: a retry by a NEW process is refused as pruned (G1).
    const retry = await run.spawn('retry', [{ op: 'append', event: e4, tolerate: true }]).finish();
    expect(val(step(retry, 'append'))).toBe('ERR:TaskPrunedError');
    const obs = await observe(run, id, [{ op: 'prune', tombstone: tomb, requireCommit: true }, { op: 'pruneState', taskId: id }]);
    expect(val(step(obs, 'pruneState', 1))).toMatchObject({ kind: 'committed', residue: 0 });
    expect(looseSeqs(run, id)).toEqual([]);
    expect(existsSync(join(taskDir(run, id), 'tombstone.json'))).toBe(true);
  }, 60_000);

  it('a writer stopped between its publication and G2 while another process commits: PRUNED, the leftover is swept, P is not resurrected', async () => {
    const run = new Run();
    const id = 'stopped-after';
    const evs = await seed(run, id, 3);
    const e4 = chain(id, 4)[3]!;
    const tomb = tombstoneOf(evs);
    const B = run.spawn('writer', [{ op: 'append', event: e4 }], [{ op: 'link', match: evRe(4), phase: 'after', barrier: 'published' }]);
    await B.ready('published');
    expect(looseSeqs(run, id)).toContain(4); // the file really is there while the writer is stopped
    const A = run.spawn('pruner', [{ op: 'prepare', tombstone: tomb }, { op: 'decide', outcome: 'commit', tombstone: tomb }, { op: 'prune', tombstone: tomb, requireCommit: true }]);
    await A.finish();
    B.release('published');
    const b = await B.finish();
    expect(val(step(b, 'append'))).toBe('ERR:TaskPrunedError');
    const obs = await observe(run, id, [{ op: 'prune', tombstone: tomb, requireCommit: true }, { op: 'pruneState', taskId: id }]);
    expect(val(step(obs, 'pruneState', 1))).toMatchObject({ kind: 'committed', residue: 0 });
    expect(looseSeqs(run, id)).toEqual([]);
  }, 60_000);

  it('a writer stopped between its publication and G2 while another process only PREPARES: G2 aborts the attempt, the confirmed event survives, a later commit is impossible', async () => {
    const run = new Run();
    const id = 'prepare-only';
    const evs = await seed(run, id, 3);
    const e4 = chain(id, 4)[3]!;
    const tomb = tombstoneOf(evs);
    const B = run.spawn('writer', [{ op: 'append', event: e4 }], [{ op: 'link', match: evRe(4), phase: 'after', barrier: 'published' }]);
    await B.ready('published');
    const A = run.spawn('pruner', [{ op: 'prepare', tombstone: tomb }, { op: 'barrier', name: 'prepared' }, { op: 'decide', outcome: 'commit', tombstone: tomb }]);
    await A.ready('prepared'); // PREPARING is visible, the writer is still stopped
    B.release('published');
    const b = await B.finish();
    expect(val(step(b, 'append'))).toBe('appended');
    A.release('prepared');
    const a = await A.finish();
    expect(val(step(a, 'decide')), 'the register value is abort; the pruner cannot commit over a confirmed event').toBe('abort');
    const obs = await observe(run, id);
    expect(val(step(obs, 'pruneState')).kind).toBe('live');
    expect(val(step(obs, 'readLog')).seqs).toEqual([1, 2, 3, 4]);
  }, 60_000);
});

// =====================================================================================================================
// Criterion 64 / test 43г: two compactors
// =====================================================================================================================

describe('criterion 64 (AC-CC-4, test 43г) — two compactors', () => {
  const compactStep = (id: string, evs: TaskEvent[], through: number): object => ({
    op: 'compact', taskId: id, throughSeq: through, events: evs.slice(0, through), tolerate: true,
  });
  const SEG_BEFORE: Hook = { op: 'link', match: ANY_SEG, phase: 'before', barrier: 'seg' };

  for (const [label, rangeA, rangeB] of [
    ['same range 1..4 / 1..4', 4, 4],
    ['nested ranges 1..4 / 1..6', 4, 6],
    ['nested ranges 1..3 / 1..6', 3, 6],
  ] as const) {
    it(`${label}: both stand before the segment publication, released together; no conflicting segments, nothing lost, Canon unchanged`, async () => {
      for (let round = 0; round < 4; round++) {
        const run = new Run();
        const id = `cc${round}`;
        const evs = await seed(run, id, 6);
        const C1 = run.spawn('c1', [compactStep(id, evs, rangeA)], [SEG_BEFORE]);
        const C2 = run.spawn('c2', [compactStep(id, evs, rangeB)], [SEG_BEFORE]);
        await run.rendezvous('seg', [C1, C2]);
        const r1 = val(step(await C1.finish(), 'compact'));
        const r2 = val(step(await C2.finish(), 'compact'));
        // Idempotent success for both, or an explicit refusal of the loser — never a corrupt log.
        for (const r of [r1, r2]) expect(typeof r === 'object' || /^ERR:(LogCorruptError|StoreIoError)$/.test(r), `outcome ${JSON.stringify(r)}`).toBe(true);
        expect([r1, r2].some((r) => typeof r === 'object'), 'at least one compactor must succeed').toBe(true);
        const obs = await observe(run, id);
        const log = val(step(obs, 'readLog'));
        expect(log, 'readLog must not throw "overlapping segments disagree"').toMatchObject({ seqs: [1, 2, 3, 4, 5, 6] });
        expect(log.hashes).toEqual(hashesOf(evs));
        expect(segments(run, id).length).toBeGreaterThan(0);
      }
    }, 120_000);
  }

  it('diverging input: the compactor with another view of slot 3 is refused (CC-1) while the honest one is paused before its publication; Canon unchanged', async () => {
    const run = new Run();
    const id = 'diverge';
    const evs = await seed(run, id, 6);
    const forged = [...evs.slice(0, 2), rival(evs, 3), ...evs.slice(3)];
    const honest = run.spawn('honest', [compactStep(id, evs, 5)], [SEG_BEFORE]);
    await honest.ready('seg'); // K2 of the honest compactor is behind it
    const liar = run.spawn('liar', [{ op: 'compact', taskId: id, throughSeq: 5, events: forged.slice(0, 5), tolerate: true }]);
    const l = await liar.finish();
    expect(val(step(l, 'compact'))).toBe('ERR:LogCorruptError');
    expect(segments(run, id), 'the refused compactor published nothing').toEqual([]);
    honest.release('seg');
    expect(val(step(await honest.finish(), 'compact'))).toMatchObject({ packedEvents: 5 });
    const log = val(step(await observe(run, id), 'readLog'));
    expect(log.hashes).toEqual(hashesOf(evs));
  }, 60_000);

  it('diverging input after the honest segment exists (slot covered, no loose file — R4E-01b): refused, no second conflicting segment', async () => {
    const run = new Run();
    const id = 'diverge-covered';
    const evs = await seed(run, id, 6);
    const ok = await run.spawn('honest', [compactStep(id, evs, 4)]).finish();
    expect(val(step(ok, 'compact'))).toMatchObject({ packedEvents: 4 });
    expect(looseSeqs(run, id)).toEqual([5, 6]);
    const forged = [...evs.slice(0, 2), rival(evs, 3), evs[3]!, evs[4]!, evs[5]!];
    const liar = await run.spawn('liar', [{ op: 'compact', taskId: id, throughSeq: 6, events: forged, tolerate: true }]).finish();
    expect(val(step(liar, 'compact'))).toBe('ERR:LogCorruptError');
    expect(segments(run, id)).toHaveLength(1);
    expect(val(step(await observe(run, id), 'readLog')).hashes).toEqual(hashesOf(evs));
  }, 60_000);
});

// =====================================================================================================================
// Criterion 65 / test 43ж: SIGKILL of a compactor at K2…K5
// =====================================================================================================================

describe('criterion 65 (AC-CC-5, test 43ж) — SIGKILL during compaction', () => {
  const POINTS: Array<{ name: string; hook: Omit<Hook, 'barrier'>; segments: number; removed: number }> = [
    { name: 'K2/K3: before the segment is published', hook: { op: 'link', match: ANY_SEG, phase: 'before' }, segments: 0, removed: 0 },
    { name: 'K4: after the segment is published, before any cleanup', hook: { op: 'link', match: ANY_SEG, phase: 'after' }, segments: 1, removed: 0 },
    { name: 'K5: before the first loose copy is removed', hook: { op: 'unlink', match: ANY_EV, phase: 'before', nth: 1 }, segments: 1, removed: 0 },
    { name: 'K5: during cleanup (after the 2nd removal)', hook: { op: 'unlink', match: ANY_EV, phase: 'after', nth: 2 }, segments: 1, removed: 2 },
    { name: 'K5: after the last removal, before G2', hook: { op: 'unlink', match: ANY_EV, phase: 'after', nth: 4 }, segments: 1, removed: 4 },
  ];
  for (const pt of POINTS) {
    it(`${pt.name}`, async () => {
      const run = new Run();
      const id = 'kill';
      const evs = await seed(run, id, 6);
      const C = run.spawn('compactor', [{ op: 'compact', taskId: id, throughSeq: 4, events: evs.slice(0, 4) }], [{ ...pt.hook, barrier: 'k' }]);
      await C.ready('k'); // confirmed standing at the critical point
      await C.kill(); // SIGKILL, not an exception
      expect(segments(run, id)).toHaveLength(pt.segments);
      expect(looseSeqs(run, id).length).toBe(6 - pt.removed);

      // A NEW process opens the store: Canon is intact, every confirmed event is readable, recovery completes idempotently.
      const fresh = run.spawn('recover', [
        { op: 'readLog', taskId: id },
        { op: 'compact', taskId: id, throughSeq: 4, events: evs.slice(0, 4) },
        { op: 'sweep', taskId: id },
        { op: 'readLog', taskId: id },
        { op: 'append', event: chain(id, 7)[6] },
        { op: 'pruneState', taskId: id },
      ]);
      const r = await fresh.finish();
      expect(val(r[0])).toMatchObject({ seqs: [1, 2, 3, 4, 5, 6] });
      expect(val(r[0]).hashes, 'Canon after SIGKILL equals the confirmed history').toEqual(hashesOf(evs));
      expect(r[1]?.ok, `repeated compact must succeed: ${JSON.stringify(r[1])}`).toBe(true);
      expect(val(r[3]).hashes).toEqual(hashesOf(evs));
      expect(val(r[4])).toBe('appended'); // the task is not wedged
      expect(val(r[5]).kind).toBe('live');
      expect(segments(run, id)).toHaveLength(1);
      expect(looseSeqs(run, id), 'cleanup finished by recovery').toEqual([5, 6, 7]);
    }, 60_000);
  }
});

// =====================================================================================================================
// Tests 39 / 41 / 42, criteria 50-53, 75 (AC-ADO-3, S2): canonical event identity
// =====================================================================================================================

describe('tests 39/41/42, AC-ADO-3 (S2) — stale writers, compaction races, SIGKILL of writers', () => {
  /** Slot 4 is published and compacted away; a stale writer stands before its link and is released afterwards. */
  async function stale(label: string, candidate: (evs: TaskEvent[]) => TaskEvent, killAfterLink: boolean): Promise<void> {
    const run = new Run();
    const id = `s2-${label}`;
    const evs = await seed(run, id, 3);
    const x = chain(id, 4)[3]!;
    const cand = candidate(chain(id, 4));
    const hooks: Hook[] = [{ op: 'link', match: evRe(4), phase: 'before', barrier: 'w2' }];
    if (killAfterLink) hooks.push({ op: 'link', match: evRe(4), phase: 'after', barrier: 'w2post' });
    const W2 = run.spawn('stale', [{ op: 'append', event: cand }], hooks);
    await W2.ready('w2'); // the AV check is behind it, the slot is still free; W1 and the compactor run only now
    const w1 = await run.spawn('w1', [{ op: 'append', event: x }]).finish();
    expect(val(step(w1, 'append'))).toBe('appended');
    const c = await run.spawn('c', [{ op: 'compact', taskId: id, throughSeq: 4, events: [...evs, x] }]).finish();
    expect(val(step(c, 'compact'))).toMatchObject({ packedEvents: 4 });
    expect(looseSeqs(run, id), 'cleanup freed slot 4').not.toContain(4);
    const segsBefore = segments(run, id);

    W2.release('w2');
    if (killAfterLink) {
      // W2 publishes into the freed slot and is killed right after the link (test 39 / 42), then a NEW process retries.
      await W2.ready('w2post');
      await W2.kill();
      const retry = await run.spawn('w2-retry', [{ op: 'append', event: cand }]).finish();
      expect(val(step(retry, 'append')), 'retry of the killed stale writer').toBe(cand.hash === x.hash ? 'adopted' : 'conflict');
    } else {
      const w2 = await W2.finish();
      expect(val(step(w2, 'append')), 'AC-ADO-3: a stale writer never gets "appended"').toBe(cand.hash === x.hash ? 'adopted' : 'conflict');
    }
    expect(segments(run, id), 'segments unchanged').toEqual(segsBefore);
    const log = val(step(await observe(run, id), 'readLog'));
    expect(log.seqs).toEqual([1, 2, 3, 4]);
    expect(log.hashes[3], 'Canon(4) is still x').toBe(x.hash);
  }
  it('S2: stale writer with the SAME bytes after compaction freed the slot -> adopted', () => stale('same', (e) => e[3]!, false), 60_000);
  it('S2: stale writer with OTHER bytes after compaction freed the slot -> conflict', () => stale('other', (e) => rival(e, 4), false), 60_000);
  it('test 39/42: stale writer with other bytes killed right after its link; a new process retries -> conflict, Canon is x', () => stale('other-kill', (e) => rival(e, 4), true), 60_000);
  it('test 42: stale writer with the same bytes killed right after its link; a new process retries -> adopted, never appended', () => stale('same-kill', (e) => e[3]!, true), 60_000);

  describe('test 41: interleavings of a writer (stopped after its link) and a compactor (stopped at K3/K4/K5)', () => {
    const C_POINTS: Array<{ name: string; hook: Omit<Hook, 'barrier'> }> = [
      { name: 'before the segment link', hook: { op: 'link', match: ANY_SEG, phase: 'before' } },
      { name: 'after the segment link', hook: { op: 'link', match: ANY_SEG, phase: 'after' } },
      { name: 'after the cleanup', hook: { op: 'unlink', match: ANY_EV, phase: 'after', nth: 4 } },
    ];
    for (const pt of C_POINTS) {
      for (const order of ['writer-first', 'compactor-first'] as const) {
        it(`compactor stopped ${pt.name}; ${order}`, async () => {
          const run = new Run();
          const id = 'i41';
          const evs = await seed(run, id, 3);
          const x = chain(id, 4)[3]!;
          const W = run.spawn('w', [{ op: 'append', event: x }], [{ op: 'link', match: evRe(4), phase: 'after', barrier: 'w' }]);
          await W.ready('w'); // x@4 is published; the writer is stopped before CEI
          const C = run.spawn('c', [{ op: 'compact', taskId: id, throughSeq: 4, events: [...evs, x] }], [{ ...pt.hook, barrier: 'c' }]);
          await C.ready('c');
          const first = order === 'writer-first' ? { p: W, b: 'w' } : { p: C, b: 'c' };
          const second = order === 'writer-first' ? { p: C, b: 'c' } : { p: W, b: 'w' };
          first.p.release(first.b);
          const r1 = await first.p.finish();
          second.p.release(second.b);
          const r2 = await second.p.finish();
          const w = val(step(order === 'writer-first' ? r1 : r2, 'append'));
          const c = val(step(order === 'writer-first' ? r2 : r1, 'compact'));
          expect(c).toMatchObject({ packedEvents: 4 });
          // CEI-6: "appended" needs own link AND loose evidence (no covering segment visible after the link).
          const segmentVisibleBeforeCei = order === 'compactor-first' || pt.hook.phase === 'after' ? true : false;
          expect(w, `writer ${order}, compactor ${pt.name}`).toBe(segmentVisibleBeforeCei ? 'adopted' : 'appended');
          const log = val(step(await observe(run, id), 'readLog'));
          expect(log.hashes[3], 'Canon(4) = x in every interleaving').toBe(x.hash);
        }, 60_000);
      }
    }
  });

  it('test 42: SIGKILL of the first publisher after its link and after its completed append; a new process retries -> adopted, no new right', async () => {
    for (const where of ['after-link', 'after-return'] as const) {
      const run = new Run();
      const id = `k42-${where}`;
      await seed(run, id, 3);
      const x = chain(id, 4)[3]!;
      const W =
        where === 'after-link'
          ? run.spawn('w', [{ op: 'append', event: x }], [{ op: 'link', match: evRe(4), phase: 'after', barrier: 'k' }])
          : run.spawn('w', [{ op: 'append', event: x }, { op: 'barrier', name: 'k' }]);
      await W.ready('k');
      await W.kill();
      const retry = await run.spawn('retry', [{ op: 'append', event: x }]).finish();
      expect(val(step(retry, 'append'))).toBe('adopted');
      expect(val(step(await observe(run, id), 'readLog')).hashes[3]).toBe(x.hash);
    }
  }, 60_000);
});

// =====================================================================================================================
// FIX-004F, task A — criteria 41/42 (Design A, table "Tests"): the points INSIDE `append` that link/unlink hooks cannot
// reach. The worker stops around the real fs calls of the library (`open`/`close`/`readdir`), see fix004c-worker.mjs.
//   after slot read       = `close` of the slot file (the read loop is complete, nothing judged yet),
//   before listing        = `readdir` of segments/ 'before',
//   after listing         = `readdir` of segments/ 'after' (the coverage is decided from it: the evaluation itself does
//                           no fs call, so nothing another process does can change it between listing and decision),
//   before segment read   = `open` of a segment file 'before' (covered case, after the coverage check).
// segments/ is created empty in the fixture: without the directory the library skips the listing (no readdir at all).
// =====================================================================================================================

const SEGDIR = '/segments$';
const mkSegDir = (run: Run, id: string): void => mkdirSync(join(taskDir(run, id), 'segments'), { recursive: true });

describe('FIX-004F A — test 41: writer stopped INSIDE append x compactor in every state', () => {
  type CState = 'none' | 'K3 before segment link' | 'K4 after segment link' | 'K5 after cleanup' | 'done';
  const C_STATES: Array<{ s: CState; hook?: Omit<Hook, 'barrier'>; segVisible: boolean }> = [
    { s: 'none', segVisible: false },
    { s: 'K3 before segment link', hook: { op: 'link', match: ANY_SEG, phase: 'before' }, segVisible: false },
    { s: 'K4 after segment link', hook: { op: 'link', match: ANY_SEG, phase: 'after' }, segVisible: true },
    { s: 'K5 after cleanup', hook: { op: 'unlink', match: ANY_EV, phase: 'after', nth: 4 }, segVisible: true },
    { s: 'done', segVisible: true },
  ];
  interface W {
    name: string;
    publisher: 'self' | 'earlier'; // who created the loose file of slot 4
    cand: 'x' | 'other';
    hook: Omit<Hook, 'barrier'>;
    expect: (segVisibleAtListing: boolean) => string;
  }
  const W_POINTS: W[] = [
    { name: 'own link, stopped before the listing', publisher: 'self', cand: 'x', hook: { op: 'readdir', match: SEGDIR, phase: 'before' }, expect: (v) => (v ? 'adopted' : 'appended') },
    { name: 'own link, stopped after the listing (coverage decided: none)', publisher: 'self', cand: 'x', hook: { op: 'readdir', match: SEGDIR, phase: 'after' }, expect: () => 'appended' },
    { name: 'EEXIST, stopped after the slot read', publisher: 'earlier', cand: 'x', hook: { op: 'close', match: evRe(4), phase: 'before' }, expect: () => 'adopted' },
    { name: 'EEXIST, stopped before the listing', publisher: 'earlier', cand: 'x', hook: { op: 'readdir', match: SEGDIR, phase: 'before' }, expect: () => 'adopted' },
    { name: 'EEXIST, stopped after the listing (coverage decided: none)', publisher: 'earlier', cand: 'x', hook: { op: 'readdir', match: SEGDIR, phase: 'after' }, expect: () => 'adopted' },
    { name: 'EEXIST with OTHER bytes, stopped after the slot read', publisher: 'earlier', cand: 'other', hook: { op: 'close', match: evRe(4), phase: 'before' }, expect: () => 'conflict' },
    { name: 'EEXIST with OTHER bytes, stopped after the listing', publisher: 'earlier', cand: 'other', hook: { op: 'readdir', match: SEGDIR, phase: 'after' }, expect: () => 'conflict' },
  ];
  for (const w of W_POINTS) {
    for (const c of C_STATES) {
      it(`writer: ${w.name}; compactor: ${c.s}`, async () => {
        const run = new Run();
        const id = 'f41';
        const evs = await seed(run, id, 3);
        mkSegDir(run, id);
        const x = chain(id, 4)[3]!;
        if (w.publisher === 'earlier') expect(await run.store().append(x)).toBe('appended');
        const cand = w.cand === 'x' ? x : rival(chain(id, 4), 4);
        const W = run.spawn('w', [{ op: 'append', event: cand }], [{ ...w.hook, barrier: 'w' }]);
        await W.ready('w'); // W stands at the point, the compactor has not touched anything yet
        let C: Proc | null = null;
        if (c.s === 'done') {
          const cr = await run.spawn('c', [{ op: 'compact', taskId: id, throughSeq: 4, events: [...evs, x] }]).finish();
          expect(val(step(cr, 'compact'))).toMatchObject({ packedEvents: 4 });
        } else if (c.hook) {
          C = run.spawn('c', [{ op: 'compact', taskId: id, throughSeq: 4, events: [...evs, x] }], [{ ...c.hook, barrier: 'c' }]);
          await C.ready('c'); // the compactor stands at its point WHILE the writer stands at its own
        }
        if (w.publisher === 'self' && w.hook.phase === 'before') {
          // The listing happens after release: what it sees is the compactor's state now (K3: nothing yet; K4+: segment).
        }
        W.release('w');
        const wr = await W.finish();
        expect(val(step(wr, 'append')), `${w.name} / ${c.s}`).toBe(w.expect(w.hook.phase === 'before' ? c.segVisible : false));
        if (C) {
          C.release('c');
          expect(val(step(await C.finish(), 'compact'))).toMatchObject({ packedEvents: 4 });
        } else if (c.s === 'none') {
          const cr = await run.spawn('c', [{ op: 'compact', taskId: id, throughSeq: 4, events: [...evs, x] }]).finish();
          expect(val(step(cr, 'compact'))).toMatchObject({ packedEvents: 4 });
        }
        const log = val(step(await observe(run, id), 'readLog'));
        expect(log.seqs).toEqual([1, 2, 3, 4]);
        expect(log.hashes[3], 'Canon(4) = x in every interleaving').toBe(x.hash);
        expect(segments(run, id)).toHaveLength(1);
      }, 60_000);
    }
  }
});

describe('FIX-004F A — test 42: SIGKILL INSIDE append, then a fresh process retries', () => {
  // Every kill point of a writer of slot 4. `pre` prepares the filesystem before the victim starts.
  const POINTS: Array<{ name: string; pre: 'plain' | 'covered'; hook: Omit<Hook, 'barrier'>; publisher: 'victim' | 'earlier' }> = [
    { name: 'own publisher, after the link', pre: 'plain', hook: { op: 'link', match: evRe(4), phase: 'after' }, publisher: 'victim' },
    { name: 'own publisher, before the listing', pre: 'plain', hook: { op: 'readdir', match: SEGDIR, phase: 'before' }, publisher: 'victim' },
    { name: 'own publisher, after the listing (coverage decided: none)', pre: 'plain', hook: { op: 'readdir', match: SEGDIR, phase: 'after' }, publisher: 'victim' },
    { name: 'retrying writer, after the slot read', pre: 'plain', hook: { op: 'close', match: evRe(4), phase: 'before' }, publisher: 'earlier' },
    { name: 'retrying writer, after the listing (coverage decided: none)', pre: 'plain', hook: { op: 'readdir', match: SEGDIR, phase: 'after' }, publisher: 'earlier' },
    { name: 'stale writer into a freed slot, after the listing (coverage decided: covered)', pre: 'covered', hook: { op: 'readdir', match: SEGDIR, phase: 'after' }, publisher: 'victim' },
    { name: 'stale writer into a freed slot, before reading the covering segment', pre: 'covered', hook: { op: 'open', match: ANY_SEG, phase: 'before' }, publisher: 'victim' },
  ];
  for (const pt of POINTS) {
    it(`${pt.name}`, async () => {
      const run = new Run();
      const id = 'f42';
      const evs = await seed(run, id, 3);
      mkSegDir(run, id);
      const x = chain(id, 4)[3]!;
      if (pt.pre === 'covered') {
        expect(await run.store().append(x)).toBe('appended');
        const cr = await run.spawn('c', [{ op: 'compact', taskId: id, throughSeq: 4, events: [...evs, x] }]).finish();
        expect(val(step(cr, 'compact'))).toMatchObject({ packedEvents: 4 });
        expect(looseSeqs(run, id)).not.toContain(4);
      } else if (pt.publisher === 'earlier') {
        expect(await run.store().append(x)).toBe('appended');
      }
      const V = run.spawn('victim', [{ op: 'append', event: x }], [{ ...pt.hook, barrier: 'k' }]);
      await V.ready('k');
      await V.kill(); // real SIGKILL at the exact point
      const retry = await run.spawn('retry', [{ op: 'append', event: x }]).finish();
      const out = val(step(retry, 'append'));
      expect(out, 'a retry after a killed writer never gets "appended" (CEI-5): the first publication belongs to someone else').toBe('adopted');
      // A second kill-free fresh process sees the same Canon; nothing was lost, nothing was invented.
      const log = val(step(await observe(run, id), 'readLog'));
      expect(log.seqs).toEqual([1, 2, 3, 4]);
      expect(log.hashes[3]).toBe(x.hash);
      expect(names(join(taskDir(run, id), 'events')).filter((n) => n.includes('.tmp.')), 'no staging residue').toEqual([]);
    }, 60_000);
  }

  // No second execution right: the rights-bearing events, victim killed at each point reachable in its own append.
  const OWN_POINTS: Array<{ name: string; hook: Omit<Hook, 'barrier'> }> = [
    { name: 'after the link', hook: { op: 'link', match: ANY_EV, phase: 'after' } },
    { name: 'before the listing', hook: { op: 'readdir', match: SEGDIR, phase: 'before' } },
    { name: 'after the listing', hook: { op: 'readdir', match: SEGDIR, phase: 'after' } },
  ];
  for (const pt of OWN_POINTS) {
    it(`run.claimed: claimant killed ${pt.name}; the next claimant gets no lease, the epoch stays 1`, async () => {
      const run = new Run();
      const rt = new DurableTasks({ store: run.store() });
      await rt.createTask({ taskId: 'f42c', kind: 'k', goal: 'g' });
      mkSegDir(run, 'f42c');
      const A = run.spawn('a', [{ op: 'rt.claim', taskId: 'f42c', owner: 'a', leaseMs: 600_000 }], [{ ...pt.hook, ...(pt.hook.op === 'link' ? {} : { since: { link: ANY_EV } }), barrier: 'k' }]); // armed by the event's own link: the stop is inside append
      const before = looseSeqs(run, 'f42c').length;
      await A.ready('k');
      expect(looseSeqs(run, 'f42c').length, 'the claim is already published: the stop is inside append').toBe(before + 1);
      await A.kill();
      const B = await run.spawn('b', [{ op: 'rt.claim', taskId: 'f42c', owner: 'b', leaseMs: 600_000, tolerate: true }, { op: 'rt.state', taskId: 'f42c' }]).finish();
      expect(val(step(B, 'rt.claim'))).toBe('ERR:LeaseHeldError');
      expect(val(step(B, 'rt.state'))).toMatchObject({ epoch: 1 });
    }, 60_000);

    it(`effect.intended: process killed ${pt.name}; the retry is "in doubt", the effect ran zero times`, async () => {
      const run = new Run();
      const rt = new DurableTasks({ store: run.store() });
      await rt.createTask({ taskId: 'f42e', kind: 'k', goal: 'g' });
      const fence = await rt.claim('f42e', { owner: 'o', leaseMs: 600_000 });
      mkSegDir(run, 'f42e');
      const A = run.spawn('a', [{ op: 'rt.effect', fence, key: 'send-1' }], [{ ...pt.hook, ...(pt.hook.op === 'link' ? {} : { since: { link: ANY_EV } }), barrier: 'k' }]); // armed by the event's own link: the stop is inside append
      const before = looseSeqs(run, 'f42e').length;
      await A.ready('k');
      expect(looseSeqs(run, 'f42e').length, 'effect.intended is already published: the stop is inside append').toBe(before + 1);
      await A.kill();
      const B = await run.spawn('b', [{ op: 'rt.effect', fence, key: 'send-1', tolerate: true }, { op: 'readLog', taskId: 'f42e' }]).finish();
      expect(val(step(B, 'rt.effect'))).toBe('ERR:EffectInDoubtError');
      expect(existsSync(join(run.ctl, 'effects.log')), 'the controlled effect never ran').toBe(false);
      expect(val(step(B, 'readLog')).types.filter((t: string) => t === 'effect.intended')).toHaveLength(1);
    }, 60_000);
  }
});

// =====================================================================================================================
// FIX-004F B — criterion 26 (Design A, rev. 004D, C-1): no writer unlinks a published result as a reaction to G2.
// The worker records EVERY unlink the process attempts (library `ops.unlinkSync` and direct `fs.unlinkSync` alike).
// Allowed: (A') own staging `<name>.tmp.<pid>.<hex16>`; (B) loose copy covered by a published, re-read segment;
// (C) roll-forward / sweeper of a consistent COMMITTED. Anything else fails the criterion.
// UNREADABLE is covered by the existing criterion-58 test (fix004a-register.test.ts) and by the in-process case below.
// =====================================================================================================================

const STAGING = /\.tmp\.\d+\.[0-9a-f]{16}$/;
const unlinksOf = (run: Run, p: Proc): string[] => {
  const f = join(run.ctl, `${p.id}.unlinks`);
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
};

describe('FIX-004F B — criterion 26: unlink spy over every G2 outcome', () => {
  async function writerAtG2(label: string, prepare: (run: Run, id: string, evs: TaskEvent[]) => Promise<void>) {
    const run = new Run();
    const id = `c26-${label}`;
    const evs = await seed(run, id, 3);
    const x = chain(id, 4)[3]!;
    const W = run.spawn('w', [{ op: 'append', event: x, tolerate: true }], [{ op: 'link', match: evRe(4), phase: 'after', barrier: 'g2' }]);
    await W.ready('g2'); // x@4 is published, G2 has not run
    await prepare(run, id, evs);
    W.release('g2');
    const recs = await W.finish();
    return { run, id, evs, x, W, outcome: val(step(recs, 'append')) };
  }
  const onlyStaging = (run: Run, W: Proc): void => {
    const u = unlinksOf(run, W);
    expect(u.filter((p) => !STAGING.test(p)), `non-staging unlinks by the writer: ${JSON.stringify(u)}`).toEqual([]);
  };

  it('PREPARING: G2 closes the attempt with abort; the writer unlinks nothing but its staging; the event survives', async () => {
    const { run, id, W, outcome, x } = await writerAtG2('prep', async (r, id, evs) => void (await r.store().preparePrune(tombstoneOf(evs))));
    expect(outcome).toBe('appended');
    onlyStaging(run, W);
    expect(looseSeqs(run, id)).toContain(4);
    expect(val(step(await observe(run, id), 'pruneState'))).toMatchObject({ kind: 'live' });
    expect(val(step(await observe(run, id), 'readLog')).hashes[3]).toBe(x.hash);
  }, 60_000);

  it('COMMITTED: the writer is told PRUNED and does not roll back or clean up; only staging may be unlinked', async () => {
    const { run, id, W, outcome } = await writerAtG2('comm', async (r, id, evs) => {
      const s = r.store();
      const t = tombstoneOf(evs);
      const p = await s.preparePrune(t);
      await s.decidePrune(id, p.attempt, 'commit', t, 'pruner');
    });
    expect(outcome).toBe('ERR:TaskPrunedError');
    onlyStaging(run, W);
    expect(looseSeqs(run, id), 'the published event was not unlinked by the writer').toContain(4);
  }, 60_000);

  it('CORRUPT register: the writer reports corruption, unlinks only staging, the event stays', async () => {
    const { run, id, W, outcome } = await writerAtG2('corr', async (r, id, evs) => {
      await r.store().preparePrune(tombstoneOf(evs));
      writeFileSync(join(taskDir(r, id), 'prune-1.decision.json'), '{ not json');
    });
    expect(outcome).toBe('ERR:PruneDecisionCorruptError');
    onlyStaging(run, W);
    expect(looseSeqs(run, id)).toContain(4);
  }, 60_000);

  it('MISSING task directory after the publication: an error, never "appended"; only staging may be unlinked', async () => {
    const { run, W, outcome } = await writerAtG2('miss', async (r, id) => void rmSync(taskDir(r, id), { recursive: true, force: true }));
    expect(outcome).not.toBe('appended');
    expect(String(outcome)).toMatch(/^ERR:/);
    onlyStaging(run, W);
  }, 60_000);

  it('category B: a compactor unlinks only loose copies covered by the segment it published and re-read; category A\' otherwise', async () => {
    const run = new Run();
    const id = 'c26-b';
    const evs = await seed(run, id, 4);
    const C = run.spawn('c', [{ op: 'compact', taskId: id, throughSeq: 4, events: evs }]);
    expect(val(step(await C.finish(), 'compact'))).toMatchObject({ packedEvents: 4 });
    const u = unlinksOf(run, C);
    const covered = segments(run, id).length === 1;
    expect(covered).toBe(true);
    for (const p of u) expect(STAGING.test(p) || /\/events\/00000000[1-4]\.json$/.test(p), `unexpected unlink ${p}`).toBe(true);
    expect(u.filter((p) => /\/events\//.test(p) && !STAGING.test(p)).length, 'all four covered loose copies were removed').toBe(4);
  }, 60_000);

  it('category C: roll-forward of a consistent COMMITTED removes only files of that task; the commit records stay', async () => {
    const run = new Run();
    const id = 'c26-c';
    const evs = await seed(run, id, 3);
    const s = run.store();
    const t = tombstoneOf(evs);
    const p = await s.preparePrune(t);
    await s.decidePrune(id, p.attempt, 'commit', t, 'pruner');
    const R = run.spawn('r', [{ op: 'prune', tombstone: t }]);
    await R.finish();
    const u = unlinksOf(run, R);
    expect(u.length).toBeGreaterThan(0);
    for (const f of u) expect(STAGING.test(f) || f.includes(`/tasks/${id}/`), `unlink outside the committed task: ${f}`).toBe(true);
    expect(existsSync(join(taskDir(run, id), 'tombstone.json'))).toBe(true);
  }, 60_000);
});

// =====================================================================================================================
// Amendment-004G S1 (lost response), rights-bearing events must not grant a second right
// =====================================================================================================================

describe('Amendment-004G S1 — lost response', () => {
  it('store level: publication succeeded, the process died before it could answer; a new process retries -> adopted', async () => {
    const run = new Run();
    await seed(run, 's1', 3);
    const e4 = chain('s1', 4)[3]!;
    const A = run.spawn('a', [{ op: 'append', event: e4 }], [{ op: 'link', match: evRe(4), phase: 'after', barrier: 'lost' }]);
    await A.ready('lost');
    await A.kill();
    expect(looseSeqs(run, 's1')).toContain(4);
    const B = await run.spawn('b', [{ op: 'append', event: e4 }]).finish();
    expect(val(step(B, 'append'))).toBe('adopted');
  }, 30_000);

  it('run.claimed: the claimant dies after its event is published; a second claimant gets no lease, the epoch stays 1', async () => {
    const run = new Run();
    const rt = new DurableTasks({ store: run.store() });
    await rt.createTask({ taskId: 's1c', kind: 'k', goal: 'g' });
    const A = run.spawn('a', [{ op: 'rt.claim', taskId: 's1c', owner: 'a', leaseMs: 600_000 }], [{ op: 'link', match: ANY_EV, phase: 'after', barrier: 'lost' }]);
    await A.ready('lost');
    await A.kill();
    const B = await run.spawn('b', [{ op: 'rt.claim', taskId: 's1c', owner: 'b', leaseMs: 600_000, tolerate: true }, { op: 'rt.state', taskId: 's1c' }]).finish();
    expect(val(step(B, 'rt.claim'))).toBe('ERR:LeaseHeldError');
    expect(val(step(B, 'rt.state'))).toMatchObject({ epoch: 1 });
  }, 30_000);

  it('effect.intended: the process dies right after the announcement is published; a retry cannot run the effect again (in doubt), the effect ran zero times', async () => {
    const run = new Run();
    const rt = new DurableTasks({ store: run.store() });
    await rt.createTask({ taskId: 's1e', kind: 'k', goal: 'g' });
    const fence = await rt.claim('s1e', { owner: 'o', leaseMs: 600_000 });
    const A = run.spawn('a', [{ op: 'rt.effect', fence, key: 'send-1' }], [{ op: 'link', match: ANY_EV, phase: 'after', barrier: 'lost' }]);
    await A.ready('lost');
    await A.kill();
    const B = await run.spawn('b', [{ op: 'rt.effect', fence, key: 'send-1', tolerate: true }, { op: 'readLog', taskId: 's1e' }]).finish();
    expect(val(step(B, 'rt.effect'))).toBe('ERR:EffectInDoubtError');
    expect(existsSync(join(run.ctl, 'effects.log')), 'the controlled effect never ran').toBe(false);
    expect(val(step(B, 'readLog')).types.filter((t: string) => t === 'effect.intended')).toHaveLength(1);
  }, 30_000);
});

// =====================================================================================================================
// D-1 / criterion 77 (AC-ADO-5): two runtimes, one rights-bearing slot
// =====================================================================================================================

describe('D-1 / AC-ADO-5 — two independent runtimes compete for one rights-bearing slot', () => {
  const RACE = (): Hook[] => [{ op: 'link', match: ANY_EV, phase: 'before', barrier: 'race' }];
  const ROUNDS = 3;

  it('task.created: exactly one creator, the other sees created=false (idempotent createTask)', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const run = new Run();
      run.store();
      const mk = (): Proc => run.spawn('create', [{ op: 'rt.createTask', input: { taskId: 'd1-new', kind: 'k', goal: 'g' } }], RACE());
      const [A, B] = [mk(), mk()];
      await run.rendezvous('race', [A, B]);
      const created = [val(step(await A.finish(), 'rt.createTask')), val(step(await B.finish(), 'rt.createTask'))].map((v) => v.created).sort();
      expect(created).toEqual([false, true]);
      const log = val(step(await observe(run, 'd1-new'), 'readLog'));
      expect(log.types).toEqual(['task.created']);
    }
  }, 120_000);

  it('run.claimed: at most one claimant obtains the lease, the other gets no fence', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const run = new Run();
      await new DurableTasks({ store: run.store() }).createTask({ taskId: 'd1-claim', kind: 'k', goal: 'g' });
      const mk = (owner: string): Proc => run.spawn(owner, [{ op: 'rt.claim', taskId: 'd1-claim', owner, leaseMs: 600_000, tolerate: true }], RACE());
      const [A, B] = [mk('a'), mk('b')];
      await run.rendezvous('race', [A, B]);
      const outs = [val(step(await A.finish(), 'rt.claim')), val(step(await B.finish(), 'rt.claim'))];
      expect(outs.filter((o) => typeof o === 'object')).toHaveLength(1);
      expect(outs.filter((o) => typeof o === 'string')[0]).toMatch(/^ERR:(LeaseHeldError|ContentionError)$/);
      const log = val(step(await observe(run, 'd1-claim'), 'readLog'));
      expect(log.types.filter((t: string) => t === 'run.claimed')).toHaveLength(1);
    }
  }, 120_000);

  it('effect.intended: the controlled effect runs at most once; the loser gets no right (conflict / in doubt)', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const run = new Run();
      const rt = new DurableTasks({ store: run.store() });
      await rt.createTask({ taskId: 'd1-eff', kind: 'k', goal: 'g' });
      const fence = await rt.claim('d1-eff', { owner: 'o', leaseMs: 600_000 });
      const mk = (): Proc => run.spawn('eff', [{ op: 'rt.effect', fence, key: 'pay-1', tolerate: true }], RACE());
      const [A, B] = [mk(), mk()];
      await run.rendezvous('race', [A, B]);
      const outs = [val(step(await A.finish(), 'rt.effect')), val(step(await B.finish(), 'rt.effect'))];
      // The right to run the effect belongs to the one whose result is NOT a replay; the other either gets an error or
      // replays the winner's recorded result (fn not called). `effects.log` below proves fn ran once.
      expect(outs.filter((o) => typeof o === 'object' && o.replayed === false), JSON.stringify(outs)).toHaveLength(1);
      for (const o of outs) if (typeof o === 'string') expect(o).toMatch(/^ERR:(EffectConflictError|EffectInDoubtError|ContentionError)$/);
      else expect(o).toHaveProperty('replayed');
      const lines = readFileSync(join(run.ctl, 'effects.log'), 'utf8').trim().split('\n');
      expect(lines, 'controlled effect executions').toHaveLength(1);
      expect(val(step(await observe(run, 'd1-eff'), 'readLog')).types.filter((t: string) => t === 'effect.intended')).toHaveLength(1);
    }
  }, 120_000);

  it('await.resolved: one delivery is accepted, the competing one is not (accepted exactly once)', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const run = new Run();
      const rt = new DurableTasks({ store: run.store() });
      await rt.createTask({ taskId: 'd1-await', kind: 'k', goal: 'g' });
      const fence = await rt.claim('d1-await', { owner: 'o', leaseMs: 600_000 });
      const w = await rt.registerAwait(fence, { awaitId: 'a', purpose: 'p' });
      const mk = (key: string): Proc => run.spawn(key, [{ op: 'rt.deliver', token: w.token, key, tolerate: true }], RACE());
      const [A, B] = [mk('k1'), mk('k2')];
      await run.rendezvous('race', [A, B]);
      const outs = [val(step(await A.finish(), 'rt.deliver')), val(step(await B.finish(), 'rt.deliver'))].map((v) => (typeof v === 'object' ? v.kind : v));
      expect(outs.filter((o) => o === 'accepted'), JSON.stringify(outs)).toHaveLength(1);
      expect(val(step(await observe(run, 'd1-await'), 'readLog')).types.filter((t: string) => t === 'await.resolved')).toHaveLength(1);
    }
  }, 120_000);
});

// =====================================================================================================================
// Section 13: crash recovery of the prune decision and of cleanup
// =====================================================================================================================

describe('crash recovery — prune decision publication and cleanup (SIGKILL)', () => {
  it('killed right after prepare was published: PREPARING is derived by a new process; a writer proceeds (G2 aborts); a later attempt gets number 2', async () => {
    const run = new Run();
    const id = 'cr-prep';
    const evs = await seed(run, id, 3);
    const tomb = tombstoneOf(evs);
    const A = run.spawn('pruner', [{ op: 'prepare', tombstone: tomb }], [{ op: 'link', match: 'prune-\\d+\\.prepare\\.json$', phase: 'after', barrier: 'k' }]);
    await A.ready('k');
    await A.kill();
    const r = await run.spawn('fresh', [
      { op: 'pruneState', taskId: id },
      { op: 'append', event: chain(id, 4)[3] },
      { op: 'pruneState', taskId: id },
      { op: 'prepare', tombstone: tomb },
    ]).finish();
    expect(val(r[0])).toMatchObject({ kind: 'preparing', attempt: 1 });
    expect(val(r[1])).toBe('appended');
    expect(val(r[2]).kind).toBe('live');
    expect(val(r[3])).toMatchObject({ attempt: 2, created: true });
  }, 60_000);

  it('killed right after decision=commit was published: a new process derives COMMITTED, refuses appends, and rolls the cleanup forward idempotently', async () => {
    const run = new Run();
    const id = 'cr-commit';
    const evs = await seed(run, id, 3);
    const tomb = tombstoneOf(evs);
    const A = run.spawn('pruner', [{ op: 'prepare', tombstone: tomb }, { op: 'decide', outcome: 'commit', tombstone: tomb }, { op: 'prune', tombstone: tomb, requireCommit: true }],
      [{ op: 'link', match: 'prune-1\\.decision\\.json$', phase: 'after', barrier: 'k' }]);
    await A.ready('k');
    await A.kill();
    expect(looseSeqs(run, id), 'nothing was deleted yet').toEqual([1, 2, 3]);
    const r = await run.spawn('fresh', [
      { op: 'pruneState', taskId: id },
      { op: 'append', event: chain(id, 4)[3], tolerate: true },
      { op: 'prune', tombstone: tomb, requireCommit: true },
      { op: 'prune', tombstone: tomb, requireCommit: true },
      { op: 'pruneState', taskId: id },
    ]).finish();
    expect(val(r[0])).toMatchObject({ kind: 'committed', attempt: 1 });
    expect(val(r[1])).toBe('ERR:TaskPrunedError');
    expect(r[2]?.ok && r[3]?.ok, 'prune twice').toBe(true);
    expect(val(r[4])).toMatchObject({ kind: 'committed', residue: 0 });
    expect(names(taskDir(run, id))).toEqual(expect.arrayContaining(['prune-1.prepare.json', 'prune-1.decision.json', 'tombstone.json']));
  }, 60_000);

  it('killed in the middle of the physical cleanup: COMMITTED with residue; a new process finishes the deletion; the commit records stay', async () => {
    const run = new Run();
    const id = 'cr-clean';
    const evs = await seed(run, id, 5);
    const tomb = tombstoneOf(evs);
    const A = run.spawn('pruner', [{ op: 'prepare', tombstone: tomb }, { op: 'decide', outcome: 'commit', tombstone: tomb }, { op: 'prune', tombstone: tomb, requireCommit: true }],
      [{ op: 'unlink', match: ANY_EV, phase: 'after', nth: 2, barrier: 'k' }]);
    await A.ready('k');
    await A.kill();
    const partly = looseSeqs(run, id);
    expect(partly.length, 'cleanup really was interrupted').toBeGreaterThan(0);
    expect(partly.length).toBeLessThan(5);
    const r = await run.spawn('fresh', [
      { op: 'pruneState', taskId: id },
      { op: 'prune', tombstone: tomb, requireCommit: true },
      { op: 'pruneState', taskId: id },
    ]).finish();
    expect(val(r[0]).kind).toBe('committed');
    expect(val(r[2])).toMatchObject({ kind: 'committed', residue: 0 });
    expect(looseSeqs(run, id)).toEqual([]);
    expect(names(taskDir(run, id))).toEqual(expect.arrayContaining(['prune-1.prepare.json', 'prune-1.decision.json', 'tombstone.json']));
  }, 60_000);

  it('runtime rights acquisition: a claimant killed after publishing run.claimed; after the lease lapses another process obtains the next epoch', async () => {
    const run = new Run();
    await new DurableTasks({ store: run.store() }).createTask({ taskId: 'cr-claim', kind: 'k', goal: 'g' });
    const A = run.spawn('a', [{ op: 'rt.claim', taskId: 'cr-claim', owner: 'a', leaseMs: 50 }], [{ op: 'link', match: ANY_EV, phase: 'after', barrier: 'k' }]);
    await A.ready('k');
    await A.kill();
    await sleep(150); // only the lease clock, not a synchronisation of the processes under test
    const r = await run.spawn('b', [{ op: 'rt.claim', taskId: 'cr-claim', owner: 'b', leaseMs: 60_000 }, { op: 'rt.state', taskId: 'cr-claim' }]).finish();
    expect(val(r[0])).toMatchObject({ owner: 'b', epoch: 2 });
    expect(val(r[1])).toMatchObject({ epoch: 2 });
  }, 60_000);
});

// =====================================================================================================================
// Criterion 70 (AC-A2-1, test 49): filesystem probe for FS-1…FS-4 (observation on this environment, not a proof)
// =====================================================================================================================

function fsType(path: string): string {
  const r = spawnSync('stat', ['-f', '-c', '%T', path], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

interface ProbeReport {
  os: string;
  kernel: string;
  tempRoot: string;
  filesystem: string;
  rounds: number;
  fs1Races: number;
  fs1Violations: number;
  churnListings: number;
  violations: string[];
}

async function runProbe(base: string, rounds: number): Promise<ProbeReport> {
  const root = mkdtempSync(join(base, 'fix004c-a2r-'));
  const ctl = mkdtempSync(join(base, 'fix004c-a2r-ctl-'));
  dirsToRemove.push(root, ctl);
  for (const d of ['stage', 'final', 'segments', 'events', 'churn', 'flag', 'P', 'P/events']) mkdirSync(join(root, d), { recursive: true });
  for (let s = 0; s < 8; s++) writeFileSync(join(root, 'churn', `stable_${s}`), '');
  for (let k = 0; k < rounds; k++) {
    writeFileSync(join(root, 'events', `loose_${k}`), 'loose\n');
    writeFileSync(join(root, 'P', 'events', `old_${k}`), 'old\n');
  }
  const kids: ChildProcess[] = [];
  const exits: Promise<number | null>[] = [];
  for (const role of ['A', 'B']) {
    const cfg = join(ctl, `${role}.cfg.json`);
    writeFileSync(cfg, JSON.stringify({ id: role, role, root, ctl, rounds }));
    const c = spawn(process.execPath, [join(build, 'probe-worker.mjs'), cfg], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr?.on('data', (d) => (err += d));
    kids.push(c);
    exits.push(new Promise((res) => c.on('close', (code) => res(code === 0 ? 0 : (console.error(err), code)))));
  }
  try {
    for (let k = 0; k < rounds; k++) {
      const t0 = Date.now();
      for (const role of ['A', 'B']) {
        while (!existsSync(join(ctl, `r${k}.${role}.ready`))) {
          if (Date.now() - t0 > BARRIER_TIMEOUT_MS) throw new Error(`BARRIER TIMEOUT: probe ${role} never reached round ${k}`);
          await sleep(1);
        }
      }
      writeFileSync(join(ctl, `r${k}.release`), '');
    }
    expect(await Promise.all(exits)).toEqual([0, 0]);
  } finally {
    for (const c of kids) c.kill('SIGKILL');
  }
  const read = (role: string): Array<Record<string, any>> => // eslint-disable-line @typescript-eslint/no-explicit-any
    readFileSync(join(ctl, `${role}.log`), 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((r) => !r.done);
  const A = read('A');
  const B = read('B');
  const violations: string[] = [];
  let fs1Violations = 0;
  for (let k = 0; k < rounds; k++) {
    const a = A.find((r) => r.k === k);
    const b = B.find((r) => r.k === k);
    if (!a || !b) { violations.push(`round ${k}: missing result`); continue; }
    if ((a.won ? 1 : 0) + (b.won ? 1 : 0) !== 1) { fs1Violations++; violations.push(`round ${k}: FS-1 winners = ${(a.won ? 1 : 0) + (b.won ? 1 : 0)}`); }
    // the name was never overwritten after the race
    const final = readFileSync(join(root, 'final', `f_${k}`), 'utf8');
    if (final !== `${a.won ? 'A' : 'B'}${k}\n`) { fs1Violations++; violations.push(`round ${k}: FS-1 final content ${JSON.stringify(final)}`); }
    for (const v of [...a.violations, ...b.violations]) violations.push(`round ${k}: ${v}`);
  }
  return {
    os: `${type()} ${platform()}`,
    kernel: release(),
    tempRoot: base,
    filesystem: fsType(base),
    rounds,
    fs1Races: rounds,
    fs1Violations,
    churnListings: B.reduce((n, r) => n + (r.lists ?? 0), 0),
    violations,
  };
}

describe('criterion 70 (AC-A2-1, test 49) — two-process filesystem probe', () => {
  it('FS-1 create-only link race, FS-2/FS-3 chains (link segment < unlink loose < link event < readdir; link decision < unlink events < link events < readdir P), FS-4 listings under churn', async () => {
    const bases = [...new Set([tmpdir(), '/dev/shm', '/var/tmp'].filter((d) => existsSync(d) && statSync(d).isDirectory()))];
    const reports: ProbeReport[] = [];
    for (const base of bases) {
      try {
        reports.push(await runProbe(base, 120));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EACCES') continue; // an unwritable candidate directory is not a result
        throw e;
      }
    }
    expect(reports.length).toBeGreaterThan(0);
    const dir = process.env['FIX004C_REPORT_DIR'];
    if (dir) writeFileSync(join(dir, 'a2r-probe.json'), JSON.stringify({ at: new Date().toISOString(), node: process.version, reports }, null, 2));
    // eslint-disable-next-line no-console
    console.log(`A2-R PROBE ${JSON.stringify(reports)}`);
    for (const r of reports) expect(r.violations, `${r.filesystem} at ${r.tempRoot}`).toEqual([]);
  }, 300_000);
});
