/**
 * Amendment-004G, storage level: the three results of `append` (CEI-6 / G1), the stale writer after a compaction (S2),
 * the lost-response retry (S1), and `readLog` by the coverage of the slot (F-G-1). Runtime criteria (AC-ADO-4/5) are NOT
 * covered here: these tests say what the store confirms, not who may act.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { stampEvent, serializeEvent } from './log.js';
import { GENESIS_HASH, type EventStore, type TaskEvent, type Tombstone } from './types.js';
import { LogCorruptError, RetentionRefusedError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'durable-ado-'));
  dirs.push(d);
  return d;
};
const fsAt = (dir: string, o: Partial<ConstructorParameters<typeof FsEventStore>[0]> = {}): FsEventStore => {
  const s = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file', ...o });
  s.initializeProtocolSync();
  return s;
};

function chain(taskId: string, n: number, actor = 'x'): TaskEvent[] {
  const out: TaskEvent[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const e =
      seq === 1
        ? stampEvent(taskId, 1, '2026-01-01T00:00:00.000Z', prev, {
            type: 'task.created', actor: null, data: { kind: 'k', goal: 'g', input: null, parentTaskId: null, dependsOn: [], labels: {} },
          })
        : stampEvent(taskId, seq, `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`, prev, {
            type: 'fact.observed', actor, data: { key: `k${seq}`, fingerprint: `f${seq}`, value: seq, source: null },
          });
    out.push(e);
    prev = e.hash;
  }
  return out;
}

/** A different event for the same slot as `evs[seq - 1]`. */
const rival = (evs: TaskEvent[], seq: number): TaskEvent =>
  stampEvent(evs[0]!.taskId, seq, '2026-02-02T00:00:00.000Z', seq === 1 ? GENESIS_HASH : evs[seq - 2]!.hash, {
    type: 'fact.observed', actor: 'rival', data: { key: 'other', fingerprint: 'zz', value: 1, source: null },
  });

const tombstoneOf = (evs: TaskEvent[]): Tombstone => ({
  v: 1, taskId: evs[0]!.taskId, kind: 'k', finalStatus: 'completed', createdAt: 'a', closedAt: 'b', prunedAt: 'c',
  headSeq: evs.length, headHash: evs[evs.length - 1]!.hash, outcomeDigest: 'd',
});

const backends: Array<[string, () => { store: EventStore; reopen: () => EventStore }]> = [
  ['memory', () => { const s = new MemoryEventStore(); return { store: s, reopen: () => s }; }],
  ['filesystem', () => { const d = newDir(); return { store: fsAt(d), reopen: () => fsAt(d) }; }],
];

