/**
 * DURABLE-SEC-005 / I-1. The audit of a committed prune (O-1) must not take the work of a concurrent, legitimate pruner for
 * damage: another process may publish `tombstone.json` and unlink events at any moment while the audit reads. The order of
 * operations is controlled here with `auditHook` (in-process, deterministic); the real multi-process version of the
 * regression is in `fix004c-process.test.ts`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { FsEventStore } from './fs-store.js';
import { createFsStoreWithSeams } from './testing.js';
import { encodeDecision, encodePrepare, prepareFile, decisionFile, TOMBSTONE_FILE, encodeTombstone } from './register.js';
import { stampEvent, serializeEvent } from './log.js';
import { tombstoneFor } from './prune-check.js';
import { foldEvents } from './projection.js';
import { GENESIS_HASH, type TaskEvent, type Tombstone } from './types.js';
import { PruneDecisionCorruptError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'durable-i1-'));
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
const eventsOf = (dir: string): string[] => (existsSync(join(taskDir(dir), 'events')) ? readdirSync(join(taskDir(dir), 'events')).sort() : []);

/** a finished task with n events and a genuine COMMIT (through the public operations, without the roll-forward). */
async function committed(dir: string, n: number): Promise<{ t: Tombstone; evs: TaskEvent[] }> {
  const evs = chain('t1', n, true);
  const s = openStore(dir);
  for (const e of evs) expect(await s.append(e)).toBe('appended');
  const t = tombstoneFor(foldEvents(evs), 'c');
  const { attempt } = await s.preparePrune(t);
  expect(await s.decidePrune('t1', attempt, 'commit', t, 'pruner')).toBe('commit');
  return { t, evs };
}

/**
 * What another pruner does in the middle of an audit: the REAL roll-forward (it is synchronous), stopped after `k`
 * unlinks (`Infinity`: to the end). Calling it from the hook is a pruner that ran between two reads of the audit.
 */
function otherPruner(dir: string, t: Tombstone, k: number): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    let allowed = k;
    const a = openStore(dir, {
      removeFile: (abs: string) => {
        if (allowed-- <= 0) throw Object.assign(new Error('other pruner stopped'), { code: 'EIO' });
        unlinkSync(abs);
      },
    });
    try {
      (a as unknown as { rollForward(id: string, t: Tombstone): unknown }).rollForward('t1', t);
    } catch {
      /* stopped on purpose */
    }
  };
}

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        out[`${relative(dir, p)}/`] = 'dir';
        walk(p);
      } else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}
const refused = async (p: Promise<unknown>): Promise<PruneDecisionCorruptError> => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(PruneDecisionCorruptError);
  return err as PruneDecisionCorruptError;
};

const N = 5;
const REMOVALS = [0, 1, 2, 3, N, Infinity]; // k unlinks done by the other pruner (0: only the tombstone is published)

describe('I-1: a concurrent pruner must not turn a genuine commit into a refusal', () => {
  for (const point of ['listed', 'surveyed'] as const) {
    for (const k of REMOVALS) {
      it(`the other pruner publishes tombstone.json and removes ${k === Infinity ? 'everything' : `${k} file(s)`} right after the audit's ${point === 'listed' ? 'listing' : 'reading'} of the data`, async () => {
        const dir = newDir();
        const { t } = await committed(dir, N);
        const other = otherPruner(dir, t, k);
        const b = openStore(dir, { auditHook: (p) => p === point && other() });
        const out = await b.prune(t); // must not throw
        expect(out.removedFiles).toBeGreaterThanOrEqual(0);
        expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(true);
        expect(eventsOf(dir)).toEqual([]);
        expect(await b.prune(t)).toEqual({ removedFiles: 0 }); // idempotent
      });
    }
  }

  it('the tombstone already exists when the audit starts, with part of the log gone', async () => {
    const dir = newDir();
    const { t } = await committed(dir, N);
    otherPruner(dir, t, 2)();
    expect(eventsOf(dir)).toHaveLength(N - 2);
    expect(await openStore(dir).prune(t)).toEqual({ removedFiles: N - 2 });
    expect(eventsOf(dir)).toEqual([]);
  });

  it('the other pruner has finished before this one starts: nothing left to remove, no error, repeatedly', async () => {
    const dir = newDir();
    const { t } = await committed(dir, N);
    otherPruner(dir, t, Infinity)();
    for (let i = 0; i < 3; i++) expect(await openStore(dir).prune(t)).toEqual({ removedFiles: 0 });
  });

  it('three pruners interleaved at different points all succeed and the data is gone once', async () => {
    const dir = newDir();
    const { t } = await committed(dir, N);
    const o1 = otherPruner(dir, t, 1);
    const o2 = otherPruner(dir, t, Infinity);
    const b = openStore(dir, { auditHook: (p) => (p === 'listed' ? o1() : o2()) });
    await b.prune(t);
    await openStore(dir).prune(t);
    expect(eventsOf(dir)).toEqual([]);
    expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(true);
  });

  it('a torn observation (a gap that is gone at the next look, no tombstone) is looked at again instead of refused', async () => {
    const dir = newDir();
    const { t, evs } = await committed(dir, N);
    const f2 = join(taskDir(dir), 'events', '000000002.json');
    const saved = readFileSync(f2, 'utf8');
    unlinkSync(f2); // what a listing taken in the middle of a compaction shows
    let looks = 0;
    const b = openStore(dir, {
      auditHook: (p) => {
        if (p === 'surveyed' && ++looks === 1) writeFileSync(f2, saved); // the slot is back for the next look
      },
    });
    expect(serializeEvent(evs[1] as TaskEvent).trim()).toBe(saved.trim());
    await b.prune(t);
    expect(looks).toBe(2);
    expect(eventsOf(dir)).toEqual([]);
  });

  it('a gap that stays, with no tombstone, is refused after a bounded number of looks and nothing is removed', async () => {
    const dir = newDir();
    const { t } = await committed(dir, N);
    unlinkSync(join(taskDir(dir), 'events', '000000002.json'));
    const before = tree(dir);
    let looks = 0;
    const b = openStore(dir, { auditHook: (p) => p === 'surveyed' && void looks++ });
    const err = await refused(b.prune(t));
    expect(err.detail).toMatch(/no removal was started/);
    expect(looks).toBe(3);
    expect(tree(dir)).toEqual(before);
  });
});

