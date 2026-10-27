/**
 * FIX-004A, storage level: the persisted prune decision register (criteria 3, 4, 10, 11, 13, 15, 19, 41, 43, 44, 55-58,
 * 67-69). Real-process, SIGKILL and barrier variants belong to FIX-004C and are NOT covered here.
 *
 * Fault seams used: `registerListing` (an incomplete listing, A7), `readFault` (EIO on one register file),
 * `maxPruneAttempts`, `earlyPruneCheck`, `ops.linkSync`/`ops.unlinkSync`. No production hook was added for these tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { stampEvent } from './log.js';
import { encodeTombstone } from './register.js';
import { GENESIS_HASH, type EventStore, type TaskEvent, type Tombstone } from './types.js';
import { PruneAttemptLimitError, RetentionRefusedError, StoreIoError, TaskPrunedError, LogCorruptError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'durable-reg-'));
  dirs.push(d);
  return d;
};
const fsAt = (dir: string, o: Partial<ConstructorParameters<typeof FsEventStore>[0]> = {}): FsEventStore => {
  const s = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file', ...o });
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
const tombstoneOf = (evs: TaskEvent[]): Tombstone => ({
  v: 1, taskId: evs[0]!.taskId, kind: 'k', finalStatus: 'completed', createdAt: 'a', closedAt: 'b', prunedAt: 'c',
  headSeq: evs.length, headHash: evs[evs.length - 1]!.hash, outcomeDigest: 'd',
});
async function fill(store: EventStore, id: string, n: number): Promise<TaskEvent[]> {
  const evs = chain(id, n);
  for (const e of evs) expect(await store.append(e)).toBe('appended');
  return evs;
}

/** Every file below `dir` with a digest of its bytes: equal snapshots mean nothing was created, changed or removed. */
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
  walk(dir);
  return out;
}
const taskDir = (dir: string, id: string): string => join(dir, 'tasks', id);
const registerFiles = (dir: string, id: string): string[] =>
  readdirSync(taskDir(dir, id)).filter((n) => n.startsWith('prune-') || n === 'tombstone.json').sort();

const backends: Array<[string, (max?: number) => EventStore]> = [
  ['memory', (max) => new MemoryEventStore(max ? { maxPruneAttempts: max } : {})],
  ['filesystem', (max) => fsAt(newDir(), max ? { maxPruneAttempts: max } : {})],
];

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 3 (AC ABA), 13 (records survive GONE), 10/11 (nothing after COMMITTED)
// ---------------------------------------------------------------------------------------------------------------------

describe.each(backends)('attempt numbers are never reused and decisions never disappear (criteria 3, 13): %s', (name, make) => {
  it('a stale pruner cannot revive an aborted attempt, and the register survives the prune', async () => {
    const store = make();
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);

    expect(await store.preparePrune!(tomb)).toEqual({ attempt: 1, created: true });
    expect(await store.decidePrune!('t1', 1, 'abort', undefined, 'child')).toBe('abort');
    expect(await store.preparePrune!(tomb)).toEqual({ attempt: 2, created: true }); // 1 is not reused

    // The stopped pruner of attempt 1 wakes up and tries to commit it.
    expect(await store.decidePrune!('t1', 1, 'commit', tomb, 'pruner')).toBe('abort');
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'preparing', attempt: 2 });

    expect(await store.decidePrune!('t1', 2, 'commit', tomb, 'pruner')).toBe('commit');
    await store.prune(tomb);
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'committed', attempt: 2 });
    // The attempt number does not go back, and a pruned task opens no further attempt.
    await expect(store.preparePrune!(tomb)).rejects.toBeInstanceOf(TaskPrunedError);
    expect(await store.decidePrune!('t1', 1, 'commit', tomb, 'pruner')).toBe('abort'); // decision 1 is still abort
  });

  it('a repeated prune after GONE is a no-op, and the commit records stay', async () => {
    const store = make();
    const evs = await fill(store, 't1', 2);
    const tomb = tombstoneOf(evs);
    expect((await store.prune(tomb)).removedFiles).toBeGreaterThan(0);
    expect((await store.prune(tomb)).removedFiles).toBe(0);
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'committed', attempt: 1 });
    if (name === 'filesystem') {
      const dir = (store as unknown as { root: string }).root;
      expect(registerFiles(dir, 't1')).toEqual(['prune-1.decision.json', 'prune-1.prepare.json', 'tombstone.json']);
      expect(statSync(taskDir(dir, 't1')).isDirectory()).toBe(true); // tasks/P/ is kept (section 21)
    }
  });

  it('after COMMITTED neither append nor compact is accepted (criteria 10, 11)', async () => {
    const store = make();
    const evs = await fill(store, 't1', 3);
    await store.prune(tombstoneOf(evs));
    const more = chain('t1', 4)[3] as TaskEvent;
    await expect(store.append(more)).rejects.toBeInstanceOf(TaskPrunedError);
    await expect(store.compact('t1', 3, evs)).rejects.toBeInstanceOf(TaskPrunedError);
  });
});

