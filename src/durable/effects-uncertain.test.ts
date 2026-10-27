/**
 * DURABLE-FIX-001 / D-5 — an exception from an external call is not proof that the call did not happen.
 *
 * Before the fix any error thrown by `fn` was recorded as `effect.failed {retryable: true}` and the next
 * `runEffect` simply ran `fn` again — a payment that succeeded on the server and then timed out on the
 * client was charged twice.
 *
 * Three outcomes are distinguished:
 *   completed      fn returned                                         -> result recorded, never re-run
 *   not executed   fn threw EffectNotExecutedError (or classifyError)  -> failed; retryable unless told otherwise
 *   unknown        fn threw anything else                              -> failed + uncertain; in doubt, needs `reconcile`
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks, type Fence } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { EffectFailedError, EffectInDoubtError, EffectNotExecutedError } from './errors.js';
import { stampEvent } from './log.js';
import type { EventStore, TaskEvent } from './types.js';

const initStore = (s: FsEventStore): FsEventStore => (s.initializeProtocolSync(), s);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const backends: Array<[string, () => EventStore]> = [
  ['memory', () => new MemoryEventStore()],
  [
    'filesystem',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-unc-'));
      dirs.push(dir);
      return initStore(new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }));
    },
  ],
];

/** A stand-in for an external payment API: the server may apply the charge and the client may still see a timeout. */
class Gateway {
  charges: string[] = [];
  calls = 0;
  mode: 'ok' | 'timeout-after-apply' | 'refused' = 'ok';
  async charge(idempotencyKey: string): Promise<{ id: string }> {
    this.calls++;
    if (this.mode === 'refused') throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    this.charges.push(idempotencyKey); // the server applied the charge
    if (this.mode === 'timeout-after-apply') throw Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' });
    return { id: `ch-${this.charges.length}` };
  }
}

