/**
 * DURABLE-FIX-001 / D-4 — an interrupted prune or compaction can be finished through the PUBLIC runtime API.
 *
 * The store could always resume (both steps are ordered marker-first and idempotent), but the runtime refused
 * to call it: `compact()` returned 0 as soon as the segment covered the range, and `pruneTask()` threw
 * TaskPrunedError as soon as the tombstone existed, so the leftovers stayed for good.
 *
 * The interruption is a real one: the events directory becomes read-only after the marker was published,
 * so the removal step fails with EACCES exactly where a crash would have stopped it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { RetentionRefusedError, StoreIoError, TaskPrunedError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop() as string;
    try {
      for (const t of readdirSync(join(d, 'tasks'))) chmodSync(join(d, 'tasks', t, 'events'), 0o755);
    } catch {
      /* directory already gone */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

class Clock {
  t = Date.parse('2026-03-01T00:00:00.000Z');
  now = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t += ms;
  }
}
const DAY = 86_400_000;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'durable-ret-'));
  dirs.push(dir);
  const clock = new Clock();
  const open = (): DurableTasks => new DurableTasks({ store: new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }), now: clock.now });
  return { dir, clock, open, rt: open() };
}
const eventsDir = (dir: string, id: string): string => join(dir, 'tasks', id, 'events');
const loose = (dir: string, id: string): string[] => (existsSync(eventsDir(dir, id)) ? readdirSync(eventsDir(dir, id)).filter((n) => /^\d{9}\.json$/.test(n)) : []);
const segments = (dir: string, id: string): string[] => {
  const d = join(dir, 'tasks', id, 'segments');
  return existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.jsonl')) : [];
};

async function longTask(rt: DurableTasks, id: string, n = 30): Promise<void> {
  await rt.createTask({ taskId: id, kind: 'k', goal: 'g' });
  for (let i = 0; i < n; i++) await rt.observe(id, { key: `k${i}`, value: i });
}

describe('interrupted compaction', () => {
  it('compact() finishes removing loose events that a published segment already covers', async () => {
    const { dir, open, rt } = setup();
    await longTask(rt, 'job1');
    const before = await rt.getLog('job1');

    chmodSync(eventsDir(dir, 'job1'), 0o555); // removal of the loose copies will fail
    await expect(rt.compact('job1', { throughSeq: 20 })).rejects.toBeInstanceOf(StoreIoError);
    chmodSync(eventsDir(dir, 'job1'), 0o755);

    expect(segments(dir, 'job1')).toHaveLength(1);
    expect(loose(dir, 'job1').length).toBeGreaterThanOrEqual(20); // the interruption left them behind
    const interrupted = await open().getLog('job1');
    expect(interrupted.diagnostics.map((d) => d.code)).toContain('LOOSE_COPY_OF_COMPACTED_EVENT');

    // the same public call, nothing new to pack: it must still finish the job
    const packed = await open().compact('job1', { throughSeq: 20 });
    expect(packed).toBe(0);
    expect(loose(dir, 'job1').every((n) => Number(n.slice(0, 9)) > 20)).toBe(true);
    const after = await open().getLog('job1');
    expect(after.diagnostics.filter((d) => d.code === 'LOOSE_COPY_OF_COMPACTED_EVENT')).toEqual([]);
    expect(after.state).toEqual(before.state);
    expect(after.events.map((e) => e.hash)).toEqual(before.events.map((e) => e.hash));
    expect((await open().verify('job1'))[0]).toMatchObject({ ok: true });

    // repeating is a no-op
    expect(await open().compact('job1', { throughSeq: 20 })).toBe(0);
    expect(segments(dir, 'job1')).toHaveLength(1);
  });

  it('applyRetention() plans and completes the interrupted compaction by itself', async () => {
    const { dir, open, rt } = setup();
    await longTask(rt, 'job1', 40);
    chmodSync(eventsDir(dir, 'job1'), 0o555);
    await expect(rt.compact('job1', { throughSeq: 30 })).rejects.toBeInstanceOf(StoreIoError);
    chmodSync(eventsDir(dir, 'job1'), 0o755);

    const policy = { terminalRetentionMs: 30 * DAY, compactAfterEvents: 1000 }; // far below the size threshold
    const plan = await open().planRetention(policy);
    expect(plan).toEqual([expect.objectContaining({ taskId: 'job1', action: 'compact', reason: expect.stringMatching(/interrupted/) })]);
    const report = await open().applyRetention(policy);
    expect(report.applied).toEqual([expect.objectContaining({ taskId: 'job1', action: 'compact' })]);
    expect(loose(dir, 'job1').every((n) => Number(n.slice(0, 9)) > 30)).toBe(true);
    expect((await open().planRetention(policy))[0]).toMatchObject({ action: 'keep' });
  });

  it('never deletes a loose file that differs from the segment (cannot be proven redundant)', async () => {
    const { dir, open, rt } = setup();
    await longTask(rt, 'job1');
    chmodSync(eventsDir(dir, 'job1'), 0o555);
    await expect(rt.compact('job1', { throughSeq: 20 })).rejects.toBeInstanceOf(StoreIoError);
    chmodSync(eventsDir(dir, 'job1'), 0o755);

    const victim = join(eventsDir(dir, 'job1'), '000000005.json');
    const original = readFileSync(victim, 'utf8');
    const forged = original.replace('"k3"', '"k9"'); // same length, different content, hash no longer matches
    expect(forged).not.toBe(original);
    writeFileSync(victim, forged);

    await open().compact('job1', { throughSeq: 20 });
    expect(existsSync(victim)).toBe(true); // kept as evidence
    expect(readFileSync(victim, 'utf8')).toBe(forged);
    expect(loose(dir, 'job1').filter((n) => Number(n.slice(0, 9)) <= 20)).toEqual(['000000005.json']); // everything provably redundant is gone
    expect((await open().verify('job1'))[0]).toMatchObject({ ok: true }); // the segment is the authority
  });

  it('concurrent finishers are safe', async () => {
    const { dir, open, rt } = setup();
    await longTask(rt, 'job1');
    chmodSync(eventsDir(dir, 'job1'), 0o555);
    await expect(rt.compact('job1', { throughSeq: 20 })).rejects.toBeInstanceOf(StoreIoError);
    chmodSync(eventsDir(dir, 'job1'), 0o755);
    await Promise.all([open().compact('job1', { throughSeq: 20 }), open().compact('job1', { throughSeq: 20 }), open().compact('job1', { throughSeq: 20 })]);
    expect(loose(dir, 'job1').every((n) => Number(n.slice(0, 9)) > 20)).toBe(true);
    expect((await open().verify('job1'))[0]).toMatchObject({ ok: true });
  });
});

