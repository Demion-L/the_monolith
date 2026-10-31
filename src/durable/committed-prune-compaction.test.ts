/**
 * DURABLE-SEC-006A / F-1, F-4. The audit of a committed prune (O-1) must not take a concurrent compaction for damage.
 * Compaction publishes a segment and only then removes the loose events it covers; the audit lists the loose events and
 * then the segments. The interleaving is controlled with `auditHook` (in-process, no timing): the compactor is the REAL
 * `compact` (its steps K0..K5 run synchronously), started from inside the audit.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FsEventStore } from './fs-store.js';
import { createFsStoreWithSeams } from './testing.js';
import { encodeDecision, encodePrepare, prepareFile, decisionFile, TOMBSTONE_FILE } from './register.js';
import { stampEvent } from './log.js';
import { tombstoneFor } from './prune-check.js';
import { foldEvents } from './projection.js';
import { GENESIS_HASH, type TaskEvent, type Tombstone } from './types.js';
import { PruneDecisionCorruptError, TaskPrunedError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'durable-f1-'));
  dirs.push(d);
  return d;
};

function chain(taskId: string, n: number, finished: boolean): TaskEvent[] {
  const out: TaskEvent[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const at = `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`;
    const e =
      seq === 1
        ? stampEvent(taskId, 1, at, prev, { type: 'task.created', actor: null, data: { kind: 'k', goal: 'g', input: null, parentTaskId: null, dependsOn: [], labels: {} } })
        : finished && seq === n
          ? stampEvent(taskId, seq, at, prev, { type: 'task.completed', actor: 'x', data: { result: { ok: true } } })
          : stampEvent(taskId, seq, at, prev, { type: 'fact.observed', actor: 'x', data: { key: `k${seq}`, fingerprint: `f${seq}`, value: seq, source: null } });
    out.push(e);
    prev = e.hash;
  }
  return out;
}

type Seams = Parameters<typeof createFsStoreWithSeams>[0] extends infer T ? Partial<T> : never;
const openStore = (dir: string, seams: Seams = {}): FsEventStore => {
  const s = createFsStoreWithSeams({ target: { scope: 'trusted-directory', dir }, durability: 'file', ...seams });
  s.initializeProtocolSync();
  return s;
};
const taskDir = (dir: string): string => join(dir, 'tasks', 't1');
const ls = (dir: string, sub: string): string[] => (existsSync(join(taskDir(dir), sub)) ? readdirSync(join(taskDir(dir), sub)).sort() : []);
const pad = (n: number): string => String(n).padStart(9, '0');
const looseName = (seq: number): string => `${pad(seq)}.json`;
const segName = (from: number, to: number): string => `S${pad(from)}-${pad(to)}.jsonl`;

async function appendAll(dir: string, evs: TaskEvent[]): Promise<void> {
  const s = openStore(dir);
  for (const e of evs) expect(await s.append(e)).toBe('appended');
}

async function committed(dir: string, evs: TaskEvent[]): Promise<Tombstone> {
  await appendAll(dir, evs);
  const s = openStore(dir);
  const t = tombstoneFor(foldEvents(evs), 'c');
  const { attempt } = await s.preparePrune(t);
  expect(await s.decidePrune('t1', attempt, 'commit', t, 'pruner')).toBe('commit');
  return t;
}

/**
 * The real `compact`, started from inside the audit. Its steps K0..K5 (publish the segment, remove the loose copies) run
 * before `compact` first awaits, so they are done when this returns; `earlyPruneCheck: false` lets it run although the
 * register already says COMMITTED (a compaction that started before the commit), and K6 then reports the task as pruned.
 */
function compactor(dir: string, evs: TaskEvent[]): { run: (from: number, to: number) => void; settled: () => Promise<void> } {
  const store = openStore(dir, { earlyPruneCheck: false });
  const pending: Array<Promise<unknown>> = [];
  return {
    run: (from, to) => {
      pending.push(store.compact('t1', to, evs.slice(from - 1, to)).catch((e: unknown) => (e instanceof TaskPrunedError ? undefined : Promise.reject(e))));
      expect(ls(dir, 'segments')).toContain(segName(from, to)); // published ...
      for (let q = from; q <= to; q++) expect(ls(dir, 'events')).not.toContain(looseName(q)); // ... and the loose copies are gone
    },
    settled: async () => void (await Promise.all(pending)),
  };
}