describe('I-1: the security properties of O-1 hold under every order of the reads', () => {
  const forgedForActive = async (dir: string): Promise<Tombstone> => {
    const evs = chain('t1', 3, false);
    const s = openStore(dir);
    for (const e of evs) await s.append(e);
    const t = { ...tombstoneFor(foldEvents(evs), 'c'), finalStatus: 'completed' as const, closedAt: '2026-01-01T00:00:03.000Z', outcomeDigest: '0'.repeat(64) };
    writeFileSync(join(taskDir(dir), prepareFile(1)), encodePrepare(1, t));
    writeFileSync(join(taskDir(dir), decisionFile(1)), encodeDecision(1, 'commit', t, 'pruner'));
    return t;
  };

  it('the original PoC: a commit forged for an ACTIVE task is refused, and every byte stays (hook points observed)', async () => {
    const dir = newDir();
    const t = await forgedForActive(dir);
    const before = tree(dir);
    const seen: string[] = [];
    const err = await refused(openStore(dir, { auditHook: (p) => void seen.push(p) }).prune(t));
    expect(err.detail).toMatch(/active/);
    expect(seen.slice(0, 2)).toEqual(['listed', 'surveyed']);
    expect(tree(dir)).toEqual(before);
  });

  it('a forged commit for an active task is refused even if a tombstone.json that is not the commit appears during the audit', async () => {
    const dir = newDir();
    const t = await forgedForActive(dir);
    const forgedTomb = { ...t, outcomeDigest: '1'.repeat(64) };
    const b = openStore(dir, { auditHook: (p) => p === 'surveyed' && !existsSync(join(taskDir(dir), TOMBSTONE_FILE)) && writeFileSync(join(taskDir(dir), TOMBSTONE_FILE), encodeTombstone(forgedTomb)) });
    await refused(b.prune(t)); // the tombstone differs from the commit: refused before the first unlink
    expect(eventsOf(dir)).toHaveLength(3);
  });

  it('a damaged tombstone.json (garbage) stops the roll-forward before the first unlink', async () => {
    const dir = newDir();
    const { t } = await committed(dir, N);
    writeFileSync(join(taskDir(dir), TOMBSTONE_FILE), '{not json');
    const before = tree(dir);
    await refused(openStore(dir).prune(t));
    expect(tree(dir)).toEqual(before);
  });

  it('a tombstone.json that differs from the commit (digest, then head) stops the roll-forward before the first unlink', async () => {
    for (const change of [{ outcomeDigest: 'b'.repeat(64) }, { headHash: 'c'.repeat(64) }]) {
      const dir = newDir();
      const { t } = await committed(dir, N);
      writeFileSync(join(taskDir(dir), TOMBSTONE_FILE), encodeTombstone({ ...t, ...change }));
      const before = tree(dir);
      await refused(openStore(dir).prune(t));
      expect(tree(dir)).toEqual(before);
    }
  });

  it('a surviving head slot that is not the committed head is refused whether or not the tombstone appears meanwhile', async () => {
    const dir = newDir();
    const { t } = await committed(dir, N);
    const wrong = { ...t, headHash: 'd'.repeat(64) }; // a commit that names a head the log does not have
    // an honest register cannot hold two commits: forge it in a fresh store
    const dir2 = newDir();
    const evs = chain('t1', N, true);
    const s = openStore(dir2);
    for (const e of evs) await s.append(e);
    writeFileSync(join(taskDir(dir2), prepareFile(1)), encodePrepare(1, wrong));
    writeFileSync(join(taskDir(dir2), decisionFile(1)), encodeDecision(1, 'commit', wrong, 'pruner'));
    const before = tree(dir2);
    await refused(s.prune(wrong));
    expect(tree(dir2)).toEqual(before);
  });

  it('the message does not claim that nobody deleted anything', async () => {
    const dir = newDir();
    const t = await forgedForActive(dir);
    const err = await refused(openStore(dir).prune(t));
    expect(err.message).not.toMatch(/nothing was deleted/);
    expect(err.message).not.toMatch(/cancelled nothing|deleted nothing|changed nothing/);
    expect(err.message).toMatch(/this call removed no task data/);
  });
});
