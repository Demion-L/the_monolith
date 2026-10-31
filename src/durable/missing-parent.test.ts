/**
 * DURABLE-SEC-007B / SEC-007A-F1 — ADR-018 D2 (C-9): a required task whose directory is MISSING is not GONE. The child
 * stays active, is refused execution, and nothing irreversible (`task.cancelled`) is written on the strength of a
 * missing directory alone. The directory is removed from the real filesystem, not simulated.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { TaskOrphanedError } from './errors.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'durable-missing-parent-'));
  dirs.push(dir);
  const mkStore = (): FsEventStore => {
    const s = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
    s.initializeProtocolSync();
    return s;
  };
  const store = mkStore();
  const rt = new DurableTasks({ store });
  const types = async (id: string): Promise<string[]> => (await store.readLog(id)).events.map((e) => e.type);
  return { dir, store, rt, mkStore, types, removeTask: (id: string) => rmSync(join(dir, 'tasks', id), { recursive: true, force: true }) };
}

async function parentAndActiveChild(s: ReturnType<typeof setup>, dependsOn: string[] = []): Promise<void> {
  await s.rt.createTask({ taskId: 'P', kind: 'k', goal: 'g' });
  await s.rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', parentTaskId: 'P', ...(dependsOn.length ? { dependsOn } : {}) });
}

describe('SEC-007A-F1: a MISSING required task blocks execution and cancels nothing', () => {
  it('T1/T2: claim of an active child is refused, no task.cancelled, no run.claimed (fence)', async () => {
    const s = setup();
    await parentAndActiveChild(s);
    const before = await s.types('C');
    s.removeTask('P');
    const err = await s.rt.claim('C', { owner: 'w' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(TaskOrphanedError);
    expect(await s.types('C')).toEqual(before);
    expect(await s.types('C')).not.toContain('task.cancelled');
    expect(await s.types('C')).not.toContain('run.claimed');
    expect((await s.rt.refresh('C')).status).toBe('active');
  });

  it('T2: the refusal repeats; repeated calls write nothing', async () => {
    const s = setup();
    await parentAndActiveChild(s);
    s.removeTask('P');
    for (let i = 0; i < 3; i++) await expect(s.rt.claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
    expect(await s.types('C')).toEqual(['task.created']);
  });

  it('T3: findResumable does not offer the child and writes nothing', async () => {
    const s = setup();
    await parentAndActiveChild(s);
    s.removeTask('P');
    expect((await s.rt.findResumable()).map((r) => r.taskId)).not.toContain('C');
    expect(await s.types('C')).toEqual(['task.created']);
  });

  it('T4: assess / resumePacket report not claimable and write nothing', async () => {
    const s = setup();
    await parentAndActiveChild(s);
    s.removeTask('P');
    const a = await s.rt.assess('C');
    expect(a.claimable).toBe(false);
    expect(a.reasons.some((r) => r.code === 'REQUIRED_TASK_GONE' && r.refs?.includes('P'))).toBe(true);
    expect((await s.rt.resumePacket('C')).assessment.claimable).toBe(false);
    expect(await s.types('C')).toEqual(['task.created']);
  });

  it('a missing dependsOn requirement behaves the same as a missing parent', async () => {
    const s = setup();
    await s.rt.createTask({ taskId: 'D', kind: 'k', goal: 'g' });
    await s.rt.createTask({ taskId: 'C', kind: 'k', goal: 'g', dependsOn: ['D'] });
    s.removeTask('D');
    await expect(s.rt.claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
    expect(await s.types('C')).toEqual(['task.created']);
  });

  it('T5: the parent becomes visible again => the child is claimable; nothing was lost', async () => {
    const s = setup();
    await parentAndActiveChild(s);
    const backup = mkdtempSync(join(tmpdir(), 'durable-missing-parent-bak-'));
    dirs.push(backup);
    cpSync(join(s.dir, 'tasks', 'P'), join(backup, 'P'), { recursive: true });
    s.removeTask('P');
    await expect(s.rt.claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
    cpSync(join(backup, 'P'), join(s.dir, 'tasks', 'P'), { recursive: true });
    const fence = await new DurableTasks({ store: s.mkStore() }).claim('C', { owner: 'w' });
    expect(fence.taskId).toBe('C');
    expect(await s.types('C')).toEqual(['task.created', 'run.claimed']);
  });

  it('T9: a restarted runtime still refuses and still writes nothing', async () => {
    const s = setup();
    await parentAndActiveChild(s);
    s.removeTask('P');
    await expect(s.rt.claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
    const restarted = new DurableTasks({ store: s.mkStore() });
    await expect(restarted.claim('C', { owner: 'w' })).rejects.toBeInstanceOf(TaskOrphanedError);
    expect((await restarted.findResumable()).map((r) => r.taskId)).not.toContain('C');
    expect(await s.types('C')).toEqual(['task.created']);
  });
});