/** the roll-forward of another pruner, run to the end from inside the audit. */
function otherPruner(dir: string, t: Tombstone): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    (openStore(dir) as unknown as { rollForward(id: string, t: Tombstone): unknown }).rollForward('t1', t);
  };
}

const refused = async (p: Promise<unknown>): Promise<PruneDecisionCorruptError> => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(PruneDecisionCorruptError);
  return err as PruneDecisionCorruptError;
};

describe('F-1: a concurrent compaction does not turn a healthy log into a refusal', () => {
  it('A: one compaction between the listing of the loose events and the listing of the segments; one look is enough', async () => {
    const dir = newDir();
    const evs = chain('t1', 6, true);
    const t = await committed(dir, evs);
    const c = compactor(dir, evs);
    let surveys = 0;
    const b = openStore(dir, { auditHook: (p) => (p === 'listed' ? c.run(1, 3) : void surveys++) });
    await b.prune(t);
    await c.settled();
    expect(surveys).toBe(1); // no second pass was needed
    expect(ls(dir, 'events')).toEqual([]);
    expect(ls(dir, 'segments')).toEqual([]);
    expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(true);
  });

  for (const n of [2, 3, 4]) {
    it(`B: ${n} compactions, one in every look of the audit (the reviewer's scenario), succeed in a single look`, async () => {
      const dir = newDir();
      const evs = chain('t1', 2 * n + 2, true);
      const t = await committed(dir, evs);
      const c = compactor(dir, evs);
      let listed = 0;
      let surveys = 0;
      const b = openStore(dir, {
        auditHook: (p) => {
          if (p === 'surveyed') surveys++;
          else if (listed++ < n) c.run(2 * listed - 1, 2 * listed);
        },
      });
      await b.prune(t);
      await c.settled();
      expect(surveys).toBe(1);
      expect(listed).toBe(1); // the hook ran for the first look only; the compactions the later looks would have met never had to happen
      expect(ls(dir, 'events')).toEqual([]);
      expect(ls(dir, 'segments')).toEqual([]);
    });
  }

  it('B: compactions that overlap earlier ones (a longer range over a shorter one) are no problem either', async () => {
    const dir = newDir();
    const evs = chain('t1', 8, true);
    const t = await committed(dir, evs);
    const c = compactor(dir, evs);
    c.run(1, 2);
    const b = openStore(dir, { auditHook: (p) => p === 'listed' && c.run(1, 6) });
    await b.prune(t);
    await c.settled();
    expect(ls(dir, 'events')).toEqual([]);
    expect(ls(dir, 'segments')).toEqual([]);
  });

  it('C: a slot that is really missing (no tombstone) is still refused, compaction or not, and nothing is removed', async () => {
    const dir = newDir();
    const evs = chain('t1', 6, true);
    const t = await committed(dir, evs);
    unlinkSync(join(taskDir(dir), 'events', looseName(5))); // real damage, in no segment
    const c = compactor(dir, evs.slice(0, 6));
    let surveys = 0;
    const b = openStore(dir, { auditHook: (p) => (p === 'listed' ? c.run(1, 3) : void surveys++) });
    const err = await refused(b.prune(t));
    await c.settled();
    expect(err.reason).toBe('commit-audit');
    expect(err.detail).toMatch(/no removal was started/);
    expect(surveys).toBe(3); // bounded
    expect(ls(dir, 'events')).toEqual([looseName(4), looseName(6)]);
    expect(ls(dir, 'segments')).toEqual([segName(1, 3)]);
    expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(false);
  });

  it('C: a slot missing inside a segment range that no segment covers is refused (the segment is not an alibi for other slots)', async () => {
    const dir = newDir();
    const evs = chain('t1', 6, true);
    const t = await committed(dir, evs);
    const c = compactor(dir, evs);
    c.run(1, 3);
    unlinkSync(join(taskDir(dir), 'events', looseName(4)));
    await refused(openStore(dir).prune(t));
    expect(ls(dir, 'events')).toEqual([looseName(5), looseName(6)]);
    expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(false);
  });

  describe('D: O-1 holds while the log is being compacted', () => {
    const forge = async (dir: string, mutate: (t: Tombstone) => Tombstone): Promise<{ t: Tombstone; evs: TaskEvent[] }> => {
      const evs = chain('t1', 4, false); // an ACTIVE task
      await appendAll(dir, evs);
      const t = mutate({ ...tombstoneFor(foldEvents(evs), 'c'), finalStatus: 'completed' as const, closedAt: '2026-01-01T00:00:04.000Z', outcomeDigest: '0'.repeat(64) });
      writeFileSync(join(taskDir(dir), prepareFile(1)), encodePrepare(1, t));
      writeFileSync(join(taskDir(dir), decisionFile(1)), encodeDecision(1, 'commit', t, 'pruner'));
      return { t, evs };
    };

    it('a commit forged for an active task is refused and no tombstone is published', async () => {
      const dir = newDir();
      const { t, evs } = await forge(dir, (x) => x);
      const c = compactor(dir, evs);
      const err = await refused(openStore(dir, { auditHook: (p) => p === 'listed' && c.run(1, 2) }).prune(t));
      await c.settled();
      expect(err.detail).toMatch(/active/);
      expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(false);
      expect(ls(dir, 'segments')).toEqual([segName(1, 2)]); // the compaction did its own work and nothing else was touched
      expect(ls(dir, 'events')).toEqual([looseName(3), looseName(4)]);
    });

    it('a commit with a wrong outcome digest for a finished task is refused and no tombstone is published', async () => {
      const dir = newDir();
      const evs = chain('t1', 4, true);
      await appendAll(dir, evs);
      const t = { ...tombstoneFor(foldEvents(evs), 'c'), outcomeDigest: 'f'.repeat(64) };
      writeFileSync(join(taskDir(dir), prepareFile(1)), encodePrepare(1, t));
      writeFileSync(join(taskDir(dir), decisionFile(1)), encodeDecision(1, 'commit', t, 'pruner'));
      const c = compactor(dir, evs);
      await refused(openStore(dir, { auditHook: (p) => p === 'listed' && c.run(1, 2) }).prune(t));
      await c.settled();
      expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(false);
      expect(ls(dir, 'events')).toEqual([looseName(3), looseName(4)]);
    });
  });

  it('E: a compaction in the first look and another pruner finishing in the second: the audit still succeeds and the data goes once', async () => {
    const dir = newDir();
    const evs = chain('t1', 6, true);
    const t = await committed(dir, evs);
    const c = compactor(dir, evs);
    const other = otherPruner(dir, t);
    const b = openStore(dir, { auditHook: (p) => (p === 'listed' ? c.run(1, 3) : other()) });
    await b.prune(t);
    await c.settled();
    expect(ls(dir, 'events')).toEqual([]);
    expect(ls(dir, 'segments')).toEqual([]);
    expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(true);
    expect(await openStore(dir).prune(t)).toEqual({ removedFiles: 0 });
  });
});

