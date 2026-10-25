/**
 * DURABLE-FIX-003 / N-6 — a tombstone alone does not prove that a required task is gone.
 *
 * A pruner publishes its tombstone BEFORE it looks for referrers. If it is stopped or killed right there, the
 * parent's data is intact and a perfectly valid active child exists. That child must not be cancelled; it must be
 * either run (the prune is rolled back) or refused for now (nothing written). Only a prune that has started removing
 * data is final, and then the child is an orphan.
 *
 * Logical states of a required task: LIVE / PRUNE_PENDING / GONE (see runtime.ts `requirementState`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { RequiredTaskPendingError, RetentionRefusedError, StoreIoError, TaskOrphanedError, TaskPrunedError, ValidationError } from './errors.js';
import type { EventStore, TaskEvent, Tombstone } from './types.js';

const POLICY = { terminalRetentionMs: 0 };
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** Delegates to a real store; a test can make single operations fail (the injected fault is not a real full disk). */
class FaultStore implements EventStore {
  failWithdraw?: () => boolean;
  failMark?: () => boolean;
  failCancel = false;
  afterAppend?: (e: TaskEvent) => Promise<void>;
  constructor(readonly inner: EventStore) {}
  readLog: EventStore['readLog'] = (id, o) => this.inner.readLog(id, o);
  listTaskIds: EventStore['listTaskIds'] = () => this.inner.listTaskIds();
  compact: EventStore['compact'] = (a, b, c) => this.inner.compact(a, b, c);
  prune: EventStore['prune'] = (t) => this.inner.prune(t);
  sweepCompacted = (id: string) => (this.inner.sweepCompacted as NonNullable<EventStore['sweepCompacted']>)(id);
  listReferences = (id: string) => (this.inner.listReferences as NonNullable<EventStore['listReferences']>)(id);
  pinReference = (p: string, c: string, at: string) => (this.inner.pinReference as NonNullable<EventStore['pinReference']>)(p, c, at);
  async markPruned(t: Tombstone): Promise<void> {
    if (this.failMark?.()) throw new StoreIoError('injected: no space left on device', Object.assign(new Error('x'), { code: 'ENOSPC' }));
    await (this.inner.markPruned as NonNullable<EventStore['markPruned']>)(t);
  }
  async withdrawTombstone(t: Tombstone): Promise<void> {
    if (this.failWithdraw?.()) throw new StoreIoError('injected: cannot remove the tombstone', Object.assign(new Error('x'), { code: 'EIO' }));
    await (this.inner.withdrawTombstone as NonNullable<EventStore['withdrawTombstone']>)(t);
  }
  async append(e: TaskEvent): Promise<'appended' | 'conflict'> {
    if (this.failCancel && e.type === 'task.cancelled') throw new StoreIoError('injected: no space left on device', Object.assign(new Error('x'), { code: 'ENOSPC' }));
    const r = await this.inner.append(e);
    if (r === 'appended') await this.afterAppend?.(e);
    return r;
  }
}

const backends: Array<[string, () => { store: EventStore; dir: string | null }]> = [
  ['memory', () => ({ store: new MemoryEventStore(), dir: null })],
  [
    'filesystem',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-pending-'));
      dirs.push(dir);
      return { store: new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }), dir };
    },
  ],
];

