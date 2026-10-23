import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startMission, listMissions, getMission, finishMission } from './mission.js';
import { trustedDirectoryTarget } from './state-keeper.js';
import { MissionNotFoundError, InvalidTransitionError, ValidationError } from './errors.js';
import { runMissionStart, runMissionList, runMissionShow, runMissionFinish } from './cli.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coordinatorium-mission-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('startMission', () => {
  it('registers a mission as in_progress with a generated id', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'Implement State Keeper', system: 'coordinatorium' });
    expect(mission.id).toBe('MIS-0001');
    expect(mission.status).toBe('in_progress');
    expect(mission.summary).toBeNull();
    expect(mission.startedAt).toBe(mission.updatedAt);
  });

  it('generates unique, incrementing ids across sequential calls', async () => {
    const dir = makeTempDir();
    const a = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const b = await startMission(trustedDirectoryTarget(dir), { title: 'B', system: 's' });
    const c = await startMission(trustedDirectoryTarget(dir), { title: 'C', system: 's' });
    expect([a.id, b.id, c.id]).toEqual(['MIS-0001', 'MIS-0002', 'MIS-0003']);
  });

  it('allows multiple concurrent (in_progress) missions at once', async () => {
    const dir = makeTempDir();
    await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's1' });
    await startMission(trustedDirectoryTarget(dir), { title: 'B', system: 's2' });
    const all = await listMissions(dir);
    expect(all.filter((m) => m.status === 'in_progress')).toHaveLength(2);
  });

  it('rejects an empty title or system', async () => {
    const dir = makeTempDir();
    await expect(startMission(trustedDirectoryTarget(dir), { title: '', system: 's' })).rejects.toBeInstanceOf(ValidationError);
    await expect(startMission(trustedDirectoryTarget(dir), { title: 't', system: '   ' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('listMissions', () => {
  it('returns an empty list for a project with no missions', async () => {
    const dir = makeTempDir();
    expect(await listMissions(dir)).toEqual([]);
  });

  it('distinguishes active from finished missions', async () => {
    const dir = makeTempDir();
    const a = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const b = await startMission(trustedDirectoryTarget(dir), { title: 'B', system: 's' });
    await finishMission(trustedDirectoryTarget(dir), a.id, { result: 'completed' });

    const all = await listMissions(dir);
    const active = all.filter((m) => m.status === 'in_progress');
    const finished = all.filter((m) => m.status !== 'in_progress');
    expect(active.map((m) => m.id)).toEqual([b.id]);
    expect(finished.map((m) => m.id)).toEqual([a.id]);
  });
});

describe('getMission', () => {
  it('returns full mission details', async () => {
    const dir = makeTempDir();
    const started = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const fetched = await getMission(dir, started.id);
    expect(fetched).toEqual(started);
  });

  it('throws MissionNotFoundError for an unknown id', async () => {
    const dir = makeTempDir();
    await expect(getMission(dir, 'MIS-9999')).rejects.toBeInstanceOf(MissionNotFoundError);
  });
});

describe('finishMission', () => {
  it('completes a mission', async () => {
    const dir = makeTempDir();
    const m = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const finished = await finishMission(trustedDirectoryTarget(dir), m.id, { result: 'completed', summary: 'done' });
    expect(finished.status).toBe('completed');
    expect(finished.summary).toBe('done');
  });

  it('fails a mission', async () => {
    const dir = makeTempDir();
    const m = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const finished = await finishMission(trustedDirectoryTarget(dir), m.id, { result: 'failed' });
    expect(finished.status).toBe('failed');
  });

  it('cancels a mission', async () => {
    const dir = makeTempDir();
    const m = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const finished = await finishMission(trustedDirectoryTarget(dir), m.id, { result: 'cancelled' });
    expect(finished.status).toBe('cancelled');
  });

  it('rejects an invalid transition on an already-terminal mission', async () => {
    const dir = makeTempDir();
    const m = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    await finishMission(trustedDirectoryTarget(dir), m.id, { result: 'completed' });
    await expect(finishMission(trustedDirectoryTarget(dir), m.id, { result: 'failed' })).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('rejects an unknown mission id', async () => {
    const dir = makeTempDir();
    await expect(finishMission(trustedDirectoryTarget(dir), 'MIS-9999', { result: 'completed' })).rejects.toBeInstanceOf(MissionNotFoundError);
  });

  it('rejects an invalid result value', async () => {
    const dir = makeTempDir();
    const m = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    // @ts-expect-error — deliberately invalid at the runtime boundary
    await expect(finishMission(trustedDirectoryTarget(dir), m.id, { result: 'bogus' })).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// CLI integration — exercises the actual command handlers (arg parsing +
// dispatch), the same code path `monolith mission ...` runs through.
// ---------------------------------------------------------------------------

describe('CLI integration', () => {
  it('start / list / show / finish round-trip through the CLI handlers', async () => {
    const dir = makeTempDir();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg);
    });

    try {
      await runMissionStart(['--title', 'Ship Coordinatorium', '--system', 'coordinatorium'], dir);
      const startedLine = logs.find((l) => l.startsWith('Started mission'));
      expect(startedLine).toBeDefined();
      const id = startedLine!.split(' ')[2];

      logs.length = 0;
      await runMissionList([], dir);
      expect(logs.join('\n')).toContain(id);

      logs.length = 0;
      await runMissionShow([id], dir);
      expect(logs.join('\n')).toContain('in_progress');

      logs.length = 0;
      await runMissionFinish([id, '--result', 'completed'], dir);
      expect(logs.join('\n')).toContain('finished as completed');
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects start without required flags', async () => {
    const dir = makeTempDir();
    await expect(runMissionStart([], dir)).rejects.toThrow(/Usage: monolith mission start/);
  });

  it('rejects show for an unknown id with a clear error', async () => {
    const dir = makeTempDir();
    await expect(runMissionShow(['MIS-9999'], dir)).rejects.toBeInstanceOf(MissionNotFoundError);
  });
});