describe('F-3: the message of PruneDecisionCorruptError claims only what is guaranteed', () => {
  const FALSE_CLAIMS = /cancelled nothing|deleted nothing|changed nothing|nothing was (deleted|changed)/;

  it('published=false: the call removed no task data, and nothing more is promised', () => {
    const m = new PruneDecisionCorruptError('t1', 'commit-audit').message;
    expect(m).not.toMatch(FALSE_CLAIMS);
    expect(m).toMatch(/this call removed no task data/);
    expect(m).toMatch(/may have recorded a prune-register entry/);
    expect(m).toMatch(/another process may have changed the task/);
  });

  it('published=true: a write is already visible and may have removed loose copies; it does not say the call changed nothing', () => {
    const e = new PruneDecisionCorruptError('t1', 'register', null, null, true);
    expect(e.published).toBe(true);
    expect(e.message).not.toMatch(FALSE_CLAIMS);
    expect(e.message).not.toMatch(/removed no task data/);
    expect(e.message).toMatch(/already made a write visible and does not take it back/);
    expect(e.message).toMatch(/may also have removed loose copies/);
  });

  it('a compaction refused by a damaged register before it publishes anything reports published=false', async () => {
    const dir = newDir();
    const evs = chain('t1', 4, false);
    await appendAll(dir, evs);
    const s = openStore(dir);
    // a damaged prepare record: the compaction is refused at K0, before any segment exists
    writeFileSync(join(taskDir(dir), prepareFile(1)), '{broken');
    const err = await s.compact('t1', 2, evs.slice(0, 2)).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(PruneDecisionCorruptError);
    const pe = err as PruneDecisionCorruptError;
    expect(pe.published).toBe(false);
    expect(pe.message).toMatch(/removed no task data/);
    expect(ls(dir, 'segments')).toEqual([]);
  });
});