describe.each(backends)('pending prune on %s store', (name, make) => {
  function setup() {
    const { store: inner, dir } = make();
    const fault = new FaultStore(inner);
    const mk = (store: EventStore = fault): DurableTasks => new DurableTasks({ store, referenceGraceMs: 300 });
    return { inner, dir, fault, rt: mk(), fresh: (): DurableTasks => mk(inner) };
  }
  type S = ReturnType<typeof setup>;

  async function finished(rt: DurableTasks, id: string): Promise<void> {
    await rt.createTask({ taskId: id, kind: 'k', goal: 'g' });
    await rt.complete(await rt.claim(id, { owner: 'w' }), 1);
  }
  /** The pruner of the audit: it decided, published its tombstone, and stopped (SIGSTOP) or died (SIGKILL) there. */
  async function tombstoneOnly(s: S, id = 'P'): Promise<Tombstone> {
    const { state } = await s.fresh().getLog(id);
    const t: Tombstone = {
      v: 1, taskId: id, kind: 'k', finalStatus: 'completed', createdAt: state.createdAt, closedAt: state.closedAt as string,
      prunedAt: state.closedAt as string, headSeq: state.headSeq, headHash: state.headHash, outcomeDigest: 'x'.repeat(64),
    };
    await (s.inner.markPruned as NonNullable<EventStore['markPruned']>)(t);
    return t;
  }
  async function parentWithChild(s: S, cfg: { dependsOn?: boolean } = {}): Promise<void> {
    await finished(s.rt, 'P');
    await s.rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', ...(cfg.dependsOn ? { dependsOn: ['P'] } : { parentTaskId: 'P' }) });
  }
  const types = async (s: S, id: string): Promise<string[]> => (await s.inner.readLog(id)).events.map((e) => e.type);

  it('TEST-1: a stopped pruner (tombstone only) does not cost the child its life: claim rolls the prune back and runs', async () => {
    const s = setup();
    await parentWithChild(s);
    await tombstoneOnly(s);
    await new Promise((r) => setTimeout(r, 1200)); // longer than the old settle window (SETTLE_ATTEMPTS x STEP)
    const fence = await s.fresh().claim('C', { owner: 'w2' });
    expect(fence.taskId).toBe('C');
    expect((await s.fresh().getState('C')).status).toBe('active');
    expect(await types(s, 'C')).toEqual(['task.created', 'run.claimed']); // no task.cancelled
    expect((await s.fresh().getState('P')).status).toBe('completed'); // the parent is live again
    // the pruner wakes up: it must see the referrer and refuse, not delete under the claimed child
    await expect(s.rt.pruneTask('P', POLICY)).rejects.toBeInstanceOf(RetentionRefusedError);
    expect((await s.fresh().getState('P')).status).toBe('completed');
    expect((await s.fresh().verify()).every((r) => r.ok)).toBe(true);
  }, 30_000);

  it('TEST-1: dependsOn behaves like parentTaskId', async () => {
    const s = setup();
    await parentWithChild(s, { dependsOn: true });
    await tombstoneOnly(s);
    expect((await s.fresh().claim('C', { owner: 'w' })).taskId).toBe('C');
    expect((await s.fresh().getState('P')).status).toBe('completed');
  });

  it('TEST-2: after a killed pruner, a restarted runtime offers and claims the child; discovery never loses it', async () => {
    const s = setup();
    await parentWithChild(s);
    await tombstoneOnly(s);
    const restarted = s.fresh();
    expect((await restarted.findResumable()).map((x) => x.taskId)).toEqual(['C']);
    expect((await restarted.claim('C', { owner: 'w' })).taskId).toBe('C');
  });

  it('assess / resumePacket are read-only on a pending prune: not claimable, REQUIRED_TASK_PRUNE_PENDING, nothing written', async () => {
    const s = setup();
    await parentWithChild(s);
    await tombstoneOnly(s);
    const a = await s.fresh().assess('C');
    expect(a.claimable).toBe(false);
    expect(a.reasons.map((r) => r.code)).toContain('REQUIRED_TASK_PRUNE_PENDING');
    expect(a.reasons.map((r) => r.code)).not.toContain('REQUIRED_TASK_GONE');
    expect((await s.fresh().resumePacket('C')).assessment.claimable).toBe(false);
    expect((await s.inner.readLog('P')).tombstone).not.toBeNull(); // still not rolled back by a read
    expect(await types(s, 'C')).toEqual(['task.created']); // not cancelled
  });

  it('fail closed but not final: if the rollback cannot be written, claim is refused as RETRYABLE and nothing is cancelled', async () => {
    const s = setup();
    await parentWithChild(s);
    await tombstoneOnly(s);
    s.fault.failWithdraw = () => true;
    for (let i = 0; i < 3; i++) {
      const err = await s.rt.claim('C', { owner: 'w' }).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(RequiredTaskPendingError);
      expect((err as RequiredTaskPendingError).retryable).toBe(true);
      expect(await s.rt.findResumable()).toEqual([]);
      expect(await types(s, 'C')).toEqual(['task.created']);
    }
    s.fault.failWithdraw = undefined;
    expect((await s.rt.findResumable()).map((x) => x.taskId)).toEqual(['C']); // not lost for good
    expect((await s.rt.claim('C', { owner: 'w' })).taskId).toBe('C');
  });

  it('TEST-3: a genuinely gone parent: no fence, TaskOrphanedError, quarantine, and a repeat opens nothing', async () => {
    const s = setup();
    await parentWithChild(s);
    const t = await tombstoneOnly(s);
    await s.inner.prune(t); // the pruner got to remove the data
    const rt = s.fresh();
    await expect(rt.claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
    expect((await rt.getState('C')).status).toBe('cancelled');
    expect(await types(s, 'C')).not.toContain('run.claimed');
    await expect(rt.claim('C', { owner: 'w' })).rejects.toMatchObject({ code: 'TASK_CLOSED' });
    expect(await rt.findResumable()).toEqual([]);
    await expect(rt.getState('P')).rejects.toBeInstanceOf(TaskPrunedError);
  });

  it('TEST-3: a parent that never existed is gone as well', async () => {
    const s = setup();
    await finished(s.rt, 'P');
    await s.rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
    // replay the child into an empty store: its parent does not exist there
    const other = setup();
    await other.inner.append((await s.rt.getLog('C')).events[0] as TaskEvent);
    await expect(other.fresh().claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
  });

  it('TEST-4: two runtimes recover the same pending prune at once; the end state is the same and the log is untouched', async () => {
    const s = setup();
    await finished(s.rt, 'P');
    await s.rt.createTask({ taskId: 'C1', kind: 'k', goal: 'g', parentTaskId: 'P' });
    await s.rt.createTask({ taskId: 'C2', kind: 'k', goal: 'g', parentTaskId: 'P' });
    const eventsBefore = (await types(s, 'P')).length;
    await tombstoneOnly(s);
    expect((await s.inner.readLog('P')).tombstone).not.toBeNull();
    const out = await Promise.allSettled([s.fresh().claim('C1', { owner: 'a' }), s.fresh().claim('C2', { owner: 'b' }), s.fresh().findResumable(), s.fresh().claim('C1', { owner: 'a' })]);
    expect(out.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect((await s.inner.readLog('P')).tombstone).toBeNull();
    expect(await types(s, 'P')).toHaveLength(eventsBefore); // recovery appends nothing
    expect((await s.fresh().verify()).every((r) => r.ok)).toBe(true);
    // a second recovery on the settled state is a no-op
    await s.fresh().claim('C2', { owner: 'b' });
    expect(await types(s, 'P')).toHaveLength(eventsBefore);
  });

  it('recovery without any referrer: a retention pass finishes the interrupted prune', async () => {
    const s = setup();
    await finished(s.rt, 'P');
    await tombstoneOnly(s);
    const report = await s.fresh().applyRetention(POLICY);
    expect(report.applied.some((a) => a.taskId === 'P' && a.action === 'prune')).toBe(true);
    await expect(s.fresh().getState('P')).rejects.toBeInstanceOf(TaskPrunedError);
    expect((await s.inner.readLog('P')).diagnostics.some((d) => d.code === 'PRUNE_INCOMPLETE')).toBe(false);
  });

  it('recovery with a referrer: a retention pass rolls the prune back instead of deleting under the child', async () => {
    const s = setup();
    await parentWithChild(s);
    await tombstoneOnly(s);
    const report = await s.fresh().applyRetention(POLICY);
    expect(report.applied.filter((a) => a.taskId === 'P')).toEqual([]);
    expect((await s.fresh().getState('P')).status).toBe('completed');
    expect((await s.fresh().claim('C', { owner: 'w' })).taskId).toBe('C');
  });

  it('TEST-6: no space for the tombstone: pruneTask fails, nothing changes, the child is unaffected', async () => {
    const s = setup();
    await parentWithChild(s);
    await s.rt.cancel('C', 'not needed'); // so the prune may start
    s.fault.failMark = () => true;
    await expect(s.rt.pruneTask('P', POLICY)).rejects.toBeInstanceOf(StoreIoError);
    expect((await s.inner.readLog('P')).tombstone).toBeNull();
    expect((await s.fresh().getState('P')).status).toBe('completed');
  });

  it('TEST-6: the quarantine write of a GONE parent fails: still unclaimable every time; the retry cancels', async () => {
    const s = setup();
    await parentWithChild(s);
    await s.inner.prune(await tombstoneOnly(s));
    s.fault.failCancel = true;
    for (let i = 0; i < 2; i++) {
      await expect(s.rt.claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
      expect((await s.rt.getState('C')).status).toBe('active');
    }
    s.fault.failCancel = false;
    expect(await s.rt.findResumable()).toEqual([]);
    expect((await s.rt.getState('C')).status).toBe('cancelled');
  });

  it('creation path: a tombstone that shows up after the child was published rolls back instead of cancelling the new child', async () => {
    const s = setup();
    await finished(s.rt, 'P');
    const { state } = await s.fresh().getLog('P');
    const tomb: Tombstone = {
      v: 1, taskId: 'P', kind: 'k', finalStatus: 'completed', createdAt: state.createdAt, closedAt: state.closedAt as string,
      prunedAt: state.closedAt as string, headSeq: state.headSeq, headHash: state.headHash, outcomeDigest: 'x'.repeat(64),
    };
    s.fault.afterAppend = async (e) => {
      if (e.taskId === 'C') await (s.inner.markPruned as NonNullable<EventStore['markPruned']>)(tomb); // the pruner, stopped from here on
    };
    const created = await s.rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
    expect(created.created).toBe(true);
    expect((await s.fresh().getState('C')).status).toBe('active');
    expect((await s.fresh().getState('P')).status).toBe('completed');
  });

  it('creation against a pruned-pending parent is still refused up front (nothing is created)', async () => {
    const s = setup();
    await finished(s.rt, 'P');
    await tombstoneOnly(s);
    await expect(s.fresh().createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' })).rejects.toBeInstanceOf(ValidationError);
    expect((await s.inner.readLog('C')).exists).toBe(false);
  }, 30_000);

  it('TEST-5: claim after the tombstone is withdrawn / before any tombstone behaves as before', async () => {
    const s = setup();
    await parentWithChild(s);
    expect((await s.fresh().claim('C', { owner: 'w' })).taskId).toBe('C'); // claim before the tombstone
    await expect(s.rt.pruneTask('P', POLICY)).rejects.toBeInstanceOf(RetentionRefusedError); // referrer: prune refused
    expect((await s.inner.readLog('P')).tombstone).toBeNull(); // and the tombstone was taken back
  });

  if (name === 'filesystem') {
    it('TEST-5/TEST-3: a prune that already removed event files is committed: gone, even though complete-looking pieces remain', async () => {
      const s = setup();
      await parentWithChild(s);
      await tombstoneOnly(s);
      const evDir = join(s.dir as string, 'tasks', 'P', 'events');
      const files = readdirSync(evDir).sort();
      unlinkSync(join(evDir, files[0] as string)); // SIGKILL of the pruner in the middle of the removal
      expect((await s.inner.readLog('P')).diagnostics.some((d) => d.code === 'PRUNE_INCOMPLETE')).toBe(true);
      await expect(s.fresh().claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
      expect((await s.fresh().getState('C')).status).toBe('cancelled');
      expect(existsSync(join(s.dir as string, 'tasks', 'P', 'tombstone.json'))).toBe(true); // never withdrawn
      // and the retention pass can finish the removal; repeating it is harmless
      await s.fresh().applyRetention(POLICY);
      await s.fresh().applyRetention(POLICY);
      expect((await s.inner.readLog('P')).diagnostics.some((d) => d.code === 'PRUNE_INCOMPLETE')).toBe(false);
    });
  }
});
