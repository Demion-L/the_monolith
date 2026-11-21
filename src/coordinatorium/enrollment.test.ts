import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveStateLocation, stateReadTargetOf, stateWriteTargetOf } from './state-location.js';
import { enrollMission, handoffMission, currentMissions } from './enrollment.js';
import { deriveExecutionContext, describeOwnership } from './context.js';
import { startMission, finishMission, listMissions } from './mission.js';
import { createCheckpoint, listCheckpoints } from './checkpoint.js';
import { MissionOwnershipError } from './errors.js';
import { readExecutionConfig } from './execution-config.js';

let base: string;
let main: string;
let wtB: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}
const writeTarget = (dir: string) => stateWriteTargetOf(resolveStateLocation(dir));
const readTarget = (dir: string) => stateReadTargetOf(resolveStateLocation(dir));
const ctx = (dir: string, extra: { sessionId?: string; agent?: string; storyId?: string } = {}) =>
  deriveExecutionContext(dir, { agent: extra.agent ?? 'claude-code', source: 'test', ...extra });

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'monolith-enroll-')));
  main = join(base, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  writeFileSync(join(main, 'a.txt'), 'x');
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'init');
  wtB = join(base, 'wt-b');
  git(main, 'worktree', 'add', '-q', '-b', 'feature-b', wtB);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('enrollMission', () => {
  it('SKIPPED for reading: no state is created', async () => {
    const r = await enrollMission(writeTarget(main), { ...ctx(main), intent: 'read' });
    expect(r.status).toBe('SKIPPED');
    expect(await listMissions(readTarget(main))).toEqual([]);
  });

  it('CREATED on the first implementation action, REUSED on the next ones (one mission)', async () => {
    const a = await enrollMission(writeTarget(main), ctx(main, { sessionId: 's1' }));
    expect(a).toMatchObject({ status: 'CREATED', missionId: 'MIS-0001' });
    for (let i = 0; i < 3; i++) {
      expect(await enrollMission(writeTarget(main), ctx(main, { sessionId: 's1' }))).toMatchObject({ status: 'REUSED', missionId: 'MIS-0001' });
    }
    const all = await listMissions(readTarget(main));
    expect(all).toHaveLength(1);
    expect(all[0].owner).toMatchObject({ agent: 'claude-code', worktree: main, sessionId: 's1', branch: 'main' });
    expect(all[0].status).toBe('in_progress');
    expect(all[0].summary).toBeNull();
    expect(await listCheckpoints(readTarget(main), 'MIS-0001')).toEqual([]); // nothing invented
  });

  it('a restarted session (new session id, same context) resumes the same mission', async () => {
    await enrollMission(writeTarget(main), ctx(main, { sessionId: 's1' }));
    const r = await enrollMission(writeTarget(main), ctx(main, { sessionId: 's2' }));
    expect(r).toMatchObject({ status: 'REUSED', missionId: 'MIS-0001', resumedFromSession: 's1' });
    expect((await listMissions(readTarget(main)))).toHaveLength(1);
  });

  it('two linked worktrees get independent missions in one shared state with unique ids', async () => {
    const a = await enrollMission(writeTarget(main), ctx(main));
    const b = await enrollMission(writeTarget(wtB), ctx(wtB));
    expect([a.missionId, b.missionId]).toEqual(['MIS-0001', 'MIS-0002']);
    expect((await listMissions(readTarget(main))).map((m) => m.owner?.worktree)).toEqual([main, wtB]);
    expect((await listMissions(readTarget(wtB)))).toHaveLength(2);
  });

  it('eight concurrent enrollments of one identity create exactly one mission', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => enrollMission(writeTarget(main), ctx(main, { sessionId: 's1' }))));
    expect(results.filter((r) => r.status === 'CREATED')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'REUSED')).toHaveLength(7);
    expect(new Set(results.map((r) => r.missionId)).size).toBe(1);
    expect(await listMissions(readTarget(main))).toHaveLength(1);
  });

  it('concurrent enrollments of different contexts lose nothing and never collide on ids', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => enrollMission(writeTarget(main), ctx(main))),
      ...Array.from({ length: 4 }, () => enrollMission(writeTarget(wtB), ctx(wtB))),
    ]);
    expect(results.filter((r) => r.status === 'CREATED')).toHaveLength(2);
    const ids = (await listMissions(readTarget(main))).map((m) => m.id);
    expect(ids.sort()).toEqual(['MIS-0001', 'MIS-0002']);
  });

  it('never joins a manual mission or another context\'s mission', async () => {
    const manual = await startMission(writeTarget(main), { title: 'manual', system: 's' });
    const r = await enrollMission(writeTarget(main), ctx(main));
    expect(r.status).toBe('CREATED');
    expect(r.missionId).not.toBe(manual.id);
    const manualAfter = (await listMissions(readTarget(main))).find((m) => m.id === manual.id);
    expect(manualAfter?.owner).toBeUndefined(); // legacy mission untouched
  });

  it('CONFLICT when ownership is ambiguous or a different story is requested', async () => {
    await enrollMission(writeTarget(main), ctx(main, { storyId: 'STORY-1' }));
    const other = await enrollMission(writeTarget(main), ctx(main, { storyId: 'STORY-2' }));
    expect(other.status).toBe('CONFLICT');
    expect(other.candidates).toEqual(['MIS-0001']);
    expect(await enrollMission(writeTarget(main), ctx(main, { storyId: 'STORY-1' }))).toMatchObject({ status: 'REUSED', missionId: 'MIS-0001' });
    expect(await listMissions(readTarget(main))).toHaveLength(1);
  });

  it('UNAVAILABLE (never a throw) when the state cannot be used', async () => {
    const loc = resolveStateLocation(main);
    mkdirSync(loc.stateDir, { recursive: true });
    writeFileSync(loc.statePath, '{ not json');
    const r = await enrollMission(writeTarget(main), ctx(main));
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.missionId).toBeNull();
  });

  it('a crash leaves the mission in progress; the same context finds it again without a duplicate', async () => {
    await enrollMission(writeTarget(main), ctx(main, { sessionId: 'dead' }));
    // (process "crashes": nothing finishes the mission)
    const mine = await currentMissions(readTarget(main), ctx(main));
    expect(mine.map((m) => m.status)).toEqual(['in_progress']);
    const r = await enrollMission(writeTarget(main), ctx(main, { sessionId: 'new' }));
    expect(r).toMatchObject({ status: 'REUSED', missionId: 'MIS-0001' });
  });
});

