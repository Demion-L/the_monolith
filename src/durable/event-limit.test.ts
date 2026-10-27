/**
 * DURABLE-FIX-001 / D-2 — a task that used up its ordinary event budget must still be able to finish.
 *
 * Before the fix `maxEventsPerTask` was a hard wall for EVERY event, including `task.completed`,
 * `task.failed` and `task.cancelled`, so a task at the limit stayed active forever; and a deliverer
 * could burn the budget with conflicting deliveries (each stored with its full payload).
 *
 * Semantics now (ADR-017 §2.5):
 *   - `maxEventsPerTask` bounds ORDINARY events;
 *   - `terminalReserveEvents` (default 16) more slots exist above it, usable only by `run.claimed` /
 *     `run.released` (all but the last slot) and by the terminal events (every slot);
 *   - conflicting deliveries to an already resolved await are recorded with a size-bounded payload and
 *     only up to a small cap per await and per task; beyond it they are answered but not stored;
 *   - a full disk is a different thing (StoreIoError, nothing published) and is not bypassed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks, type Fence } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { LogTooLargeError, StoreIoError } from './errors.js';
import { MAX_EVENT_BYTES } from './log.js';
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

const MAX = 10;
const backends: Array<[string, () => EventStore]> = [
  ['memory', () => new MemoryEventStore()],
  [
    'filesystem',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-lim-'));
      dirs.push(dir);
      return initStore(new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }));
    },
  ],
];

describe.each(backends)('event budget on %s store', (_n, make) => {
  function setup(opts: { maxEventsPerTask?: number; terminalReserveEvents?: number } = {}) {
    const store = make();
    const clock = new Clock();
    const rt = new DurableTasks({ store, now: clock.now, maxEventsPerTask: MAX, ...opts });
    return { store, clock, rt };
  }
  async function fillToLimit(rt: DurableTasks, taskId = 'job1'): Promise<Fence> {
    await rt.createTask({ taskId, kind: 'k', goal: 'g' });
    const f = await rt.claim(taskId, { owner: 'worker-a' });
    for (let i = 0; ; i++) {
      try {
        await rt.observe(taskId, { key: `k${i}`, value: i });
      } catch (err) {
        expect(err).toBeInstanceOf(LogTooLargeError);
        return f;
      }
    }
  }

  it('complete() still works after the ordinary budget is exhausted', async () => {
    const { rt } = setup();
    const f = await fillToLimit(rt);
    await expect(rt.observe('job1', { key: 'more', value: 1 })).rejects.toBeInstanceOf(LogTooLargeError);
    await rt.complete(f, { done: true });
    const s = await rt.getState('job1');
    expect(s.status).toBe('completed');
    expect(s.eventCount).toBe(MAX + 1);
    expect((await rt.verify('job1'))[0]).toMatchObject({ ok: true, status: 'completed' });
  });

  it('fail() and cancel() work as well', async () => {
    const { rt } = setup();
    const f = await fillToLimit(rt, 'a');
    await rt.fail(f, 'gave up');
    expect((await rt.getState('a')).status).toBe('failed');
    await fillToLimit(rt, 'b');
    await rt.cancel('b', 'operator stop', 'ops');
    expect((await rt.getState('b')).status).toBe('cancelled');
  });

  it('a task at the limit whose lease expired can be re-claimed and then completed', async () => {
    const { rt, clock } = setup();
    await fillToLimit(rt);
    clock.advance(10 * 60_000);
    const g = await rt.claim('job1', { owner: 'worker-b' }); // control event, from the reserve
    expect(g.epoch).toBe(2);
    await rt.complete(g, 'ok');
    expect((await rt.getState('job1')).status).toBe('completed');
  });

  it('the reserve is finite: claim/release churn stops one slot before the end, and cancel still fits', async () => {
    const { rt, clock } = setup({ terminalReserveEvents: 4 });
    await fillToLimit(rt);
    let churn = 0;
    for (;;) {
      clock.advance(10 * 60_000);
      try {
        await rt.claim('job1', { owner: `w${churn}` });
        churn++;
      } catch (err) {
        expect(err).toBeInstanceOf(LogTooLargeError);
        break;
      }
    }
    expect(churn).toBe(3); // reserve 4: three control events, the last slot is kept for the terminal event
    expect((await rt.getState('job1')).eventCount).toBe(MAX + 3);
    await rt.cancel('job1', 'stop');
    const s = await rt.getState('job1');
    expect(s.status).toBe('cancelled');
    expect(s.eventCount).toBe(MAX + 4);
  });

  it('a terminal task is sealed: nothing more fits, the reserve does not reopen it', async () => {
    const { rt } = setup();
    const f = await fillToLimit(rt);
    await rt.complete(f);
    await expect(rt.observe('job1', { key: 'late', value: 1 })).rejects.toMatchObject({ code: 'TASK_CLOSED' });
  });

  it('terminalReserveEvents: 0 restores the strict ceiling (opt-out)', async () => {
    const { rt } = setup({ terminalReserveEvents: 0 });
    const f = await fillToLimit(rt);
    await expect(rt.complete(f)).rejects.toBeInstanceOf(LogTooLargeError);
  });
});

describe.each(backends)('conflicting deliveries on %s store', (_n, make) => {
  async function resolvedAwait(opts: { maxEventsPerTask?: number } = {}) {
    const rt = new DurableTasks({ store: make(), ...opts });
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'worker-a' });
    const w = await rt.registerAwait(f, { awaitId: 'acme', purpose: 'p' });
    expect(await rt.deliver(w.token, { answer: 1 }, { idempotencyKey: 'first' })).toMatchObject({ kind: 'accepted' });
    return { rt, f, w };
  }

  it('many deliveries with different idempotency keys do not grow the log without bound', async () => {
    const { rt, w } = await resolvedAwait();
    const before = (await rt.getState('job1')).headSeq;
    const big = { blob: 'x'.repeat(200_000) };
    const kinds = new Map<string, number>();
    for (let i = 0; i < 100; i++) {
      const r = await rt.deliver(w.token, big, { idempotencyKey: `retry-${i}` });
      expect(r.kind).toBe('conflict');
      const rec = (r as { recorded: boolean }).recorded ? 'recorded' : 'dropped';
      kinds.set(rec, (kinds.get(rec) ?? 0) + 1);
    }
    expect(kinds.get('recorded')).toBe(8); // per-await cap
    expect(kinds.get('dropped')).toBe(92);
    const log = await rt.getLog('job1');
    expect(log.state.headSeq - before).toBe(8);
    expect(log.state.awaits['acme']?.rejectedDeliveries).toBe(8);
    // the first answer was never replaced
    expect(log.state.awaits['acme']).toMatchObject({ status: 'resolved', payload: { answer: 1 } });
  });

  it('a rejected delivery keeps a bounded record, not the 200 KB payload', async () => {
    const { rt, w } = await resolvedAwait();
    const big = { blob: 'x'.repeat(200_000) };
    const r = await rt.deliver(w.token, big, { idempotencyKey: 'big', source: 'sphynx' });
    expect(r).toMatchObject({ kind: 'conflict', recorded: true });
    const ev = (await rt.getLog('job1')).events.find((e) => e.type === 'await.delivery_rejected');
    expect(JSON.stringify(ev).length).toBeLessThan(2000);
    expect(ev?.data).toMatchObject({ awaitId: 'acme', idempotencyKey: 'big', payload: { $truncated: true, bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    // a small conflicting payload is kept verbatim
    const small = await rt.deliver(w.token, { answer: 2 }, { idempotencyKey: 'small' });
    expect(small).toMatchObject({ kind: 'conflict', recorded: true });
    const evs = (await rt.getLog('job1')).events.filter((e) => e.type === 'await.delivery_rejected');
    expect(evs[1]?.data).toMatchObject({ payload: { answer: 2 } });
  });

  it('a dropped conflicting delivery writes nothing and says which event it conflicts with', async () => {
    const { rt, w } = await resolvedAwait();
    for (let i = 0; i < 8; i++) await rt.deliver(w.token, { n: i }, { idempotencyKey: `r${i}` });
    const head = (await rt.getState('job1')).headSeq;
    const resolvedAt = (await rt.getState('job1')).awaits['acme']?.resolvedAtSeq;
    const r = await rt.deliver(w.token, { n: 99 }, { idempotencyKey: 'overflow' });
    expect(r).toMatchObject({ kind: 'conflict', recorded: false, seq: resolvedAt });
    expect((await rt.getState('job1')).headSeq).toBe(head);
  });

  it('the same key is still a duplicate, and the per-task cap bounds many awaits', async () => {
    const { rt, f, w } = await resolvedAwait();
    expect(await rt.deliver(w.token, { answer: 1 }, { idempotencyKey: 'first' })).toMatchObject({ kind: 'duplicate' });
    expect(await rt.deliver(w.token, { z: 1 }, { idempotencyKey: 'again' })).toMatchObject({ kind: 'conflict', recorded: true });
    expect(await rt.deliver(w.token, { z: 1 }, { idempotencyKey: 'again' })).toMatchObject({ kind: 'duplicate' });

    // 64 stored rejections per task, spread over awaits
    let recorded = 1;
    for (let a = 0; a < 12; a++) {
      const wa = await rt.registerAwait(f, { awaitId: `w${a}`, purpose: 'p' });
      await rt.deliver(wa.token, { ok: 1 }, { idempotencyKey: 'first' });
      for (let i = 0; i < 8; i++) {
        const r = await rt.deliver(wa.token, { i }, { idempotencyKey: `x${i}` });
        if ((r as { recorded?: boolean }).recorded) recorded++;
      }
    }
    expect(recorded).toBe(64);
  });

  it('rejected deliveries cannot exhaust the budget of a task that is near its limit', async () => {
    const { rt, f, w } = await resolvedAwait({ maxEventsPerTask: 20 });
    for (let i = 0; i < 200; i++) await rt.deliver(w.token, { i }, { idempotencyKey: `k${i}` });
    // 8 rejections at most were stored; the task can still do ordinary work and finish
    await rt.observe('job1', { key: 'still-works', value: 1 });
    await rt.complete(f, 'done');
    expect((await rt.getState('job1')).status).toBe('completed');
  });
});

describe('a full disk is not the logical limit', () => {
  it('ENOSPC on a terminal append: StoreIoError, nothing published, the task stays active and can finish once space returns', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'durable-enospc-'));
    dirs.push(dir);
    let full = false;
    const store = new FsEventStore({
      target: { scope: 'trusted-directory', dir },
      durability: 'file',
      ops: {
        writeSync: ((fd: number, ...rest: unknown[]) => {
          if (full) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
          return (realWrite as (...a: unknown[]) => number)(fd, ...rest);
        }) as typeof import('fs').writeSync,
      },
    });
    store.initializeProtocolSync();
    const rt = new DurableTasks({ store });
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'w' });
    const head = (await rt.getState('job1')).headSeq;

    full = true;
    const err = await rt.complete(f, 'x').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(StoreIoError);
    expect(err).not.toBeInstanceOf(LogTooLargeError);
    expect((err as StoreIoError).errnoCode).toBe('ENOSPC');
    expect((err as StoreIoError).message).toMatch(/ENOSPC|no space/);

    const mid = new DurableTasks({ store: initStore(new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' })) });
    const s = await mid.getState('job1');
    expect(s).toMatchObject({ status: 'active', headSeq: head }); // nothing half-written is visible

    full = false;
    await rt.complete(f, 'x');
    expect((await mid.verify('job1'))[0]).toMatchObject({ ok: true, status: 'completed' });
  });

  it('an event larger than the per-event ceiling is a ValidationError, not a store failure', async () => {
    const rt = new DurableTasks({ store: new MemoryEventStore() });
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'w' });
    await expect(rt.complete(f, 'x'.repeat(MAX_EVENT_BYTES))).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

import * as fsReal from 'fs';

const initStore = (s: FsEventStore): FsEventStore => (s.initializeProtocolSync(), s);
const realWrite = fsReal.writeSync;