describe('interrupted prune', () => {
  async function finishedTask(rt: DurableTasks, clock: Clock, id: string): Promise<void> {
    await rt.createTask({ taskId: id, kind: 'k', goal: 'g' });
    const f = await rt.claim(id, { owner: 'w' });
    for (let i = 0; i < 6; i++) await rt.observe(id, { key: `k${i}`, value: i });
    await rt.complete(f, { result: 'done' });
    clock.advance(40 * DAY);
  }
  const policy = { terminalRetentionMs: 30 * DAY };

  it('pruneTask() finishes removing the data after the tombstone was published', async () => {
    const { dir, open, clock, rt } = setup();
    await finishedTask(rt, clock, 'old1');

    chmodSync(eventsDir(dir, 'old1'), 0o555);
    await expect(rt.pruneTask('old1', policy)).rejects.toBeInstanceOf(StoreIoError);
    chmodSync(eventsDir(dir, 'old1'), 0o755);
    expect(existsSync(join(dir, 'tasks', 'old1', 'tombstone.json'))).toBe(true);
    expect(loose(dir, 'old1').length).toBeGreaterThan(0); // data still there

    const again = open();
    const tomb = await again.pruneTask('old1', policy); // used to throw TaskPrunedError
    expect(tomb).toMatchObject({ taskId: 'old1', finalStatus: 'completed' });
    expect(loose(dir, 'old1')).toEqual([]);
    expect(existsSync(eventsDir(dir, 'old1'))).toBe(false);
    await expect(again.getState('old1')).rejects.toBeInstanceOf(TaskPrunedError);

    // already complete: calling again is harmless and returns the same tombstone
    expect(await open().pruneTask('old1', policy)).toEqual(tomb);
  });

  it('planRetention/applyRetention report and complete the interrupted prune', async () => {
    const { dir, open, clock, rt } = setup();
    await finishedTask(rt, clock, 'old1');
    chmodSync(eventsDir(dir, 'old1'), 0o555);
    await expect(rt.pruneTask('old1', policy)).rejects.toBeInstanceOf(StoreIoError);
    chmodSync(eventsDir(dir, 'old1'), 0o755);

    expect((await open().verify('old1'))[0].diagnostics.map((d) => d.code)).toContain('PRUNE_INCOMPLETE');
    const plan = await open().planRetention(policy);
    expect(plan).toEqual([expect.objectContaining({ taskId: 'old1', action: 'prune', reason: expect.stringMatching(/interrupted/) })]);
    const report = await open().applyRetention(policy);
    expect(report.applied).toEqual([expect.objectContaining({ taskId: 'old1', action: 'prune' })]);
    expect(loose(dir, 'old1')).toEqual([]);
    expect((await open().verify('old1'))[0]).toMatchObject({ ok: true, status: 'pruned', diagnostics: [] });
    expect(await open().planRetention(policy)).toEqual([]); // nothing left to do
  });

  it('a finished prune is not re-planned, and an unfinished one is never started for a task that is not eligible', async () => {
    const { open, clock, rt } = setup();
    await finishedTask(rt, clock, 'old1');
    await rt.createTask({ taskId: 'live1', kind: 'k', goal: 'g' });
    await expect(rt.pruneTask('live1', policy)).rejects.toBeInstanceOf(RetentionRefusedError);
    await rt.pruneTask('old1', policy);
    expect(await open().planRetention(policy)).toEqual([expect.objectContaining({ taskId: 'live1', action: 'keep' })]);
    expect((await open().getState('live1')).status).toBe('active');
  });

  it('concurrent finishers are safe', async () => {
    const { dir, open, clock, rt } = setup();
    await finishedTask(rt, clock, 'old1');
    chmodSync(eventsDir(dir, 'old1'), 0o555);
    await expect(rt.pruneTask('old1', policy)).rejects.toBeInstanceOf(StoreIoError);
    chmodSync(eventsDir(dir, 'old1'), 0o755);
    const outs = await Promise.all([open().pruneTask('old1', policy), open().pruneTask('old1', policy), open().pruneTask('old1', policy)]);
    expect(new Set(outs.map((t) => t.headHash)).size).toBe(1);
    expect(loose(dir, 'old1')).toEqual([]);
  });
});
