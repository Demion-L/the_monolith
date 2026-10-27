/**
 * FIX-004B, runtime level (Amendment-004G, 2.11 / AC-ADO-4 / AC-ADO-5): only `'appended'` gives the right derived from
 * winning a slot. `'adopted'` is success solely for the closed list of state-only events; for the four rights-bearing
 * events (and any unknown type) it is a lost race. Process-level proofs (real processes, SIGKILL) belong to FIX-004C.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks, type Fence } from './runtime.js';
import { FsEventStore, AppendOutcomeUnknownError } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import {
  ContentionError, EffectConflictError, EffectInDoubtError, LeaseHeldError, TaskExistsError, TaskNotFoundError,
} from './errors.js';
import {
  ADOPTED_IS_SUCCESS_EVENT_TYPES, EVENT_TYPES, adoptedIsSuccess, type AppendOutcome, type EventStore, type EventType, type TaskEvent,
} from './types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const RIGHTS_BEARING: EventType[] = ['effect.intended', 'run.claimed', 'await.resolved', 'task.created'];

class Clock {
  t = Date.parse('2026-03-01T00:00:00.000Z');
  now = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t += ms;
  }
}

/** What the wrapper does to an append of a selected type. The inner store always sees the real call except for `conflict`. */
type Fault = 'adopted' | 'lost-response' | 'conflict' | 'compacted-adopted';

/**
 * Delegates to a real store and rewrites the outcome the runtime sees:
 *  - `adopted`: the event is really stored, but the caller is told only "adopted";
 *  - `lost-response`: the event is really stored, then the call fails with an unknown outcome (resolveUnknown path);
 *  - `conflict`: nothing is stored, the caller is told "conflict";
 *  - `compacted-adopted`: the event is stored, the log is compacted through it, the retry returns the real 'adopted'.
 */
class OutcomeStore implements EventStore {
  fault = new Map<EventType, { kind: Fault; times: number }>();
  attempts: Array<{ type: EventType; outcome: AppendOutcome | 'unknown' }> = [];
  constructor(readonly inner: EventStore) {}
  readLog: EventStore['readLog'] = (id, o) => this.inner.readLog(id, o);
  listTaskIds: EventStore['listTaskIds'] = () => this.inner.listTaskIds();
  compact: EventStore['compact'] = (a, b, c) => this.inner.compact(a, b, c);
  prune: EventStore['prune'] = (t) => this.inner.prune(t);
  inject(type: EventType, kind: Fault, times = Number.POSITIVE_INFINITY): void {
    this.fault.set(type, { kind, times });
  }
  appended(type: EventType): number {
    return this.attempts.filter((a) => a.type === type && a.outcome === 'appended').length;
  }
  async append(e: TaskEvent): Promise<AppendOutcome> {
    const f = this.fault.get(e.type);
    if (!f || f.times <= 0) return this.record(e, await this.inner.append(e));
    f.times--;
    if (f.kind === 'conflict') return this.record(e, 'conflict');
    const real = await this.inner.append(e);
    if (real !== 'appended') throw new Error(`test setup: the real append returned ${real}`);
    if (f.kind === 'adopted') return this.record(e, 'adopted');
    if (f.kind === 'lost-response') {
      this.attempts.push({ type: e.type, outcome: 'unknown' });
      throw new AppendOutcomeUnknownError(e.taskId, e.seq, new Error('response lost'));
    }
    const log = await this.inner.readLog(e.taskId);
    await this.inner.compact(e.taskId, e.seq, log.events.filter((x) => x.seq <= e.seq));
    const again = await this.inner.append(e);
    expect(again).toBe('adopted');
    return this.record(e, again);
  }
  private record(e: TaskEvent, outcome: AppendOutcome): AppendOutcome {
    this.attempts.push({ type: e.type, outcome });
    return outcome;
  }
}

