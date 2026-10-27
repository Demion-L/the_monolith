/**
 * DURABLE-SECURITY-FIX-001. F-1: the public prune operations of a store refuse to remove a task that is not a finished
 * task with the head the tombstone names; a refusal changes nothing on disk. F-2: the test seams are not reachable through
 * the public constructor or the package entry point.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync, linkSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { createFsStoreWithSeams } from './testing.js';
import { DurableTasks } from './runtime.js';
import * as publicApi from './index.js';
import { stampEvent, serializeEvent } from './log.js';
import { tombstoneFor } from './prune-check.js';
import { foldEvents } from './projection.js';
import { GENESIS_HASH, type EventStore, type TaskEvent, type Tombstone } from './types.js';
import { LogCorruptError, RetentionRefusedError, TaskPrunedError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'durable-pre-'));
  dirs.push(d);
  return d;
};
const fsStore = (dir: string, o: Parameters<typeof createFsStoreWithSeams>[0] extends infer T ? Partial<T> : never = {}): FsEventStore => {
  const s = createFsStoreWithSeams({ target: { scope: 'trusted-directory', dir }, durability: 'file', ...o });
  s.initializeProtocolSync();
  return s;
};

/** `n` events; the last one closes the task when `finished`. */
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
async function put(store: EventStore, evs: TaskEvent[]): Promise<void> {
  for (const e of evs) expect(await store.append(e)).toBe('appended');
}

/** Every file below `dir` with a digest of its bytes: equal snapshots mean nothing was created, changed or removed. */
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

type Make = () => { store: EventStore; snapshot: () => unknown };
const backends: Array<[string, Make]> = [
  ['memory', () => {
    const store = new MemoryEventStore();
    return { store, snapshot: () => store.readLog('t1', { rawEvents: true }).then(async (l) => ({ l, st: await store.pruneState!('t1') })) };
  }],
  ['filesystem', () => {
    const dir = newDir();
    const store = fsStore(dir);
    return { store, snapshot: () => tree(dir) };
  }],
];

describe.each(backends)('F-1: the public prune operations check the task (%s)', (_n, make) => {
  /** A refusal is an exception AND no change at all. */
  async function refused(store: EventStore, snapshot: () => unknown, op: () => Promise<unknown>, err: new (...a: never[]) => Error = RetentionRefusedError as never): Promise<void> {
    const before = await snapshot();
    await expect(op()).rejects.toBeInstanceOf(err);
    expect(await snapshot(), 'a refused prune must not touch the store').toEqual(before);
  }

  it('the PoC of the review: an ACTIVE task with forged head metadata is not pruned', async () => {
    const { store, snapshot } = make();
    const evs = chain('t1', 4, false);
    await put(store, evs);
    const forged: Tombstone = { v: 1, taskId: 't1', kind: 'k', finalStatus: 'completed', createdAt: 'a', closedAt: 'b', prunedAt: 'c', headSeq: 99, headHash: 'f'.repeat(64), outcomeDigest: 'd' };
    await refused(store, snapshot, () => store.prune(forged));
    await refused(store, snapshot, () => store.preparePrune!(forged));
    await refused(store, snapshot, () => store.markPruned!(forged));
    expect((await store.readLog('t1')).events).toEqual(evs);
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'live' });
  });

  it('an active task is refused even with the TRUE head: right headSeq and headHash do not make it finished', async () => {
    const { store, snapshot } = make();
    const evs = chain('t1', 4, false);
    await put(store, evs);
    const s = foldEvents(evs);
    const truthful: Tombstone = { v: 1, taskId: 't1', kind: s.kind, finalStatus: 'completed', createdAt: s.createdAt, closedAt: '2026-01-01T00:00:04.000Z', prunedAt: 'c', headSeq: s.headSeq, headHash: s.headHash, outcomeDigest: 'd' };
    await refused(store, snapshot, () => store.prune(truthful));
  });

  it.each([
    ['headSeq', (t: Tombstone): Tombstone => ({ ...t, headSeq: t.headSeq + 1 })],
    ['headHash', (t: Tombstone): Tombstone => ({ ...t, headHash: 'f'.repeat(64) })],
    ['finalStatus', (t: Tombstone): Tombstone => ({ ...t, finalStatus: 'failed' })],
    ['closedAt', (t: Tombstone): Tombstone => ({ ...t, closedAt: '2030-01-01T00:00:00.000Z' })],
    ['outcomeDigest', (t: Tombstone): Tombstone => ({ ...t, outcomeDigest: '0'.repeat(64) })],
  ])('a finished task, a forged %s: refused on every public route', async (_f, forge) => {
    const { store, snapshot } = make();
    const evs = chain('t1', 4, true);
    await put(store, evs);
    const bad = forge(tombstoneFor(foldEvents(evs), 'c'));
    await refused(store, snapshot, () => store.prune(bad));
    await refused(store, snapshot, () => store.preparePrune!(bad));
    await refused(store, snapshot, () => store.markPruned!(bad));
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'live' });
  });

  it('a tombstone of an OLDER head (the log moved on) is refused', async () => {
    const { store, snapshot } = make();
    const evs = chain('t1', 4, true);
    await put(store, evs);
    const stale = tombstoneFor(foldEvents(chain('t1', 3, true)), 'c');
    await refused(store, snapshot, () => store.prune(stale));
  });

  it('a correct prune still works, is idempotent, and leaves no resurrection', async () => {
    const { store } = make();
    const evs = chain('t1', 4, true);
    await put(store, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    await store.prune(t);
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'committed', tombstone: expect.objectContaining({ headSeq: 4, headHash: evs[3]!.hash }) });
    await expect(store.prune(t)).resolves.toMatchObject({ removedFiles: 0 }); // a second prune of a deleted task
    await expect(store.append(stampEvent('t1', 5, '2026-02-02T00:00:00.000Z', evs[3]!.hash, { type: 'fact.observed', actor: 'z', data: { key: 'z', fingerprint: 'z', value: 1, source: null } }))).rejects.toBeInstanceOf(TaskPrunedError);
    await expect(store.prune({ ...t, headHash: 'f'.repeat(64) })).rejects.toBeInstanceOf(LogCorruptError); // a different tombstone after the commit
    const log = await store.readLog('t1');
    expect(log.events).toEqual([]);
    expect(log.tombstone).toMatchObject({ headHash: evs[3]!.hash }); // the canonical head is the one that was verified
  });
});

