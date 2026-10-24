/**
 * DURABLE-FIX-001 / D-3 — keys that collide with `Object.prototype` members and forged tokens.
 *
 * Before the fix, `state.assumptions['__proto__'] = ...` replaced the prototype of the dictionary
 * instead of storing an entry (the blocking assumption vanished and `assess` answered `direct`), and
 * `awaits['constructor']` resolved to a function, so a forged token made `deliver` throw a TypeError.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks, type Fence } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { diffStates } from './assess.js';
import { foldEvents } from './projection.js';
import { LogCorruptError } from './errors.js';
import type { EventStore } from './types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const SPECIAL = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'] as const;

const backends: Array<[string, () => EventStore]> = [
  ['memory', () => new MemoryEventStore()],
  [
    'filesystem',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-keys-'));
      dirs.push(dir);
      return new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
    },
  ],
];

describe.each(backends)('prototype-sensitive keys on %s store', (_n, make) => {
  async function start(): Promise<{ store: EventStore; rt: DurableTasks; f: Fence }> {
    const store = make();
    const rt = new DurableTasks({ store });
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'worker-a' });
    return { store, rt, f };
  }

  it.each(SPECIAL)('keeps an assumption, an observation and an effect named "%s" as plain entries', async (key) => {
    const { store, rt, f } = await start();
    await rt.recordAssumption(f, { key, statement: `${key} holds`, value: 1, criticality: 'blocking' });
    await rt.observe('job1', { key, value: 1, source: 'other' });
    await rt.runEffect(f, key, async () => ({ ok: true }), { description: 'special' });

    // the same must hold for a state folded from scratch by another process
    for (const s of [await rt.getState('job1'), await new DurableTasks({ store }).getState('job1')]) {
      expect(Object.keys(s.assumptions)).toEqual([key]);
      expect(Object.keys(s.observations)).toEqual([key]);
      expect(Object.keys(s.effects)).toEqual([key]);
      expect(Object.hasOwn(s.assumptions, key)).toBe(true);
      expect(s.assumptions[key]).toMatchObject({ key, status: 'active', criticality: 'blocking' });
      expect(s.effects[key]).toMatchObject({ status: 'completed' });
    }
    // and nothing leaked into the global prototype
    expect(({} as Record<string, unknown>).statement).toBeUndefined();
    expect(({} as Record<string, unknown>).criticality).toBeUndefined();
  });

  it.each(SPECIAL)('a blocking assumption "%s" is honoured by assess: changed => recovery, unknown => never direct', async (key) => {
    const { rt, f } = await start();
    await rt.declarePlan(f, [{ id: 's1', title: 'step' }]);
    await rt.recordAssumption(f, { key, statement: 'must stay', value: 'a', criticality: 'blocking' });
    await rt.release(f);

    const unverified = await rt.assess('job1');
    expect(unverified.mode).not.toBe('direct');
    expect(unverified.reasons.map((r) => r.code)).toContain('BLOCKING_ASSUMPTION_UNVERIFIED');

    await rt.observe('job1', { key, value: 'b', source: 'other' });
    const changed = await rt.assess('job1');
    expect(changed.mode).toBe('recovery');
    expect(changed.assumptionChanges).toMatchObject([{ key, criticality: 'blocking', was: 'a', now: 'b', source: 'recorded' }]);

    const live = await rt.assess('job1', { observations: Object.fromEntries([[key, 'a']]) });
    expect(live.reasons.map((r) => r.code)).not.toContain('BLOCKING_ASSUMPTION_CHANGED');
  });

  it('retracting and re-recording a special-named assumption works', async () => {
    const { rt, f } = await start();
    await rt.recordAssumption(f, { key: '__proto__', statement: 's', value: 1 });
    await rt.retractAssumption(f, '__proto__', 'no longer true');
    expect((await rt.getState('job1')).assumptions['__proto__']).toMatchObject({ status: 'retracted' });
    await rt.recordAssumption(f, { key: '__proto__', statement: 's', value: 2 });
    expect((await rt.getState('job1')).assumptions['__proto__']).toMatchObject({ status: 'active' });
  });

  it('a plan step, a label and an await named like a prototype member are ordinary entries', async () => {
    const store = make();
    const rt = new DurableTasks({ store });
    await rt.createTask({ taskId: 'job2', kind: 'k', goal: 'g', labels: { constructor: 'x', toString: 'y' } });
    const f = await rt.claim('job2', { owner: 'w' });
    await rt.declarePlan(f, [{ id: 'constructor', title: 'c' }, { id: 'toString', title: 't', dependsOn: ['constructor'] }]);
    const w = await rt.registerAwait(f, { awaitId: 'constructor', purpose: 'p', stepId: 'constructor' });
    expect(await rt.deliver(w.token, { ok: 1 }, { idempotencyKey: 'k1' })).toMatchObject({ kind: 'accepted' });
    const s = await rt.getState('job2');
    expect(s.labels['constructor']).toBe('x');
    expect(s.awaits['constructor']).toMatchObject({ status: 'resolved' });
    await rt.completeStep(f, 'constructor');
    await rt.completeStep(f, 'toString');
    expect((await rt.assess('job2')).planComplete).toBe(true);
    expect((await rt.listTasks({ label: ['constructor', 'x'] })).map((t) => t.taskId)).toEqual(['job2']);
    expect(await rt.listTasks({ label: ['hasOwnProperty', 'x'] })).toEqual([]);
  });

  it('diffStates and resumePacket report entries whose key is a prototype member', async () => {
    const { rt, f } = await start();
    const before = await rt.getState('job1');
    await rt.declarePlan(f, [{ id: 'constructor', title: 'c' }]);
    await rt.recordAssumption(f, { key: 'toString', statement: 's', value: 1 });
    const after = await rt.getState('job1');
    expect(diffStates(before, after)).toEqual(
      expect.arrayContaining([
        { section: 'plan', key: 'constructor', change: 'added' },
        { section: 'assumptions', key: 'toString', change: 'added' },
      ]),
    );
  });
});

describe.each(backends)('untrusted tokens on %s store', (_n, make) => {
  const nonce = '0'.repeat(32);

  it.each(SPECIAL.filter((k) => k !== '__proto__'))('a forged token naming the await "%s" is rejected, not a TypeError', async (awaitId) => {
    const rt = new DurableTasks({ store: make() });
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'w' });
    await rt.registerAwait(f, { awaitId: 'real', purpose: 'p' });
    const head = (await rt.getState('job1')).headSeq;
    const r = await rt.deliver(`dsc1.job1.${awaitId}.${nonce}`, { x: 1 }, { idempotencyKey: 'k' });
    expect(r).toEqual({ kind: 'rejected', reason: 'unknown-await' });
    expect((await rt.getState('job1')).headSeq).toBe(head);
  });

  it('a forged token naming a task called like a prototype member is rejected as unknown', async () => {
    const rt = new DurableTasks({ store: make() });
    for (const id of ['constructor', 'toString', 'valueOf']) {
      expect(await rt.deliver(`dsc1.${id}.await1.${nonce}`, {}, { idempotencyKey: 'k' })).toEqual({ kind: 'rejected', reason: 'unknown-task' });
    }
  });

  it.each([
    ['too many parts', `dsc1.job1.a.${nonce}.extra`],
    ['wrong prefix', `dsc2.job1.a.${nonce}`],
    ['control characters', `dsc1.job1.a\n.${nonce}`],
    ['non-hex nonce', `dsc1.job1.a.${'z'.repeat(32)}`],
    ['oversized', `dsc1.job1.${'a'.repeat(500)}.${nonce}`],
    ['empty', ''],
  ])('a malformed token (%s) is rejected without touching the store', async (_label, token) => {
    const rt = new DurableTasks({ store: make() });
    expect(await rt.deliver(token, {}, { idempotencyKey: 'k' })).toEqual({ kind: 'rejected', reason: 'malformed-token' });
  });

  it.each([[null], [undefined], [42], [{}], [['dsc1']]])('a non-string token (%j) is rejected', async (token) => {
    const rt = new DurableTasks({ store: make() });
    expect(await rt.deliver(token as unknown as string, {}, { idempotencyKey: 'k' })).toEqual({ kind: 'rejected', reason: 'malformed-token' });
  });
});

describe('a rule violation in a proposed event is not reported as a corrupt log', () => {
  it('the fold is still strict on stored events (a corrupt log stays corrupt)', async () => {
    const rt = new DurableTasks({ store: new MemoryEventStore() });
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const { events } = await rt.getLog('job1');
    const dup = { ...(events[0] as object), seq: 2 } as never;
    expect(() => foldEvents([events[0] as never, dup])).toThrow(LogCorruptError);
  });
});
