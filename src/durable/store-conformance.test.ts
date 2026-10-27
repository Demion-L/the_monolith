/**
 * One contract, every backend. A new EventStore passes if this suite passes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { stampEvent } from './log.js';
import { GENESIS_HASH, type EventStore, type TaskEvent, type Tombstone } from './types.js';
import { tombstoneFor } from './prune-check.js';
import { foldEvents } from './projection.js';
import { TaskPrunedError } from './errors.js';

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
      const dir = mkdtempSync(join(tmpdir(), 'durable-conf-'));
      dirs.push(dir);
      return initStore(new FsEventStore({ target: { scope: 'trusted-directory', dir } }));
    },
  ],
];

function chainOpen(taskId: string, n: number): TaskEvent[] {
  const out: TaskEvent[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const e =
      seq === 1
        ? stampEvent(taskId, 1, '2026-01-01T00:00:00.000Z', prev, {
            type: 'task.created', actor: null,
            data: { kind: 'k', goal: 'g', input: null, parentTaskId: null, dependsOn: [], labels: {} },
          })
        : stampEvent(taskId, seq, `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`, prev, {
            type: 'fact.observed', actor: 'x', data: { key: `k${seq}`, fingerprint: `f${seq}`, value: seq, source: null },
          });
    out.push(e);
    prev = e.hash;
  }
  return out;
}

function chain(taskId: string, n: number): TaskEvent[] {
  // A task a prune may remove ends in a terminal event; a single-event chain stays active.
  if (n < 2) return chainOpen(taskId, n);
  const evs = chainOpen(taskId, n - 1);
  const done = stampEvent(taskId, n, `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`, evs[evs.length - 1]!.hash, {
    type: 'task.completed', actor: 'x', data: { result: null },
  });
  return [...evs, done];
}

describe.each(backends)('EventStore contract: %s', (_name, make) => {
  it('reports an unknown task as not existing', async () => {
    const s = make();
    const r = await s.readLog('nope');
    expect(r.exists).toBe(false);
    expect(r.events).toEqual([]);
  });

  it('appends in order and reads back identical events', async () => {
    const s = make();
    const evs = chain('t1', 5);
    for (const e of evs) expect(await s.append(e)).toBe('appended');
    const r = await s.readLog('t1');
    expect(r.exists).toBe(true);
    expect(r.events).toEqual(evs);
  });

  it('afterSeq returns only the newer suffix', async () => {
    const s = make();
    for (const e of chain('t1', 6)) await s.append(e);
    const r = await s.readLog('t1', { afterSeq: 4 });
    expect(r.events.map((e) => e.seq)).toEqual([5, 6]);
  });

  it('reports a taken slot as conflict and leaves the first event in place', async () => {
    const s = make();
    const evs = chain('t1', 2);
    await s.append(evs[0] as TaskEvent);
    await s.append(evs[1] as TaskEvent);
    const rival = stampEvent('t1', 2, '2026-02-02T00:00:00.000Z', (evs[0] as TaskEvent).hash, {
      type: 'fact.observed', actor: 'rival', data: { key: 'other', fingerprint: 'zz', value: 1, source: null },
    });
    expect(await s.append(rival)).toBe('conflict');
    expect((await s.readLog('t1')).events[1]).toEqual(evs[1]);
  });

  it('of N concurrent writers for one slot exactly one wins', async () => {
    const s = make();
    const first = chain('t1', 1)[0] as TaskEvent;
    await s.append(first);
    const rivals = Array.from({ length: 12 }, (_, i) =>
      stampEvent('t1', 2, '2026-02-02T00:00:00.000Z', first.hash, {
        type: 'fact.observed', actor: `w${i}`, data: { key: `w${i}`, fingerprint: `f${i}`, value: i, source: null },
      }),
    );
    const results = await Promise.all(rivals.map((e) => s.append(e)));
    expect(results.filter((r) => r === 'appended')).toHaveLength(1);
    expect((await s.readLog('t1')).events).toHaveLength(2);
  });

  it('lists task ids sorted', async () => {
    const s = make();
    await s.append(chain('b', 1)[0] as TaskEvent);
    await s.append(chain('a', 1)[0] as TaskEvent);
    expect(await s.listTaskIds()).toEqual(['a', 'b']);
  });

  it('compaction keeps the log readable and identical', async () => {
    const s = make();
    const evs = chain('t1', 10);
    for (const e of evs) await s.append(e);
    await s.compact('t1', 6, evs.slice(0, 6));
    const r = await s.readLog('t1');
    expect(r.events).toEqual(evs);
    // idempotent
    await s.compact('t1', 6, evs.slice(0, 6));
    expect((await s.readLog('t1')).events).toEqual(evs);
    // appending after compaction still works
    const next = stampEvent('t1', 11, '2026-01-01T00:01:00.000Z', (evs[9] as TaskEvent).hash, {
      type: 'fact.observed', actor: 'x', data: { key: 'late', fingerprint: 'f', value: 0, source: null },
    });
    expect(await s.append(next)).toBe('appended');
    expect((await s.readLog('t1')).events).toHaveLength(11);
  });

  it('prune leaves only a tombstone and refuses further appends', async () => {
    const s = make();
    const evs = chain('t1', 3);
    for (const e of evs) await s.append(e);
    const tomb: Tombstone = tombstoneFor(foldEvents(evs), 'c');
    await s.prune(tomb);
    const r = await s.readLog('t1');
    expect(r.tombstone?.headHash).toBe(tomb.headHash);
    expect(r.events).toEqual([]);
    const next = stampEvent('t1', 4, '2026-01-01T00:01:00.000Z', (evs[2] as TaskEvent).hash, {
      type: 'fact.observed', actor: 'x', data: { key: 'ghost', fingerprint: 'f', value: 0, source: null },
    });
    await expect(s.append(next)).rejects.toBeInstanceOf(TaskPrunedError);
    await s.prune(tomb); // idempotent: finishing an interrupted prune must not fail
  });
});
