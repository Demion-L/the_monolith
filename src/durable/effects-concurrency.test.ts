/**
 * DURABLE-FIX-001 / D-1 — concurrent `runEffect` calls with the same effect identity.
 *
 * Before the fix two parallel calls both appended `effect.intended`, both ran `fn`, and the second
 * `effect.completed` was rejected by the writer-side fold as `LogCorruptError`.
 *
 * What is guaranteed now (see ADR-017 §2.3a):
 *  - same process: concurrent calls with one (task, key) share ONE execution;
 *  - any number of processes: the announce step is a compare-and-set on the effect's identity in the log,
 *    so at most one caller can start `fn` for a given announcement; the others get `EffectConflictError`;
 *  - another owner (lease takeover): the announced-but-unfinished effect is in doubt for the new owner.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks, type Fence } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { EffectInDoubtError, LogCorruptError, StaleFenceError } from './errors.js';
import type { EventStore } from './types.js';

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

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

const backends: Array<[string, () => EventStore]> = [
  ['memory', () => new MemoryEventStore()],
  [
    'filesystem',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-eff-'));
      dirs.push(dir);
      return new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
    },
  ],
];

describe.each(backends)('concurrent effects on %s store', (_n, make) => {
  async function start(): Promise<{ store: EventStore; clock: Clock; rt: DurableTasks; f: Fence; mk: () => DurableTasks }> {
    const store = make();
    const clock = new Clock();
    const mk = (): DurableTasks => new DurableTasks({ store, now: clock.now });
    const rt = mk();
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'worker-a' });
    return { store, clock, rt, f, mk };
  }
  const intents = async (rt: DurableTasks): Promise<number> => (await rt.getLog('job1')).events.filter((e) => e.type === 'effect.intended').length;

  it('Promise.all of two calls with the same key runs fn once and both callers get the result', async () => {
    const { rt, f } = await start();
    const gate = deferred();
    let calls = 0;
    const fn = async () => {
      calls++;
      await gate.promise;
      return { paymentId: 'p-1' };
    };
    const both = Promise.all([
      rt.runEffect(f, 'pay-1', fn, { description: 'pay' }),
      rt.runEffect(f, 'pay-1', fn, { description: 'pay' }),
    ]);
    await tick(30); // let both reach the announce step while fn is still running
    gate.resolve();
    const [a, b] = await both;
    expect(calls).toBe(1);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.result).toEqual({ paymentId: 'p-1' });
    expect(b.result).toEqual({ paymentId: 'p-1' });
    expect(await intents(rt)).toBe(1);
    expect((await rt.verify('job1'))[0]).toMatchObject({ ok: true });
  });

  it('a failing shared execution fails every caller of that execution and is not run twice', async () => {
    const { rt, f } = await start();
    const gate = deferred();
    let calls = 0;
    const fn = async (): Promise<{ ok: true }> => {
      calls++;
      await gate.promise;
      throw new Error('upstream unavailable');
    };
    const both = Promise.allSettled([
      rt.runEffect(f, 'pay-1', fn, { description: 'pay' }),
      rt.runEffect(f, 'pay-1', fn, { description: 'pay' }),
    ]);
    await tick(30);
    gate.resolve();
    const out = await both;
    expect(calls).toBe(1);
    expect(out.map((o) => o.status)).toEqual(['rejected', 'rejected']);
    expect((await rt.verify('job1'))[0]).toMatchObject({ ok: true });
  });

  it('different keys run independently and concurrently', async () => {
    const { rt, f } = await start();
    let calls = 0;
    const fn = async () => ({ n: ++calls });
    await Promise.all([rt.runEffect(f, 'a', fn, { description: 'a' }), rt.runEffect(f, 'b', fn, { description: 'b' })]);
    expect(calls).toBe(2);
    expect(await intents(rt)).toBe(2);
  });

  it('two runtimes sharing one fence (as two processes would): fn runs once, the loser is refused', async () => {
    const { rt, f, mk } = await start();
    const other = mk();
    const gate = deferred();
    let calls = 0;
    const fn = async () => {
      calls++;
      await gate.promise;
      return { done: true };
    };
    const winner = rt.runEffect(f, 'pay-1', fn, { description: 'pay' });
    await tick(30);
    const loser = other.runEffect(f, 'pay-1', fn, { description: 'pay' });
    await expect(loser).rejects.toMatchObject({ code: expect.stringMatching(/^EFFECT_(CONFLICT|IN_DOUBT)$/) });
    expect(calls).toBe(1);
    gate.resolve();
    expect(await winner).toMatchObject({ result: { done: true }, replayed: false });
    expect(await intents(rt)).toBe(1);
    expect((await rt.verify('job1'))[0]).toMatchObject({ ok: true });
  });

  it('a loser that decided on the same prior state is stopped by the compare-and-set, not by timing', async () => {
    // Both runtimes read "no prior attempt" before either announces: the announce step must still let only one through.
    const { store, f, mk } = await start();
    const a = mk();
    const b = mk();
    const barrier = deferred();
    let waiting = 0;
    const slow = (rt: DurableTasks): DurableTasks => {
      const real = rt.getState.bind(rt);
      rt.getState = async (id: string) => {
        const s = await real(id);
        if (++waiting >= 2) barrier.resolve();
        await barrier.promise; // hold the first read of each runtime until both have it
        return s;
      };
      return rt;
    };
    let calls = 0;
    const fn = async () => ({ n: ++calls });
    const results = await Promise.allSettled([
      slow(a).runEffect(f, 'pay-1', fn, { description: 'pay' }),
      slow(b).runEffect(f, 'pay-1', fn, { description: 'pay' }),
    ]);
    expect(calls).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'EFFECT_CONFLICT' });
    expect(rejected.reason).not.toBeInstanceOf(LogCorruptError);
    expect((await new DurableTasks({ store }).verify('job1'))[0]).toMatchObject({ ok: true });
  });

  it('after the owner changed, an unfinished effect is in doubt for the new owner and fn is not run', async () => {
    const { rt, f, clock, mk } = await start();
    const gate = deferred();
    let calls = 0;
    const slowFn = async () => {
      calls++;
      await gate.promise;
      return { charged: true };
    };
    const old = rt.runEffect(f, 'charge', slowFn, { description: 'charge' });
    await tick(30);

    clock.advance(10 * 60_000); // the first worker's lease runs out while its call is in flight
    const rt2 = mk();
    const g = await rt2.claim('job1', { owner: 'worker-b' });
    await expect(rt2.runEffect(g, 'charge', async () => ({ n: ++calls }), { description: 'charge' })).rejects.toBeInstanceOf(EffectInDoubtError);
    expect(calls).toBe(1);

    gate.resolve(); // the zombie finishes; it may not record the result any more
    await expect(old).rejects.toBeInstanceOf(StaleFenceError);
    const state = await rt2.getState('job1');
    expect(state.effects['charge']).toMatchObject({ status: 'intended', intendedEpoch: f.epoch });

    // the new owner resolves the doubt against the external system
    const out = await rt2.runEffect(g, 'charge', async () => ({ n: ++calls }), {
      description: 'charge',
      reconcile: async () => ({ status: 'completed', result: { charged: true } }),
    });
    expect(out).toEqual({ result: { charged: true }, replayed: true });
    expect(calls).toBe(1);
    expect((await rt2.verify('job1'))[0]).toMatchObject({ ok: true });
  });

  it('a retry after the effect completed never announces again', async () => {
    const { rt, f } = await start();
    let calls = 0;
    const fn = async () => ({ n: ++calls });
    await rt.runEffect(f, 'e', fn, { description: 'e' });
    const again = await Promise.all([rt.runEffect(f, 'e', fn, { description: 'e' }), rt.runEffect(f, 'e', fn, { description: 'e' })]);
    expect(again.every((o) => o.replayed)).toBe(true);
    expect(calls).toBe(1);
    expect(await intents(rt)).toBe(1);
  });
});