/** Reports every append outcome of one shared store and holds all appends until `parties` callers have arrived. */
class GatedStore implements EventStore {
  outcomes: AppendOutcome[] = [];
  private arrived = 0;
  private release!: () => void;
  private readonly gate: Promise<void>;
  constructor(readonly inner: EventStore, private readonly parties: number, private readonly only: EventType) {
    this.gate = new Promise((r) => (this.release = r));
  }
  readLog: EventStore['readLog'] = (id, o) => this.inner.readLog(id, o);
  listTaskIds: EventStore['listTaskIds'] = () => this.inner.listTaskIds();
  compact: EventStore['compact'] = (a, b, c) => this.inner.compact(a, b, c);
  prune: EventStore['prune'] = (t) => this.inner.prune(t);
  async append(e: TaskEvent): Promise<AppendOutcome> {
    if (e.type === this.only && this.arrived < this.parties) {
      if (++this.arrived === this.parties) this.release();
      await this.gate;
      const r = await this.inner.append(e);
      this.outcomes.push(r);
      return r;
    }
    return this.inner.append(e);
  }
}

type Backend = () => EventStore;
const backends: Array<[string, Backend]> = [
  ['memory', () => new MemoryEventStore()],
  [
    'filesystem',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-fix004b-'));
      dirs.push(dir);
      const s = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
      s.initializeProtocolSync();
      return s;
    },
  ],
];

describe('state-only allowlist (closed, deny-by-default)', () => {
  const NAMED = [
    'effect.completed', 'effect.failed', 'task.completed', 'task.failed', 'task.cancelled', 'plan.declared', 'plan.step_done',
    'plan.step_skipped', 'decision.recorded', 'assumption.recorded', 'assumption.retracted', 'fact.observed', 'run.heartbeat',
    'run.released', 'await.registered', 'await.expired', 'await.delivery_rejected',
  ];

  it('is exactly the 17 types named by Amendment-004G 2.11', () => {
    expect([...ADOPTED_IS_SUCCESS_EVENT_TYPES].sort()).toEqual([...NAMED].sort());
  });

  it('classifies every EVENT_TYPE: 17 state-only + 4 rights-bearing, disjoint, nothing left over', () => {
    for (const t of EVENT_TYPES) expect(adoptedIsSuccess(t) !== RIGHTS_BEARING.includes(t)).toBe(true);
    expect(EVENT_TYPES.length).toBe(ADOPTED_IS_SUCCESS_EVENT_TYPES.length + RIGHTS_BEARING.length);
    for (const t of ADOPTED_IS_SUCCESS_EVENT_TYPES) expect(RIGHTS_BEARING).not.toContain(t);
  });

  it('refuses the four rights-bearing types, unknown types and look-alikes (no prefix or substring matching)', () => {
    for (const t of RIGHTS_BEARING) expect(adoptedIsSuccess(t)).toBe(false);
    for (const t of ['', 'effect', 'effect.', 'effect.unknown', 'effect.intended.completed', 'plan.step_done ', 'Plan.declared',
      'task.created2', 'run.claimed.heartbeat', 'await.future', 'fact.observed\n', 'constructor', '__proto__', 'toString']) {
      expect(adoptedIsSuccess(t), JSON.stringify(t)).toBe(false);
    }
  });
});

