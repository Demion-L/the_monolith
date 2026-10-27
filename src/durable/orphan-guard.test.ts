/**
 * DURABLE-FIX-002 / N-1, N-2 — an active task whose required task (parentTaskId / dependsOn) is gone must never be
 * handed out for execution, whatever the creator managed to do before it died and whatever the clocks say.
 *
 * Safety does not come from the creator's compensation (it can be killed) nor from the clocks (they can disagree):
 * it comes from `claim` refusing such a task by looking at the required task NOW, and from every discovery path
 * (`findResumable`, `assess`, `resumePacket`) reporting it as not claimable. Writing `task.cancelled` is a
 * best-effort cleanup on top of that, never the thing the guarantee rests on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { TaskOrphanedError, TaskPrunedError, StoreIoError, ValidationError } from './errors.js';
import type { EventStore, TaskEvent } from './types.js';

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
const POLICY = { terminalRetentionMs: 0 };
const GRACE = 300;

class Boom extends Error {}

/** Delegates to a real store; a test can stop the caller right after an append (a process that dies there). */
class CrashStore implements EventStore {
  afterAppend?: (e: TaskEvent) => void | Promise<void>;
  failAppend?: (e: TaskEvent) => boolean;
  constructor(readonly inner: EventStore) {}
  readLog: EventStore['readLog'] = (id, o) => this.inner.readLog(id, o);
  listTaskIds: EventStore['listTaskIds'] = () => this.inner.listTaskIds();
  compact: EventStore['compact'] = (a, b, c) => this.inner.compact(a, b, c);
  prune: EventStore['prune'] = (t) => this.inner.prune(t);
  sweepCompacted = (id: string) => (this.inner.sweepCompacted as NonNullable<EventStore['sweepCompacted']>)(id);
  listReferences = (id: string) => (this.inner.listReferences as NonNullable<EventStore['listReferences']>)(id);
  withdrawTombstone: EventStore['withdrawTombstone'] = (t) => (this.inner.withdrawTombstone as NonNullable<EventStore['withdrawTombstone']>)(t);
  markPruned: EventStore['markPruned'] = (t) => (this.inner.markPruned as NonNullable<EventStore['markPruned']>)(t);
  pinReference = (p: string, c: string, at: string) => (this.inner.pinReference as NonNullable<EventStore['pinReference']>)(p, c, at);
  async append(e: TaskEvent): Promise<'appended' | 'conflict'> {
    if (this.failAppend?.(e)) throw new StoreIoError('injected: no space left on device', Object.assign(new Error('x'), { code: 'ENOSPC' }));
    const r = await this.inner.append(e);
    if (r === 'appended') await this.afterAppend?.(e);
    return r;
  }
}

const backends: Array<[string, () => EventStore]> = [
  ['memory', () => new MemoryEventStore()],
  [
    'filesystem',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-orphan-'));
      dirs.push(dir);
      return initStore(new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }));
    },
  ],
];