describe('F-1 over a real runtime: an active task with a live claim', () => {
  it('store.prune() with a forged tombstone leaves the claim, the log and the right to complete intact', async () => {
    const dir = newDir();
    const store = fsStore(dir);
    const rt = new DurableTasks({ store });
    await rt.createTask({ taskId: 't1', kind: 'k', goal: 'g' });
    const fence = await rt.claim('t1', { owner: 'w' });
    const before = tree(dir);
    const state = await rt.getState('t1');
    const forged: Tombstone = { v: 1, taskId: 't1', kind: 'k', finalStatus: 'completed', createdAt: state.createdAt, closedAt: state.createdAt, prunedAt: state.createdAt, headSeq: state.headSeq, headHash: state.headHash, outcomeDigest: '0'.repeat(64) };
    await expect(store.prune(forged)).rejects.toBeInstanceOf(RetentionRefusedError);
    await expect(store.prune({ ...forged, headSeq: 999, headHash: 'f'.repeat(64) })).rejects.toBeInstanceOf(RetentionRefusedError);
    expect(tree(dir), 'files of the active task are all still there, unchanged').toEqual(before);
    // the execution right was not given away or destroyed: the holder still finishes the task
    await rt.complete(fence, 'done');
    expect((await rt.getState('t1')).status).toBe('completed');
    // and only now does the honest path prune it (zero retention)
    const t = await rt.pruneTask('t1', { terminalRetentionMs: 0 });
    expect(t.finalStatus).toBe('completed');
    expect(existsSync(join(dir, 'tasks', 't1', 'tombstone.json'))).toBe(true);
  });
});