describe.each(backends)('append outcome (CEI-6 / G1): %s', (_n, make) => {
  it('the first publication of a slot is "appended"', async () => {
    const { store } = make();
    for (const e of chain('t1', 3)) expect(await store.append(e)).toBe('appended');
  });

  it('a byte-identical repeat is "adopted", never "appended"', async () => {
    const { store } = make();
    const evs = chain('t1', 3);
    for (const e of evs) await store.append(e);
    for (const e of evs) expect(await store.append(e)).toBe('adopted');
    expect((await store.readLog('t1')).events).toEqual(evs);
  });

  it('a different event for a taken slot is "conflict"', async () => {
    const { store } = make();
    const evs = chain('t1', 3);
    for (const e of evs) await store.append(e);
    expect(await store.append(rival(evs, 2))).toBe('conflict');
    expect(await store.append(rival(evs, 3))).toBe('conflict');
    expect((await store.readLog('t1')).events).toEqual(evs);
  });

  it('of N concurrent identical writers exactly one is "appended", the rest are "adopted"', async () => {
    const { store } = make();
    const evs = chain('t1', 2);
    await store.append(evs[0]!);
    const results = await Promise.all(Array.from({ length: 12 }, () => store.append(evs[1]!)));
    expect(results.filter((r) => r === 'appended')).toHaveLength(1);
    expect(results.filter((r) => r === 'adopted')).toHaveLength(11);
  });

  it('S1: the publication happened, the answer was lost; the retry (even by a new instance) is "adopted" and gives no new right', async () => {
    const { store, reopen } = make();
    const evs = chain('t1', 2);
    expect(await store.append(evs[0]!)).toBe('appended');
    expect(await store.append(evs[1]!)).toBe('appended'); // the caller never saw this answer
    const again = reopen();
    expect(await again.append(evs[1]!)).toBe('adopted');
    expect(await again.append(evs[1]!)).toBe('adopted'); // and it stays "adopted" however often it is asked
  });

  it('"adopted" stays "adopted" after a compaction of the slot', async () => {
    const { store, reopen } = make();
    const evs = chain('t1', 6);
    for (const e of evs) await store.append(e);
    await store.compact('t1', 4, evs.slice(0, 4));
    const again = reopen();
    for (const e of evs) expect(await again.append(e)).toBe('adopted');
  });

  it('prune safety: the low-level prune does not start a new attempt after a foreign abort', async () => {
    const { store } = make();
    const evs = chain('t1', 3);
    for (const e of evs) await store.append(e);
    const tomb = tombstoneOf(evs);
    await store.markPruned!(tomb);
    await store.withdrawTombstone!(tomb); // another task that needs the parent aborts the attempt
    await expect(store.prune(tomb)).rejects.toBeInstanceOf(RetentionRefusedError);
    const r = await store.readLog('t1');
    expect(r.tombstone).toBeNull();
    expect(r.events).toEqual(evs);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Filesystem layout: S2, F-G-1
// ---------------------------------------------------------------------------------------------------------------------

const eventsOf = (dir: string, taskId: string): string[] => readdirSync(join(dir, 'tasks', taskId, 'events')).sort();
const slotFile = (dir: string, taskId: string, seq: number): string => {
  const name = eventsOf(dir, taskId).find((n) => new RegExp(`^0*${seq}\\.json$`).test(n));
  return join(dir, 'tasks', taskId, 'events', name ?? `${String(seq).padStart(9, '0')}.json`);
};

describe('S2: a stale writer after a compaction (AC-ADO-3, storage level)', () => {
  it('is "adopted" when its event equals the compacted one, and its stray loose file is removed', async () => {
    const dir = newDir();
    const evs = chain('t1', 6);
    const other = fsAt(dir);
    for (const e of evs.slice(0, 5)) await other.append(e);
    let armed = true;
    const stale = fsAt(dir, {
      beforePublish: async (e) => {
        if (!armed || e.seq !== 6) return;
        armed = false;
        // The stale writer has already read the old state. Meanwhile another writer publishes slot 6 and compacts 1..6.
        expect(await other.append(evs[5]!)).toBe('appended');
        await other.compact('t1', 6, evs);
        expect(eventsOf(dir, 't1').some((n) => /^0*6\.json$/.test(n))).toBe(false); // the slot is free again
      },
    });
    expect(await stale.append(evs[5]!)).toBe('adopted');
    expect(eventsOf(dir, 't1').some((n) => /^0*6\.json$/.test(n))).toBe(false); // class B: the publisher removed its copy
    expect((await stale.readLog('t1')).events).toEqual(evs);
  });

  it('is "conflict" when its event differs from the compacted one, never "appended"', async () => {
    const dir = newDir();
    const evs = chain('t1', 6);
    const other = fsAt(dir);
    for (const e of evs.slice(0, 5)) await other.append(e);
    let armed = true;
    const stale = fsAt(dir, {
      beforePublish: async (e) => {
        if (!armed || e.seq !== 6) return;
        armed = false;
        await other.append(evs[5]!);
        await other.compact('t1', 6, evs);
      },
    });
    expect(await stale.append(rival(evs, 6))).toBe('conflict');
    expect((await stale.readLog('t1')).events).toEqual(evs);
  });
});

describe('F-G-1: readLog by the coverage of the slot', () => {
  /** Events 1..9 published, only 5..9 compacted: segment S5-9 and loose files 1..4. */
  async function nonPrefix(): Promise<{ dir: string; evs: TaskEvent[]; store: FsEventStore }> {
    const dir = newDir();
    const evs = chain('t1', 9);
    const store = fsAt(dir);
    for (const e of evs) await store.append(e);
    await store.compact('t1', 9, evs.slice(4));
    return { dir, evs, store };
  }

  it('a segment outside the prefix does not hide the loose events before it', async () => {
    const { evs, store } = await nonPrefix();
    const r = await store.readLog('t1');
    expect(r.events).toEqual(evs);
    expect(r.compactedThrough).toBe(9); // reference value only, not a coverage predicate
  });

  it('an append into a free, uncovered slot below the segment is "appended" and visible to readers', async () => {
    const { dir, evs, store } = await nonPrefix();
    unlinkSync(slotFile(dir, 't1', 4)); // slot 4 is outside every segment and free
    expect(await store.append(evs[3]!)).toBe('appended');
    expect((await store.readLog('t1')).events).toEqual(evs);
  });

  it('a loose copy inside the coverage is ignored (with a diagnostic), even if its bytes differ', async () => {
    const { dir, evs, store } = await nonPrefix();
    const orphan = rival(evs, 7);
    writeFileSync(join(dir, 'tasks', 't1', 'events', `${String(7).padStart(9, '0')}.json`), `${serializeEvent(orphan)}\n`);
    const r = await store.readLog('t1');
    expect(r.events).toEqual(evs);
    expect(r.diagnostics.some((d) => d.code === 'LOOSE_COPY_OF_COMPACTED_EVENT')).toBe(true);
  });

  it('a gap between segments is still an error, and a loose file in the gap fills it', async () => {
    const dir = newDir();
    const evs = chain('t1', 9);
    const store = fsAt(dir);
    for (const e of evs) await store.append(e);
    await store.compact('t1', 2, evs.slice(0, 2));
    await store.compact('t1', 9, evs.slice(5));
    expect((await store.readLog('t1')).events).toEqual(evs); // loose 3..5 sit in the gap and are canonical
    unlinkSync(slotFile(dir, 't1', 4));
    await expect(store.readLog('t1')).rejects.toBeInstanceOf(LogCorruptError);
  });

  it('overlapping segments cover a slot once; the log is whole', async () => {
    const dir = newDir();
    const evs = chain('t1', 9);
    const store = fsAt(dir);
    for (const e of evs) await store.append(e);
    await store.compact('t1', 5, evs.slice(0, 5));
    await store.compact('t1', 9, evs.slice(2));
    expect((await store.readLog('t1')).events).toEqual(evs);
  });

  it('recovery after an interrupted compaction: loose copies of covered slots are ignored, uncovered ones are canonical', async () => {
    const { dir, evs, store } = await nonPrefix();
    // Put the loose copies of the compacted slots back, as a crash between K3 and K5 leaves them.
    for (const e of evs.slice(4)) writeFileSync(join(dir, 'tasks', 't1', 'events', `${String(e.seq).padStart(9, '0')}.json`), `${serializeEvent(e)}\n`);
    const after = fsAt(dir);
    expect((await after.readLog('t1')).events).toEqual(evs);
    await after.compact('t1', 9, evs.slice(4)); // idempotent re-run
    expect((await after.readLog('t1')).events).toEqual(evs);
    expect(await after.append(evs[6]!)).toBe('adopted');
  });

  it('readLog, canonRead, cei and compact see the same canonical content of every slot', async () => {
    const { dir, evs, store } = await nonPrefix();
    writeFileSync(join(dir, 'tasks', 't1', 'events', `${String(8).padStart(9, '0')}.json`), `${serializeEvent(evs[7]!)}\n`); // a copy
    const internals = store as unknown as {
      canonRead(t: string, from: number, to: number): Map<number, { t: string; line?: string }>;
    };
    const read = (await store.readLog('t1')).events;
    const canon = internals.canonRead('t1', 1, 9);
    for (const e of read) {
      const c = canon.get(e.seq)!;
      expect(['LOOSE', 'SEGMENT']).toContain(c.t);
      expect(c.line).toBe(serializeEvent(e));
      expect(c.t).toBe(e.seq >= 5 ? 'SEGMENT' : 'LOOSE');
    }
    // cei: an append of the same event confirms through the same evidence (via the public result: 'adopted' = EEXIST).
    for (const e of evs) expect(await store.append(e)).toBe('adopted');
    // compact accepts exactly the canonical lines and refuses anything else.
    await store.compact('t1', 9, evs.slice(4));
    await expect(store.compact('t1', 9, [...evs.slice(4, 8), rival(evs, 9)])).rejects.toBeInstanceOf(LogCorruptError);
    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(slotFile(dir, 't1', 1), 'utf8').trim()).toBe(serializeEvent(evs[0]!));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// FIX-004A audit: BLOCKER-1 (sweepCompacted) and HIGH-1 (prune over a foreign abort)
// ---------------------------------------------------------------------------------------------------------------------

describe('sweepCompacted removes only loose files covered by a segment (BLOCKER-1)', () => {
  it('keeps uncovered loose events below a non-prefix segment, and removes the covered copy', async () => {
    const dir = newDir();
    const evs = chain('t1', 9);
    const store = fsAt(dir);
    for (const e of evs) await store.append(e);
    await store.compact('t1', 9, evs.slice(4)); // segment S5-9; loose 1..4 are uncovered and canonical
    writeFileSync(slotFile(dir, 't1', 7).replace(/[^/]+$/, `${String(7).padStart(9, '0')}.json`), `${serializeEvent(evs[6]!)}\n`); // covered copy
    const r = await store.sweepCompacted!('t1');
    expect(r.removedFiles).toBe(1);
    expect(eventsOf(dir, 't1')).toHaveLength(4);
    expect((await store.readLog('t1')).events).toEqual(evs); // nothing confirmed was lost
  });
});

describe('prune() does not replace an attempt aborted in its race window (HIGH-1)', () => {
  it('FsEventStore: refuses, commits nothing, leaves no open attempt and keeps the events', async () => {
    const dir = newDir();
    const evs = chain('t1', 3);
    const store = fsAt(dir);
    for (const e of evs) await store.append(e);
    const tomb = tombstoneOf(evs);
    const other = fsAt(dir);
    const real = store.preparePrune.bind(store);
    // Between the pruner's state check and its own preparePrune, another task opens an attempt and aborts it.
    store.preparePrune = async (t: Tombstone) => {
      await other.markPruned!(tomb);
      await other.withdrawTombstone!(tomb);
      return real(t);
    };
    await expect(store.prune(tomb)).rejects.toBeInstanceOf(RetentionRefusedError);
    const r = await fsAt(dir).readLog('t1');
    expect(r.tombstone).toBeNull();
    expect(r.events).toEqual(evs);
  });
});
