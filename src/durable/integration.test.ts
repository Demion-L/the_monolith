/**
 * FIX-004E: minimal integration check. Durable State is used only through the package's public entry point
 * (`durable` namespace of `src/index.ts`), the way an internal MONOLITH mechanism would use it. No new API, no UI/CLI,
 * no external system: the "external effect" is a counter owned by the test.
 *
 * Lifecycle: create -> record execution state -> close the runtime -> reopen -> recover -> read canonical state ->
 * continue without a second right to an already used effect -> compact -> prune. SIGKILL / multi-process behaviour is
 * proven separately in fix004c-process.test.ts; here "closing" drops the runtime and the store object.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { durable } from '../index.js';

const { DurableTasks, FsEventStore, MemoryEventStore } = durable;
type EventStore = durable.EventStore;

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** A store that tells the runtime `'adopted'` for the selected event type although the event really is stored. */
function adoptingFor(inner: EventStore, type: string): EventStore {
  const w = Object.create(inner) as EventStore;
  w.append = async (e) => {
    const r = await inner.append(e);
    return e.type === type && r === 'appended' ? 'adopted' : r;
  };
  return w;
}

type Open = () => EventStore;
function backends(): Array<[string, Open]> {
  const dir = mkdtempSync(join(tmpdir(), 'durable-int-'));
  dirs.push(dir);
  const mem = new MemoryEventStore(); // a memory store has no "reopen": the same instance is the persisted state
  return [
    ['memory', () => mem],
    [
      'filesystem',
      () => {
        const s = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
        s.initializeProtocolSync();
        return s;
      },
    ],
  ];
}

describe('public entry point', () => {
  it('exposes the runtime and the stores, and keeps storage internals private', () => {
    for (const name of ['DurableTasks', 'FsEventStore', 'MemoryEventStore', 'newOwnerId', 'planRetention', 'foldEvents']) {
      expect(durable, name).toHaveProperty(name);
    }
    for (const internal of ['stampEvent', 'serializeEvent', 'createFile', 'derivePruneState', 'adoptedIsSuccess']) {
      expect(Object.keys(durable), `${internal} must not be public`).not.toContain(internal);
    }
  });
});

describe.each(backends())('lifecycle on the %s backend', (_name, open) => {
  it('create -> record -> reopen -> recover -> canonical state -> no second right -> compact -> prune', async () => {
    let calls = 0;
    const effect = async (): Promise<{ n: number }> => ({ n: ++calls });
    const policy = { terminalRetentionMs: 0 };

    // 1-3: create, record execution state
    const rt1 = new DurableTasks({ store: open() });
    expect((await rt1.createTask({ taskId: 'int-1', kind: 'k', goal: 'g' })).created).toBe(true);
    expect((await rt1.createTask({ taskId: 'int-1', kind: 'k', goal: 'g' })).created, 'no duplicate task').toBe(false);
    const f1 = await rt1.claim('int-1', { owner: 'worker-1', leaseMs: 60_000 });
    await rt1.declarePlan(f1, [{ id: 's1', title: 'step one' }]);
    await rt1.observe('int-1', { key: 'seen', value: 1 });
    const first = await rt1.runEffect(f1, 'send-1', effect, { description: 'controlled effect' });
    expect(first).toMatchObject({ replayed: false });
    expect(calls).toBe(1);

    // 4-6: close, reopen, recover
    const rt2 = new DurableTasks({ store: open() });
    const s2 = await rt2.getState('int-1');
    expect(s2.effects['send-1']?.status).toBe('completed');
    expect(s2.observations['seen']?.value).toBe(1);
    expect((await rt2.verify('int-1'))[0]).toMatchObject({ ok: true });
    expect(await rt2.findResumable(), 'a live lease is not resumable').toEqual([]);

    // 8: continue without a second right: another worker takes over, the used effect is replayed, not run again
    await rt2.release(f1);
    expect(await rt2.findResumable(), 'after release the task is recoverable').toEqual(expect.arrayContaining([expect.objectContaining({ taskId: 'int-1' })]));
    const f2 = await rt2.claim('int-1', { owner: 'worker-2', leaseMs: 60_000 });
    expect(f2.epoch).toBeGreaterThan(f1.epoch);
    expect(await rt2.runEffect(f2, 'send-1', effect, { description: 'controlled effect' })).toMatchObject({ replayed: true, result: { n: 1 } });
    expect(calls, 'the effect ran once in total').toBe(1);

    // 'adopted' grants no right: the announcement is stored, the runtime treats it as a lost race and does not run fn
    const rt3 = new DurableTasks({ store: adoptingFor(open(), 'effect.intended') });
    await expect(rt3.runEffect(f2, 'send-2', effect, { description: 'second effect' })).rejects.toThrow();
    expect(calls, "'adopted' must not let the effect run").toBe(1);

    // compaction keeps the canonical state and the used rights
    const before = await rt2.getState('int-1');
    expect(await rt2.compact('int-1', { throughSeq: before.headSeq - 1 })).toBeGreaterThan(0);
    const rt4 = new DurableTasks({ store: open() });
    const after = await rt4.getState('int-1');
    expect(after.headHash).toBe(before.headHash);
    expect(after.effects['send-1']?.status).toBe('completed');
    expect(await rt4.runEffect(f2, 'send-1', effect, { description: 'controlled effect' })).toMatchObject({ replayed: true });
    expect(calls).toBe(1);
    expect((await rt4.verify('int-1'))[0]).toMatchObject({ ok: true });

    // prune: tombstone, idempotent, nothing resurrected
    await rt4.complete(f2, { done: true });
    const tomb = await rt4.pruneTask('int-1', policy);
    expect(tomb).toMatchObject({ taskId: 'int-1', finalStatus: 'completed' });
    const rt5 = new DurableTasks({ store: open() });
    expect(await rt5.pruneTask('int-1', policy), 'a second prune is a no-op').toEqual(tomb);
    await expect(rt5.createTask({ taskId: 'int-1', kind: 'k', goal: 'g' })).rejects.toThrow();
    await expect(rt5.getState('int-1')).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('filesystem layout after prune', () => {
  it('keeps the decision register and the tombstone, leaves no events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'durable-int-'));
    dirs.push(dir);
    const store = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
    store.initializeProtocolSync();
    const rt = new DurableTasks({ store });
    await rt.createTask({ taskId: 'int-fs', kind: 'k', goal: 'g' });
    const f = await rt.claim('int-fs', { owner: 'w' });
    await rt.complete(f, 1);
    await rt.pruneTask('int-fs', { terminalRetentionMs: 0 });
    const td = join(dir, 'tasks', 'int-fs');
    expect(readdirSync(td)).toEqual(expect.arrayContaining(['tombstone.json', 'prune-1.prepare.json', 'prune-1.decision.json']));
    expect(existsSync(join(td, 'events')) ? readdirSync(join(td, 'events')).filter((n) => /^\d{9}\.json$/.test(n)) : []).toEqual([]);
    expect(await store.pruneState('int-fs')).toMatchObject({ kind: 'committed', residue: 0 });
  });
});
