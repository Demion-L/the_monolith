/**
 * Fault and adversary tests for the filesystem store: what is left on disk
 * after a crash at each step, what a hostile or damaged directory looks like,
 * and what a paused ("zombie") writer can and cannot do.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, linkSync, symlinkSync, statSync, existsSync, mkdirSync, unlinkSync, renameSync, chmodSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FsEventStore } from './fs-store.js';
import { createFsStoreWithSeams } from './testing.js';
import { tombstoneFor } from './prune-check.js';
import { foldEvents } from './projection.js';
import { DurableTasks } from './runtime.js';
import { AppendOutcomeUnknownError } from './fs-store.js';
import { readBoundedFile } from '../root/index.js';
import { stampEvent, computeHash, serializeEvent } from './log.js';
import { canonicalize, type Json } from './canonical.js';
import {
  LogCorruptError, LogUnsupportedError, StoreSecurityError, TaskPrunedError,
} from './errors.js';
import { GENESIS_HASH, type EventStore, type TaskEvent, type Tombstone } from './types.js';

const initStore = (s: FsEventStore): FsEventStore => (s.initializeProtocolSync(), s);

let dir: string;
const extra: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'durable-fault-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  while (extra.length) rmSync(extra.pop() as string, { recursive: true, force: true });
});

const storeOf = (o: Partial<ConstructorParameters<typeof FsEventStore>[0]> = {}) =>
  initStore(createFsStoreWithSeams({ target: { scope: 'trusted-directory', dir }, durability: 'file', ...o }));

function chainOpen(taskId: string, n: number): TaskEvent[] {
  const out: TaskEvent[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const e =
      seq === 1
        ? stampEvent(taskId, 1, '2026-01-01T00:00:00.000Z', prev, {
            type: 'task.created', actor: null, data: { kind: 'k', goal: 'g', input: null, parentTaskId: null, dependsOn: [], labels: {} },
          })
        : stampEvent(taskId, seq, '2026-01-01T00:00:00.000Z', prev, {
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
const eventsDir = (id: string) => join(dir, 'tasks', id, 'events');
const eventFile = (id: string, seq: number) => join(eventsDir(id), `${String(seq).padStart(9, '0')}.json`);
async function fill(s: EventStore, id: string, n: number): Promise<TaskEvent[]> {
  const evs = chain(id, n);
  for (const e of evs) expect(await s.append(e)).toBe('appended');
  return evs;
}

describe('crash between link() and unlink(tmp): a complete event with two names', () => {
  // `ops.unlinkSync` failing for staging names reproduces exactly the on-disk state a SIGKILL
  // between the two syscalls leaves (the real-kill version is in process.test.ts).
  const failStaging = {
    unlinkSync: ((p: string, ...rest: unknown[]) => {
      if (String(p).includes('.tmp.')) throw Object.assign(new Error('crashed'), { code: 'EIO' });
      return (unlinkSync as (...a: unknown[]) => void)(p, ...rest);
    }) as typeof unlinkSync,
  };

  it('leaves nlink 2, which the strict reader would refuse forever — and the store repairs it', async () => {
    const warnings: string[] = [];
    const s = storeOf({ ops: failStaging, onWarning: (w) => warnings.push(w.code) });
    warnings.length = 0; // initializing the store (the marker file) went through the same faulty unlink
    const evs = chain('t1', 3);
    await s.append(evs[0] as TaskEvent);
    await s.append(evs[1] as TaskEvent);
    expect(warnings).toEqual(['STAGING_RESIDUE', 'STAGING_RESIDUE']);
    expect(statSync(eventFile('t1', 2)).nlink).toBe(2);

    // the generic reader of ADR-014 refuses it: this is the wedge a naive store would suffer
    const strict = readBoundedFile(eventFile('t1', 2), 'event', { boundary: dir }, true);
    expect(strict).toMatchObject({ ok: false, code: 'FILE_HARDLINKED' });

    const healthy = storeOf();
    const r = await healthy.readLog('t1');
    expect(r.events).toEqual(evs.slice(0, 2));
    expect(r.diagnostics.filter((d) => d.code === 'STAGING_RESIDUE_REPAIRED')).toHaveLength(2);
    expect(statSync(eventFile('t1', 2)).nlink).toBe(1);
    expect(readdirSync(eventsDir('t1')).filter((n) => n.includes('.tmp.'))).toEqual([]);
    // and the log carries on
    expect(await healthy.append(evs[2] as TaskEvent)).toBe('appended');
    expect((await healthy.readLog('t1')).events).toHaveLength(3);
  });

  it('a second link that is NOT the staging name is a security error, not residue', async () => {
    const s = storeOf();
    await fill(s, 't1', 2);
    linkSync(eventFile('t1', 2), join(dir, 'elsewhere.json'));
    await expect(s.readLog('t1')).rejects.toBeInstanceOf(StoreSecurityError);
  });

  it('a staging-looking name that is a different file is not touched', async () => {
    const s = storeOf();
    await fill(s, 't1', 2);
    writeFileSync(join(eventsDir('t1'), '000000002.json.tmp.1234.0123456789abcdef'), 'someone else');
    const r = await s.readLog('t1');
    expect(r.events).toHaveLength(2);
    expect(r.diagnostics.map((d) => d.code)).toContain('STAGING_FILE_PRESENT');
    expect(existsSync(join(eventsDir('t1'), '000000002.json.tmp.1234.0123456789abcdef'))).toBe(true);
  });
});

describe('hostile or damaged directories fail closed', () => {
  it('refuses a symlinked event file', async () => {
    const s = storeOf();
    await fill(s, 't1', 3);
    const secret = join(dir, 'secret.txt');
    writeFileSync(secret, 'TOP-SECRET');
    unlinkSync(eventFile('t1', 2));
    symlinkSync(secret, eventFile('t1', 2));
    const err = await s.readLog('t1').catch((e) => e);
    expect(err).toBeInstanceOf(StoreSecurityError);
    expect(String(err.message)).not.toContain('TOP-SECRET');
  });

  it('refuses a symlinked events directory and a symlinked task directory', async () => {
    const s = storeOf();
    await fill(s, 't1', 2);
    const real = join(dir, 'tasks', 't1', 'events-real');
    renameSync(eventsDir('t1'), real);
    symlinkSync(real, eventsDir('t1'));
    await expect(s.readLog('t1')).rejects.toBeInstanceOf(StoreSecurityError);
    await expect(s.append(chain('t1', 3)[2] as TaskEvent)).rejects.toBeInstanceOf(StoreSecurityError);
  });

  it('refuses to write through a symlinked ancestor inside a project', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'durable-proj-'));
    extra.push(proj);
    const outside = mkdtempSync(join(tmpdir(), 'durable-outside-'));
    extra.push(outside);
    symlinkSync(outside, join(proj, '.monolith'));
    const s = new FsEventStore({ target: { scope: 'project', projectRoot: proj, dir: join(proj, '.monolith', 'durable') }, durability: 'file' });
    await expect(s.append(chain('t1', 1)[0] as TaskEvent)).rejects.toBeInstanceOf(StoreSecurityError);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('detects a flipped byte in an event', async () => {
    const s = storeOf();
    await fill(s, 't1', 3);
    const f = eventFile('t1', 2);
    writeFileSync(f, readFileSync(f, 'utf8').replace('"f2"', '"f9"'));
    await expect(s.readLog('t1')).rejects.toMatchObject({ code: 'LOG_CORRUPT', reason: expect.stringContaining('hash') });
  });

  it('detects a rewritten event even when the attacker recomputes its own hash (the chain breaks)', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 4);
    const forged = { ...(evs[2] as TaskEvent), data: { key: 'k3', fingerprint: 'EVIL', value: 3, source: null } } as unknown as Record<string, unknown>;
    delete forged['hash'];
    forged['hash'] = computeHash(forged as never);
    writeFileSync(eventFile('t1', 3), `${canonicalize(forged as unknown as Json)}\n`);
    const log = await s.readLog('t1'); // each file is individually valid…
    const rt = new DurableTasks({ store: s });
    await expect(rt.getLog('t1')).rejects.toMatchObject({ code: 'LOG_CORRUPT', seq: 4 }); // …the chain is not
    expect(log.events).toHaveLength(4);
  });

  it('detects a missing event (gap) instead of folding around it', async () => {
    const s = storeOf();
    await fill(s, 't1', 5);
    unlinkSync(eventFile('t1', 3));
    await expect(s.readLog('t1')).rejects.toBeInstanceOf(LogCorruptError);
  });

  it('detects an event moved from another task', async () => {
    const s = storeOf();
    await fill(s, 't1', 2);
    await fill(s, 't2', 2);
    writeFileSync(eventFile('t1', 2), readFileSync(eventFile('t2', 2)));
    await expect(s.readLog('t1')).rejects.toMatchObject({ code: 'LOG_CORRUPT', reason: expect.stringContaining('another task') });
  });

  it('refuses an event type from a newer format instead of skipping it', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 2);
    const future = { ...(evs[1] as TaskEvent), type: 'task.teleported' } as unknown as Record<string, unknown>;
    delete future['hash'];
    future['hash'] = computeHash(future as never);
    writeFileSync(eventFile('t1', 2), `${canonicalize(future as unknown as Json)}\n`);
    await expect(s.readLog('t1')).rejects.toBeInstanceOf(LogUnsupportedError);
  });

  it('treats an empty or truncated event file as corruption', async () => {
    const s = storeOf();
    await fill(s, 't1', 3);
    writeFileSync(eventFile('t1', 3), '');
    await expect(s.readLog('t1')).rejects.toBeInstanceOf(LogCorruptError);
    writeFileSync(eventFile('t1', 3), readFileSync(eventFile('t1', 2), 'utf8').slice(0, 40));
    await expect(s.readLog('t1')).rejects.toBeInstanceOf(LogCorruptError);
  });

  it('a hostile task id never reaches the filesystem', async () => {
    const s = storeOf();
    await expect(s.readLog('../../etc')).rejects.toBeInstanceOf(StoreSecurityError);
  });

  it('corruption of one task does not affect another, and verify names the broken one', async () => {
    const s = storeOf();
    const rt = new DurableTasks({ store: s });
    await rt.createTask({ taskId: 'good', kind: 'k', goal: 'g' });
    await rt.createTask({ taskId: 'bad', kind: 'k', goal: 'g' });
    await rt.observe('bad', { key: 'a', value: 1 });
    writeFileSync(eventFile('bad', 2), 'not json');
    const reports = await new DurableTasks({ store: s }).verify();
    expect(reports.map((r) => [r.taskId, r.ok])).toEqual([['bad', false], ['good', true]]);
    expect((await new DurableTasks({ store: s }).getState('good')).status).toBe('active');
  });
});

describe('a paused (zombie) writer cannot fork or resurrect a log', () => {
  it('its append into a slot that was compacted away is rolled back and reported as a conflict', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 20);
    // writer Z believes the head is 5 and prepared event 6
    const stale = stampEvent('t1', 6, '2026-09-09T00:00:00.000Z', (evs[4] as TaskEvent).hash, {
      type: 'fact.observed', actor: 'zombie', data: { key: 'zombie', fingerprint: 'z', value: 1, source: null },
    });
    // meanwhile the log is compacted through 15 (files 1..15 removed)
    await s.compact('t1', 15, evs.slice(0, 15));
    expect(existsSync(eventFile('t1', 6))).toBe(false);

    const outcome = await s.append(stale);
    expect(outcome).toBe('conflict');
    expect(existsSync(eventFile('t1', 6))).toBe(false);
    const r = await s.readLog('t1');
    expect(r.events).toEqual(evs);
    expect(r.diagnostics.filter((d) => d.code === 'LOOSE_COPY_OF_COMPACTED_EVENT')).toEqual([]);
  });

  it('even if the zombie file survives, segments win and the loose copy is only a diagnostic', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 20);
    await s.compact('t1', 15, evs.slice(0, 15));
    writeFileSync(eventFile('t1', 6), 'garbage that must never be parsed');
    const r = await s.readLog('t1');
    expect(r.events).toEqual(evs);
    expect(r.diagnostics.map((d) => d.code)).toContain('LOOSE_COPY_OF_COMPACTED_EVENT');
  });

  it('the pause is simulated at the exact point between check and publish', async () => {
    const racer = storeOf();
    const evs = await fill(racer, 't1', 20);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const zombieStore = storeOf({ beforePublish: () => gate });
    const stale = stampEvent('t1', 6, '2026-09-09T00:00:00.000Z', (evs[4] as TaskEvent).hash, {
      type: 'fact.observed', actor: 'zombie', data: { key: 'zombie', fingerprint: 'z', value: 1, source: null },
    });
    // it first has to get past "slot 6 is taken" — so free the slot as compaction does, mid-flight
    const pending = zombieStore.append(stale); // parked in beforePublish
    await racer.compact('t1', 15, evs.slice(0, 15));
    release();
    expect(await pending).toBe('conflict');
    expect((await racer.readLog('t1')).events).toEqual(evs);
  });

  it('its append into a pruned task is rolled back and refused', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 3);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const zombieStore = storeOf({ beforePublish: () => gate });
    const ghost = stampEvent('t1', 4, '2026-09-09T00:00:00.000Z', (evs[2] as TaskEvent).hash, {
      type: 'fact.observed', actor: 'zombie', data: { key: 'ghost', fingerprint: 'g', value: 1, source: null },
    });
    const pending = zombieStore.append(ghost);
    const tomb: Tombstone = tombstoneFor(foldEvents(evs.slice(0, 3)), 'c');
    await s.prune(tomb);
    release();
    await expect(pending).rejects.toBeInstanceOf(TaskPrunedError);
    expect(existsSync(eventFile('t1', 4))).toBe(false);
  });
});

describe('zombie vs prune when the events directory survives', () => {
  it('its link succeeds, G2 sees the commit: TaskPrunedError, the file is NOT taken back (F-1) and the roll-forward removes it', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 3);
    writeFileSync(join(eventsDir('t1'), 'README-keep-dir-alive'), 'x'); // prune leaves a directory with strangers in it
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const zombieStore = storeOf({ beforePublish: () => gate });
    const ghost = stampEvent('t1', 4, '2026-09-09T00:00:00.000Z', (evs[2] as TaskEvent).hash, {
      type: 'fact.observed', actor: 'zombie', data: { key: 'ghost', fingerprint: 'g', value: 1, source: null },
    });
    const pending = zombieStore.append(ghost);
    await s.prune(tombstoneFor(foldEvents(evs), 'c'));
    expect(existsSync(eventsDir('t1'))).toBe(true);
    release();
    await expect(pending).rejects.toBeInstanceOf(TaskPrunedError);
    // A published file is shared state: a writer that learns the task is pruned reports it and removes NOTHING (class A).
    expect(existsSync(eventFile('t1', 4))).toBe(true);
    const done = await s.pruneState('t1');
    expect(done).toMatchObject({ kind: 'committed', residue: 1 }); // DELETING: a late publication after the cleanup
    // The cleanup (class C) is the only thing that removes it, and it is the same call again.
    const tomb = done.tombstone as Tombstone;
    expect((await s.prune(tomb)).removedFiles).toBe(1);
    expect(existsSync(eventFile('t1', 4))).toBe(false);
    expect(readdirSync(eventsDir('t1'))).toEqual(['README-keep-dir-alive']);
    expect(await s.pruneState('t1')).toMatchObject({ kind: 'committed', residue: 0 }); // GONE
  });
});

describe('a reader overtaken by compaction still gets a complete log', () => {
  it('files that vanish between the listing and the read are found in the new segment on the next pass', async () => {
    const writer = storeOf();
    const evs = await fill(writer, 't1', 40);
    let packedThrough = 0;
    const reader = storeOf({
      afterListing: (attempt) => {
        // a compaction lands in the gap between the listing and the reads, on each of the first three passes
        if (attempt < 3) {
          packedThrough += 10;
          void writer.compact('t1', packedThrough, evs.slice(packedThrough - 10, packedThrough));
        }
      },
    });
    const log = await reader.readLog('t1');
    expect(log.events).toEqual(evs);
    expect(packedThrough).toBe(30);
  });

  it('gives up with a typed error, not a silently shorter log, if files keep vanishing', async () => {
    const writer = storeOf();
    const evs = await fill(writer, 't1', 60);
    let packed = 0;
    const reader = storeOf({
      afterListing: () => {
        packed = Math.min(packed + 5, 50);
        void writer.compact('t1', packed, evs.slice(packed - 5, packed));
      },
    });
    await expect(reader.readLog('t1')).rejects.toMatchObject({ code: 'LOG_CORRUPT', reason: expect.stringContaining('vanishing') });
  });
});

describe('interrupted maintenance is a consistent state that can be completed', () => {
  it.skipIf(process.getuid?.() === 0)('compaction that fails while removing files keeps every event readable and can be re-run', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 12);
    chmodSync(eventsDir('t1'), 0o500); // unlink is now refused: the segment is published, the loose files cannot go
    try {
      await expect(s.compact('t1', 8, evs.slice(0, 8))).rejects.toMatchObject({ code: 'STORE_IO' });
    } finally {
      chmodSync(eventsDir('t1'), 0o700);
    }
    expect(readdirSync(join(dir, 'tasks', 't1', 'segments'))).toEqual(['S000000001-000000008.jsonl']);
    const mid = await s.readLog('t1');
    expect(mid.events).toEqual(evs);
    expect(mid.diagnostics.filter((d) => d.code === 'LOOSE_COPY_OF_COMPACTED_EVENT').length).toBeGreaterThan(0);
    await s.compact('t1', 8, evs.slice(0, 8)); // finishes the job
    const after = await s.readLog('t1');
    expect(after.events).toEqual(evs);
    expect(after.diagnostics.filter((d) => d.code === 'LOOSE_COPY_OF_COMPACTED_EVENT')).toEqual([]);
    expect(readdirSync(eventsDir('t1'))).toHaveLength(4);
  });

  it('compaction crash window: segment present, all loose files still there', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 12);
    // exactly what a crash right after segment publication leaves
    mkdirSync(join(dir, 'tasks', 't1', 'segments'), { recursive: true });
    writeFileSync(join(dir, 'tasks', 't1', 'segments', 'S000000001-000000008.jsonl'), `${evs.slice(0, 8).map(serializeEvent).join('\n')}\n`);
    const r = await s.readLog('t1');
    expect(r.events).toEqual(evs);
    expect(r.diagnostics.filter((d) => d.code === 'LOOSE_COPY_OF_COMPACTED_EVENT')).toHaveLength(8);
    const done = await s.compact('t1', 8, evs.slice(0, 8));
    expect(done.removedFiles).toBe(8);
    const after = await s.readLog('t1');
    expect(after.events).toEqual(evs);
    expect(after.diagnostics.filter((d) => d.code === 'LOOSE_COPY_OF_COMPACTED_EVENT')).toEqual([]);
  });

  it('a conflicting segment of the same name is refused, loose events are kept', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 6);
    mkdirSync(join(dir, 'tasks', 't1', 'segments'), { recursive: true });
    writeFileSync(join(dir, 'tasks', 't1', 'segments', 'S000000001-000000004.jsonl'), 'different content\n');
    await expect(s.compact('t1', 4, evs.slice(0, 4))).rejects.toBeInstanceOf(LogCorruptError);
    expect(existsSync(eventFile('t1', 1))).toBe(true);
  });

  it('a damaged segment is detected, not trusted', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 8);
    await s.compact('t1', 5, evs.slice(0, 5));
    const seg = join(dir, 'tasks', 't1', 'segments', 'S000000001-000000005.jsonl');
    writeFileSync(seg, readFileSync(seg, 'utf8').replace('"f2"', '"f7"'));
    await expect(s.readLog('t1')).rejects.toBeInstanceOf(LogCorruptError);
  });

  it('prune that died after the commit: the task already reads as pruned and finishing is idempotent', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 4);
    const tomb: Tombstone = tombstoneFor(foldEvents(evs.slice(0, 4)), 'c');
    const { attempt } = await s.preparePrune(tomb);
    expect(await s.decidePrune('t1', attempt, 'commit', tomb)).toBe('commit'); // ... and the pruner died here
    expect((await s.readLog('t1')).tombstone?.headHash).toBe(tomb.headHash);
    expect(readdirSync(eventsDir('t1'))).toHaveLength(4); // data still there, but unreachable
    const out = await s.prune(tomb);
    expect(out.removedFiles).toBe(4);
    expect(existsSync(eventsDir('t1'))).toBe(false);
    expect(existsSync(join(dir, 'tasks', 't1', 'tombstone.json'))).toBe(true); // published from the commit, before the first unlink
    expect((await s.prune(tomb)).removedFiles).toBe(0); // and a second run is a no-op
  });

  it('a legacy tombstone.json without a register is LEGACY_TOMBSTONE: every operation refuses, nothing is deleted or committed', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 4);
    const tomb: Tombstone = tombstoneFor(foldEvents(evs.slice(0, 4)), 'c');
    writeFileSync(join(dir, 'tasks', 't1', 'tombstone.json'), `${JSON.stringify(tomb)}\n`);
    expect(await s.pruneState('t1')).toMatchObject({ kind: 'legacy', basis: 'lookup' });
    await expect(s.prune(tomb)).rejects.toMatchObject({ code: 'PRUNE_DECISION_CORRUPT', reason: 'legacy-tombstone-unmigrated' });
    await expect(s.preparePrune(tomb)).rejects.toMatchObject({ code: 'PRUNE_DECISION_CORRUPT' });
    expect(readdirSync(eventsDir('t1'))).toHaveLength(4); // untouched
    expect(readdirSync(join(dir, 'tasks', 't1')).filter((n) => n.startsWith('prune-'))).toEqual([]); // no commit was invented
  });

  it('a different tombstone already present is refused', async () => {
    const s = storeOf();
    const evs = await fill(s, 't1', 2);
    const good = tombstoneFor(foldEvents(evs), 'c');
    await s.prune(good);
    await expect(s.prune({ ...good, headHash: 'f'.repeat(64) })).rejects.toBeInstanceOf(LogCorruptError);
  });
});

describe('publication with an unknown outcome', () => {
  class UnknownOnce implements EventStore {
    armed = true;
    stored: 'yes' | 'no' = 'yes';
    constructor(readonly inner: EventStore) {}
    readLog: EventStore['readLog'] = (a, b) => this.inner.readLog(a, b);
    listTaskIds: EventStore['listTaskIds'] = () => this.inner.listTaskIds();
    compact: EventStore['compact'] = (a, b, c) => this.inner.compact(a, b, c);
    prune: EventStore['prune'] = (t) => this.inner.prune(t);
    async append(e: TaskEvent) {
      if (this.armed && e.seq > 1) {
        this.armed = false;
        if (this.stored === 'yes') await this.inner.append(e);
        throw new AppendOutcomeUnknownError(e.taskId, e.seq);
      }
      return this.inner.append(e);
    }
  }

  it('is resolved by reading the log: an event that did land is not written twice', async () => {
    const s = new UnknownOnce(storeOf());
    const rt = new DurableTasks({ store: s });
    await rt.createTask({ taskId: 't1', kind: 'k', goal: 'g' });
    await rt.observe('t1', { key: 'a', value: 1 });
    const { events } = await rt.getLog('t1');
    expect(events.map((e) => e.type)).toEqual(['task.created', 'fact.observed']);
  });

  it('and an event that did not land is published again', async () => {
    const s = new UnknownOnce(storeOf());
    s.stored = 'no';
    const rt = new DurableTasks({ store: s });
    await rt.createTask({ taskId: 't1', kind: 'k', goal: 'g' });
    await rt.observe('t1', { key: 'a', value: 1 });
    expect((await rt.getLog('t1')).events.map((e) => e.type)).toEqual(['task.created', 'fact.observed']);
  });
});
