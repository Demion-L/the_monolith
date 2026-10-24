import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks, parseToken, type Fence } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import {
  ContentionError, EffectFailedError, EffectInDoubtError, LeaseHeldError, LogTooLargeError, RetentionRefusedError,
  StaleFenceError, TaskClosedError, TaskExistsError, TaskNotFoundError, TaskPrunedError, ValidationError,
} from './errors.js';
import type { EventStore, TaskEvent } from './types.js';

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

/** Delegates to a real store; can be told to "crash" on selected appends (the process dies, the event is not stored). */
class FaultStore implements EventStore {
  crashOn: ((e: TaskEvent) => boolean) | null = null;
  constructor(readonly inner: EventStore) {}
  readLog: EventStore['readLog'] = (id, o) => this.inner.readLog(id, o);
  listTaskIds: EventStore['listTaskIds'] = () => this.inner.listTaskIds();
  compact: EventStore['compact'] = (a, b, c) => this.inner.compact(a, b, c);
  prune: EventStore['prune'] = (t) => this.inner.prune(t);
  async append(e: TaskEvent): Promise<'appended' | 'conflict'> {
    if (this.crashOn?.(e)) throw new Error('simulated process death');
    return this.inner.append(e);
  }
}

type Make = () => { store: EventStore; dir: string | null };
const backends: Array<[string, Make]> = [
  ['memory', () => ({ store: new MemoryEventStore(), dir: null })],
  [
    'filesystem',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-rt-'));
      dirs.push(dir);
      return { store: new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }), dir };
    },
  ],
];

