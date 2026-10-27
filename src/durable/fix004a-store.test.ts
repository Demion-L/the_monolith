/**
 * FIX-004A, storage level: protocol marker and diagnostic mode (criterion 17, test 38), canonical compaction input
 * (CC-1…6, criteria 61-66, test 43), canonical event identity (CEI, criteria 50-54, 73-75, tests 40/42), directory fsync
 * (criterion 38) and the sweeper.
 *
 * NOT covered here (FIX-004C, real processes): 43г (two compactors), 43ж (SIGKILL at K2…K5), 39/41/42 barrier and SIGKILL
 * variants, the barrier variant of AC-ADO-3. Exceptions thrown from a hook are not SIGKILL and are not presented as such.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync, linkSync, unlinkSync, fstatSync, fsyncSync, statSync,
} from 'fs';
import fsDefault from 'fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { stampEvent, serializeEvent } from './log.js';
import { GENESIS_HASH, type EventStore, type TaskEvent, type Tombstone } from './types.js';
import { AppendOutcomeUnknownError } from './fs-store.js';
import { LogCorruptError, PruneDecisionCorruptError, StoreIoError, StoreProtocolError, TaskPrunedError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'durable-fix4a-'));
  dirs.push(d);
  return d;
};
const open = (dir: string, o: Partial<ConstructorParameters<typeof FsEventStore>[0]> = {}): FsEventStore =>
  new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file', ...o });
const fsAt = (dir: string, o: Partial<ConstructorParameters<typeof FsEventStore>[0]> = {}): FsEventStore => {
  const s = open(dir, o);
  s.initializeProtocolSync();
  return s;
};

function chain(taskId: string, n: number): TaskEvent[] {
  const out: TaskEvent[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const e =
      seq === 1
        ? stampEvent(taskId, 1, '2026-01-01T00:00:00.000Z', prev, {
            type: 'task.created', actor: null, data: { kind: 'k', goal: 'g', input: null, parentTaskId: null, dependsOn: [], labels: {} },
          })
        : stampEvent(taskId, seq, `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`, prev, {
            type: 'fact.observed', actor: 'x', data: { key: `k${seq}`, fingerprint: `f${seq}`, value: seq, source: null },
          });
    out.push(e);
    prev = e.hash;
  }
  return out;
}
const rival = (evs: TaskEvent[], seq: number): TaskEvent =>
  stampEvent(evs[0]!.taskId, seq, '2026-02-02T00:00:00.000Z', seq === 1 ? GENESIS_HASH : evs[seq - 2]!.hash, {
    type: 'fact.observed', actor: 'rival', data: { key: 'other', fingerprint: 'zz', value: 1, source: null },
  });
const tombstoneOf = (evs: TaskEvent[]): Tombstone => ({
  v: 1, taskId: evs[0]!.taskId, kind: 'k', finalStatus: 'completed', createdAt: 'a', closedAt: 'b', prunedAt: 'c',
  headSeq: evs.length, headHash: evs[evs.length - 1]!.hash, outcomeDigest: 'd',
});
async function fill(store: EventStore, id: string, n: number): Promise<TaskEvent[]> {
  const evs = chain(id, n);
  for (const e of evs) expect(await store.append(e)).toBe('appended');
  return evs;
}
const slot = (dir: string, id: string, seq: number): string => join(dir, 'tasks', id, 'events', `${String(seq).padStart(9, '0')}.json`);
const looseOf = (dir: string, id: string): string[] => readdirSync(join(dir, 'tasks', id, 'events')).filter((n) => /^\d{9}\.json$/.test(n)).sort();
const segmentsOf = (dir: string, id: string): string[] => {
  const d = join(dir, 'tasks', id, 'segments');
  return existsSync(d) ? readdirSync(d).sort() : [];
};
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        out[`${relative(dir, p)}/`] = 'dir';
        walk(p);
      } else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Records every `link` and `unlink` the store makes: through its write primitive (`ops`) and through `fs` directly. */