describe('ownership', () => {
  it('rejects checkpoint and finish of another context\'s mission; the owner may', async () => {
    await enrollMission(writeTarget(main), ctx(main));
    await expect(finishMission(writeTarget(wtB), 'MIS-0001', { result: 'completed' }, ctx(wtB))).rejects.toBeInstanceOf(MissionOwnershipError);
    await expect(createCheckpoint(writeTarget(wtB), 'MIS-0001', { summary: 'x' }, ctx(wtB))).rejects.toBeInstanceOf(MissionOwnershipError);
    expect((await listMissions(readTarget(main)))[0].status).toBe('in_progress');
    await createCheckpoint(writeTarget(main), 'MIS-0001', { summary: 'done part' }, ctx(main));
    expect((await finishMission(writeTarget(main), 'MIS-0001', { result: 'completed' }, ctx(main))).status).toBe('completed');
  });

  it('legacy (unowned) missions stay unrestricted for any actor', async () => {
    await startMission(writeTarget(main), { title: 'm', system: 's' });
    await createCheckpoint(writeTarget(wtB), 'MIS-0001', { summary: 'ok' }, ctx(wtB));
    expect((await finishMission(writeTarget(wtB), 'MIS-0001', { result: 'completed' }, ctx(wtB))).status).toBe('completed');
  });

  it('library callers that pass no actor keep the old behaviour', async () => {
    await enrollMission(writeTarget(main), ctx(main));
    expect((await finishMission(writeTarget(wtB), 'MIS-0001', { result: 'cancelled' })).status).toBe('cancelled');
  });

  it('handoff is the only way across contexts; it records the previous owner and needs a reason', async () => {
    await enrollMission(writeTarget(main), ctx(main, { sessionId: 's1' }));
    await expect(handoffMission(writeTarget(wtB), 'MIS-0001', ctx(wtB), '  ')).rejects.toThrow(/reason/);
    const m = await handoffMission(writeTarget(wtB), 'MIS-0001', ctx(wtB), 'agent A crashed');
    expect(m.owner?.worktree).toBe(wtB);
    expect(m.owner?.previous).toMatchObject([{ worktree: main, sessionId: 's1', reason: 'agent A crashed' }]);
    await createCheckpoint(writeTarget(wtB), 'MIS-0001', { summary: 'continued' }, ctx(wtB));
    await expect(createCheckpoint(writeTarget(main), 'MIS-0001', { summary: 'x' }, ctx(main))).rejects.toBeInstanceOf(MissionOwnershipError);
  });

  it('liveness: only a vanished worktree is "confirmed orphaned"; silence is "unknown"', async () => {
    await enrollMission(writeTarget(wtB), ctx(wtB));
    const m = (await listMissions(readTarget(main)))[0];
    expect(describeOwnership(m, ctx(main))).toMatchObject({ relation: 'other-context', liveness: 'unknown' });
    expect(describeOwnership(m, ctx(wtB))).toMatchObject({ relation: 'this-context' });
    rmSync(wtB, { recursive: true, force: true });
    expect(describeOwnership(m, ctx(main))).toMatchObject({ liveness: 'confirmed-orphaned' });
    expect((await listMissions(readTarget(main)))[0].status).toBe('in_progress'); // never auto-closed
  });
});

describe('execution config', () => {
  it('defaults to off; managed only by explicit opt-in; invalid values are reported, not guessed', () => {
    expect(readExecutionConfig(main).mode).toBe('off');
    writeFileSync(join(main, 'monolith.config.json'), JSON.stringify({ execution: { mode: 'managed' } }));
    expect(readExecutionConfig(main)).toMatchObject({ mode: 'managed', onEnrollmentFailure: 'deny', status: 'ok' });
    writeFileSync(join(main, 'monolith.config.json'), JSON.stringify({ execution: { mode: 'strict' } }));
    expect(readExecutionConfig(main)).toMatchObject({ mode: 'off', status: 'invalid' });
    writeFileSync(join(main, 'monolith.config.json'), '{oops');
    expect(readExecutionConfig(main)).toMatchObject({ mode: 'off', status: 'unreadable' });
  });
});