describe.each(backends)('DurableTasks on %s store', (_n, make) => {
  function setup(opts: { maxEventsPerTask?: number } = {}) {
    const clock = new Clock();
    const { store, dir } = make();
    let n = 0;
    const mk = (s: EventStore = store) => new DurableTasks({ store: s, now: clock.now, newId: () => `id${++n}`, ...opts });
    return { clock, store, dir, mk, rt: mk() };
  }
  const createAndClaim = async (rt: DurableTasks, taskId = 'job1', owner = 'worker-a'): Promise<Fence> => {
    await rt.createTask({ taskId, kind: 'research', goal: 'prepare proposals' });
    return rt.claim(taskId, { owner });
  };

  // ------------------------------------------------------------------ tasks
  describe('tasks', () => {
    it('creates a task and is idempotent for the same request', async () => {
      const { rt } = setup();
      const a = await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g', input: { b: 1, a: 2 } });
      const b = await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g', input: { a: 2, b: 1 } });
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.state.headSeq).toBe(1);
    });

    it('refuses to reuse an id for a different request', async () => {
      const { rt } = setup();
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      await expect(rt.createTask({ taskId: 'job1', kind: 'k', goal: 'other' })).rejects.toBeInstanceOf(TaskExistsError);
    });

    it('validates ids and fields, and rejects non-JSON input', async () => {
      const { rt } = setup();
      await expect(rt.createTask({ taskId: '../x', kind: 'k', goal: 'g' })).rejects.toBeInstanceOf(ValidationError);
      await expect(rt.createTask({ kind: '', goal: 'g' })).rejects.toBeInstanceOf(ValidationError);
      await expect(rt.createTask({ kind: 'k', goal: 'g', input: { when: new Date() } })).rejects.toBeInstanceOf(ValidationError);
      await expect(rt.createTask({ kind: 'k', goal: 'g', input: { n: NaN } })).rejects.toBeInstanceOf(ValidationError);
    });

    it('requires referenced tasks to exist', async () => {
      const { rt } = setup();
      await expect(rt.createTask({ kind: 'k', goal: 'g', parentTaskId: 'ghost' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('reports an unknown task', async () => {
      const { rt } = setup();
      await expect(rt.getState('nope')).rejects.toBeInstanceOf(TaskNotFoundError);
    });

    it('a second runtime (another process) sees the same state', async () => {
      const { rt, mk } = setup();
      const f = await createAndClaim(rt);
      await rt.declarePlan(f, [{ id: 's1', title: 'one' }]);
      const other = mk();
      expect((await other.getState('job1')).plan?.map((p) => p.id)).toEqual(['s1']);
    });
  });

  // -------------------------------------------------------- lease and fencing
  describe('lease and fencing', () => {
    it('refuses a second live claim and lets an expired one be taken over', async () => {
      const { rt, clock } = setup();
      const a = await createAndClaim(rt);
      await expect(rt.claim('job1', { owner: 'worker-b' })).rejects.toBeInstanceOf(LeaseHeldError);
      clock.advance(10 * 60_000);
      const b = await rt.claim('job1', { owner: 'worker-b' });
      expect(b.epoch).toBe(a.epoch + 1);
    });

    it('fences out the old worker after a takeover', async () => {
      const { rt, clock } = setup();
      const a = await createAndClaim(rt);
      clock.advance(10 * 60_000);
      await rt.claim('job1', { owner: 'worker-b' });
      await expect(rt.declarePlan(a, [{ id: 's1', title: 'x' }])).rejects.toBeInstanceOf(StaleFenceError);
      await expect(rt.heartbeat(a)).rejects.toBeInstanceOf(StaleFenceError);
      expect((await rt.getState('job1')).plan).toBeNull();
    });

    it('heartbeat extends the lease; release frees the task', async () => {
      const { rt, clock } = setup();
      const a = await createAndClaim(rt);
      clock.advance(4 * 60_000);
      await rt.heartbeat(a);
      clock.advance(4 * 60_000);
      await expect(rt.claim('job1', { owner: 'worker-b' })).rejects.toBeInstanceOf(LeaseHeldError);
      await rt.release(a);
      await rt.release(a); // idempotent
      await expect(rt.claim('job1', { owner: 'worker-b' })).resolves.toMatchObject({ epoch: 2 });
    });

    it('of two runtimes racing to claim, exactly one wins', async () => {
      const { rt, mk } = setup();
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      const settled = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => mk().claim('job1', { owner: `w${i}` })),
      );
      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of settled.filter((r) => r.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(LeaseHeldError);
      }
    });

    it('cannot claim a closed task', async () => {
      const { rt } = setup();
      const f = await createAndClaim(rt);
      await rt.complete(f, { ok: true });
      await expect(rt.claim('job1', { owner: 'worker-b' })).rejects.toBeInstanceOf(TaskClosedError);
    });
  });

  // ------------------------------------------------------ plan and knowledge
  describe('plan, decisions, assumptions', () => {
    it('rejects invalid plans and re-declaring the same plan is a no-op', async () => {
      const { rt } = setup();
      const f = await createAndClaim(rt);
      await expect(rt.declarePlan(f, [{ id: 'a', title: 'a', dependsOn: ['b'] }])).rejects.toBeInstanceOf(ValidationError);
      await expect(
        rt.declarePlan(f, [{ id: 'a', title: 'a', dependsOn: ['b'] }, { id: 'b', title: 'b', dependsOn: ['a'] }]),
      ).rejects.toBeInstanceOf(ValidationError);
      await rt.declarePlan(f, [{ id: 'a', title: 'A' }]);
      const seq = (await rt.getState('job1')).headSeq;
      await rt.declarePlan(f, [{ id: 'a', title: 'A' }]);
      expect((await rt.getState('job1')).headSeq).toBe(seq);
    });

    it('enforces step order, is idempotent, and a re-plan never reopens finished work', async () => {
      const { rt } = setup();
      const f = await createAndClaim(rt);
      await rt.declarePlan(f, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', dependsOn: ['a'] }]);
      await expect(rt.completeStep(f, 'b')).rejects.toBeInstanceOf(ValidationError);
      await rt.completeStep(f, 'a', { found: 3 });
      await rt.completeStep(f, 'a', { found: 3 });
      await rt.declarePlan(f, [{ id: 'a', title: 'A2' }, { id: 'b', title: 'B', dependsOn: ['a'] }, { id: 'c', title: 'C', dependsOn: ['b'] }]);
      const plan = (await rt.getState('job1')).plan ?? [];
      expect(plan.find((p) => p.id === 'a')).toMatchObject({ status: 'done', title: 'A2', result: { found: 3 } });
      expect(plan.find((p) => p.id === 'c')?.status).toBe('pending');
    });

    it('decisions and assumptions are idempotent; conflicting redefinition is an error', async () => {
      const { rt } = setup();
      const f = await createAndClaim(rt);
      await rt.recordDecision(f, { id: 'd1', summary: 'use vendor A', rationale: 'cheapest' });
      await rt.recordDecision(f, { id: 'd1', summary: 'use vendor A', rationale: 'cheapest' });
      await expect(rt.recordDecision(f, { id: 'd1', summary: 'use vendor B' })).rejects.toBeInstanceOf(ValidationError);
      await rt.recordAssumption(f, { key: 'budget', statement: 'budget is 10k', value: 10000, evidence: [{ ref: 'crm:deal/42' }] });
      await rt.recordAssumption(f, { key: 'budget', statement: 'budget is 10k', value: 10000, evidence: [{ ref: 'crm:deal/42' }] });
      const s = await rt.getState('job1');
      expect(s.decisions).toHaveLength(1);
      expect(s.assumptions['budget']).toMatchObject({ criticality: 'blocking', status: 'active', evidence: [{ ref: 'crm:deal/42', note: null }] });
      expect(s.eventCount).toBe(1 + 1 + 1 + 1); // created, claimed, decision, assumption
    });

    it('re-stating an assumption with a changed value is refused unless it is a deliberate supersede', async () => {
      const { rt } = setup();
      const f = await createAndClaim(rt);
      await rt.recordAssumption(f, { key: 'budget', statement: 'budget is 10k', value: 10000 });
      await expect(rt.recordAssumption(f, { key: 'budget', statement: 'budget is 10k', value: 2000 })).rejects.toBeInstanceOf(ValidationError);
      expect((await rt.getState('job1')).assumptions['budget']?.value).toBe(10000);
      await rt.recordAssumption(f, { key: 'budget', statement: 'budget is now 2k', value: 2000, supersede: true });
      expect((await rt.getState('job1')).assumptions['budget']).toMatchObject({ value: 2000, status: 'active' });
    });

    it('observations from outside need no fence and equal repeats are no-ops', async () => {
      const { rt } = setup();
      await createAndClaim(rt);
      await rt.observe('job1', { key: 'budget', value: 8000, source: 'crm' });
      await rt.observe('job1', { key: 'budget', value: 8000, source: 'crm' });
      expect((await rt.getState('job1')).observations['budget']?.value).toBe(8000);
      expect((await rt.getState('job1')).eventCount).toBe(3);
    });
  });

  // ------------------------------------------------------------------ effects
  describe('effects', () => {
    it('runs once and replays the recorded result', async () => {
      const { rt } = setup();
      const f = await createAndClaim(rt);
      let calls = 0;
      const fn = async () => ({ id: ++calls });
      const a = await rt.runEffect(f, 'send-mail', fn, { description: 'send mail' });
      const b = await rt.runEffect(f, 'send-mail', fn, { description: 'send mail' });
      expect(a).toEqual({ result: { id: 1 }, replayed: false });
      expect(b).toEqual({ result: { id: 1 }, replayed: true });
      expect(calls).toBe(1);
    });

    it('a crash after the call but before the outcome is recorded is reported as in doubt, never re-run blindly', async () => {
      const { clock, store, mk } = setup();
      const faulty = new FaultStore(store);
      const rt1 = mk(faulty);
      const f = await createAndClaim(rt1);
      let calls = 0;
      faulty.crashOn = (e) => e.type === 'effect.completed';
      await expect(rt1.runEffect(f, 'charge', async () => ({ n: ++calls }), { description: 'charge card' })).rejects.toThrow('simulated process death');
      expect(calls).toBe(1);

      // new process, after the lease ran out
      clock.advance(10 * 60_000);
      const rt2 = mk();
      const g = await rt2.claim('job1', { owner: 'worker-b' });
      await expect(rt2.runEffect(g, 'charge', async () => ({ n: ++calls }), { description: 'charge card' })).rejects.toBeInstanceOf(EffectInDoubtError);
      expect(calls).toBe(1);
      const a = await rt2.assess('job1');
      expect(a.mode).toBe('recovery');
      expect(a.reasons.map((r) => r.code)).toContain('EFFECT_IN_DOUBT');

      // reconciliation finds the charge went through
      const out = await rt2.runEffect(g, 'charge', async () => ({ n: ++calls }), {
        description: 'charge card',
        reconcile: async () => ({ status: 'completed', result: { n: 1 } }),
      });
      expect(out).toEqual({ result: { n: 1 }, replayed: true });
      expect(calls).toBe(1);
      expect((await rt2.assess('job1')).reasons.map((r) => r.code)).not.toContain('EFFECT_IN_DOUBT');
    });

    it('reconciliation may establish that the effect did not run; it then runs under the new epoch', async () => {
      const { clock, store, mk } = setup();
      const faulty = new FaultStore(store);
      const rt1 = mk(faulty);
      const f = await createAndClaim(rt1);
      faulty.crashOn = (e) => e.type === 'effect.intended';
      await expect(rt1.runEffect(f, 'x', async () => ({ ran: true }), { description: 'x' })).rejects.toThrow('simulated');
      faulty.crashOn = null;
      // crash was BEFORE intent was stored: nothing in doubt, plain re-run
      clock.advance(10 * 60_000);
      const rt2 = mk();
      const g = await rt2.claim('job1', { owner: 'b' });
      expect(await rt2.runEffect(g, 'x', async () => ({ ran: true }), { description: 'x' })).toEqual({ result: { ran: true }, replayed: false });
    });

    it('an effect that threw is retryable by default; a non-retryable one is not run again', async () => {
      const { rt } = setup();
      const f = await createAndClaim(rt);
      await expect(rt.runEffect(f, 'a', async () => { throw new Error('boom'); }, { description: 'a' })).rejects.toThrow('boom');
      expect(await rt.runEffect(f, 'a', async () => ({ ok: 1 }), { description: 'a' })).toMatchObject({ replayed: false });
      await expect(rt.runEffect(f, 'b', async () => { throw new Error('bad'); }, { description: 'b', retryable: false })).rejects.toThrow('bad');
      await expect(rt.runEffect(f, 'b', async () => ({}), { description: 'b' })).rejects.toBeInstanceOf(EffectFailedError);
    });

    it('a fenced-out worker cannot record an effect', async () => {
      const { rt, clock } = setup();
      const a = await createAndClaim(rt);
      clock.advance(10 * 60_000);
      await rt.claim('job1', { owner: 'worker-b' });
      await expect(rt.runEffect(a, 'e', async () => ({}), { description: 'e' })).rejects.toBeInstanceOf(StaleFenceError);
    });
  });

  // ---------------------------------------------------------- awaits/delivery
  describe('awaits and deliveries', () => {
    async function withAwaits() {
      const s = setup();
      const f = await createAndClaim(s.rt);
      await s.rt.declarePlan(f, [{ id: 'research', title: 'research' }, { id: 'write', title: 'write', dependsOn: ['research'] }]);
      const w1 = await s.rt.registerAwait(f, { awaitId: 'acme', purpose: 'research Acme', stepId: 'research', request: { company: 'Acme' } });
      const w2 = await s.rt.registerAwait(f, { awaitId: 'globex', purpose: 'research Globex', stepId: 'research', request: { company: 'Globex' } });
      return { ...s, f, w1, w2 };
    }

    it('registration is idempotent and returns the same token', async () => {
      const { rt, f, w1 } = await withAwaits();
      const again = await rt.registerAwait(f, { awaitId: 'acme', purpose: 'research Acme', stepId: 'research' });
      expect(again).toEqual({ awaitId: 'acme', token: w1.token, created: false });
      await expect(rt.registerAwait(f, { awaitId: 'acme', purpose: 'different', stepId: 'research' })).rejects.toBeInstanceOf(ValidationError);
      await expect(rt.registerAwait(f, { purpose: 'p', stepId: 'nope' })).rejects.toBeInstanceOf(ValidationError);
      await expect(rt.registerAwait(f, { purpose: 'p', deadlineAt: 'not a date' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('accepts results in any order, from a process that never saw the task, and tolerates duplicates', async () => {
      const { rt, mk, f, w1, w2 } = await withAwaits();
      await rt.release(f); // the worker is gone
      const courier = mk(); // a different process
      const r2 = await courier.deliver(w2.token, { rank: 2 }, { idempotencyKey: 'msg-2', source: 'sphynx' });
      expect(r2.kind).toBe('accepted');
      expect((await rt.assess('job1')).mode).toBe('waiting');
      expect(await courier.deliver(w2.token, { rank: 2 }, { idempotencyKey: 'msg-2' })).toMatchObject({ kind: 'duplicate' });
      const before = (await rt.getState('job1')).headSeq;
      expect(await courier.deliver(w2.token, { rank: 2 }, { idempotencyKey: 'msg-2' })).toMatchObject({ kind: 'duplicate' });
      expect((await rt.getState('job1')).headSeq).toBe(before); // a duplicate writes nothing
      expect(await courier.deliver(w1.token, { rank: 1 }, { idempotencyKey: 'msg-1' })).toMatchObject({ kind: 'accepted' });
      const a = await rt.assess('job1');
      expect(a.nextSteps.map((s) => s.id)).toEqual(['research']);
      expect(a.results.map((r) => r.awaitId).sort()).toEqual(['acme', 'globex']);
    });

    it('a different result for a resolved await is a conflict that is kept, not applied', async () => {
      const { rt, w1 } = await withAwaits();
      await rt.deliver(w1.token, { v: 'first' }, { idempotencyKey: 'k1' });
      const r = await rt.deliver(w1.token, { v: 'second' }, { idempotencyKey: 'k2' });
      expect(r.kind).toBe('conflict');
      const s = await rt.getState('job1');
      expect(s.awaits['acme']).toMatchObject({ payload: { v: 'first' }, rejectedDeliveries: 1 });
      const { events } = await rt.getLog('job1');
      expect(events.find((e) => e.type === 'await.delivery_rejected')?.data).toMatchObject({ payload: { v: 'second' } });
      expect(await rt.deliver(w1.token, { v: 'second' }, { idempotencyKey: 'k2' })).toMatchObject({ kind: 'duplicate' });
    });

    it('an idempotency key is scoped to its await: the same key for two awaits is two deliveries', async () => {
      const { rt, w1, w2 } = await withAwaits();
      expect(await rt.deliver(w1.token, { v: 1 }, { idempotencyKey: 'msg-7' })).toMatchObject({ kind: 'accepted' });
      expect(await rt.deliver(w2.token, { v: 2 }, { idempotencyKey: 'msg-7' })).toMatchObject({ kind: 'accepted' });
      expect(await rt.deliver(w2.token, { v: 2 }, { idempotencyKey: 'msg-7' })).toMatchObject({ kind: 'duplicate' });
      const s = await rt.getState('job1');
      expect([s.awaits['acme']?.payload, s.awaits['globex']?.payload]).toEqual([{ v: 1 }, { v: 2 }]);
    });

    it('a result whose step was removed by a re-plan is still reported', async () => {
      const { rt, f, w1 } = await withAwaits();
      await rt.deliver(w1.token, { v: 1 }, { idempotencyKey: 'k' });
      await rt.declarePlan(f, [{ id: 'other', title: 'a different approach' }], 'research step dropped');
      const a = await rt.assess('job1');
      expect(a.results.map((r) => r.awaitId)).toContain('acme');
    });

    it('rejects malformed, forged and misdirected tokens', async () => {
      const { rt, w1 } = await withAwaits();
      expect(await rt.deliver('garbage', {}, { idempotencyKey: 'k' })).toEqual({ kind: 'rejected', reason: 'malformed-token' });
      const p = parseToken(w1.token) as { taskId: string; awaitId: string };
      expect(await rt.deliver(`dsc1.${p.taskId}.${p.awaitId}.${'0'.repeat(32)}`, {}, { idempotencyKey: 'k' })).toEqual({ kind: 'rejected', reason: 'bad-token' });
      expect(await rt.deliver(`dsc1.${p.taskId}.nope.${'0'.repeat(32)}`, {}, { idempotencyKey: 'k' })).toEqual({ kind: 'rejected', reason: 'unknown-await' });
      expect(await rt.deliver(`dsc1.ghost.${p.awaitId}.${'0'.repeat(32)}`, {}, { idempotencyKey: 'k' })).toEqual({ kind: 'rejected', reason: 'unknown-task' });
    });

    it('a result after the deadline is accepted, flagged late, and sends the task to adaptive handling', async () => {
      const s = setup();
      const f = await createAndClaim(s.rt);
      await s.rt.declarePlan(f, [{ id: 'r', title: 'r' }]);
      const w = await s.rt.registerAwait(f, { awaitId: 'slow', purpose: 'slow thing', stepId: 'r', deadlineAt: new Date(s.clock.t + 1000) });
      s.clock.advance(5000);
      expect(await s.rt.sweepDeadlines()).toEqual([{ taskId: 'job1', awaitId: 'slow' }]);
      expect(await s.rt.sweepDeadlines()).toEqual([]);
      const expired = await s.rt.assess('job1');
      expect(expired.mode).toBe('recovery');
      expect(expired.reasons.map((r) => r.code)).toContain('AWAIT_EXPIRED');
      await s.rt.deliver(w.token, { ok: 1 }, { idempotencyKey: 'late' });
      const a = await s.rt.assess('job1');
      expect(a.results[0]).toMatchObject({ late: true });
      expect(a.mode).toBe('adaptive');
    });

    it('results for a finished task are ignored and the log stays sealed', async () => {
      const { rt, f, w1 } = await withAwaits();
      await rt.cancel('job1', 'no longer needed');
      expect(await rt.deliver(w1.token, { v: 1 }, { idempotencyKey: 'k' })).toEqual({ kind: 'ignored', reason: 'task-closed', taskId: 'job1' });
      await expect(rt.completeStep(f, 'research')).rejects.toBeInstanceOf(TaskClosedError);
      await rt.cancel('job1', 'again'); // idempotent
    });

    it('delivery is safe under concurrency: same key from many deliverers is accepted exactly once', async () => {
      const { mk, w1 } = await withAwaits();
      const results = await Promise.all(Array.from({ length: 10 }, () => mk().deliver(w1.token, { v: 1 }, { idempotencyKey: 'same' })));
      expect(results.filter((r) => r.kind === 'accepted')).toHaveLength(1);
      expect(results.filter((r) => r.kind === 'duplicate')).toHaveLength(9);
    });
  });

  // ------------------------------------------------------------- continuation
  describe('resume assessment: the three continuation scenarios', () => {
    async function proposalTask() {
      const s = setup();
      const f = await createAndClaim(s.rt, 'proposals');
      await s.rt.declarePlan(f, [
        { id: 'research', title: 'research prospects' },
        { id: 'draft', title: 'draft proposals', dependsOn: ['research'] },
      ]);
      await s.rt.recordAssumption(f, { key: 'budget', statement: 'prospect budget is at least 10k', value: { min: 10000 }, criticality: 'blocking' });
      await s.rt.recordAssumption(f, { key: 'tone', statement: 'formal tone preferred', value: 'formal', criticality: 'advisory' });
      await s.rt.recordDecision(f, { id: 'd1', summary: 'research via SphynX', basedOn: ['budget'] });
      const w = await s.rt.registerAwait(f, { awaitId: 'acme', purpose: 'research Acme', stepId: 'research' });
      await s.rt.release(f); // the original process ends
      return { ...s, f, w };
    }

    it('scenario 1 (direct): result in, nothing changed, next step known', async () => {
      const { rt, w } = await proposalTask();
      await rt.deliver(w.token, { facts: 1 }, { idempotencyKey: 'm1' });
      const a = await rt.assess('proposals', { observations: { budget: { min: 10000 }, tone: 'formal' } });
      expect(a.mode).toBe('direct');
      expect(a.nextSteps.map((s) => s.id)).toEqual(['research']);
      expect(a.results[0]).toMatchObject({ awaitId: 'acme', payload: { facts: 1 } });
      expect(a.reasons.filter((r) => r.severity !== 'info')).toEqual([]);
    });

    it('scenario 2 (adaptive): an advisory assumption changed, or the world moved without breaking the plan', async () => {
      const { rt, w } = await proposalTask();
      await rt.deliver(w.token, { facts: 1 }, { idempotencyKey: 'm1' });
      const a = await rt.assess('proposals', { observations: { budget: { min: 10000 }, tone: 'casual' } });
      expect(a.mode).toBe('adaptive');
      expect(a.assumptionChanges).toEqual([expect.objectContaining({ key: 'tone', was: 'formal', now: 'casual', criticality: 'advisory' })]);

      await rt.observe('proposals', { key: 'competitor', value: 'entered the market', source: 'news-agent' });
      const b = await rt.assess('proposals', { observations: { budget: { min: 10000 }, tone: 'formal' } });
      expect(b.mode).toBe('adaptive');
      expect(b.reasons.map((r) => r.code)).toContain('WORLD_CHANGED_SINCE_SEND');
      expect(b.sinceSend.map((e) => e.key)).toEqual(['competitor']);
    });

    it('scenario 3 (recovery): a blocking assumption no longer holds', async () => {
      const { rt, w } = await proposalTask();
      await rt.deliver(w.token, { facts: 1 }, { idempotencyKey: 'm1' });
      await rt.observe('proposals', { key: 'budget', value: { min: 2000 }, source: 'crm' });
      const a = await rt.assess('proposals');
      expect(a.mode).toBe('recovery');
      expect(a.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'BLOCKING_ASSUMPTION_CHANGED', refs: ['budget'] })]));

      const packet = await rt.resumePacket('proposals');
      expect(packet.decisions[0]).toMatchObject({ id: 'd1', basedOn: ['budget'] });
      expect(packet.assumptions.find((x) => x.key === 'budget')).toMatchObject({ value: { min: 10000 } });
      expect(packet.sinceSend[0]?.changes).toEqual(expect.arrayContaining([{ section: 'observations', key: 'budget', change: 'added' }]));
      expect(packet.timeline.map((t) => t.type)).toContain('await.resolved');
    });

    it('a blocking assumption with no current value is not silently trusted', async () => {
      const { rt, w } = await proposalTask();
      await rt.deliver(w.token, { facts: 1 }, { idempotencyKey: 'm1' });
      const a = await rt.assess('proposals', { observations: { tone: 'formal' } });
      expect(a.mode).toBe('adaptive');
      expect(a.reasons.map((r) => r.code)).toContain('BLOCKING_ASSUMPTION_UNVERIFIED');
      expect((await rt.assess('proposals', { unverifiedBlocking: 'recovery' })).mode).toBe('recovery');
    });

    it('the state at send time can be reconstructed', async () => {
      const { rt, w } = await proposalTask();
      const reg = (await rt.getState('proposals')).awaits['acme'];
      await rt.deliver(w.token, { facts: 1 }, { idempotencyKey: 'm1' });
      await rt.observe('proposals', { key: 'budget', value: { min: 2000 }, source: 'crm' });
      const then = await rt.getStateAt('proposals', reg?.basisSeq as number);
      expect(then.awaits['acme']).toBeUndefined();
      expect(Object.keys(then.observations)).toEqual([]);
      expect(then.assumptions['budget']?.value).toEqual({ min: 10000 });
    });

    it('waiting while results are outstanding; closed when finished', async () => {
      const { rt, w } = await proposalTask();
      expect((await rt.assess('proposals', { observations: { budget: { min: 10000 }, tone: 'formal' } })).mode).toBe('waiting');
      await rt.deliver(w.token, {}, { idempotencyKey: 'm1' });
      const f = await rt.claim('proposals', { owner: 'worker-b' });
      await rt.completeStep(f, 'research');
      await rt.completeStep(f, 'draft');
      const done = await rt.assess('proposals', { observations: { budget: { min: 10000 }, tone: 'formal' } });
      expect(done).toMatchObject({ mode: 'direct', planComplete: true, nextSteps: [] });
      await rt.complete(f, { proposals: 3 });
      expect((await rt.assess('proposals')).mode).toBe('closed');
    });

    it('work recorded without a plan means the next step is unknown', async () => {
      const { rt } = setup();
      const f = await createAndClaim(rt);
      expect((await rt.assess('job1')).reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['NO_PLAN_YET']));
      await rt.registerAwait(f, { awaitId: 'x', purpose: 'p' });
      const a = await rt.assess('job1');
      expect(a.mode).toBe('recovery');
      expect(a.reasons.map((r) => r.code)).toContain('NO_PLAN_BUT_PROGRESS');
    });

    it('findResumable returns unowned tasks with something to do, not waiting ones', async () => {
      const { rt, w } = await proposalTask();
      await rt.createTask({ taskId: 'idle', kind: 'k', goal: 'g' });
      expect((await rt.findResumable({ observations: () => ({ budget: { min: 10000 }, tone: 'formal' }) })).map((r) => r.taskId)).toEqual(['idle']);
      await rt.deliver(w.token, {}, { idempotencyKey: 'm1' });
      const found = await rt.findResumable({ observations: () => ({ budget: { min: 10000 }, tone: 'formal' }) });
      expect(found.map((r) => `${r.taskId}:${r.mode}`)).toEqual(['idle:direct', 'proposals:direct']);
      await rt.claim('proposals', { owner: 'w' });
      expect((await rt.findResumable()).map((r) => r.taskId)).toEqual(['idle']);
    });
  });

  // ----------------------------------------------------------- concurrency
  describe('concurrency', () => {
    it('many runtimes appending to one task lose nothing and keep the chain intact', async () => {
      const { rt, mk } = setup();
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      await Promise.all(Array.from({ length: 30 }, (_, i) => mk().observe('job1', { key: `k${i}`, value: i, source: `s${i % 3}` })));
      const s = await rt.getState('job1');
      expect(Object.keys(s.observations)).toHaveLength(30);
      expect(s.headSeq).toBe(31);
      expect((await rt.verify('job1'))[0]).toMatchObject({ ok: true, headSeq: 31 });
    });

    it('gives up with ContentionError instead of spinning forever', async () => {
      const { store, mk } = setup();
      const hostile: EventStore = {
        readLog: (id, o) => store.readLog(id, o),
        listTaskIds: () => store.listTaskIds(),
        compact: (a, b, c) => store.compact(a, b, c),
        prune: (t) => store.prune(t),
        append: async (e) => (e.seq === 1 ? store.append(e) : 'conflict'),
      };
      const rt = new DurableTasks({ store: hostile, maxAppendAttempts: 5, now: () => new Date() });
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      await expect(rt.observe('job1', { key: 'a', value: 1 })).rejects.toBeInstanceOf(ContentionError);
      void mk;
    });

    it('enforces the per-task event ceiling', async () => {
      const { rt } = setup({ maxEventsPerTask: 4 });
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      for (let i = 0; i < 3; i++) await rt.observe('job1', { key: `k${i}`, value: i });
      await expect(rt.observe('job1', { key: 'k9', value: 9 })).rejects.toBeInstanceOf(LogTooLargeError);
    });
  });

  // ---------------------------------------------------------------- lifecycle
  describe('retention', () => {
    const HOUR = 3_600_000;
    async function finished(rt: DurableTasks, id: string, clock: Clock) {
      await rt.createTask({ taskId: id, kind: 'k', goal: 'g' });
      const f = await rt.claim(id, { owner: 'w' });
      await rt.complete(f, { done: id });
      clock.advance(0);
    }

    it('keeps young and referenced tasks, prunes the rest, and leaves a tombstone', async () => {
      const { rt, clock } = setup();
      await finished(rt, 'old', clock);
      await finished(rt, 'parent', clock);
      await finished(rt, 'young', clock);
      await rt.createTask({ taskId: 'child', kind: 'k', goal: 'g', parentTaskId: 'parent' });
      clock.advance(48 * HOUR);
      await finished(rt, 'fresh', clock);

      const plan = await rt.planRetention({ terminalRetentionMs: 24 * HOUR });
      const by = Object.fromEntries(plan.map((d) => [d.taskId, d]));
      expect(by['old']?.action).toBe('prune');
      expect(by['young']?.action).toBe('prune');
      expect(by['parent']).toMatchObject({ action: 'keep', reason: expect.stringContaining('child') });
      expect(by['fresh']).toMatchObject({ action: 'keep', reason: 'within retention period' });
      expect(by['child']?.action).toBe('keep');

      const report = await rt.applyRetention({ terminalRetentionMs: 24 * HOUR });
      expect(report.applied.map((a) => a.taskId).sort()).toEqual(['old', 'young']);
      await expect(rt.getState('old')).rejects.toBeInstanceOf(TaskPrunedError);
      expect((await rt.getState('parent')).status).toBe('completed');
      expect(await rt.listTasks()).toHaveLength(3);
    });

    it('a late delivery to a pruned task is recognised, not resurrected', async () => {
      const { rt, clock } = setup();
      const f = await createAndClaim(rt, 'gone');
      const w = await rt.registerAwait(f, { awaitId: 'a', purpose: 'p' });
      await rt.complete(f, { x: 1 });
      clock.advance(48 * HOUR);
      await rt.applyRetention({ terminalRetentionMs: 24 * HOUR });
      expect(await rt.deliver(w.token, {}, { idempotencyKey: 'late' })).toEqual({ kind: 'ignored', reason: 'task-pruned', taskId: 'gone' });
      await expect(rt.createTask({ taskId: 'gone', kind: 'k', goal: 'g' })).rejects.toBeInstanceOf(TaskPrunedError);
    });

    it('never prunes an active task, even a very old one; pruneTask re-checks against the live log', async () => {
      const { rt, clock } = setup();
      await createAndClaim(rt, 'alive');
      clock.advance(1000 * HOUR);
      expect((await rt.planRetention({ terminalRetentionMs: HOUR })).find((d) => d.taskId === 'alive')?.action).toBe('keep');
      await expect(rt.pruneTask('alive', { terminalRetentionMs: 0 })).rejects.toBeInstanceOf(RetentionRefusedError);
    });

    it('refuses to prune a task an active task started referencing after the plan was made', async () => {
      const { rt, clock } = setup();
      await finished(rt, 'dep', clock);
      clock.advance(48 * HOUR);
      const plan = await rt.planRetention({ terminalRetentionMs: 24 * HOUR });
      expect(plan.find((d) => d.taskId === 'dep')?.action).toBe('prune');
      await rt.createTask({ taskId: 'newcomer', kind: 'k', goal: 'g', dependsOn: ['dep'] });
      await expect(rt.pruneTask('dep', { terminalRetentionMs: 24 * HOUR })).rejects.toBeInstanceOf(RetentionRefusedError);
      const report = await rt.applyRetention({ terminalRetentionMs: 24 * HOUR });
      expect(report.applied).toEqual([]);
      expect((await rt.getState('dep')).status).toBe('completed');
    });

    it('compacts a long task without changing its state or its history', async () => {
      const { rt, dir } = setup();
      await rt.createTask({ taskId: 'long', kind: 'k', goal: 'g' });
      for (let i = 0; i < 150; i++) await rt.observe('long', { key: `k${i}`, value: i });
      const before = await rt.getLog('long');
      const report = await rt.applyRetention({ terminalRetentionMs: HOUR, compactAfterEvents: 100, keepTailEvents: 20 });
      expect(report.applied).toEqual([{ taskId: 'long', action: 'compact', detail: '131 events packed' }]);
      const after = await rt.getLog('long');
      expect(after.events).toEqual(before.events);
      expect(after.state).toEqual(before.state);
      if (dir) {
        const t = join(dir, 'tasks', 'long');
        expect(readdirSync(join(t, 'events'))).toHaveLength(20);
        expect(readdirSync(join(t, 'segments'))).toHaveLength(1);
      }
      // a fresh process reads the compacted task identically and can keep writing
      const fresh = new DurableTasks({ store: setupStore(dir, rt), now: () => new Date() });
      await fresh.observe('long', { key: 'after', value: 1 });
      expect((await fresh.getState('long')).headSeq).toBe(152);
      if (dir) {
        // one more event must not trigger a crumb segment
        expect((await rt.planRetention({ terminalRetentionMs: HOUR, compactAfterEvents: 100, keepTailEvents: 20 })).find((d) => d.taskId === 'long')?.action).toBe('keep');
      }
    });
  });

  describe('stale caches across processes', () => {
    it('a runtime whose cache sits inside a range another process compacted keeps working', async () => {
      const { rt, mk } = setup();
      await rt.createTask({ taskId: 'long', kind: 'k', goal: 'g' });
      for (let i = 0; i < 120; i++) await rt.observe('long', { key: `k${i}`, value: i });
      const reader = mk(); // another process, cache warm at seq 121
      expect((await reader.getState('long')).headSeq).toBe(121);
      for (let i = 0; i < 40; i++) await rt.observe('long', { key: `m${i}`, value: i });
      await rt.compact('long', { throughSeq: 150 }); // packs 1..150, which spans the reader's cached head
      await reader.observe('long', { key: 'from-reader', value: 1 }); // must refresh incrementally through a segment
      const s = await reader.getState('long');
      expect(s.headSeq).toBe(162);
      expect(s.observations['m39']?.value).toBe(39);
      expect((await rt.verify('long'))[0]).toMatchObject({ ok: true, headSeq: 162 });
    });
  });

  function setupStore(dir: string | null, rt: DurableTasks): EventStore {
    if (dir) return new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
    return (rt as unknown as { store: EventStore }).store;
  }
});
