/**
 * DURABLE-FIX-001 / D-7 — pruning a parent task must not race with creating a task that refers to it.
 *
 * The defect: `pruneTask` checked "does an active task refer to it?" and then removed the data; a task created
 * in between kept a `parentTaskId` that pointed at a pruned task. Re-checking only narrows the window.
 *
 * The mechanism now (ADR-017 §2.5): each side publishes a marker first and looks at the other's second.
 *   creator: pin the reference (create-only file in the parent's directory) -> see whether a tombstone exists -> publish
 *   pruner : publish the tombstone -> look at published tasks and pins -> withdraw the tombstone (data still intact) or delete
 * Hooks on the store boundary force the interleavings; no sleeps decide the outcome.
 * (The same interleavings between real OS processes are in review-fixes.process.test.ts.)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { RetentionRefusedError, TaskNotFoundError, TaskPrunedError, ValidationError } from './errors.js';
import type { EventStore, TaskEvent, Tombstone } from './types.js';
import { tombstoneFor } from './prune-check.js';

const initStore = (s: FsEventStore): FsEventStore => (s.initializeProtocolSync(), s);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

class Clock {
  t = Date.parse('2026-03-01T00:00:00.000Z');
  now = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t += ms;
  }
}
const DAY = 86_400_000;
const POLICY = { terminalRetentionMs: 0 };

/** Delegates everything (including the optional methods) and lets a test act at the boundaries. */
class HookStore implements EventStore {
  hooks: {
    beforeMark?: () => Promise<void>;
    afterMark?: () => Promise<void>;
    afterPin?: () => Promise<void>;
    beforeAppend?: (e: TaskEvent) => Promise<void>;
  } = {};
  constructor(readonly inner: EventStore) {}
  readLog: EventStore['readLog'] = (id, o) => this.inner.readLog(id, o);
  listTaskIds: EventStore['listTaskIds'] = () => this.inner.listTaskIds();
  compact: EventStore['compact'] = (a, b, c) => this.inner.compact(a, b, c);
  prune: EventStore['prune'] = (t) => this.inner.prune(t);
  sweepCompacted = (id: string) => (this.inner.sweepCompacted as NonNullable<EventStore['sweepCompacted']>)(id);
  listReferences = (id: string) => (this.inner.listReferences as NonNullable<EventStore['listReferences']>)(id);
  withdrawTombstone = (t: Tombstone) => (this.inner.withdrawTombstone as NonNullable<EventStore['withdrawTombstone']>)(t);
  async markPruned(t: Tombstone): Promise<void> {
    await this.hooks.beforeMark?.();
    await (this.inner.markPruned as NonNullable<EventStore['markPruned']>)(t);
    await this.hooks.afterMark?.();
  }
  async pinReference(p: string, c: string, at: string) {
    const r = await (this.inner.pinReference as NonNullable<EventStore['pinReference']>)(p, c, at);
    await this.hooks.afterPin?.();
    return r;
  }
  async append(e: TaskEvent): Promise<'appended' | 'conflict'> {
    await this.hooks.beforeAppend?.(e);
    return this.inner.append(e);
  }
}

