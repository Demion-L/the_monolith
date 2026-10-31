/**
 * DURABLE-SEC-003 / O-1. A COMMITTED prune register is not self-proving (its checksum is unkeyed), so `prune()` audits the
 * data that is still on disk against the commit before it unlinks anything. The audit must refuse a forged commit and must
 * not block the roll-forward of a genuine one, whatever part of the data an interrupted roll-forward already removed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { FsEventStore } from './fs-store.js';
import { createFsStoreWithSeams } from './testing.js';
import { encodeDecision, encodePrepare, prepareFile, decisionFile, TOMBSTONE_FILE, encodeTombstone } from './register.js';
import { stampEvent, serializeEvent } from './log.js';
import { tombstoneFor, committedProblem } from './prune-check.js';
import { foldEvents } from './projection.js';
import { GENESIS_HASH, type TaskEvent, type Tombstone } from './types.js';
import { PruneDecisionCorruptError, StoreIoError, StoreSecurityError, TaskPrunedError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'durable-o1-'));
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

function openStore(dir: string, seams: Parameters<typeof createFsStoreWithSeams>[0] extends infer T ? Partial<T> : never = {}): FsEventStore {
  const s = createFsStoreWithSeams({ target: { scope: 'trusted-directory', dir }, durability: 'file', ...seams });
  s.initializeProtocolSync();
  return s;
}
async function withTask(dir: string, evs: TaskEvent[], seams = {}): Promise<FsEventStore> {
  const s = openStore(dir, seams);
  for (const e of evs) expect(await s.append(e)).toBe('appended');
  return s;
}
const taskDir = (dir: string, id = 't1'): string => join(dir, 'tasks', id);
const eventFile = (dir: string, seq: number): string => join(taskDir(dir), 'events', `${String(seq).padStart(9, '0')}.json`);

/** What a forger (or a hostile project) can write by hand: a prepare and a commit decision with a self-consistent checksum. */
function forgeCommit(dir: string, t: Tombstone, opts: { tombstoneJson?: boolean } = {}): void {
  writeFileSync(join(taskDir(dir), prepareFile(1)), encodePrepare(1, t));
  writeFileSync(join(taskDir(dir), decisionFile(1)), encodeDecision(1, 'commit', t, 'pruner'));
  if (opts.tombstoneJson) writeFileSync(join(taskDir(dir), TOMBSTONE_FILE), encodeTombstone(t));
}
/** A genuine commit: through the public operations, without the roll-forward. */
async function genuineCommit(store: FsEventStore, t: Tombstone): Promise<void> {
  const { attempt } = await store.preparePrune(t);
  expect(await store.decidePrune('t1', attempt, 'commit', t, 'pruner')).toBe('commit');
}

