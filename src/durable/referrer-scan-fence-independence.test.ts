/**
 * DURABLE-SEC-007F — regression guard for DESIGN-004 §27, RS-2.
 *
 * RS-2: any non-terminal child that refers to P counts as an active referrer, whether or not it has a fence
 * (`run.claimed`), a pin, or a pin of any age. Restricting the scan to children that hold a fence lets a prune
 * delete a parent that a created, never-claimed child still needs.
 *
 * Why the store has no pins: `createTask` pins every reference and the pin stays until the parent is pruned, so on
 * a pin-capable store the pin scan alone would refuse the prune and mask a fence-dependent log scan. `pinReference`,
 * `listReferences` and the tombstone-withdraw seam are optional in `EventStore`; leaving them out is a legal store.
 * Then the scan of the published task logs is the only thing that can protect P — which is what RS-2 constrains.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { RetentionRefusedError } from './errors.js';
import type { EventStore } from './types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const DAY = 86_400_000;

/** A store that offers only the required operations: no pins, no tombstone-first prune. */
function withoutPins(inner: EventStore): EventStore {
  return {
    append: (e) => inner.append(e),
    readLog: (id, o) => inner.readLog(id, o),
    listTaskIds: () => inner.listTaskIds(),
    compact: (a, b, c) => inner.compact(a, b, c),
    prune: (t) => inner.prune(t),
  };
}

describe('RS-2: the referrer scan does not depend on a fence or a pin', () => {
  it('refuses to prune P while a created, never-claimed child C (no fence, no pin) refers to it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'durable-rs2-'));
    dirs.push(dir);
    const fs = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
    fs.initializeProtocolSync();
    let t = Date.parse('2026-03-01T00:00:00.000Z');
    const rt = new DurableTasks({ store: withoutPins(fs), now: () => new Date(t) });

    // P is finished and past retention: a legitimate prune candidate.
    await rt.createTask({ taskId: 'P', kind: 'k', goal: 'g' });
    await rt.complete(await rt.claim('P', { owner: 'w' }), { r: 1 });
    // C refers to P and is active, but nobody has claimed it.
    await rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P' });
    t += DAY;

    // The scenario really is "no fence, no pin": one event, epoch 0, nothing recorded under P/refs.
    const child = await rt.getLog('C');
    expect(child.events.map((e) => e.type)).toEqual(['task.created']);
    expect(child.state.epoch).toBe(0);
    expect(child.state.parentTaskId).toBe('P');
    expect(child.state.status).toBe('active');
    expect(await fs.listReferences('P')).toEqual([]); // no pin was ever written for C
    expect(existsSync(join(dir, 'tasks', 'P', 'refs'))).toBe(false);
    const eventsOfP = (await rt.getLog('P')).events.length;

    await expect(rt.pruneTask('P', { terminalRetentionMs: 0 })).rejects.toBeInstanceOf(RetentionRefusedError);

    // No prune side effects: P is still whole and not committed, no tombstone, data on disk.
    expect((await fs.pruneState('P')).kind).toBe('live');
    expect((await fs.readLog('P', { afterSeq: Number.MAX_SAFE_INTEGER })).tombstone ?? null).toBeNull();
    expect(existsSync(join(dir, 'tasks', 'P', 'events'))).toBe(true);
    expect(existsSync(join(dir, 'tasks', 'P', 'tombstone.json'))).toBe(false);
    const parent = await rt.getLog('P');
    expect(parent.state.status).toBe('completed');
    expect(parent.events).toHaveLength(eventsOfP);
    // C stays active and was not given a fence by the refused prune.
    const after = await rt.getLog('C');
    expect(after.state.status).toBe('active');
    expect(after.state.epoch).toBe(0);
    expect(after.events.map((e) => e.type)).toEqual(['task.created']);
  });
});