describe('F-1 under concurrency and damage (filesystem)', () => {
  it('a corrupt log is never pruned, and nothing changes', async () => {
    const dir = newDir();
    const store = fsStore(dir);
    const evs = chain('t1', 3, true);
    await put(store, evs);
    const file = join(dir, 'tasks', 't1', 'events', '000000002.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace(evs[1]!.prev, 'e'.repeat(64)));
    const before = tree(dir);
    await expect(store.prune(tombstoneFor(foldEvents(evs), 'c'))).rejects.toBeInstanceOf(LogCorruptError);
    expect(tree(dir)).toEqual(before);
  });

  it('decidePrune(commit) on an attempt whose log moved on behind its back is refused; abort is always allowed', async () => {
    const dir = newDir();
    const store = fsStore(dir);
    const evs = chain('t1', 3, true);
    await put(store, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    const { attempt } = await store.preparePrune(t);
    // a rogue file the store did not publish (so no G2 closed the attempt)
    const late = stampEvent('t1', 4, '2026-03-03T00:00:00.000Z', evs[2]!.hash, { type: 'fact.observed', actor: 'rogue', data: { key: 'r', fingerprint: 'r', value: 1, source: null } });
    writeFileSync(join(dir, 'tasks', 't1', 'events', '000000004.json'), serializeEvent(late) + '\n');
    const before = tree(dir);
    await expect(store.decidePrune(t.taskId, attempt, 'commit', t, 'pruner')).rejects.toThrow();
    expect(tree(dir), 'no decision was written').toEqual(before);
    expect(await store.decidePrune(t.taskId, attempt, 'abort', undefined, 'pruner')).toBe('abort');
    expect(await store.pruneState('t1')).toMatchObject({ kind: 'live', attempt: 1 });
  });


  it('an event published between the early check and the prepare is seen by the check after the prepare: the attempt is aborted', async () => {
    const dir = newDir();
    const evs = chain('t1', 3, true);
    const seed = fsStore(dir);
    await put(seed, evs);
    const t = tombstoneFor(foldEvents(evs), 'c');
    const late = stampEvent('t1', 4, '2026-03-03T00:00:00.000Z', evs[2]!.hash, { type: 'fact.observed', actor: 'rogue', data: { key: 'r', fingerprint: 'r', value: 1, source: null } });
    let injected = false;
    const store = fsStore(dir, {
      ops: {
        // the writer's file appears right after the prepare of the pruner became visible
        linkSync: ((from: string, to: string) => {
          linkSync(from, to);
          if (!injected && /prune-1\.prepare\.json$/.test(to)) {
            injected = true;
            writeFileSync(join(dir, 'tasks', 't1', 'events', '000000004.json'), serializeEvent(late) + '\n');
          }
        }) as never,
      },
    });
    await expect(store.prune(t)).rejects.toThrow();
    expect(injected).toBe(true);
    expect(existsSync(join(dir, 'tasks', 't1', 'tombstone.json'))).toBe(false);
    expect(readdirSync(join(dir, 'tasks', 't1', 'events')).sort()).toEqual(['000000001.json', '000000002.json', '000000003.json', '000000004.json']);
    expect(await store.pruneState('t1')).toMatchObject({ kind: 'live', attempt: 1 }); // the attempt is closed with abort
  });
});

describe('F-2: test seams are not part of the public API', () => {
  it('the package entry point exports no seam factory or seam type holder', () => {
    for (const name of ['createFsStoreWithSeams', 'createMemoryStoreWithSeams', 'handOver', 'takeFsSeams', 'takeMemorySeams']) {
      expect(name in publicApi, name).toBe(false);
    }
  });

  it('the public constructor ignores seams, even when a caller passes them untyped', async () => {
    const dir = newDir();
    let called = 0;
    const smuggled = {
      target: { scope: 'trusted-directory', dir },
      durability: 'file',
      ops: { linkSync: () => { called++; throw new Error('seam used'); }, unlinkSync: () => { called++; } },
      beforePublish: () => { called++; },
      afterListing: () => { called++; },
      readFault: () => 'EIO',
      registerListing: () => [],
      earlyPruneCheck: false,
      maxPruneAttempts: 1,
      skipPrunePrecondition: true,
    };
    const s = new FsEventStore(smuggled as never);
    s.initializeProtocolSync();
    const evs = chain('t1', 3, true);
    await put(s, evs); // would throw if `ops.linkSync` or `readFault` were honoured
    expect((await s.readLog('t1')).events).toEqual(evs);
    expect(called).toBe(0);
    const bad: Tombstone = { ...tombstoneFor(foldEvents(evs), 'c'), headHash: 'f'.repeat(64) };
    await expect(s.prune(bad)).rejects.toBeInstanceOf(RetentionRefusedError); // skipPrunePrecondition was not honoured either
  });

  it('a hand-over that was not consumed does not leak into the next public store', async () => {
    const dir = newDir();
    createFsStoreWithSeams({ target: { scope: 'trusted-directory', dir }, readFault: () => 'EIO' }); // consumed by this constructor
    const plain = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
    plain.initializeProtocolSync();
    await put(plain, chain('t1', 2, true));
    expect((await plain.readLog('t1')).events).toHaveLength(2);
  });
});