describe('records are kept on disk (criterion 3, filesystem)', () => {
  it('no operation of the store removes a decision file: abort, new attempt, reads, appends, compaction', async () => {
    const dir = newDir();
    const store = fsAt(dir);
    const evs = await fill(store, 't1', 5);
    const tomb = tombstoneOf(evs);
    await store.markPruned!(tomb);
    await store.withdrawTombstone!(tomb);
    expect(registerFiles(dir, 't1')).toEqual(['prune-1.decision.json', 'prune-1.prepare.json']);
    const before = readFileSync(join(taskDir(dir, 't1'), 'prune-1.decision.json'), 'utf8');

    await store.readLog('t1');
    await store.compact('t1', 3, evs.slice(0, 3));
    await store.sweepCompacted!('t1');
    await store.markPruned!(tomb);
    await store.withdrawTombstone!(tomb);
    expect(registerFiles(dir, 't1')).toEqual(['prune-1.decision.json', 'prune-1.prepare.json', 'prune-2.decision.json', 'prune-2.prepare.json']);
    expect(readFileSync(join(taskDir(dir, 't1'), 'prune-1.decision.json'), 'utf8')).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 4: commit and abort never coexist (>= 200 rounds, deterministic, no random delays)
// ---------------------------------------------------------------------------------------------------------------------

describe.each(backends)('commit and abort of one attempt never coexist (criterion 4): %s', (name, make) => {
  it('200 rounds of two deciders: both see the same value; the first caller wins, in both orders', async () => {
    const store = make();
    // A second instance over the same directory plays the other process; memory has one shared object.
    const other = name === 'filesystem' ? fsAt((store as unknown as { root: string }).root) : store;
    let commits = 0;
    let aborts = 0;
    for (let round = 0; round < 200; round++) {
      const id = `r${round}`;
      const evs = await fill(store, id, 1);
      const tomb = tombstoneOf(evs);
      await store.preparePrune!(tomb);
      const commitFirst = round % 2 === 0;
      const doCommit = () => store.decidePrune!(id, 1, 'commit', tomb, 'pruner');
      const doAbort = () => other.decidePrune!(id, 1, 'abort', undefined, 'child');
      const [a, b] = await Promise.all(commitFirst ? [doCommit(), doAbort()] : [doAbort(), doCommit()]);
      expect(a).toBe(b); // one decision, seen by both
      expect(a).toBe(commitFirst ? 'commit' : 'abort'); // and it is the one that was issued first
      const st = await store.pruneState!(id);
      if (a === 'commit') {
        commits++;
        expect(st).toMatchObject({ kind: 'committed', attempt: 1 });
      } else {
        aborts++;
        expect(st).toMatchObject({ kind: 'live', attempt: 1 });
      }
    }
    expect([commits, aborts]).toEqual([100, 100]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 15: MAX_PRUNE_ATTEMPTS
// ---------------------------------------------------------------------------------------------------------------------

describe.each(backends)('MAX_PRUNE_ATTEMPTS (criterion 15): %s', (name, make) => {
  it('the last permitted attempt can be committed', async () => {
    const store = make(3);
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);
    for (let n = 1; n <= 2; n++) {
      expect(await store.preparePrune!(tomb)).toEqual({ attempt: n, created: true });
      await store.decidePrune!('t1', n, 'abort', undefined, 'child');
    }
    expect(await store.preparePrune!(tomb)).toEqual({ attempt: 3, created: true });
    expect(await store.decidePrune!('t1', 3, 'commit', tomb, 'pruner')).toBe('commit');
    await store.prune(tomb);
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'committed', attempt: 3 });
  });

  it('an attempt beyond the limit is refused, the counter does not reset, nothing is written', async () => {
    const store = make(3);
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);
    for (let n = 1; n <= 3; n++) {
      await store.preparePrune!(tomb);
      await store.decidePrune!('t1', n, 'abort', undefined, 'child');
    }
    for (let i = 0; i < 2; i++) {
      await expect(store.preparePrune!(tomb)).rejects.toBeInstanceOf(PruneAttemptLimitError);
      await expect(store.markPruned!(tomb)).rejects.toBeInstanceOf(PruneAttemptLimitError);
    }
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'live', attempt: 3 }); // not reset, not 4
    expect((await store.readLog('t1')).events).toEqual(evs); // the task is untouched
    if (name === 'filesystem') {
      expect(registerFiles((store as unknown as { root: string }).root, 't1')).toHaveLength(6); // 3 prepare + 3 decision, no prune-4
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 19: the old operations do not bypass the register
// ---------------------------------------------------------------------------------------------------------------------

describe.each(backends)('the old operations do not bypass the register (criterion 19): %s', (name, make) => {
  it('requireCommit refuses without a commit; markPruned and withdrawTombstone delete nothing and publish no tombstone.json', async () => {
    const store = make();
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);
    await expect(store.prune(tomb, { requireCommit: true })).rejects.toBeInstanceOf(RetentionRefusedError);
    await store.markPruned!(tomb);
    await expect(store.prune(tomb, { requireCommit: true })).rejects.toBeInstanceOf(RetentionRefusedError);
    expect((await store.readLog('t1', { rawEvents: true })).events).toEqual(evs);
    await store.withdrawTombstone!(tomb);
    expect((await store.readLog('t1')).events).toEqual(evs);
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'live', attempt: 1 });
    if (name === 'filesystem') {
      const dir = (store as unknown as { root: string }).root;
      expect(existsSync(join(taskDir(dir, 't1'), 'tombstone.json'))).toBe(false);
      expect(registerFiles(dir, 't1')).toEqual(['prune-1.decision.json', 'prune-1.prepare.json']);
    }
  });

  it('prune() without requireCommit acts only through a commit decision', async () => {
    const store = make();
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);
    await store.prune(tomb);
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'committed', attempt: 1 });
    if (name === 'filesystem') {
      const dir = (store as unknown as { root: string }).root;
      expect(readFileSync(join(taskDir(dir, 't1'), 'prune-1.decision.json'), 'utf8')).toContain('"commit"');
    }
  });

  it('a different tombstone than the open attempt carries is refused', async () => {
    const store = make();
    const evs = await fill(store, 't1', 3);
    await store.markPruned!(tombstoneOf(evs));
    await expect(store.prune(tombstoneOf(evs.slice(0, 2)))).rejects.toBeInstanceOf(LogCorruptError);
    expect((await store.readLog('t1', { rawEvents: true })).events).toEqual(evs);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 41: append validity does not depend on G1
// ---------------------------------------------------------------------------------------------------------------------

describe('append validity does not depend on G1 (criterion 41)', () => {
  it.each([true, false])('a committed, not yet cleaned task refuses the append the same way with earlyPruneCheck=%s', async (early) => {
    const dir = newDir();
    const store = fsAt(dir, { earlyPruneCheck: early });
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);
    await store.markPruned!(tomb);
    await store.decidePrune!('t1', 1, 'commit', tomb, 'pruner'); // committed, roll-forward not run yet
    await expect(store.append(chain('t1', 4)[3] as TaskEvent)).rejects.toBeInstanceOf(TaskPrunedError);
    // a gap is refused regardless of G1 as well
    await expect(store.append(chain('t1', 6)[5] as TaskEvent)).rejects.toBeInstanceOf(TaskPrunedError);
    await store.prune(tomb); // the roll-forward removes whatever G1=false let through
    expect(readdirSync(taskDir(dir, 't1')).sort()).toEqual(['prune-1.decision.json', 'prune-1.prepare.json', 'tombstone.json']);
  });

  it.each([true, false])('an append past a hole is refused with earlyPruneCheck=%s and publishes nothing', async (early) => {
    const dir = newDir();
    const store = fsAt(dir, { earlyPruneCheck: early });
    await fill(store, 't1', 2);
    const before = tree(dir);
    await expect(store.append(chain('t1', 5)[4] as TaskEvent)).rejects.toBeInstanceOf(LogCorruptError);
    expect(tree(dir)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criteria 43, 44, 55, 56, 68, 69: an unstable listing is neither permission nor proof of damage
// ---------------------------------------------------------------------------------------------------------------------

describe('an unstable listing (criteria 43, 44, 55, 56, 68, 69)', () => {
  /** A pruned task whose register is healthy, opened through a store that sees only `visible` of the directory. */
  async function committed(attempts: number): Promise<{ dir: string; tomb: Tombstone; evs: TaskEvent[] }> {
    const dir = newDir();
    const setup = fsAt(dir);
    const evs = await fill(setup, 't1', 3);
    const tomb = tombstoneOf(evs);
    for (let n = 1; n < attempts; n++) {
      await setup.markPruned!(tomb);
      await setup.withdrawTombstone!(tomb);
    }
    await setup.markPruned!(tomb);
    await setup.decidePrune!('t1', attempts, 'commit', tomb, 'pruner');
    await setup.prune(tomb);
    return { dir, tomb, evs };
  }
  const seeing = (dir: string, visible: (names: string[]) => string[]) => fsAt(dir, { registerListing: (_id, names) => visible(names) });

  it('tombstone.json without any prune-* in the listing is COMMITTED(1) when the register is found by name (rule T, m = 0)', async () => {
    const { dir } = await committed(1);
    const s = seeing(dir, (names) => names.filter((n) => n === 'tombstone.json'));
    expect(await s.pruneState('t1')).toMatchObject({ kind: 'committed', attempt: 1 });
  });

  it('a listing without prune-(k).* of a healthy COMMITTED(k) does not give CORRUPT (criterion 44, test 44)', async () => {
    const { dir } = await committed(2);
    const s = seeing(dir, (names) => names.filter((n) => n.startsWith('prune-1.') || n === 'tombstone.json'));
    expect(await s.pruneState('t1')).toMatchObject({ kind: 'committed', attempt: 2 });
    const empty = seeing(dir, (names) => names.filter((n) => !n.startsWith('prune-')));
    expect(await empty.pruneState('t1')).toMatchObject({ kind: 'committed', attempt: 2 });
  });

  it('a tombstone that really has no commit is CORRUPT(tombstone-without-commit), confirmed by lookup, and nothing is changed', async () => {
    const dir = newDir();
    const store = fsAt(dir);
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);
    await store.markPruned!(tomb);
    await store.withdrawTombstone!(tomb);
    writeFileSync(join(taskDir(dir, 't1'), 'tombstone.json'), encodeTombstone(tomb));
    const before = tree(dir);
    const s = seeing(dir, (names) => names.filter((n) => n !== 'prune-1.decision.json'));
    expect(await s.pruneState('t1')).toMatchObject({ kind: 'corrupt', reason: 'tombstone-without-commit', basis: 'lookup' });
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'corrupt', reason: 'tombstone-without-commit' });
    await expect(store.prune(tomb)).rejects.toMatchObject({ code: 'PRUNE_DECISION_CORRUPT' });
    expect(tree(dir)).toEqual(before); // byte for byte
  });

  it('a real legacy tombstone is LEGACY only after prepare.1 is confirmed absent; a healthy COMMITTED is never LEGACY (criterion 69)', async () => {
    const legacyDir = newDir();
    const ls = fsAt(legacyDir);
    const evs = await fill(ls, 't1', 4);
    const tomb: Tombstone = { ...tombstoneOf(evs) };
    writeFileSync(join(taskDir(legacyDir, 't1'), 'tombstone.json'), `${JSON.stringify(tomb)}\n`);
    const looked: string[] = [];
    const spy = fsAt(legacyDir, { readFault: (abs) => (looked.push(abs), null) });
    expect(await spy.pruneState('t1')).toMatchObject({ kind: 'legacy', basis: 'lookup' });
    expect(looked.some((p) => p.endsWith('prune-1.prepare.json'))).toBe(true); // the lookup of prepare.1 was made
    expect(await seeing(legacyDir, (n) => n.filter((x) => x === 'tombstone.json')).pruneState('t1')).toMatchObject({ kind: 'legacy' });

    const { dir } = await committed(1);
    expect((await seeing(dir, (n) => n.filter((x) => x === 'tombstone.json')).pruneState('t1')).kind).toBe('committed');
  });

  it('the legacy state grants nothing: no commit is invented, no file is removed (criterion 69)', async () => {
    const dir = newDir();
    const store = fsAt(dir);
    const evs = await fill(store, 't1', 4);
    const tomb = tombstoneOf(evs);
    writeFileSync(join(taskDir(dir, 't1'), 'tombstone.json'), `${JSON.stringify(tomb)}\n`);
    const before = tree(dir);
    for (const act of [
      () => store.prune(tomb),
      () => store.markPruned!(tomb),
      () => store.withdrawTombstone!(tomb),
      () => store.preparePrune!(tomb),
      () => store.decidePrune!('t1', 1, 'commit', tomb, 'pruner'),
      () => store.compact('t1', 2, evs.slice(0, 2)),
      () => store.append(chain('t1', 5)[4] as TaskEvent),
      () => store.sweepCompacted!('t1'),
    ]) await expect(act()).rejects.toBeInstanceOf(Error);
    expect(tree(dir)).toEqual(before);
  });

  it('an unknown artifact is CORRUPT(unknown-artifact) and a staging file is ignored', async () => {
    const dir = newDir();
    const store = fsAt(dir);
    const evs = await fill(store, 't1', 2);
    const tomb = tombstoneOf(evs);
    await store.markPruned!(tomb);
    writeFileSync(join(taskDir(dir, 't1'), 'prune-1.prepare.json.tmp.123.0123456789abcdef'), 'partial');
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'preparing', attempt: 1 });
    writeFileSync(join(taskDir(dir, 't1'), 'prune-1.decision.json.bak'), 'x');
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'corrupt', reason: 'unknown-artifact' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criteria 57, 58, 67: EIO is UNREADABLE and UNREADABLE grants nothing
// ---------------------------------------------------------------------------------------------------------------------

describe('EIO on the register (criteria 57, 58, 67)', () => {
  let fault: string | null = null;
  const faulty = (abs: string): string | null => (fault !== null && abs.endsWith(fault) ? 'EIO' : null);
  afterEach(() => {
    fault = null;
  });

  async function healthyCommitted(): Promise<{ dir: string; tomb: Tombstone }> {
    const dir = newDir();
    const setup = fsAt(dir);
    const evs = await fill(setup, 't1', 3);
    const tomb = tombstoneOf(evs);
    await setup.prune(tomb);
    return { dir, tomb };
  }

  it.each(['prune-1.prepare.json', 'prune-1.decision.json', 'tombstone.json'])('EIO on %s is UNREADABLE with a full listing, and the verdict returns when it clears', async (file) => {
    const { dir } = await healthyCommitted();
    const s = fsAt(dir, { readFault: faulty });
    fault = file;
    const st = await s.pruneState('t1');
    expect(st.kind).toBe('unreadable');
    fault = null;
    expect(await s.pruneState('t1')).toMatchObject({ kind: 'committed', attempt: 1 });
  });

  it.each(['full', 'incomplete'])('EIO on decision.1 with an existing tombstone.json (trace R4E-02), %s listing: UNREADABLE, never CORRUPT / COMMITTED / LEGACY', async (listing) => {
    const { dir } = await healthyCommitted();
    const s = fsAt(dir, {
      readFault: faulty,
      registerListing: (_id, names) => (listing === 'full' ? names : names.filter((n) => n === 'tombstone.json')),
    });
    fault = 'prune-1.decision.json';
    expect((await s.pruneState('t1')).kind).toBe('unreadable');
    fault = 'prune-1.prepare.json'; // the lookup itself fails
    expect((await s.pruneState('t1')).kind).toBe('unreadable');
  });

  it('EIO on a decision with an independent finding (BAD decision.1): UNREADABLE wins over the unproven finding (IO-G1)', async () => {
    const dir = newDir();
    const store = fsAt(dir);
    const evs = await fill(store, 't1', 2);
    const tomb = tombstoneOf(evs);
    await store.markPruned!(tomb);
    await store.withdrawTombstone!(tomb);
    await store.markPruned!(tomb);
    writeFileSync(join(taskDir(dir, 't1'), 'prune-1.decision.json'), '{ not json');
    const s = fsAt(dir, { readFault: faulty });
    expect(await s.pruneState('t1')).toMatchObject({ kind: 'corrupt', reason: 'register' }); // BAD alone is a finding
    fault = 'prune-2.prepare.json';
    expect((await s.pruneState('t1')).kind).toBe('corrupt'); // present BAD decision.1 is established; EIO elsewhere cannot hide it
    fault = 'prune-1.decision.json';
    expect((await s.pruneState('t1')).kind).toBe('unreadable'); // its own bytes cannot be read: not a finding
  });

  it('while UNREADABLE no irreversible action is taken: nothing is committed, prepared, published or deleted (criterion 58)', async () => {
    const dir = newDir();
    const links: string[] = [];
    const unlinks: string[] = [];
    const ops = {
      linkSync: ((a: string, b: string) => (links.push(b), linkSyncReal(a, b))) as typeof linkSyncReal,
      unlinkSync: ((p: string) => (unlinks.push(p), unlinkSyncReal(p))) as typeof unlinkSyncReal,
    };
    const store = fsAt(dir, { readFault: faulty, ops });
    const evs = await fill(store, 't1', 5);
    const tomb = tombstoneOf(evs);
    await store.compact('t1', 2, evs.slice(0, 2)); // (G2 of a compaction would close an open attempt: open it afterwards)
    await store.markPruned!(tomb); // an open attempt
    const before = tree(dir);
    links.length = 0;
    unlinks.length = 0;
    fault = 'prune-1.prepare.json';
    const actions: Array<[string, () => Promise<unknown>]> = [
      ['decidePrune(commit)', () => store.decidePrune!('t1', 1, 'commit', tomb, 'pruner')],
      ['decidePrune(abort)', () => store.decidePrune!('t1', 1, 'abort', undefined, 'child')],
      ['preparePrune', () => store.preparePrune!(tomb)],
      ['markPruned', () => store.markPruned!(tomb)],
      ['withdrawTombstone', () => store.withdrawTombstone!(tomb)],
      ['prune', () => store.prune(tomb)],
      ['sweepCompacted', () => store.sweepCompacted!('t1')],
      ['pinReference', () => store.pinReference!('t1', 'child', '2026-01-01T00:00:00.000Z')],
      ['append', () => store.append(chain('t1', 6)[5] as TaskEvent)],
    ];
    for (const [label, act] of actions) {
      await expect(act(), label).rejects.toBeInstanceOf(StoreIoError);
    }
    expect(links).toEqual([]);
    expect(unlinks).toEqual([]);
    expect(tree(dir)).toEqual(before);
    fault = null;
    expect(await store.pruneState!('t1')).toMatchObject({ kind: 'preparing', attempt: 1 });
  });

  it('a commit whose decision cannot be read is not rolled forward: no tombstone.json, no deletion (class C)', async () => {
    const dir = newDir();
    const store = fsAt(dir, { readFault: faulty });
    const evs = await fill(store, 't1', 3);
    const tomb = tombstoneOf(evs);
    await store.markPruned!(tomb);
    await store.decidePrune!('t1', 1, 'commit', tomb, 'pruner');
    const before = tree(dir);
    fault = 'prune-1.decision.json';
    await expect(store.prune(tomb)).rejects.toBeInstanceOf(StoreIoError);
    expect(tree(dir)).toEqual(before);
    expect(existsSync(join(taskDir(dir, 't1'), 'tombstone.json'))).toBe(false);
    fault = null;
    expect((await store.prune(tomb)).removedFiles).toBe(3); // the commit stands; the retry finishes it
  });
});

import { linkSync as linkSyncReal, unlinkSync as unlinkSyncReal } from 'fs';