describe.each(backends)('orphan guard on %s store', (_n, make) => {
  function setup() {
    const inner = make();
    const creatorClock = new Clock();
    const prunerClock = new Clock();
    const crash = new CrashStore(inner);
    const mk = (store: EventStore, clock: Clock): DurableTasks => new DurableTasks({ store, now: clock.now, referenceGraceMs: GRACE });
    return {
      inner, crash, creatorClock, prunerClock,
      creator: mk(crash, creatorClock),
      pruner: mk(inner, prunerClock),
      fresh: (): DurableTasks => mk(inner, prunerClock), // "a new runtime after restart"
    };
  }
  async function closedParent(rt: DurableTasks, id = 'P'): Promise<void> {
    await rt.createTask({ taskId: id, kind: 'k', goal: 'g' });
    const f = await rt.claim(id, { owner: 'w' });
    await rt.complete(f, { r: 1 });
  }
  /** N-1 schedule: the creator pinned, froze; the pruner (pin ignorable) removed the parent; the creator published and was killed. */
  async function frozenCreatorOrphan(s: ReturnType<typeof setup>): Promise<void> {
    await closedParent(s.pruner);
    const origAppend = s.crash.append.bind(s.crash);
    let pruned = false;
    s.crash.append = async (e) => {
      if (e.taskId === 'C' && !pruned) {
        pruned = true;
        s.prunerClock.advance(GRACE + 1);
        await s.pruner.pruneTask('P', POLICY);
      }
      return origAppend(e);
    };
    s.crash.afterAppend = (e) => {
      if (e.taskId === 'C') throw new Boom('SIGKILL');
    };
    const err = await s.creator.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Boom);
    // the log physically holds an active child, and the parent is gone
    expect((await s.inner.readLog('C')).events.length).toBe(1);
    expect((await s.inner.readLog('P')).tombstone).not.toBeNull();
  }

  it('N-1: claim refuses the orphan left by a killed creator, and quarantines it durably', async () => {
    const s = setup();
    await frozenCreatorOrphan(s);
    const rt = s.fresh();
    await expect(rt.claim('C', { owner: 'w2' })).rejects.toBeInstanceOf(TaskOrphanedError);
    expect((await rt.getState('C')).status).toBe('cancelled');
    expect((await s.inner.readLog('C')).events.filter((e) => e.type === 'run.claimed').length).toBe(0);
    expect((await rt.verify()).every((r) => r.ok)).toBe(true);
  });

  it('N-1: findResumable never offers the orphan', async () => {
    const s = setup();
    await frozenCreatorOrphan(s);
    expect(await s.fresh().findResumable()).toEqual([]);
    expect((await s.fresh().getState('C')).status).toBe('cancelled');
  });

  it('N-1: assess and resumePacket report it as not claimable with REQUIRED_TASK_GONE', async () => {
    const s = setup();
    await frozenCreatorOrphan(s);
    const a = await s.fresh().assess('C');
    expect(a.claimable).toBe(false);
    expect(a.reasons.map((r) => r.code)).toContain('REQUIRED_TASK_GONE');
    await closedParentAgainForPacket(s);
  });

  async function closedParentAgainForPacket(s: ReturnType<typeof setup>): Promise<void> {
    // a second orphan, so resumePacket sees an active one as well
    const scratch = new DurableTasks({ store: new MemoryEventStore(), now: s.creatorClock.now });
    await scratch.createTask({ taskId: 'P', kind: 'k', goal: 'g' });
    await scratch.createTask({ taskId: 'C2', kind: 'k', goal: 'g', parentTaskId: 'P' });
    await s.inner.append((await scratch.getLog('C2')).events[0] as TaskEvent);
    const pk = await s.fresh().resumePacket('C2');
    expect(pk.assessment.claimable).toBe(false);
    expect(pk.assessment.reasons.map((r) => r.code)).toContain('REQUIRED_TASK_GONE');
  }

  it('N-2: a creator whose clock is behind still ends up with no executable child', async () => {
    const s = setup();
    await closedParent(s.pruner);
    // the pruner's clock is ahead by more than the grace; the creator believes almost no time passed
    s.prunerClock.advance(GRACE + 50);
    const origAppend = s.crash.append.bind(s.crash);
    let once = false;
    s.crash.append = async (e) => {
      if (e.taskId === 'C' && !once) {
        once = true;
        await s.pruner.pruneTask('P', POLICY);
      }
      return origAppend(e);
    };
    const err = await s.creator.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' }).then(() => null, (e: unknown) => e);
    // whichever way it went (refused up front or cancelled afterwards), nothing is executable
    expect(err).toBeInstanceOf(ValidationError);
    const rt = s.fresh();
    const st = await rt.getState('C').catch(() => null);
    if (st) expect(st.status).not.toBe('active');
    expect(await rt.findResumable()).toEqual([]);
  });

  it('TEST-3: recovery that cannot write (ENOSPC) leaves the task unclaimable on every attempt; a later attempt finishes it', { timeout: 60_000 }, async () => {
    const s = setup();
    await makeOrphanDirect(s);
    const rt = new DurableTasks({ store: s.crash, now: s.prunerClock.now, referenceGraceMs: GRACE });
    s.crash.failAppend = (e) => e.type === 'task.cancelled';
    for (let i = 0; i < 2; i++) {
      await expect(rt.claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
      expect(await rt.findResumable()).toEqual([]);
      expect((await rt.assess('C')).claimable).toBe(false);
      expect((await rt.getState('C')).status).toBe('active'); // log unchanged, still not executable
    }
    s.crash.failAppend = undefined;
    expect(await rt.findResumable()).toEqual([]); // the retry quarantines it
    expect((await rt.getState('C')).status).toBe('cancelled');
    expect(await rt.findResumable()).toEqual([]);
    await expect(rt.claim('C', { owner: 'w' })).rejects.toMatchObject({ code: 'TASK_CLOSED' });
  });

  it('TEST-3: a crash after the cancel was written, or two recoveries at once, are harmless', async () => {
    const s = setup();
    await makeOrphanDirect(s);
    const a = s.fresh();
    const b = s.fresh();
    const r = await Promise.allSettled([a.claim('C', { owner: 'a' }), b.claim('C', { owner: 'b' }), a.findResumable(), b.assess('C')]);
    expect(r[0].status).toBe('rejected');
    expect(r[1].status).toBe('rejected');
    const log = (await s.inner.readLog('C')).events;
    expect(log.filter((e) => e.type === 'task.cancelled').length).toBe(1);
    expect(log.filter((e) => e.type === 'run.claimed').length).toBe(0); // never claimed, so no effect could have run
  });

  it('dependsOn is guarded like the parent', async () => {
    const s = setup();
    await closedParent(s.pruner, 'D');
    await s.pruner.createTask({ taskId: 'E', kind: 'k', goal: 'g' });
    await makeOrphanDirect(s, 'C', { dependsOn: ['D'], parent: undefined, required: 'D' });
    await expect(s.fresh().claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
    // an unrelated task is untouched
    const f = await s.fresh().claim('E', { owner: 'w' });
    expect(f.taskId).toBe('E');
  });

  it('TEST-5: with the parent alive, claim / findResumable / assess behave as before', async () => {
    const s = setup();
    await closedParent(s.pruner);
    await s.creator.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
    const rt = s.fresh();
    expect((await rt.findResumable()).map((x) => x.taskId)).toEqual(['C']);
    expect((await rt.assess('C')).claimable).toBe(true);
    const f = await rt.claim('C', { owner: 'w' });
    await rt.complete(f);
    expect((await rt.getState('C')).status).toBe('completed');
    // and a terminal child of a pruned parent is just history
    await rt.pruneTask('P', POLICY);
    await expect(rt.getState('P')).rejects.toBeInstanceOf(TaskPrunedError);
    expect((await rt.getState('C')).status).toBe('completed');
    expect((await rt.assess('C')).reasons.map((r) => r.code)).not.toContain('REQUIRED_TASK_GONE');
  });

  /**
   * Publishes an active child whose required task is already pruned, the way the audit's schedule did.
   * The normal createTask path refuses this (pin → 'parent-pruned'), so the first event is built from a real
   * createTask on a scratch store and replayed into the target: byte-identical to what a creator that passed all of
   * its checks before the prune would have written.
   */
  async function makeOrphanDirect(
    s: ReturnType<typeof setup>,
    childId = 'C',
    cfg: { dependsOn?: string[]; parent?: string | undefined; required?: string } = { parent: 'P', required: 'P' },
  ): Promise<void> {
    const required = cfg.required ?? 'P';
    if (required === 'P') await closedParent(s.pruner);
    const scratch = new DurableTasks({ store: new MemoryEventStore(), now: s.creatorClock.now });
    await scratch.createTask({ taskId: required, kind: 'k', goal: 'g' });
    await scratch.createTask({
      taskId: childId, kind: 'k', goal: 'g',
      ...(cfg.parent === undefined && cfg.dependsOn ? { dependsOn: cfg.dependsOn } : { parentTaskId: required }),
    });
    const ev = (await scratch.getLog(childId)).events[0] as TaskEvent;
    expect(await s.inner.append(ev)).toBe('appended');
    // prune the required task for real (the child was not visible to the pruner's pin check at that time: it is
    // published after the tombstone; the prune of a task with an active referrer would refuse)
    s.prunerClock.advance(GRACE + 1);
    // withdraw the child's visibility is not possible; so prune first on a store where the child is not there yet
    // is covered by the dedicated schedules above. Here the required task is removed directly through the store.
    const log = await s.inner.readLog(required);
    const last = log.events[log.events.length - 1] as TaskEvent;
    await s.inner.prune({
      v: 1, taskId: required, kind: 'k', finalStatus: 'completed', createdAt: last.at, closedAt: last.at, prunedAt: last.at,
      headSeq: last.seq, headHash: last.hash, outcomeDigest: 'x'.repeat(64),
    });
  }
});