/** every path below `dir` with a digest of its bytes (symlinks by target): equal snapshots mean nothing was touched. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        out[`${relative(dir, p)}/`] = 'dir';
        walk(p);
      } else if (e.isSymbolicLink()) out[relative(dir, p)] = 'link';
      else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}
const auditFailure = async (p: Promise<unknown>): Promise<PruneDecisionCorruptError> => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(PruneDecisionCorruptError);
  expect((err as PruneDecisionCorruptError).reason).toBe('commit-audit');
  return err as PruneDecisionCorruptError;
};

describe('O-1: a forged COMMITTED register does not delete data (nothing was removed yet)', () => {
  it('the review PoC: a commit forged for an ACTIVE task is refused and every byte stays', async () => {
    const dir = newDir();
    const evs = chain('t1', 3, false);
    const store = await withTask(dir, evs);
    const t = tombstoneFor(foldEvents(evs), 'c'); // an active task has no closedAt: forge the rest
    const forged: Tombstone = { ...t, finalStatus: 'completed', closedAt: '2026-01-01T00:00:03.000Z', outcomeDigest: '0'.repeat(64) };
    forgeCommit(dir, forged);
    expect((await store.pruneState('t1')).kind).toBe('committed');
    const before = tree(dir);

    const err = await auditFailure(store.prune(forged));

    expect(err.detail).toMatch(/active/);
    expect(tree(dir)).toEqual(before);
    expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(false);
    expect(readdirSync(join(taskDir(dir), 'events'))).toHaveLength(3);
  });

  it('a commit with the right head numbers but a wrong head hash is refused', async () => {
    const dir = newDir();
    const evs = chain('t1', 3, true);
    const store = await withTask(dir, evs);
    const forged = { ...tombstoneFor(foldEvents(evs), 'c'), headHash: 'f'.repeat(64) };
    forgeCommit(dir, forged);
    const before = tree(dir);
    const err = await auditFailure(store.prune(forged));
    expect(err.detail).toMatch(/head hash/);
    expect(tree(dir)).toEqual(before);
  });

  it('a commit that names an OLDER head (the log moved on) is refused', async () => {
    const dir = newDir();
    const evs = chain('t1', 5, false);
    const store = await withTask(dir, evs);
    const older = tombstoneFor(foldEvents(chain('t1', 3, true)), 'c'); // finished at 3; the real log goes on to 5
    forgeCommit(dir, older);
    const before = tree(dir);
    await auditFailure(store.prune(older));
    expect(tree(dir)).toEqual(before);
  });

  it('a commit that names a head BEYOND the log (so that the data would look half-removed) is refused while no removal was started', async () => {
    const dir = newDir();
    const evs = chain('t1', 3, false);
    const store = await withTask(dir, evs);
    const beyond = { ...tombstoneFor(foldEvents(chain('t1', 6, true)), 'c') }; // claims 6 events, only 3 exist
    forgeCommit(dir, beyond);
    const before = tree(dir);
    const err = await auditFailure(store.prune(beyond));
    expect(err.detail).toMatch(/no removal was started/);
    expect(tree(dir)).toEqual(before);
  });

  it('a commit with a wrong outcome digest for a finished task is refused', async () => {
    const dir = newDir();
    const evs = chain('t1', 3, true);
    const store = await withTask(dir, evs);
    const forged = { ...tombstoneFor(foldEvents(evs), 'c'), outcomeDigest: 'a'.repeat(64) };
    forgeCommit(dir, forged);
    await auditFailure(store.prune(forged));
    expect(readdirSync(join(taskDir(dir), 'events'))).toHaveLength(3);
  });

  it('a corrupt event in a committed task is refused, and nothing outside the store is touched', async () => {
    const dir = newDir();
    const outside = newDir();
    writeFileSync(join(outside, 'victim'), 'precious');
    const evs = chain('t1', 3, true);
    const store = await withTask(dir, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    await genuineCommit(store, t);
    writeFileSync(eventFile(dir, 2), readFileSync(eventFile(dir, 2), 'utf8').replace('"value":2', '"value":99'));
    const before = tree(dir);
    const err = await auditFailure(store.prune(t));
    expect(err.detail).toMatch(/content hash mismatch/);
    expect(tree(dir)).toEqual(before);
    expect(readFileSync(join(outside, 'victim'), 'utf8')).toBe('precious');
  });

  it('a symlink named like an event inside a committed task is refused or skipped, never followed', async () => {
    const dir = newDir();
    const outside = newDir();
    writeFileSync(join(outside, 'victim'), 'precious');
    const evs = chain('t1', 3, true);
    const store = await withTask(dir, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    await genuineCommit(store, t);
    symlinkSync(join(outside, 'victim'), join(taskDir(dir), 'events', '000000009.json'));
    await store.prune(t).catch((e: unknown) => expect(e).toBeInstanceOf(StoreSecurityError));
    expect(readFileSync(join(outside, 'victim'), 'utf8')).toBe('precious');
  });

  it('a commit for a task whose log is gone but whose directory remains: nothing to read, no removal started: refused', async () => {
    const dir = newDir();
    const evs = chain('t1', 2, true);
    const store = await withTask(dir, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    for (const f of readdirSync(join(taskDir(dir), 'events'))) unlinkSync(join(taskDir(dir), 'events', f));
    forgeCommit(dir, t);
    await auditFailure(store.prune(t));
  });
});

describe('O-1: a genuine COMMITTED register is rolled forward from every state an interruption can leave', () => {
  it('a genuine commit with the data intact (no removal started) is rolled forward', async () => {
    const dir = newDir();
    const evs = chain('t1', 4, true);
    const store = await withTask(dir, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    await genuineCommit(store, t);
    expect(await store.prune(t)).toEqual({ removedFiles: 4 });
    expect((await store.readLog('t1')).tombstone).not.toBeNull();
    await expect(store.append(chain('t1', 5, true)[4] as TaskEvent)).rejects.toBeInstanceOf(TaskPrunedError);
  });

  // For every subset of removed events (what a roll-forward that stopped after k unlinks, in ANY directory order, leaves).
  const subsets = (n: number): number[][] => Array.from({ length: 1 << n }, (_, m) => [...Array(n).keys()].filter((i) => m & (1 << i)).map((i) => i + 1));
  it.each(subsets(4).map((rm) => [rm.join(',') || '(none)', rm] as const))('tombstone.json published, events {%s} already removed: the roll-forward completes', async (_n, removed) => {
    const dir = newDir();
    const evs = chain('t1', 4, true);
    const store = await withTask(dir, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    await genuineCommit(store, t);
    writeFileSync(join(taskDir(dir), TOMBSTONE_FILE), encodeTombstone(t));
    for (const seq of removed) unlinkSync(eventFile(dir, seq));
    expect(await store.prune(t)).toEqual({ removedFiles: 4 - removed.length });
    expect(existsSync(join(taskDir(dir), 'events'))).toBe(false);
  });

  it('stragglers: events appended after the commit (beyond the head) are removed with the rest', async () => {
    const dir = newDir();
    const evs = chain('t1', 3, true);
    const store = await withTask(dir, evs);
    const t = tombstoneFor(foldEvents(evs), 'c'); // finished at 3
    await genuineCommit(store, t);
    const extra = stampEvent('t1', 4, '2026-01-01T00:00:09.000Z', evs[2]!.hash, { type: 'fact.observed', actor: 'late', data: { key: 'z', fingerprint: 'z', value: 1, source: null } });
    // an append that passed its early check before the commit publishes its file and is then told the task is pruned
    // (G2 never takes a published file back): that file is what such a race leaves behind. G1 now refuses new appends.
    await expect(store.append(extra)).rejects.toBeInstanceOf(TaskPrunedError);
    writeFileSync(eventFile(dir, 4), `${serializeEvent(extra)}\n`);
    expect(existsSync(eventFile(dir, 4))).toBe(true);
    await store.prune(t);
    expect(existsSync(join(taskDir(dir), 'events'))).toBe(false);
  });

  it('a roll-forward interrupted by a fault after k removals is finished by the next call, and again (idempotent)', async () => {
    const dir = newDir();
    const evs = chain('t1', 5, true);
    const t = tombstoneFor(foldEvents(evs), 'c');
    let allowed = 2;
    const flaky = openStore(dir, {
      removeFile: (abs: string) => {
        if (allowed-- <= 0) throw Object.assign(new Error('injected EIO'), { code: 'EIO' });
        unlinkSync(abs);
      },
    });
    for (const e of evs) await flaky.append(e);
    await genuineCommit(flaky, t);

    await expect(flaky.prune(t)).rejects.toBeInstanceOf(StoreIoError);
    expect(readdirSync(join(taskDir(dir), 'events'))).toHaveLength(3); // two removed, three left
    expect(existsSync(join(taskDir(dir), TOMBSTONE_FILE))).toBe(true);

    const fresh = openStore(dir); // a new process after the crash
    expect(await fresh.prune(t)).toEqual({ removedFiles: 3 });
    expect(await fresh.prune(t)).toEqual({ removedFiles: 0 });
    expect(existsSync(join(taskDir(dir), 'events'))).toBe(false);
  });

  it('a partly removed task whose surviving head slot holds something else than the committed head is refused', async () => {
    const dir = newDir();
    const evs = chain('t1', 3, true);
    const store = await withTask(dir, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    await genuineCommit(store, t);
    writeFileSync(join(taskDir(dir), TOMBSTONE_FILE), encodeTombstone(t));
    unlinkSync(eventFile(dir, 1));
    const other = stampEvent('t1', 3, '2026-01-01T00:00:03.000Z', evs[1]!.hash, { type: 'task.failed', actor: 'x', data: { error: 'boom', detail: null } });
    writeFileSync(eventFile(dir, 3), `${serializeEvent(other)}\n`);
    const before = tree(dir);
    const err = await auditFailure(store.prune(t));
    expect(err.detail).toMatch(/head hash/);
    expect(tree(dir)).toEqual(before);
  });

  it('a damaged tombstone.json is not "published": the roll-forward does not continue over it', async () => {
    const dir = newDir();
    const evs = chain('t1', 3, true);
    const store = await withTask(dir, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    await genuineCommit(store, t);
    writeFileSync(join(taskDir(dir), TOMBSTONE_FILE), '{not json');
    unlinkSync(eventFile(dir, 2));
    const before = tree(dir);
    await expect(store.prune(t)).rejects.toBeInstanceOf(PruneDecisionCorruptError);
    expect(tree(dir)).toEqual(before);
  });
});

describe('O-1: concurrency with the commit', () => {
  it('without a forged register the F-1 precondition still refuses an unfinished task, and its log is untouched', async () => {
    const dir = newDir();
    const evs = chain('t1', 4, true);
    const store = await withTask(dir, evs.slice(0, 3)); // active at 3
    const early = tombstoneFor(foldEvents(chain('t1', 3, true)), 'c');
    await expect(store.prune(early)).rejects.toMatchObject({ name: 'RetentionRefusedError' });
    expect(readdirSync(join(taskDir(dir), 'events'))).toHaveLength(3);
  });

  it('prune and a competing append from a second store handle: the register decides, the data either stays whole or is gone', async () => {
    const dir = newDir();
    const evs = chain('t1', 3, true);
    const a = await withTask(dir, evs);
    const b = openStore(dir);
    const late = stampEvent('t1', 4, '2026-01-01T00:00:09.000Z', evs[2]!.hash, { type: 'fact.observed', actor: 'late', data: { key: 'z', fingerprint: 'z', value: 1, source: null } });
    const t = tombstoneFor(foldEvents(evs), 'c');
    const [p, q] = await Promise.allSettled([a.prune(t), b.append(late)]);
    const state = (await a.pruneState('t1')).kind;
    expect(state).toBe('committed');
    expect(p.status).toBe('fulfilled');
    expect(q.status === 'rejected' && q.reason instanceof TaskPrunedError).toBe(true);
    expect(existsSync(join(taskDir(dir), 'events'))).toBe(false);
  });
});

describe('committedProblem (pure)', () => {
  const evs = chain('t1', 4, true);
  const t = tombstoneFor(foldEvents(evs), 'c');
  it('the whole prefix of a finished task passes, with or without a started removal', () => {
    expect(committedProblem('t1', evs, t, false)).toBeNull();
    expect(committedProblem('t1', evs, t, true)).toBeNull();
  });
  it('a missing part is tolerated only once a removal was started', () => {
    const part = [evs[0]!, evs[3]!];
    expect(committedProblem('t1', part, t, true)).toBeNull();
    expect(committedProblem('t1', part, t, false)).toMatch(/no removal was started/);
    expect(committedProblem('t1', [], t, true)).toBeNull();
    expect(committedProblem('t1', [], t, false)).toMatch(/no removal was started/);
  });
  it('a surviving head slot that is not the committed head is always a problem', () => {
    expect(committedProblem('t1', [{ ...evs[3]!, hash: 'e'.repeat(64) }], t, true)).toMatch(/head hash/);
  });
});