describe.each(backends)('uncertain effect outcomes on %s store', (_n, make) => {
  async function start(): Promise<{ store: EventStore; rt: DurableTasks; f: Fence; gw: Gateway }> {
    const store = make();
    const rt = new DurableTasks({ store });
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'worker-a' });
    return { store, rt, f, gw: new Gateway() };
  }

  it('success on the server followed by a client timeout is NOT retried automatically', async () => {
    const { rt, f, gw } = await start();
    gw.mode = 'timeout-after-apply';
    await expect(rt.runEffect(f, 'pay-1', () => gw.charge('pay-1'), { description: 'charge card' })).rejects.toThrow('ETIMEDOUT');

    // the very next attempt (same worker, same lease) must not call the gateway again
    await expect(rt.runEffect(f, 'pay-1', () => gw.charge('pay-1'), { description: 'charge card' })).rejects.toBeInstanceOf(EffectInDoubtError);
    expect(gw.calls).toBe(1);
    expect(gw.charges).toEqual(['pay-1']);

    const e = (await rt.getState('job1')).effects['pay-1'];
    expect(e).toMatchObject({ status: 'failed', uncertain: true });
    const a = await rt.assess('job1');
    expect(a.mode).toBe('recovery');
    expect(a.reasons.map((r) => r.code)).toContain('EFFECT_IN_DOUBT');
    expect(a.unresolvedEffects).toMatchObject([{ key: 'pay-1', inDoubt: true }]);
  });

  it('the in-doubt effect is resolved through reconcile: found on the server => recorded, not re-run', async () => {
    const { rt, f, gw } = await start();
    gw.mode = 'timeout-after-apply';
    await expect(rt.runEffect(f, 'pay-1', () => gw.charge('pay-1'), { description: 'charge card' })).rejects.toThrow('ETIMEDOUT');
    gw.mode = 'ok';
    const out = await rt.runEffect(f, 'pay-1', () => gw.charge('pay-1'), {
      description: 'charge card',
      reconcile: async (effect) => {
        expect(effect).toMatchObject({ key: 'pay-1', status: 'failed', uncertain: true });
        return gw.charges.includes('pay-1') ? { status: 'completed', result: { id: 'ch-1' } } : { status: 'not-executed' };
      },
    });
    expect(out).toEqual({ result: { id: 'ch-1' }, replayed: true });
    expect(gw.calls).toBe(1);
    expect((await rt.getState('job1')).effects['pay-1']).toMatchObject({ status: 'completed', result: { id: 'ch-1' } });
    expect((await rt.assess('job1')).reasons.map((r) => r.code)).not.toContain('EFFECT_IN_DOUBT');
    // and it stays settled
    expect(await rt.runEffect(f, 'pay-1', () => gw.charge('pay-1'), { description: 'charge card' })).toMatchObject({ replayed: true });
    expect(gw.calls).toBe(1);
  });

  it('reconcile may establish that nothing happened; only then is the call made again', async () => {
    const { rt, f, gw } = await start();
    let n = 0;
    const flaky = async (): Promise<{ id: string }> => {
      if (++n === 1) throw new Error('socket hang up'); // nothing applied on the server this time
      return { id: 'ok' };
    };
    await expect(rt.runEffect(f, 'e', flaky, { description: 'e' })).rejects.toThrow('socket hang up');
    const out = await rt.runEffect(f, 'e', flaky, { description: 'e', reconcile: async () => ({ status: 'not-executed' }) });
    expect(out).toEqual({ result: { id: 'ok' }, replayed: false });
    expect(n).toBe(2);
    void gw;
  });

  it('an error that PROVES nothing happened (EffectNotExecutedError) leaves the effect retryable', async () => {
    const { rt, f } = await start();
    let n = 0;
    const fn = async (): Promise<{ n: number }> => {
      if (++n === 1) throw new EffectNotExecutedError('connection refused before any byte was sent');
      return { n };
    };
    await expect(rt.runEffect(f, 'e', fn, { description: 'e' })).rejects.toBeInstanceOf(EffectNotExecutedError);
    expect((await rt.getState('job1')).effects['e']).toMatchObject({ status: 'failed', uncertain: false, retryable: true });
    expect((await rt.assess('job1')).reasons.map((r) => r.code)).not.toContain('EFFECT_IN_DOUBT');
    expect(await rt.runEffect(f, 'e', fn, { description: 'e' })).toEqual({ result: { n: 2 }, replayed: false });
  });

  it('a certain failure with retryable:false is permanent', async () => {
    const { rt, f } = await start();
    const fn = async (): Promise<{ n: number }> => {
      throw new EffectNotExecutedError('card number rejected locally');
    };
    await expect(rt.runEffect(f, 'b', fn, { description: 'b', retryable: false })).rejects.toBeInstanceOf(EffectNotExecutedError);
    await expect(rt.runEffect(f, 'b', async () => ({ n: 1 }), { description: 'b' })).rejects.toBeInstanceOf(EffectFailedError);
  });

  it('classifyError lets the application say which of its errors prove non-execution', async () => {
    const { rt, f, gw } = await start();
    const classifyError = (err: unknown): 'not-executed' | 'unknown' => ((err as { code?: string }).code === 'ECONNREFUSED' ? 'not-executed' : 'unknown');
    gw.mode = 'refused';
    await expect(rt.runEffect(f, 'a', () => gw.charge('a'), { description: 'a', classifyError })).rejects.toThrow('ECONNREFUSED');
    gw.mode = 'ok';
    expect(await rt.runEffect(f, 'a', () => gw.charge('a'), { description: 'a', classifyError })).toMatchObject({ replayed: false });

    gw.mode = 'timeout-after-apply';
    await expect(rt.runEffect(f, 'b', () => gw.charge('b'), { description: 'b', classifyError })).rejects.toThrow('ETIMEDOUT');
    await expect(rt.runEffect(f, 'b', () => gw.charge('b'), { description: 'b', classifyError })).rejects.toBeInstanceOf(EffectInDoubtError);
    expect(gw.charges).toEqual(['a', 'b']);
  });

  it('an uncertain failure is recorded so that a reader of the previous format also refuses to retry it', async () => {
    const { rt, f, gw } = await start();
    gw.mode = 'timeout-after-apply';
    await expect(rt.runEffect(f, 'pay-1', () => gw.charge('pay-1'), { description: 'charge card' })).rejects.toThrow('ETIMEDOUT');
    const failed = (await rt.getLog('job1')).events.find((e) => e.type === 'effect.failed') as Extract<TaskEvent, { type: 'effect.failed' }>;
    expect(failed.data).toMatchObject({ key: 'pay-1', retryable: false, uncertain: true });
  });

  it('an uncertain failure survives a restart and a change of owner', async () => {
    const { store, rt, f, gw } = await start();
    gw.mode = 'timeout-after-apply';
    await expect(rt.runEffect(f, 'pay-1', () => gw.charge('pay-1'), { description: 'charge card' })).rejects.toThrow('ETIMEDOUT');
    await rt.release(f);
    const rt2 = new DurableTasks({ store });
    const g = await rt2.claim('job1', { owner: 'worker-b' });
    gw.mode = 'ok';
    await expect(rt2.runEffect(g, 'pay-1', () => gw.charge('pay-1'), { description: 'charge card' })).rejects.toBeInstanceOf(EffectInDoubtError);
    expect(gw.calls).toBe(1);
  });

  it('logs written before this change (effect.failed without `uncertain`) keep their meaning', async () => {
    const { store, rt, f } = await start();
    await rt.runEffect(f, 'old', async () => ({ ok: 1 }), { description: 'old' }); // seq 3,4
    // hand-write what the previous version recorded for a retryable failure
    await rt.runEffect(f, 'legacy', async () => ({ ok: 1 }), { description: 'legacy' });
    const { state } = await rt.getLog('job1');
    const head = state.headSeq;
    const intended = stampEvent('job1', head + 1, '2026-03-01T00:00:00.000Z', state.headHash, {
      type: 'effect.intended', actor: f.owner, data: { key: 'legacy-2', description: 'legacy', params: null, epoch: f.epoch },
    });
    expect(await store.append(intended)).toBe('appended');
    const failed = stampEvent('job1', head + 2, '2026-03-01T00:00:01.000Z', intended.hash, {
      type: 'effect.failed', actor: f.owner, data: { key: 'legacy-2', error: 'boom', retryable: true },
    });
    expect(await store.append(failed)).toBe('appended');

    const s = (await new DurableTasks({ store }).getState('job1')).effects['legacy-2'];
    expect(s).toMatchObject({ status: 'failed', retryable: true, uncertain: false });
    expect(await rt.runEffect(f, 'legacy-2', async () => ({ rerun: true }), { description: 'legacy' })).toEqual({ result: { rerun: true }, replayed: false });
  });
});
