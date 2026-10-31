/**
 * DURABLE-SEC-001. A prune fails closed over hostile residue that is already in place (static, not a concurrent swap:
 * TM-C is out of scope, ADR-013): a non-regular entry among the events makes the log unverifiable, so the prune is refused
 * before anything is written, nothing is unlinked, and nothing outside the store is touched.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FsEventStore } from './fs-store.js';
import { stampEvent } from './log.js';
import { tombstoneFor } from './prune-check.js';
import { foldEvents } from './projection.js';
import { GENESIS_HASH, type TaskEvent } from './types.js';
import { StoreSecurityError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'durable-hostile-'));
  dirs.push(d);
  return d;
};

function finished(taskId: string): TaskEvent[] {
  const created = stampEvent(taskId, 1, '2026-01-01T00:00:01.000Z', GENESIS_HASH, {
    type: 'task.created', actor: null, data: { kind: 'k', goal: 'g', input: null, parentTaskId: null, dependsOn: [], labels: {} },
  });
  const done = stampEvent(taskId, 2, '2026-01-01T00:00:02.000Z', created.hash, { type: 'task.completed', actor: 'x', data: { result: { ok: true } } });
  return [created, done];
}

async function storeWithFinishedTask(root: string, id: string): Promise<{ store: FsEventStore; evs: TaskEvent[] }> {
  const store = new FsEventStore({ target: { scope: 'trusted-directory', dir: root }, durability: 'file' });
  store.initializeProtocolSync();
  const evs = finished(id);
  for (const e of evs) expect(await store.append(e)).toBe('appended');
  return { store, evs };
}

describe('prune over pre-existing hostile entries', () => {
  /** every file below `dir` with its bytes: equal snapshots mean nothing was created, changed or removed. */
  const snapshot = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(`${p}:${e.isSymbolicLink() ? 'link' : readFileSync(p, 'utf8')}`);
      }
    };
    walk(dir);
    return out.sort();
  };

  it('a symlink entry named like an event is refused: not followed, not removed, no register residue', async () => {
    const root = newDir();
    const outside = newDir();
    writeFileSync(join(outside, 'victim.txt'), 'precious');
    const { store, evs } = await storeWithFinishedTask(join(root, 'store'), 'tsk');
    symlinkSync(join(outside, 'victim.txt'), join(root, 'store', 'tasks', 'tsk', 'events', '000000009.json'));
    const before = snapshot(root);

    await expect(store.prune(tombstoneFor(foldEvents(evs), 'c'))).rejects.toBeInstanceOf(StoreSecurityError);

    expect(snapshot(root)).toEqual(before);
    expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('precious');
  });

  it('a directory entry named like an event is refused and left in place', async () => {
    const root = newDir();
    const { store, evs } = await storeWithFinishedTask(join(root, 'store'), 'tsk');
    const eventsDir = join(root, 'store', 'tasks', 'tsk', 'events');
    mkdirSync(join(eventsDir, '000000007.json'));
    writeFileSync(join(eventsDir, '000000007.json', 'inner'), 'keep');
    const before = snapshot(root);

    await expect(store.prune(tombstoneFor(foldEvents(evs), 'c'))).rejects.toBeInstanceOf(StoreSecurityError);

    expect(snapshot(root)).toEqual(before);
    expect(existsSync(join(eventsDir, '000000007.json', 'inner'))).toBe(true);
  });

  it('an events directory that is a symlink out of the store is refused and nothing outside is touched', async () => {
    const root = newDir();
    const outside = newDir();
    writeFileSync(join(outside, '000000001.json'), 'precious');
    const { store, evs } = await storeWithFinishedTask(join(root, 'store'), 'tsk');
    const eventsDir = join(root, 'store', 'tasks', 'tsk', 'events');
    rmSync(eventsDir, { recursive: true });
    symlinkSync(outside, eventsDir);

    await expect(store.prune(tombstoneFor(foldEvents(evs), 'c'))).rejects.toBeInstanceOf(StoreSecurityError);
    expect(readFileSync(join(outside, '000000001.json'), 'utf8')).toBe('precious');
  });
});