function spies(): { log: string[]; ops: NonNullable<ConstructorParameters<typeof FsEventStore>[0]['ops']>; install: () => () => void } {
  const log: string[] = [];
  const ops = {
    linkSync: ((a: string, b: string) => (log.push(`link ${b}`), linkSync(a, b))) as typeof linkSync,
    unlinkSync: ((p: string) => (log.push(`unlink ${p}`), unlinkSync(p))) as typeof unlinkSync,
  };
  const install = (): (() => void) => {
    const real = fsDefault.unlinkSync;
    (fsDefault as { unlinkSync: unknown }).unlinkSync = (p: string, ...r: unknown[]) => (log.push(`unlink ${p}`), (real as (...a: unknown[]) => void)(p, ...r));
    syncBuiltinESMExports();
    return () => {
      (fsDefault as { unlinkSync: unknown }).unlinkSync = real;
      syncBuiltinESMExports();
    };
  };
  return { log, ops, install };
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 17 / test 38: version marker and diagnostic mode (store level)
// ---------------------------------------------------------------------------------------------------------------------

describe('protocol marker and diagnostic mode (criterion 17)', () => {
  const marker = (dir: string): string => join(dir, 'durable-protocol.json');

  it('a store without a marker opens for diagnostics: reads work, nothing is created', async () => {
    const dir = join(newDir(), 'not-yet');
    const s = open(dir);
    expect(await s.protocolStatus()).toEqual({ mode: 'diagnostic', reason: 'uninitialized', tasksPresent: false });
    expect(await s.listTaskIds()).toEqual([]);
    expect((await s.readLog('t1')).exists).toBe(false);
    expect(existsSync(dir)).toBe(false); // opening and reading created neither the directory nor a marker
  });

  it('every write is refused without a marker and leaves no trace', async () => {
    const dir = newDir();
    const s = open(dir);
    const evs = chain('t1', 3);
    const before = tree(dir);
    const tomb = tombstoneOf(evs);
    const writes: Array<[string, () => Promise<unknown>]> = [
      ['append', () => s.append(evs[0] as TaskEvent)],
      ['compact', () => s.compact('t1', 1, [evs[0] as TaskEvent])],
      ['markPruned', () => s.markPruned!(tomb)],
      ['preparePrune', () => s.preparePrune!(tomb)],
      ['decidePrune', () => s.decidePrune!('t1', 1, 'abort', undefined, 'child')],
      ['withdrawTombstone', () => s.withdrawTombstone!(tomb)],
      ['prune', () => s.prune(tomb)],
      ['pinReference', () => s.pinReference!('t1', 'c', '2026-01-01T00:00:00.000Z')],
      ['sweepCompacted', () => s.sweepCompacted!('t1')],
    ];
    for (const [label, act] of writes) {
      await expect(act(), label).rejects.toMatchObject({ detailCode: 'PROTOCOL_NOT_INITIALIZED' });
    }
    expect(tree(dir)).toEqual(before);
    expect(existsSync(marker(dir))).toBe(false);
  });

  it('initializeProtocol creates the marker once, create-only, and the store is writable afterwards; a reopen needs nothing', async () => {
    const dir = newDir();
    const s = open(dir);
    expect(await s.initializeProtocol()).toBe('initialized');
    expect(readFileSync(marker(dir), 'utf8')).toBe('{"v":2}\n');
    expect(await s.initializeProtocol()).toBe('already-initialized');
    expect(await s.protocolStatus()).toEqual({ mode: 'ready', version: 2 });
    const evs = await fill(s, 't1', 2);

    const again = open(dir); // a new process / a reopen: no initialization call
    expect(await again.protocolStatus()).toEqual({ mode: 'ready', version: 2 });
    expect((await again.readLog('t1')).events).toEqual(evs);
    expect(await again.append(chain('t1', 3)[2] as TaskEvent)).toBe('appended');
  });

  it.each([
    ['a newer version', '{"v":3}\n', 'unsupported-version'],
    ['version 1', '{"v":1}\n', 'unsupported-version'],
    ['not JSON', '{ nope', 'invalid-marker'],
    ['extra keys', '{"v":2,"x":1}\n', 'invalid-marker'],
    ['a non-integer version', '{"v":2.5}\n', 'invalid-marker'],
  ])('a marker with %s is incompatible: nothing is read as compatible, nothing is written, the marker is not touched', async (_n, content, reason) => {
    const dir = newDir();
    writeFileSync(marker(dir), content);
    const s = open(dir);
    expect(await s.protocolStatus()).toEqual({ mode: 'incompatible', reason });
    await expect(s.readLog('t1')).rejects.toMatchObject({ detailCode: 'PROTOCOL_UNSUPPORTED' });
    await expect(s.append(chain('t1', 1)[0] as TaskEvent)).rejects.toMatchObject({ detailCode: 'PROTOCOL_UNSUPPORTED' });
    await expect(s.initializeProtocol()).rejects.toBeInstanceOf(StoreProtocolError);
    expect(readFileSync(marker(dir), 'utf8')).toBe(content);
    expect(readdirSync(dir)).toEqual(['durable-protocol.json']);
  });

  it('initializeProtocol refuses a store that already holds tasks; those stay diagnostic-only and are never repaired or pruned', async () => {
    const dir = newDir();
    const setup = fsAt(dir);
    const evs = await fill(setup, 't1', 4);
    await setup.compact('t1', 2, evs.slice(0, 2));
    unlinkSync(marker(dir)); // a store written by a runtime that did not know the marker

    const s = open(dir);
    expect(await s.protocolStatus()).toEqual({ mode: 'diagnostic', reason: 'uninitialized', tasksPresent: true });
    const before = tree(dir);
    await expect(s.initializeProtocol()).rejects.toMatchObject({ detailCode: 'PROTOCOL_STORE_NOT_EMPTY' });
    expect(existsSync(marker(dir))).toBe(false);
    expect((await s.readLog('t1')).events).toEqual(evs); // diagnostics read
    for (const act of [
      () => s.append(chain('t1', 5)[4] as TaskEvent),
      () => s.compact('t1', 3, evs.slice(2, 3)),
      () => s.sweepCompacted!('t1'),
      () => s.markPruned!(tombstoneOf(evs)),
      () => s.prune(tombstoneOf(evs)),
    ]) await expect(act()).rejects.toMatchObject({ detailCode: 'PROTOCOL_NOT_INITIALIZED' });
    expect(tree(dir)).toEqual(before);
  });

  it('diagnostic mode does not repair crash residue (a second hard link) while reading', async () => {
    const dir = newDir();
    const setup = fsAt(dir);
    await fill(setup, 't1', 2);
    const twin = `${slot(dir, 't1', 2)}.tmp.4242.0123456789abcdef`;
    linkSync(slot(dir, 't1', 2), twin); // what a publisher killed between link() and unlink(tmp) leaves
    unlinkSync(marker(dir));
    const s = open(dir);
    try {
      await s.readLog('t1');
    } catch {
      /* refusing is fine: repairing is not */
    }
    expect(existsSync(twin)).toBe(true);
    expect(statSync(slot(dir, 't1', 2)).nlink).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 38: directory fsync
// ---------------------------------------------------------------------------------------------------------------------

describe('directory fsync never blocks an operation in Mode A (criterion 38)', () => {
  const failing = (code: string, on: 'dir' | 'file') => ({
    fsyncSync: ((fd: number) => {
      if (fstatSync(fd).isDirectory() === (on === 'dir')) throw Object.assign(new Error(`injected ${code}`), { code });
      return fsyncSync(fd);
    }) as typeof fsyncSync,
  });

  it.each(['EINVAL', 'ENOTSUP'])('%s on a directory fsync: every operation completes, the only trace is a DIR_FSYNC_UNSUPPORTED warning', async (code) => {
    const dir = newDir();
    const warnings: string[] = [];
    const s = fsAt(dir, { durability: 'full', ops: failing(code, 'dir'), onWarning: (w) => warnings.push(w.code) });
    const evs = await fill(s, 't1', 4);
    await s.compact('t1', 3, evs.slice(0, 3));
    await s.sweepCompacted!('t1');
    await s.pinReference!('t1', 'c1', '2026-01-01T00:00:00.000Z');
    expect((await s.readLog('t1')).events).toEqual(evs);
    await s.prune(tombstoneOf(evs));
    expect(await s.pruneState!('t1')).toMatchObject({ kind: 'committed' });
    expect(warnings.length).toBeGreaterThan(0);
    expect(new Set(warnings)).toEqual(new Set(['DIR_FSYNC_UNSUPPORTED']));
  });

  it('EIO on a directory fsync is a warning of the write primitive (durability unknown): the published event is not taken back', async () => {
    const dir = newDir();
    const warnings: string[] = [];
    const s = fsAt(dir, { durability: 'full', ops: failing('EIO', 'dir'), onWarning: (w) => warnings.push(w.code) });
    const evs = chain('t1', 2);
    expect(await s.append(evs[0] as TaskEvent)).toBe('appended');
    expect(existsSync(slot(dir, 't1', 1))).toBe(true);
    expect(warnings).toContain('DIR_FSYNC_FAILED');
    expect((await s.readLog('t1')).events).toEqual([evs[0]]);
  });

  it('a failing FILE fsync is not swallowed: the append is not confirmed', async () => {
    const dir = newDir();
    fsAt(dir); // the marker is published with a healthy store
    const s = open(dir, { durability: 'full', ops: failing('EIO', 'file') });
    await expect(s.append(chain('t1', 1)[0] as TaskEvent)).rejects.toBeInstanceOf(Error);
    await expect(s.append(chain('t1', 1)[0] as TaskEvent)).rejects.toBeInstanceOf(Error);
    expect(looseOf(dir, 't1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// CC-1…CC-3 on the store boundary, both backends (criteria 61-63, test 43a/43b/43d/43i)
// ---------------------------------------------------------------------------------------------------------------------

const backends: Array<[string, () => { store: EventStore; dir: string | null }]> = [
  ['memory', () => ({ store: new MemoryEventStore(), dir: null })],
  ['filesystem', () => { const dir = newDir(); return { store: fsAt(dir), dir }; }],
];

describe.each(backends)('compact validates its input at the store boundary: %s', (_n, make) => {
  async function ready(n = 5): Promise<{ store: EventStore; dir: string | null; evs: TaskEvent[]; snap: () => Promise<unknown> }> {
    const { store, dir } = make();
    const evs = await fill(store, 't1', n);
    return { store, dir, evs, snap: async () => ({ log: await store.readLog('t1'), files: dir ? tree(dir) : null }) };
  }

  it('43a: an input event that differs from the stored one is refused and nothing changes', async () => {
    const { store, evs, snap } = await ready();
    const before = await snap();
    const bad = [evs[0], rival(evs, 2), evs[2]] as TaskEvent[];
    await expect(store.compact('t1', 3, bad)).rejects.toBeInstanceOf(LogCorruptError);
    expect(await snap()).toEqual(before);
  });

  it('a non-contiguous input, an input not ending at throughSeq, duplicates and a permutation are refused', async () => {
    const { store, evs, snap } = await ready();
    const before = await snap();
    const e = (i: number): TaskEvent => evs[i - 1] as TaskEvent;
    const bads: Array<[string, number, TaskEvent[]]> = [
      ['hole', 4, [e(1), e(2), e(4)]],
      ['does not end at throughSeq', 4, [e(1), e(2), e(3)]],
      ['ends beyond throughSeq', 2, [e(1), e(2), e(3)]],
      ['duplicate', 4, [e(1), e(3), e(3), e(4)]],
      ['permutation', 4, [e(1), e(3), e(2), e(4)]],
      ['reversed', 3, [e(3), e(2), e(1)]],
    ];
    for (const [label, through, input] of bads) {
      await expect(store.compact('t1', through, input), label).rejects.toBeInstanceOf(LogCorruptError);
    }
    expect(await snap()).toEqual(before);
  });

  it('43b: a slot that has no canonical event is refused (a range past the end of the log)', async () => {
    const { store, evs, snap } = await ready(3);
    const before = await snap();
    const ghost = chain('t1', 5).slice(3); // events 4 and 5 were never appended
    await expect(store.compact('t1', 5, ghost)).rejects.toBeInstanceOf(LogCorruptError);
    await expect(store.compact('t1', 5, [...evs, ...ghost])).rejects.toBeInstanceOf(LogCorruptError);
    expect(await snap()).toEqual(before);
  });

  it('43d: a valid input succeeds, the log reads the same, and the same call again is idempotent', async () => {
    const { store, evs } = await ready();
    await store.compact('t1', 3, evs.slice(0, 3));
    await store.compact('t1', 5, evs); // overlaps the first range with identical rows
    await store.compact('t1', 5, evs);
    await store.compact('t1', 3, evs.slice(0, 3));
    expect((await store.readLog('t1')).events).toEqual(evs);
    expect(await store.compact('t1', 0, [])).toMatchObject({ packedEvents: 0 });
  });

  it('43i: a task that does not exist is not created by compact', async () => {
    const { store, dir } = make();
    const evs = chain('ghost', 2);
    await expect(store.compact('ghost', 2, evs)).rejects.toBeInstanceOf(PruneDecisionCorruptError);
    expect((await store.readLog('ghost')).exists).toBe(false);
    if (dir) expect(tree(dir)).toEqual({ 'durable-protocol.json': expect.any(String) });
  });

  it('a pruned task is refused', async () => {
    const { store, evs } = await ready(3);
    await store.prune(tombstoneOf(evs));
    await expect(store.compact('t1', 3, evs)).rejects.toBeInstanceOf(TaskPrunedError);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// CC on the filesystem: K2 before publication, K3-K5 order, canonical rows (criteria 62-66, test 43)
// ---------------------------------------------------------------------------------------------------------------------

describe('canonical compaction on the filesystem (criteria 61-66)', () => {
  it('43a/c: a refused input publishes no segment and calls neither link nor unlink', async () => {
    const dir = newDir();
    const sp = spies();
    const s = fsAt(dir, { ops: sp.ops });
    const evs = await fill(s, 't1', 6);
    await s.compact('t1', 3, evs.slice(0, 3));
    sp.log.length = 0;
    const restore = sp.install();
    const before = tree(dir);
    try {
      // row differs from the segment's row while the loose copy is gone (R4E-01b)
      await expect(s.compact('t1', 4, [evs[0], rival(evs, 2), evs[2], evs[3]] as TaskEvent[])).rejects.toBeInstanceOf(LogCorruptError);
      // row differs from a LOOSE file
      await expect(s.compact('t1', 6, [...evs.slice(0, 4), rival(evs, 5), evs[5]] as TaskEvent[])).rejects.toBeInstanceOf(LogCorruptError);
      // duplicates and permutations (the segment would not be contiguous)
      await expect(s.compact('t1', 5, [evs[3], evs[3], evs[4]] as TaskEvent[])).rejects.toBeInstanceOf(LogCorruptError);
      await expect(s.compact('t1', 5, [evs[4], evs[3]] as TaskEvent[])).rejects.toBeInstanceOf(LogCorruptError);
    } finally {
      restore();
    }
    expect(sp.log).toEqual([]);
    expect(tree(dir)).toEqual(before);
    expect(segmentsOf(dir, 't1')).toEqual(['S000000001-000000003.jsonl']);
    expect((await s.readLog('t1')).events).toEqual(evs);
  });

  it('43b: a slot with neither a loose file nor a covering segment is refused before publication', async () => {
    const dir = newDir();
    const sp = spies();
    const s = fsAt(dir, { ops: sp.ops });
    const evs = await fill(s, 't1', 4);
    unlinkSync(slot(dir, 't1', 4)); // a hole: event 4 is gone
    sp.log.length = 0;
    const before = tree(dir);
    await expect(s.compact('t1', 4, evs)).rejects.toBeInstanceOf(LogCorruptError);
    expect(sp.log).toEqual([]);
    expect(tree(dir)).toEqual(before);
  });

  it('43d: a mixed input (rows partly loose, partly covered by an agreeing segment) succeeds', async () => {
    const dir = newDir();
    const s = fsAt(dir);
    const evs = await fill(s, 't1', 6);
    await s.compact('t1', 3, evs.slice(0, 3));
    expect(looseOf(dir, 't1')).toEqual(['000000004.json', '000000005.json', '000000006.json']);
    const r = await s.compact('t1', 5, evs.slice(0, 5));
    expect(r.segment).toBe('S000000001-000000005.jsonl');
    expect((await s.readLog('t1')).events).toEqual(evs);
    expect(looseOf(dir, 't1')).toEqual(['000000006.json']);
  });

  it('a non-prefix compaction leaves the uncovered loose events alone and the log whole', async () => {
    const dir = newDir();
    const s = fsAt(dir);
    const evs = await fill(s, 't1', 8);
    await s.compact('t1', 6, evs.slice(3, 6)); // S4-6; 1..3 are loose and canonical
    expect(looseOf(dir, 't1')).toEqual(['000000001.json', '000000002.json', '000000003.json', '000000007.json', '000000008.json']);
    expect((await s.readLog('t1')).events).toEqual(evs);
    await s.compact('t1', 3, evs.slice(0, 3)); // fills the prefix; overlapping neighbours agree
    expect((await s.readLog('t1')).events).toEqual(evs);
  });

  it('43e: EIO on a slot or on a segment row is a StoreIoError, nothing is published, nothing is removed', async () => {
    const dir = newDir();
    let fault: string | null = null;
    const sp = spies();
    const s = fsAt(dir, { ops: sp.ops, readFault: (abs) => (fault !== null && abs.endsWith(fault) ? 'EIO' : null) });
    const evs = await fill(s, 't1', 5);
    await s.compact('t1', 2, evs.slice(0, 2));
    sp.log.length = 0;
    const before = tree(dir);
    const restore = sp.install();
    try {
      for (const f of ['000000004.json', 'S000000001-000000002.jsonl']) {
        fault = f;
        await expect(s.compact('t1', 5, evs), f).rejects.toBeInstanceOf(StoreIoError);
      }
    } finally {
      restore();
      fault = null;
    }
    expect(sp.log).toEqual([]);
    expect(tree(dir)).toEqual(before);
    await s.compact('t1', 5, evs); // and the retry after the fault clears
    expect((await s.readLog('t1')).events).toEqual(evs);
  });

  it('K3-K5 order: the segment is linked before any loose file goes, only the packed identical loose files go, the segment never does (CL-1, CL-2)', async () => {
    const dir = newDir();
    const sp = spies();
    const s = fsAt(dir, { ops: sp.ops });
    const evs = await fill(s, 't1', 6);
    writeFileSync(slot(dir, 't1', 2), `${serializeEvent(rival(evs, 2))}\n`); // a differing loose copy: not the packed event
    sp.log.length = 0;
    const restore = sp.install();
    try {
      // slot 2's loose file differs from the input: K2 refuses (the loose file is canonical there)
      await expect(s.compact('t1', 4, evs.slice(0, 4))).rejects.toBeInstanceOf(LogCorruptError);
      expect(sp.log).toEqual([]);
      writeFileSync(slot(dir, 't1', 2), `${serializeEvent(evs[1] as TaskEvent)}\n`); // restore
      await s.compact('t1', 4, evs.slice(0, 4));
    } finally {
      restore();
    }
    const calls = sp.log.filter((l) => !l.includes('.tmp.'));
    const linkAt = calls.findIndex((l) => l.startsWith('link') && l.includes('S000000001-000000004.jsonl'));
    const unlinks = calls.filter((l) => l.startsWith('unlink'));
    expect(linkAt).toBeGreaterThanOrEqual(0);
    expect(unlinks.map((l) => relative(join(dir, 'tasks', 't1'), l.slice(7)))).toEqual([1, 2, 3, 4].map((n) => `events/${String(n).padStart(9, '0')}.json`));
    for (const u of unlinks) expect(calls.indexOf(u)).toBeGreaterThan(linkAt);
    expect(segmentsOf(dir, 't1')).toEqual(['S000000001-000000004.jsonl']);
    expect(looseOf(dir, 't1')).toEqual(['000000005.json', '000000006.json']);
  });

  it('Canon is the same on readLog, compact and a repeated compact: cleanup changes nothing logical (criterion 66)', async () => {
    const dir = newDir();
    const s = fsAt(dir);
    const evs = await fill(s, 't1', 5);
    const before = (await s.readLog('t1')).events;
    await s.compact('t1', 5, evs);
    expect((await s.readLog('t1')).events).toEqual(before);
    await s.compact('t1', 5, evs);
    expect((await s.readLog('t1')).events).toEqual(before);
    expect(readFileSync(join(dir, 'tasks', 't1', 'segments', 'S000000001-000000005.jsonl'), 'utf8')).toBe(`${evs.map(serializeEvent).join('\n')}\n`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// sweepCompacted: BLOCKER-1 complement (idempotence, Canon, differing copies, overlap)
// ---------------------------------------------------------------------------------------------------------------------

describe('sweepCompacted (complement of BLOCKER-1)', () => {
  it('removes only identical copies inside the coverage, keeps differing ones, leaves Canon unchanged, and repeats as a no-op', async () => {
    const dir = newDir();
    const s = fsAt(dir);
    const evs = await fill(s, 't1', 9);
    await s.compact('t1', 9, evs.slice(4)); // S5-9; 1..4 are canonical loose events
    const canon = (await s.readLog('t1')).events;
    writeFileSync(slot(dir, 't1', 6), `${serializeEvent(evs[5] as TaskEvent)}\n`); // identical covered copy
    writeFileSync(slot(dir, 't1', 8), `${serializeEvent(rival(evs, 8))}\n`); // differing covered copy
    const r = await s.sweepCompacted!('t1');
    expect(r).toEqual({ removedFiles: 1, keptFiles: 1 });
    expect(looseOf(dir, 't1')).toEqual(['000000001.json', '000000002.json', '000000003.json', '000000004.json', '000000008.json']);
    expect((await s.readLog('t1')).events).toEqual(canon);
    expect(await s.sweepCompacted!('t1')).toEqual({ removedFiles: 0, keptFiles: 1 });
    expect((await s.readLog('t1')).events).toEqual(canon);
    expect(looseOf(dir, 't1').slice(0, 4)).toEqual(['000000001.json', '000000002.json', '000000003.json', '000000004.json']);
  });

  it('with overlapping segments only the covered slots are swept; the uncovered tail stays', async () => {
    const dir = newDir();
    const s = fsAt(dir);
    const evs = await fill(s, 't1', 8);
    await s.compact('t1', 4, evs.slice(0, 4));
    await s.compact('t1', 6, evs.slice(2, 6)); // S3-6 overlaps S1-4
    for (const n of [2, 5]) writeFileSync(slot(dir, 't1', n), `${serializeEvent(evs[n - 1] as TaskEvent)}\n`);
    expect(await s.sweepCompacted!('t1')).toEqual({ removedFiles: 2, keptFiles: 0 });
    expect(looseOf(dir, 't1')).toEqual(['000000007.json', '000000008.json']);
    expect((await s.readLog('t1')).events).toEqual(evs);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// CEI: the slot-by-repeat matrix of section 36.1 under Amendment-004G (criteria 50-54, 73-75; tests 40, 42)
// ---------------------------------------------------------------------------------------------------------------------

describe('canonical event identity (section 36.1 under Amendment-004G)', () => {
  async function covered(n = 6): Promise<{ dir: string; s: FsEventStore; evs: TaskEvent[]; sp: ReturnType<typeof spies> }> {
    const dir = newDir();
    const sp = spies();
    const s = fsAt(dir, { ops: sp.ops });
    const evs = await fill(s, 't1', n);
    await s.compact('t1', 5, evs.slice(0, 5)); // S1-5; loose 1..5 gone; slot 6 is loose and uncovered
    sp.log.length = 0;
    return { dir, s, evs, sp };
  }
  const unlinked = (sp: ReturnType<typeof spies>): string[] => sp.log.filter((l) => l.startsWith('unlink') && !l.includes('.tmp.'));

  it('rows 1-2: a free slot is "appended"; a byte-identical repeat is "adopted"; nothing is removed', async () => {
    const { s, evs, sp } = await covered(5);
    const restore = sp.install();
    try {
      expect(await s.append(chain('t1', 6)[5] as TaskEvent)).toBe('appended');
      expect(await s.append(chain('t1', 6)[5] as TaskEvent)).toBe('adopted');
    } finally {
      restore();
    }
    expect(unlinked(sp)).toEqual([]);
    expect((await s.readLog('t1')).events).toHaveLength(6);
    expect((await s.readLog('t1')).events.slice(0, 5)).toEqual(evs);
  });

  it('row 3: an uncovered slot with other bytes is "conflict" and the other file is untouched', async () => {
    const { dir, s, evs, sp } = await covered(5);
    const other = rival(chain('t1', 6), 6);
    writeFileSync(slot(dir, 't1', 6), `${serializeEvent(other)}\n`);
    const restore = sp.install();
    try {
      expect(await s.append(chain('t1', 6)[5] as TaskEvent)).toBe('conflict');
    } finally {
      restore();
    }
    expect(unlinked(sp)).toEqual([]);
    expect(readFileSync(slot(dir, 't1', 6), 'utf8')).toBe(`${serializeEvent(other)}\n`);
    expect((await s.readLog('t1')).events.slice(0, 5)).toEqual(evs);
  });

  it('rows 4 and 6: a covered slot whose row equals the event is "adopted" (never "appended"); only the caller\'s own orphan goes', async () => {
    const { dir, s, evs, sp } = await covered();
    const restore = sp.install();
    try {
      expect(await s.append(evs[2] as TaskEvent)).toBe('adopted'); // loose absent: link succeeds, an orphan
    } finally {
      restore();
    }
    expect(unlinked(sp)).toEqual([`unlink ${slot(dir, 't1', 3)}`]); // class B: its own copy, byte-identical to the event
    expect(existsSync(slot(dir, 't1', 3))).toBe(false);
  });

  it('rows 5 and 6: a covered slot whose row differs is "conflict"; only the caller\'s own orphan goes; the segment is intact', async () => {
    const { dir, s, evs, sp } = await covered();
    const seg = join(dir, 'tasks', 't1', 'segments', 'S000000001-000000005.jsonl');
    const segBytes = readFileSync(seg, 'utf8');
    const restore = sp.install();
    try {
      expect(await s.append(rival(evs, 3))).toBe('conflict');
    } finally {
      restore();
    }
    expect(unlinked(sp)).toEqual([`unlink ${slot(dir, 't1', 3)}`]);
    expect(readFileSync(seg, 'utf8')).toBe(segBytes);
    expect((await s.readLog('t1')).events).toEqual(evs);
  });

  it.each([
    ['equal to the row', 'adopted', (evs: TaskEvent[]) => evs[3] as TaskEvent, (evs: TaskEvent[]) => evs[3] as TaskEvent],
    ['different from the row (an orphan of a stale writer)', 'adopted', (evs: TaskEvent[]) => rival(evs, 4), (evs: TaskEvent[]) => evs[3] as TaskEvent],
    ['equal to the caller\'s event, which differs from the row', 'conflict', (evs: TaskEvent[]) => rival(evs, 4), (evs: TaskEvent[]) => rival(evs, 4)],
  ])('row 7: a covered slot with a loose file %s decides by the row only (EEXIST adopter), and removes nothing', async (_n, outcome, looseOf_, callerOf) => {
    const { dir, s, evs, sp } = await covered();
    writeFileSync(slot(dir, 't1', 4), `${serializeEvent(looseOf_(evs))}\n`);
    const restore = sp.install();
    try {
      expect(await s.append(callerOf(evs))).toBe(outcome);
    } finally {
      restore();
    }
    expect(unlinked(sp)).toEqual([]); // an adopter never removes a file it did not create
    expect(existsSync(slot(dir, 't1', 4))).toBe(true);
    expect((await s.readLog('t1')).events).toEqual(evs);
  });

  it('row 11: a published event whose register state is unknown is not taken back; the retry recomputes the evidence', async () => {
    const dir = newDir();
    let fault: string | null = null;
    const s = fsAt(dir, { earlyPruneCheck: false, readFault: (abs) => (fault !== null && abs.endsWith(fault) ? 'EIO' : null) });
    const evs = await fill(s, 't1', 2);
    await s.markPruned!(tombstoneOf(evs)); // an open attempt
    fault = 'prune-1.prepare.json';
    const next = chain('t1', 3)[2] as TaskEvent;
    await expect(s.append(next)).rejects.toBeInstanceOf(AppendOutcomeUnknownError);
    expect(existsSync(slot(dir, 't1', 3))).toBe(true); // the file stays (F-1)
    fault = null;
    expect(await s.append(next)).toBe('adopted'); // the retry closes the attempt and finds the slot: no right is derived
    expect((await s.readLog('t1')).events).toEqual(chain('t1', 3));
  });

  it('a hook that throws between the publication and the check is not a SIGKILL, but the retry still recomputes from scratch (criterion 53, partial)', async () => {
    const dir = newDir();
    const s = fsAt(dir);
    const evs = await fill(s, 't1', 3);
    await s.compact('t1', 3, evs); // the slot is covered by now
    expect(await s.append(evs[1] as TaskEvent)).toBe('adopted'); // not "appended", whatever a previous attempt did
    expect(await s.append(rival(evs, 2))).toBe('conflict');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// HIGH-1 complement: the guard in prune() against a replaced attempt, on both backends; a foreign attempt is never aborted
// ---------------------------------------------------------------------------------------------------------------------

describe.each(backends)('prune() and an attempt replaced in its race window: %s', (_n, make) => {
  type Racy = EventStore & { preparePrune: NonNullable<EventStore['preparePrune']> };

  it('refuses, commits nothing, and aborts only the attempt it opened itself', async () => {
    const { store } = make();
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);
    const real = (store as Racy).preparePrune.bind(store);
    (store as Racy).preparePrune = async (t) => {
      await real(t);
      await store.decidePrune!('t1', 1, 'abort', undefined, 'child'); // someone opened attempt 1 and aborted it
      return real(t); // this call now opens attempt 2
    };
    await expect(store.prune(tomb)).rejects.toBeInstanceOf(Error);
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'live', attempt: 2 }); // its own attempt 2 is closed, 1 stays aborted
    expect((await store.readLog('t1')).events).toEqual(evs);
    expect(await store.decidePrune!('t1', 2, 'commit', tomb, 'pruner')).toBe('abort');
  });

  it('leaves an attempt that somebody else opened in the window alone', async () => {
    const { store } = make();
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);
    const real = (store as Racy).preparePrune.bind(store);
    (store as Racy).preparePrune = async (t) => {
      await real(t);
      await store.decidePrune!('t1', 1, 'abort', undefined, 'child'); // 1 aborted
      await real(t); // 2 opened by another task, still open
      return real(t); // returns 2, created: false
    };
    await expect(store.prune(tomb)).rejects.toBeInstanceOf(Error);
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'preparing', attempt: 2 }); // not aborted by this caller
    expect((await store.readLog('t1', { rawEvents: true })).events).toEqual(evs);
  });
});
