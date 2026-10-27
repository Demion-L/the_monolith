import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runDurable, openDurable, initializeDurable } from './cli.js';

let proj: string;
beforeEach(() => {
  proj = mkdtempSync(join(tmpdir(), 'durable-cli-'));
  mkdirSync(join(proj, '.monolith'));
});
afterEach(() => rmSync(proj, { recursive: true, force: true }));

async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await runDurable(args, { cwd: proj, out: (s) => (out += `${s}\n`), err: (s) => (err += `${s}\n`) });
  return { code, out, err };
}

describe('monolith durable', () => {
  it('lists, shows, assesses and prints a resume packet', async () => {
    initializeDurable(proj);
    const rt = openDurable(proj);
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'w' });
    await rt.registerAwait(f, { awaitId: 'a', purpose: 'p' });
    await rt.release(f);

    const list = await cli('list');
    expect(list.code).toBe(0);
    expect(JSON.parse(list.out)).toMatchObject([{ taskId: 'job1', status: 'active', pendingAwaits: 1 }]);
    expect(JSON.parse((await cli('list', '--status', 'completed')).out)).toEqual([]);
    expect(JSON.parse((await cli('show', 'job1')).out)).toMatchObject({ taskId: 'job1', headSeq: 4 });
    expect(JSON.parse((await cli('assess', 'job1')).out)).toMatchObject({ taskId: 'job1', mode: expect.any(String) });
    expect(JSON.parse((await cli('packet', 'job1')).out)).toMatchObject({ formatVersion: 1, task: { taskId: 'job1' } });
  });

  it('reports usage errors and unknown tasks with exit code 1', async () => {
    expect((await cli('show')).code).toBe(1);
    expect((await cli('list', '--status', 'bogus')).code).toBe(1);
    expect((await cli('nope')).code).toBe(1);
    const r = await cli('show', 'ghost');
    expect(r.code).toBe(1);
    expect(r.err).toContain('TASK_NOT_FOUND');
  });

  it('verify exits 2 on a damaged log and names the task', async () => {
    initializeDurable(proj);
    const rt = openDurable(proj);
    await rt.createTask({ taskId: 'good', kind: 'k', goal: 'g' });
    await rt.createTask({ taskId: 'bad', kind: 'k', goal: 'g' });
    expect((await cli('verify')).code).toBe(0);
    const dir = join(proj, '.monolith', 'durable', 'tasks', 'bad', 'events');
    writeFileSync(join(dir, readdirSync(dir)[0] as string), '{}');
    const r = await cli('verify');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).map((x: { taskId: string; ok: boolean }) => [x.taskId, x.ok])).toEqual([['bad', false], ['good', true]]);
  });

  it('retention is a dry run unless --apply is given', async () => {
    initializeDurable(proj);
    const rt = openDurable(proj);
    await rt.createTask({ taskId: 'old', kind: 'k', goal: 'g' });
    const f = await rt.claim('old', { owner: 'w' });
    await rt.complete(f, {});
    const dry = await cli('retention', '--retain-days', '0');
    expect(JSON.parse(dry.out)).toMatchObject({ dryRun: true, decisions: [{ taskId: 'old', action: 'prune' }] });
    expect(JSON.parse((await cli('show', 'old')).out).status).toBe('completed'); // untouched
    const applied = await cli('retention', '--retain-days', '0', '--apply');
    expect(JSON.parse(applied.out).applied).toMatchObject([{ taskId: 'old', action: 'prune' }]);
    expect((await cli('show', 'old')).err).toContain('TASK_PRUNED');
    expect((await cli('retention')).code).toBe(1);
  });

  it('refuses a monolithRoot that escapes the project through a symlink', async () => {
    rmSync(join(proj, '.monolith'), { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), 'durable-cli-out-'));
    try {
      symlinkSync(outside, join(proj, '.monolith'));
      expect(() => openDurable(proj)).toThrow(/ROOT_SYMLINK_ESCAPE/);
      expect((await cli('list')).code).toBe(1);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a symlink inside the project too (writes never follow links)', async () => {
    mkdirSync(join(proj, 'elsewhere'));
    symlinkSync(join(proj, 'elsewhere'), join(proj, '.monolith', 'durable'));
    const rt = openDurable(proj);
    await expect(rt.createTask({ taskId: 'x', kind: 'k', goal: 'g' })).rejects.toMatchObject({ code: 'STORE_SECURITY' });
    expect(readdirSync(join(proj, 'elsewhere'))).toEqual([]);
  });
});