describe.each(backends)('FIX-004B runtime CAS on %s store', (_n, make) => {
  function setup(opts: { maxAppendAttempts?: number } = {}) {
    const clock = new Clock();
    const inner = make();
    const store = new OutcomeStore(inner);
    let n = 0;
    const mk = (s: EventStore = store) => new DurableTasks({ store: s, now: clock.now, newId: () => `id${++n}`, maxAppendAttempts: 6, ...opts });
    return { clock, inner, store, mk, rt: mk() };
  }
  const claimed = async (rt: DurableTasks, taskId = 'job1', owner = 'worker-a'): Promise<Fence> => {
    await rt.createTask({ taskId, kind: 'k', goal: 'g' });
    return rt.claim(taskId, { owner });
  };
  const types = async (rt: DurableTasks, taskId = 'job1'): Promise<string[]> => (await rt.getLog(taskId)).events.map((e) => e.type);

  // ------------------------------------------------------------- effect.intended
  describe('effect.intended (right to the external effect)', () => {
    it('appended: the effect runs once and is recorded', async () => {
      const { rt, store } = setup();
      const f = await claimed(rt);
      let calls = 0;
      const out = await rt.runEffect(f, 'send', async () => (calls++, { ok: true }), { description: 'send' });
      expect(calls).toBe(1);
      expect(out.replayed).toBe(false);
      expect(store.appended('effect.intended')).toBe(1);
    });

    it('adopted: fn is NOT called, even though the event is in the log', async () => {
      const { rt, store } = setup();
      const f = await claimed(rt);
      store.inject('effect.intended', 'adopted', 1);
      let calls = 0;
      await expect(rt.runEffect(f, 'send', async () => (calls++, { ok: true }), { description: 'send' })).rejects.toBeInstanceOf(EffectConflictError);
      expect(calls).toBe(0);
      expect(await types(rt)).toContain('effect.intended');
      // a repeated call does not recover the right from the matching event: the effect is in doubt
      await expect(rt.runEffect(f, 'send', async () => (calls++, { ok: true }), { description: 'send' })).rejects.toBeInstanceOf(EffectInDoubtError);
      expect(calls).toBe(0);
    });

    it('conflict: fn is NOT called and the failure is bounded (ContentionError)', async () => {
      const { rt, store } = setup({ maxAppendAttempts: 4 });
      const f = await claimed(rt);
      store.inject('effect.intended', 'conflict');
      let calls = 0;
      await expect(rt.runEffect(f, 'send', async () => (calls++, 1), { description: 'send' })).rejects.toBeInstanceOf(ContentionError);
      expect(calls).toBe(0);
      expect(store.attempts.filter((a) => a.type === 'effect.intended')).toHaveLength(4);
      expect(await types(rt)).not.toContain('effect.intended');
    });

    it('lost response -> resolveUnknown finds the matching event -> adopted: fn is NOT called, nothing is repeated', async () => {
      const { rt, store } = setup();
      const f = await claimed(rt);
      store.inject('effect.intended', 'lost-response', 1);
      let calls = 0;
      await expect(rt.runEffect(f, 'send', async () => (calls++, 1), { description: 'send' })).rejects.toBeInstanceOf(EffectConflictError);
      expect(calls).toBe(0);
      expect((await types(rt)).filter((t) => t === 'effect.intended')).toHaveLength(1);
      await expect(rt.runEffect(f, 'send', async () => (calls++, 1), { description: 'send' })).rejects.toBeInstanceOf(EffectInDoubtError);
      expect(calls).toBe(0);
    });

    it('compaction: event exists, compacted, the retry is adopted -> no execution right', async () => {
      const { rt, store } = setup();
      const f = await claimed(rt);
      await rt.heartbeat(f); // a later event keeps the compacted range strictly below the head
      store.inject('effect.intended', 'compacted-adopted', 1);
      let calls = 0;
      await expect(rt.runEffect(f, 'send', async () => (calls++, 1), { description: 'send' })).rejects.toBeInstanceOf(EffectConflictError);
      expect(calls).toBe(0);
    });

    it('with a reconcile hook the in-doubt effect is still decided by reconcile, not by the matching event', async () => {
      const { rt, store } = setup();
      const f = await claimed(rt);
      store.inject('effect.intended', 'adopted', 1);
      await expect(rt.runEffect(f, 'send', async () => 1, { description: 'send' })).rejects.toBeInstanceOf(EffectConflictError);
      let calls = 0;
      let reconciled = 0;
      const out = await rt.runEffect(f, 'send', async () => (calls++, 7), {
        description: 'send',
        reconcile: async () => (reconciled++, { status: 'completed', result: 5 }),
      });
      expect(reconciled).toBe(1);
      expect(calls).toBe(0);
      expect(out).toEqual({ result: 5, replayed: true });
    });
  });

  // ------------------------------------------------------------- run.claimed
  describe('run.claimed (right to own the execution)', () => {
    it('appended: a fence is issued', async () => {
      const { rt } = setup();
      const f = await claimed(rt);
      expect(f.epoch).toBe(1);
    });

    it('adopted: the adopted claim is not used; the fence comes from a later claim won by appended', async () => {
      const { rt, store } = setup();
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      store.inject('run.claimed', 'adopted', 1);
      const f = await rt.claim('job1', { owner: 'worker-a' });
      expect(f.epoch).toBe(2);
      expect(store.attempts.filter((a) => a.type === 'run.claimed').map((a) => a.outcome)).toEqual(['adopted', 'appended']);
    });

    it('adopted every time: no fence at all', async () => {
      const { rt, store } = setup({ maxAppendAttempts: 3 });
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      store.inject('run.claimed', 'adopted');
      await expect(rt.claim('job1', { owner: 'worker-a' })).rejects.toBeInstanceOf(ContentionError);
    });

    it('conflict: no fence; bounded', async () => {
      const { rt, store } = setup({ maxAppendAttempts: 3 });
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      store.inject('run.claimed', 'conflict');
      await expect(rt.claim('job1', { owner: 'worker-a' })).rejects.toBeInstanceOf(ContentionError);
      expect(await types(rt)).toEqual(['task.created']);
    });

    it('lost response -> adopted: the worker re-claims through a fresh CAS instead of trusting its own event', async () => {
      const { rt, store } = setup();
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      store.inject('run.claimed', 'lost-response', 1);
      const f = await rt.claim('job1', { owner: 'worker-a' });
      expect(f.epoch).toBe(2);
      expect(store.appended('run.claimed')).toBe(1);
    });
  });

  // ------------------------------------------------------------- await.resolved
  describe('await.resolved (right to complete the wait)', () => {
    async function withAwait() {
      const s = setup({ maxAppendAttempts: 4 });
      const f = await claimed(s.rt);
      const a = await s.rt.registerAwait(f, { awaitId: 'w1', purpose: 'approval' });
      return { ...s, f, token: a.token };
    }

    it('appended: accepted', async () => {
      const { rt, token } = await withAwait();
      expect(await rt.deliver(token, { yes: 1 }, { idempotencyKey: 'k1' })).toMatchObject({ kind: 'accepted' });
    });

    it('adopted: NOT reported as accepted (the event is in the log, the caller won nothing); a repeat is a duplicate', async () => {
      const { rt, store, token } = await withAwait();
      store.inject('await.resolved', 'adopted', 1);
      const r = await rt.deliver(token, { yes: 1 }, { idempotencyKey: 'k1' });
      expect(r.kind).toBe('duplicate');
      expect((await types(rt)).filter((t) => t === 'await.resolved')).toHaveLength(1);
      expect((await rt.deliver(token, { yes: 1 }, { idempotencyKey: 'k1' })).kind).toBe('duplicate');
    });

    it('conflict: nothing resolved, nothing reported accepted, bounded', async () => {
      const { rt, store, token } = await withAwait();
      store.inject('await.resolved', 'conflict');
      await expect(rt.deliver(token, { yes: 1 }, { idempotencyKey: 'k1' })).rejects.toBeInstanceOf(ContentionError);
      expect((await rt.getState('job1')).awaits['w1']?.status).toBe('pending');
    });

    it('lost response -> adopted: duplicate, the await is resolved exactly once', async () => {
      const { rt, store, token } = await withAwait();
      store.inject('await.resolved', 'lost-response', 1);
      expect((await rt.deliver(token, { yes: 1 }, { idempotencyKey: 'k1' })).kind).toBe('duplicate');
      expect((await types(rt)).filter((t) => t === 'await.resolved')).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------- task.created
  describe('task.created (right to create the task)', () => {
    it('appended: created, a repeat is created:false', async () => {
      const { rt } = setup();
      const a = await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      const b = await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      expect([a.created, b.created]).toEqual([true, false]);
    });

    it('adopted: created:false, the task is not created a second time', async () => {
      const { rt, store } = setup();
      store.inject('task.created', 'adopted', 1);
      const a = await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      expect(a.created).toBe(false);
      expect(a.state.headSeq).toBe(1);
      expect(await types(rt)).toEqual(['task.created']);
    });

    it('lost response -> adopted: created:false, one event', async () => {
      const { rt, store } = setup();
      store.inject('task.created', 'lost-response', 1);
      const a = await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      expect(a.created).toBe(false);
      expect(await types(rt)).toEqual(['task.created']);
    });

    it('a different request on the same id: real conflict -> TaskExistsError, never created:true', async () => {
      const { rt, store } = setup();
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      await expect(rt.createTask({ taskId: 'job1', kind: 'k', goal: 'other' })).rejects.toBeInstanceOf(TaskExistsError);
    });

    it('conflict with nothing stored: no task is reported as created', async () => {
      const { rt, store } = setup();
      store.inject('task.created', 'conflict', 1);
      await expect(rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' })).rejects.toBeInstanceOf(TaskNotFoundError);
    });
  });

  // ------------------------------------------------------------- state-only: every allowed type
  describe('state-only events: adopted is success (one attempt, no replan, no duplicate)', () => {
    /** One scenario per allowed type: `prepare` brings the task to the point just before the event, `act` triggers it. */
    type Ctx = { rt: DurableTasks; f: Fence; clock: Clock };
    const scenarios: Record<string, { prepare?: (c: Ctx) => Promise<void>; act: (c: Ctx) => Promise<unknown>; closes?: boolean }> = {
      'run.heartbeat': { act: (c) => c.rt.heartbeat(c.f) },
      'run.released': { act: (c) => c.rt.release(c.f) },
      'plan.declared': { act: (c) => c.rt.declarePlan(c.f, [{ id: 's1', title: 'one' }]) },
      'plan.step_done': { prepare: (c) => c.rt.declarePlan(c.f, [{ id: 's1', title: 'one' }]), act: (c) => c.rt.completeStep(c.f, 's1', 1) },
      'plan.step_skipped': { prepare: (c) => c.rt.declarePlan(c.f, [{ id: 's1', title: 'one' }]), act: (c) => c.rt.skipStep(c.f, 's1', 'not needed') },
      'decision.recorded': { act: (c) => c.rt.recordDecision(c.f, { id: 'd1', summary: 'go' }) },
      'assumption.recorded': { act: (c) => c.rt.recordAssumption(c.f, { key: 'a1', statement: 's', value: 1 }) },
      'assumption.retracted': {
        prepare: (c) => c.rt.recordAssumption(c.f, { key: 'a1', statement: 's', value: 1 }),
        act: (c) => c.rt.retractAssumption(c.f, 'a1', 'wrong'),
      },
      'fact.observed': { act: (c) => c.rt.observe('job1', { key: 'k', value: 1 }) },
      'effect.completed': { act: (c) => c.rt.runEffect(c.f, 'e1', async () => 1, { description: 'e' }) },
      'effect.failed': {
        act: (c) => c.rt.runEffect(c.f, 'e1', async () => { throw new Error('boom'); }, { description: 'e' }).catch((e: Error) => e.message),
      },
      'await.registered': { act: (c) => c.rt.registerAwait(c.f, { awaitId: 'w1', purpose: 'p' }) },
      'await.expired': {
        prepare: async (c) => { await c.rt.registerAwait(c.f, { awaitId: 'w1', purpose: 'p', deadlineAt: new Date(c.clock.t + 1000) }); c.clock.advance(5000); },
        act: (c) => c.rt.sweepDeadlines('job1'),
      },
      'await.delivery_rejected': {
        prepare: async (c) => {
          const a = await c.rt.registerAwait(c.f, { awaitId: 'w1', purpose: 'p' });
          await c.rt.deliver(a.token, 1, { idempotencyKey: 'first' });
        },
        act: async (c) => c.rt.deliver((await c.rt.getState('job1')).awaits['w1']!.token, 2, { idempotencyKey: 'second' }),
      },
      'task.completed': { act: (c) => c.rt.complete(c.f, 'done'), closes: true },
      'task.failed': { act: (c) => c.rt.fail(c.f, 'bad'), closes: true },
      'task.cancelled': { act: (c) => c.rt.cancel('job1', 'stop'), closes: true },
    };

    it('covers every allowed type', () => {
      expect(Object.keys(scenarios).sort()).toEqual([...ADOPTED_IS_SUCCESS_EVENT_TYPES].sort());
    });

    for (const kind of ['adopted', 'lost-response'] as const) {
      for (const type of ADOPTED_IS_SUCCESS_EVENT_TYPES) {
        it(`${type}: ${kind} -> success, exactly one stored event, no retry`, async () => {
          const s = setup();
          const f = await claimed(s.rt);
          const sc = scenarios[type]!;
          await sc.prepare?.({ rt: s.rt, f, clock: s.clock });
          const before = (await types(s.rt)).filter((t) => t === type).length;
          s.store.attempts.length = 0;
          s.store.inject(type, kind, 1);
          await sc.act({ rt: s.rt, f, clock: s.clock });
          const after = (await types(s.rt)).filter((t) => t === type).length;
          expect(after - before).toBe(1);
          expect(s.store.attempts.filter((a) => a.type === type)).toHaveLength(1);
        });
      }
    }

    it('effect.completed adopted: fn ran exactly once and its result is returned', async () => {
      const { rt, store } = setup();
      const f = await claimed(rt);
      store.inject('effect.completed', 'adopted', 1);
      let calls = 0;
      const out = await rt.runEffect(f, 'e1', async () => (calls++, { v: 1 }), { description: 'e' });
      expect(calls).toBe(1);
      expect(out).toEqual({ result: { v: 1 }, replayed: false });
    });
  });

  // ------------------------------------------------------------- regression
  describe('regression: ordinary behaviour is unchanged', () => {
    it('a full effect/await/claim lifecycle on a plain store never sees adopted', async () => {
      const { rt, store } = setup();
      const f = await claimed(rt);
      await rt.declarePlan(f, [{ id: 's1', title: 'one' }]);
      const a = await rt.registerAwait(f, { awaitId: 'w1', purpose: 'p', stepId: 's1' });
      expect(await rt.runEffect(f, 'e1', async () => 1, { description: 'e' })).toEqual({ result: 1, replayed: false });
      expect((await rt.deliver(a.token, 1, { idempotencyKey: 'k' })).kind).toBe('accepted');
      expect((await rt.deliver(a.token, 1, { idempotencyKey: 'k' })).kind).toBe('duplicate');
      await rt.completeStep(f, 's1');
      await rt.complete(f, 'ok');
      expect(store.attempts.every((x) => x.outcome === 'appended')).toBe(true);
    });

    it('a second claim by another owner while the lease is live is still refused', async () => {
      const { rt } = setup();
      await claimed(rt);
      await expect(rt.claim('job1', { owner: 'worker-b' })).rejects.toBeInstanceOf(LeaseHeldError);
    });
  });

  // ------------------------------------------------------------- concurrent runtimes
  describe('two runtimes on one rights-bearing slot', () => {
    it('effect.intended with byte-identical events: one appended, one adopted, fn runs once', async () => {
      const { clock, inner, rt } = setup();
      const f = await claimed(rt);
      const gated = new GatedStore(inner, 2, 'effect.intended');
      let n = 0;
      const mk = () => new DurableTasks({ store: gated, now: clock.now, newId: () => `g${++n}`, maxAppendAttempts: 4 });
      const a = mk();
      const b = mk();
      let calls = 0;
      const run = (r: DurableTasks) => r.runEffect(f, 'send', async () => (calls++, { ok: true }), { description: 'send' });
      const results = await Promise.allSettled([run(a), run(b)]);
      expect(gated.outcomes.slice().sort()).toEqual(['adopted', 'appended']);
      expect(calls).toBe(1);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(EffectConflictError);
    });

    it('effect.intended with different events: one appended, one conflict, fn runs once', async () => {
      const { clock, inner, rt } = setup();
      const f = await claimed(rt);
      const gated = new GatedStore(inner, 2, 'effect.intended');
      let n = 0;
      const mk = () => new DurableTasks({ store: gated, now: clock.now, newId: () => `g${++n}`, maxAppendAttempts: 4 });
      let calls = 0;
      const results = await Promise.allSettled([
        mk().runEffect(f, 'send', async () => (calls++, 1), { description: 'send A' }),
        mk().runEffect(f, 'send', async () => (calls++, 1), { description: 'send B' }),
      ]);
      expect(gated.outcomes.slice().sort()).toEqual(['appended', 'conflict']);
      expect(calls).toBe(1);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('run.claimed by the same owner: no (owner, epoch) pair is ever handed to two callers', async () => {
      const { clock, inner, rt } = setup();
      await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
      const gated = new GatedStore(inner, 2, 'run.claimed');
      let n = 0;
      const mk = () => new DurableTasks({ store: gated, now: clock.now, newId: () => `g${++n}`, maxAppendAttempts: 6 });
      const fences = await Promise.all([mk().claim('job1', { owner: 'w' }), mk().claim('job1', { owner: 'w' })]);
      expect(gated.outcomes.slice().sort()).toEqual(['adopted', 'appended']);
      expect(new Set(fences.map((x) => x.epoch)).size).toBe(2);
    });

    it('await.resolved: the same delivery from two runtimes is accepted at most once', async () => {
      const { clock, inner, rt } = setup();
      const f = await claimed(rt);
      const { token } = await rt.registerAwait(f, { awaitId: 'w1', purpose: 'p' });
      const gated = new GatedStore(inner, 2, 'await.resolved');
      let n = 0;
      const mk = () => new DurableTasks({ store: gated, now: clock.now, newId: () => `g${++n}`, maxAppendAttempts: 4 });
      const rs = await Promise.all([
        mk().deliver(token, { v: 1 }, { idempotencyKey: 'k' }),
        mk().deliver(token, { v: 1 }, { idempotencyKey: 'k' }),
      ]);
      expect(gated.outcomes.slice().sort()).toEqual(['adopted', 'appended']);
      expect(rs.filter((r) => r.kind === 'accepted')).toHaveLength(1);
      expect(rs.filter((r) => r.kind === 'duplicate')).toHaveLength(1);
    });

    it('task.created: the same request from two runtimes creates once (created: [true, false])', async () => {
      const { clock, inner } = setup();
      const gated = new GatedStore(inner, 2, 'task.created');
      let n = 0;
      const mk = () => new DurableTasks({ store: gated, now: clock.now, newId: () => `g${++n}`, maxAppendAttempts: 4 });
      const rs = await Promise.all([
        mk().createTask({ taskId: 'job1', kind: 'k', goal: 'g' }),
        mk().createTask({ taskId: 'job1', kind: 'k', goal: 'g' }),
      ]);
      expect(gated.outcomes.slice().sort()).toEqual(['adopted', 'appended']);
      expect(rs.map((r) => r.created).sort()).toEqual([false, true]);
    });
  });
});