const backends: Array<[string, () => { store: EventStore; dir: string | null }]> = [
  ['memory', () => ({ store: new MemoryEventStore(), dir: null })],
  [
    'filesystem',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-race-'));
      dirs.push(dir);
      return { store: initStore(new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' })), dir };
    },
  ],
];

describe.each(backends)('prune vs. child creation on %s store', (_n, make) => {
  function setup() {
    const { store: inner, dir } = make();
    const clock = new Clock();
    const store = new HookStore(inner);
    const mk = (s: EventStore = store): DurableTasks => new DurableTasks({ store: s, now: clock.now });
    return { inner, dir, clock, store, mk, rt: mk(), plain: mk(inner) };
  }
  async function finishedParent(rt: DurableTasks, clock: Clock, id = 'P'): Promise<void> {
    await rt.createTask({ taskId: id, kind: 'k', goal: 'g' });
    const f = await rt.claim(id, { owner: 'w' });
    await rt.complete(f, { r: 1 });
    clock.advance(DAY);
  }

  it('a child created between the prune check and the removal is NOT left pointing at a deleted parent', async () => {
    const { store, rt, plain, clock } = setup();
    await finishedParent(rt, clock);
    // The pruner has passed its check; before it commits, another process creates the child in full.
    store.hooks.beforeMark = async () => {
      store.hooks.beforeMark = undefined;
      await plain.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
    };
    await expect(rt.pruneTask('P', POLICY)).rejects.toBeInstanceOf(RetentionRefusedError);

    const parent = await plain.getState('P'); // not pruned
    expect(parent.status).toBe('completed');
    expect((await plain.getState('C')).status).toBe('active');
    expect((await plain.verify()).every((r) => r.ok)).toBe(true);
    // once the child is finished the parent may go
    const f = await plain.claim('C', { owner: 'w' });
    await plain.complete(f);
    await rt.pruneTask('P', POLICY);
    await expect(plain.getState('P')).rejects.toBeInstanceOf(TaskPrunedError);
  });

  it('a child whose pin lands after the pruner looked, but before the tombstone, is caught by the second look', async () => {
    const { store, rt, plain, clock, inner } = setup();
    await finishedParent(rt, clock);
    store.hooks.beforeMark = async () => {
      store.hooks.beforeMark = undefined;
      // only the pin (creation still in progress)
      await (inner.pinReference as NonNullable<EventStore['pinReference']>)('P', 'C', clock.now().toISOString());
    };
    await expect(rt.pruneTask('P', POLICY)).rejects.toThrow(/refers to it/);
    expect((await plain.getState('P')).status).toBe('completed');
  });

  it('after the tombstone is published a new child is refused cleanly: nothing of it is published', async () => {
    const { store, rt, plain, clock } = setup();
    await finishedParent(rt, clock);
    let creation: Promise<unknown> | null = null;
    store.hooks.afterMark = async () => {
      store.hooks.afterMark = undefined;
      creation = plain.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' }).then(() => null, (e: unknown) => e);
      // the prune proceeds without waiting for the creator
    };
    await rt.pruneTask('P', POLICY);
    const err = await creation;
    expect(err).toBeInstanceOf(ValidationError);
    await expect(plain.getState('C')).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(plain.getState('P')).rejects.toBeInstanceOf(TaskPrunedError);
  });

  it('a pin that landed between the tombstone and the child: the pruner sees the pin and withdraws, the creator carries on', async () => {
    const { store, rt, plain, clock } = setup();
    await finishedParent(rt, clock);
    let creation: Promise<unknown> | null = null;
    // creator pins first (no tombstone yet) and is held right after the pin
    let releaseCreator!: () => void;
    const gate = new Promise<void>((r) => (releaseCreator = r));
    const creator = new HookStore(store.inner);
    creator.hooks.afterPin = () => gate;
    const creatorRt = new DurableTasks({ store: creator, now: clock.now });
    store.hooks.beforeMark = async () => {
      store.hooks.beforeMark = undefined;
      creation = creatorRt.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
      // wait until the creator has pinned (the pin is visible in the store)
      for (let i = 0; i < 400 && (await (store.inner.listReferences as NonNullable<EventStore['listReferences']>)('P')).length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    };
    store.hooks.afterMark = async () => {
      store.hooks.afterMark = undefined;
      releaseCreator(); // the creator now publishes the child while the tombstone is up, then waits for it to settle
    };
    await expect(rt.pruneTask('P', POLICY)).rejects.toBeInstanceOf(RetentionRefusedError);
    const created = (await creation) as { created: boolean };
    expect(created.created).toBe(true);
    expect((await plain.getState('P')).status).toBe('completed');
    expect((await plain.getState('C')).status).toBe('active');
  });

  it('a crash between the tombstone and the second look: finishing the prune notices the child and withdraws', async () => {
    const { store, rt, plain, clock } = setup();
    await finishedParent(rt, clock);
    store.hooks.beforeMark = async () => {
      store.hooks.beforeMark = undefined;
      await plain.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
    };
    store.hooks.afterMark = async () => {
      throw new Error('simulated process death');
    };
    await expect(rt.pruneTask('P', POLICY)).rejects.toThrow('simulated process death');
    await expect(plain.getState('P')).rejects.toBeInstanceOf(TaskPrunedError); // tombstone is up, data intact

    await expect(mkFresh(store.inner, clock).pruneTask('P', POLICY)).rejects.toBeInstanceOf(RetentionRefusedError);
    expect((await plain.getState('P')).status).toBe('completed'); // withdrawn
    expect((await plain.getState('C')).status).toBe('active');
  });

  it('a pin whose creator died blocks the prune only for the grace period', async () => {
    const { rt, plain, clock, inner } = setup();
    await finishedParent(rt, clock);
    await (inner.pinReference as NonNullable<EventStore['pinReference']>)('P', 'ghost', clock.now().toISOString());
    await expect(rt.pruneTask('P', POLICY)).rejects.toThrow(/refers to it/);
    clock.advance(9 * 60_000);
    await expect(rt.pruneTask('P', POLICY)).rejects.toThrow(/refers to it/);
    clock.advance(2 * 60_000); // 11 minutes: beyond the default 10
    await rt.pruneTask('P', POLICY);
    await expect(plain.getState('P')).rejects.toBeInstanceOf(TaskPrunedError);
    // a pin never resurrects anything and a late creator is refused
    await expect(plain.createTask({ taskId: 'ghost', kind: 'k', goal: 'g', parentTaskId: 'P' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('a creator that stalled longer than the grace period and lost its parent is cancelled, not left active', async () => {
    const { store, rt, plain, clock } = setup();
    await finishedParent(rt, clock);
    store.hooks.beforeAppend = async (e) => {
      if (e.taskId !== 'C') return;
      store.hooks.beforeAppend = undefined;
      clock.advance(11 * 60_000); // the creator was paused after pinning; the pin is now ignorable
      await plain.pruneTask('P', POLICY);
    };
    const err = await rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    const c = await plain.getState('C');
    expect(c.status).toBe('cancelled');
    expect(c.error).toMatch(/was pruned while this task was being created/);
  });

  it('dependsOn references are pinned like the parent', async () => {
    const { store, rt, plain, clock } = setup();
    await finishedParent(rt, clock, 'D1');
    store.hooks.beforeMark = async () => {
      store.hooks.beforeMark = undefined;
      await plain.createTask({ taskId: 'C', kind: 'k', goal: 'g', dependsOn: ['D1'] });
    };
    await expect(rt.pruneTask('D1', POLICY)).rejects.toBeInstanceOf(RetentionRefusedError);
    expect((await plain.getState('D1')).status).toBe('completed');
  });

  it('creating a task twice (a retry after a crash) is idempotent with pins', async () => {
    const { rt, clock } = setup();
    await finishedParent(rt, clock);
    const a = await rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
    const b = await rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
    expect([a.created, b.created]).toEqual([true, false]);
  });
});

function mkFresh(store: EventStore, clock: Clock): DurableTasks {
  return new DurableTasks({ store, now: clock.now });
}

describe('prune vs. child creation: filesystem specifics', () => {
  function fsSetup() {
    const dir = mkdtempSync(join(tmpdir(), 'durable-race-'));
    dirs.push(dir);
    const store = initStore(new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }));
    const clock = new Clock();
    return { dir, store, clock, rt: new DurableTasks({ store, now: clock.now }) };
  }

  it('the pin is a small file in the parent directory and disappears with the parent data', async () => {
    const { dir, rt, clock } = fsSetup();
    await rt.createTask({ taskId: 'P', kind: 'k', goal: 'g' });
    await rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
    expect(readdirSync(join(dir, 'tasks', 'P', 'refs'))).toEqual(['C.json']);
    const fc = await rt.claim('C', { owner: 'w' });
    await rt.complete(fc);
    const fp = await rt.claim('P', { owner: 'w' });
    await rt.complete(fp);
    clock.advance(DAY);
    await rt.pruneTask('P', POLICY);
    expect(existsSync(join(dir, 'tasks', 'P', 'refs'))).toBe(false);
    expect(existsSync(join(dir, 'tasks', 'P', 'events'))).toBe(false);
    expect(existsSync(join(dir, 'tasks', 'P', 'tombstone.json'))).toBe(true);
  });

  it('a tombstone cannot be withdrawn once the data was partly removed: the prune is refused loudly and nothing more is deleted', async () => {
    const { dir, store, rt, clock } = fsSetup();
    await rt.createTask({ taskId: 'P', kind: 'k', goal: 'g' });
    const fp = await rt.claim('P', { owner: 'w' });
    await rt.complete(fp);
    await rt.createTask({ taskId: 'X', kind: 'k', goal: 'g' }); // an active task that has a pin on P
    clock.advance(DAY);
    const state = await rt.getState('P');
    const tomb: Tombstone = tombstoneFor(state, clock.now().toISOString());
    await (store.pinReference as NonNullable<EventStore['pinReference']>)('P', 'X', clock.now().toISOString());
    // The pruner decided (commit) and died in the middle of the removal. Data can only go missing after a commit.
    const attempt = await (store.preparePrune as NonNullable<EventStore['preparePrune']>)(tomb);
    await (store.decidePrune as NonNullable<EventStore['decidePrune']>)('P', attempt.attempt, 'commit', tomb);
    unlinkSync(join(dir, 'tasks', 'P', 'events', '000000002.json')); // an interrupted removal got this far

    await expect(rt.pruneTask('P', POLICY)).rejects.toThrow(/partly removed/);
    expect((await (store.pruneState as NonNullable<EventStore['pruneState']>)('P')).kind).toBe('committed'); // never withdrawn
    expect(existsSync(join(dir, 'tasks', 'P', 'events', '000000001.json'))).toBe(true); // not touched further
  });
});
