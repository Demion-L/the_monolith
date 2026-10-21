import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ts from 'typescript';
import { createCheckpoint, listCheckpoints, getCheckpoint } from './checkpoint.js';
import { startMission, finishMission } from './mission.js';
import { readState, stateFilePath } from './state-keeper.js';
import { createInitialState } from './types.js';
import {
  MissionNotFoundError,
  MissionNotActiveError,
  CheckpointNotFoundError,
  ValidationError,
} from './errors.js';
import { runMissionCheckpoint, runMissionCheckpoints, runMissionStart, runMissionFinish } from './cli.js';
import * as checkpointModule from './checkpoint.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coordinatorium-checkpoint-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// createCheckpoint
// ---------------------------------------------------------------------------

describe('createCheckpoint', () => {
  it('appends a well-formed checkpoint for an active mission', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    const checkpoint = await createCheckpoint(dir, mission.id, {
      summary: 'Did the thing',
      remainingSteps: ['step one', 'step two'],
      context: 'extra context',
    });

    expect(checkpoint.id).toBe(`${mission.id}-CKPT-0001`);
    expect(checkpoint.missionId).toBe(mission.id);
    expect(checkpoint.summary).toBe('Did the thing');
    expect(checkpoint.remainingSteps).toEqual(['step one', 'step two']);
    expect(checkpoint.context).toBe('extra context');
    expect(typeof checkpoint.createdAt).toBe('string');
  });

  it('defaults remainingSteps to [] and context to null when omitted', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    const checkpoint = await createCheckpoint(dir, mission.id, { summary: 'minimal' });
    expect(checkpoint.remainingSteps).toEqual([]);
    expect(checkpoint.context).toBeNull();
  });

  it('creates multiple checkpoints for one mission with sequential per-mission ordinals', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    const c1 = await createCheckpoint(dir, mission.id, { summary: 'first' });
    const c2 = await createCheckpoint(dir, mission.id, { summary: 'second' });
    const c3 = await createCheckpoint(dir, mission.id, { summary: 'third' });
    expect([c1.id, c2.id, c3.id]).toEqual([
      `${mission.id}-CKPT-0001`,
      `${mission.id}-CKPT-0002`,
      `${mission.id}-CKPT-0003`,
    ]);
  });

  it('numbers checkpoints independently per mission', async () => {
    const dir = makeTempDir();
    const a = await startMission(dir, { title: 'A', system: 's' });
    const b = await startMission(dir, { title: 'B', system: 's' });

    await createCheckpoint(dir, a.id, { summary: 'a1' });
    const aC2 = await createCheckpoint(dir, a.id, { summary: 'a2' });
    const bC1 = await createCheckpoint(dir, b.id, { summary: 'b1' });

    expect(aC2.id).toBe(`${a.id}-CKPT-0002`);
    expect(bC1.id).toBe(`${b.id}-CKPT-0001`); // independent numbering, not a global counter
  });

  it('increments revision by exactly 1 per successful checkpoint creation', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' }); // revision 1
    await createCheckpoint(dir, mission.id, { summary: 'c1' }); // revision 2
    const state = await readState(dir);
    expect(state.revision).toBe(2);
    await createCheckpoint(dir, mission.id, { summary: 'c2' }); // revision 3
    expect((await readState(dir)).revision).toBe(3);
  });

  it('rejects an unknown missionId with MissionNotFoundError', async () => {
    const dir = makeTempDir();
    await expect(createCheckpoint(dir, 'MIS-9999', { summary: 'x' })).rejects.toBeInstanceOf(MissionNotFoundError);
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'rejects checkpoint creation against a %s mission with MissionNotActiveError',
    async (resultStatus) => {
      const dir = makeTempDir();
      const mission = await startMission(dir, { title: 'A', system: 's' });
      await finishMission(dir, mission.id, { result: resultStatus });
      await expect(createCheckpoint(dir, mission.id, { summary: 'x' })).rejects.toBeInstanceOf(
        MissionNotActiveError,
      );
    },
  );

  it('rejects an empty or whitespace-only summary', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    await expect(createCheckpoint(dir, mission.id, { summary: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCheckpoint(dir, mission.id, { summary: '   ' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a remainingSteps element that is empty/whitespace-only', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    await expect(
      createCheckpoint(dir, mission.id, { summary: 'x', remainingSteps: ['ok', '   '] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects remainingSteps that is not an array', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    // @ts-expect-error — deliberately invalid at the runtime boundary
    await expect(createCheckpoint(dir, mission.id, { summary: 'x', remainingSteps: 'nope' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a summary exceeding the max length', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    await expect(createCheckpoint(dir, mission.id, { summary: 'x'.repeat(5000) })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a context exceeding the max length', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    await expect(
      createCheckpoint(dir, mission.id, { summary: 'x', context: 'y'.repeat(5000) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects more than the maximum number of remainingSteps', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    await expect(
      createCheckpoint(dir, mission.id, { summary: 'x', remainingSteps: Array.from({ length: 51 }, (_, i) => `s${i}`) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// listCheckpoints / getCheckpoint
// ---------------------------------------------------------------------------

describe('listCheckpoints', () => {
  it('returns [] for a mission with no checkpoints yet, without throwing', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    expect(await listCheckpoints(dir, mission.id)).toEqual([]);
  });

  it('returns only the requested mission checkpoints, chronologically', async () => {
    const dir = makeTempDir();
    const a = await startMission(dir, { title: 'A', system: 's' });
    const b = await startMission(dir, { title: 'B', system: 's' });
    const a1 = await createCheckpoint(dir, a.id, { summary: 'a1' });
    await createCheckpoint(dir, b.id, { summary: 'b1' });
    const a2 = await createCheckpoint(dir, a.id, { summary: 'a2' });

    const listed = await listCheckpoints(dir, a.id);
    expect(listed.map((c) => c.id)).toEqual([a1.id, a2.id]);
  });

  it('remains available for a completed mission', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    await createCheckpoint(dir, mission.id, { summary: 'before finish' });
    await finishMission(dir, mission.id, { result: 'completed' });
    const listed = await listCheckpoints(dir, mission.id);
    expect(listed).toHaveLength(1);
  });
});

describe('getCheckpoint', () => {
  it('reads a checkpoint by id', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    const created = await createCheckpoint(dir, mission.id, { summary: 'x' });
    const fetched = await getCheckpoint(dir, created.id);
    expect(fetched).toEqual(created);
  });

  it('throws CheckpointNotFoundError for an unknown id', async () => {
    const dir = makeTempDir();
    await expect(getCheckpoint(dir, 'MIS-0001-CKPT-0001')).rejects.toBeInstanceOf(CheckpointNotFoundError);
  });

  it('remains readable for a checkpoint belonging to a completed mission', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    const created = await createCheckpoint(dir, mission.id, { summary: 'x' });
    await finishMission(dir, mission.id, { result: 'completed' });
    const fetched = await getCheckpoint(dir, created.id);
    expect(fetched).toEqual(created);
  });
});

// ---------------------------------------------------------------------------
// Append-only: no update/delete path exists
// ---------------------------------------------------------------------------

describe('append-only semantics', () => {
  it('exposes no updateCheckpoint or deleteCheckpoint export', () => {
    expect((checkpointModule as Record<string, unknown>).updateCheckpoint).toBeUndefined();
    expect((checkpointModule as Record<string, unknown>).deleteCheckpoint).toBeUndefined();
  });

  it('a checkpoint is byte-identical on repeated reads — nothing mutates it in place', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    const created = await createCheckpoint(dir, mission.id, { summary: 'x', remainingSteps: ['a'] });
    const read1 = await getCheckpoint(dir, created.id);
    const read2 = await getCheckpoint(dir, created.id);
    expect(read1).toEqual(created);
    expect(read2).toEqual(created);
  });
});

// ---------------------------------------------------------------------------
// Round-trip serialization
// ---------------------------------------------------------------------------

describe('round-trip serialization', () => {
  it('persists the exact checkpoint shape to state.json and reads it back identically', async () => {
    const dir = makeTempDir();
    const mission = await startMission(dir, { title: 'A', system: 's' });
    const created = await createCheckpoint(dir, mission.id, {
      summary: 'roundtrip',
      remainingSteps: ['x', 'y'],
      context: 'ctx',
    });

    const onDisk = JSON.parse(readFileSync(stateFilePath(dir), 'utf8'));
    expect(onDisk.tactical.checkpoints[created.id]).toEqual(created);

    const reRead = await getCheckpoint(dir, created.id);
    expect(reRead).toEqual(created);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: old state.json without tactical.checkpoints
// ---------------------------------------------------------------------------

describe('backward compatibility with pre-COORDINATORIUM-002 state.json', () => {
  it('readState defaults tactical.checkpoints to {} when the key is entirely absent', async () => {
    const dir = makeTempDir();
    const legacyState = createInitialState() as unknown as { tactical: { missions: unknown; checkpoints?: unknown } };
    legacyState.tactical.missions = {
      'MIS-0001': {
        id: 'MIS-0001',
        title: 'Legacy mission',
        system: 'coordinatorium',
        status: 'in_progress',
        startedAt: '2026-10-21T00:00:00.000Z',
        updatedAt: '2026-10-21T00:00:00.000Z',
        summary: null,
      },
    };
    delete legacyState.tactical.checkpoints;
    writeFileSync(stateFilePath(dir), JSON.stringify(legacyState, null, 2), 'utf8');

    const state = await readState(dir);
    expect(state.tactical.checkpoints).toEqual({});
    expect(await listCheckpoints(dir, 'MIS-0001')).toEqual([]);
  });

  it('createCheckpoint works against a legacy file missing tactical.checkpoints', async () => {
    const dir = makeTempDir();
    const legacyState = createInitialState() as unknown as { tactical: { missions: unknown; checkpoints?: unknown } };
    legacyState.tactical.missions = {
      'MIS-0001': {
        id: 'MIS-0001',
        title: 'Legacy mission',
        system: 'coordinatorium',
        status: 'in_progress',
        startedAt: '2026-10-21T00:00:00.000Z',
        updatedAt: '2026-10-21T00:00:00.000Z',
        summary: null,
      },
    };
    delete legacyState.tactical.checkpoints;
    writeFileSync(stateFilePath(dir), JSON.stringify(legacyState, null, 2), 'utf8');

    const checkpoint = await createCheckpoint(dir, 'MIS-0001', { summary: 'first ever checkpoint' });
    expect(checkpoint.id).toBe('MIS-0001-CKPT-0001');

    const state = await readState(dir);
    expect(state.tactical.checkpoints[checkpoint.id]).toEqual(checkpoint);
  });
});

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

/**
 * Starts a mission through the actual CLI handler (not the domain function
 * directly) so the returned id lives under the same resolved state
 * directory (`<dir>/.monolith`, via stateDirFor) that the checkpoint CLI
 * commands under test will themselves resolve to.
 */
async function startMissionViaCli(dir: string): Promise<string> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    logs.push(msg);
  });
  try {
    await runMissionStart(['--title', 'A', '--system', 's'], dir);
  } finally {
    spy.mockRestore();
  }
  const startedLine = logs.find((l) => l.startsWith('Started mission'));
  if (!startedLine) throw new Error('mission was not started via CLI');
  return startedLine.split(' ')[2];
}

describe('CLI integration', () => {
  it('runMissionCheckpoint creates a checkpoint and prints it', async () => {
    const dir = makeTempDir();
    const missionId = await startMissionViaCli(dir);
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg);
    });
    try {
      await runMissionCheckpoint(
        [missionId, '--summary', 'Made progress', '--remaining', 'step 1', '--remaining', 'step 2', '--context', 'ctx'],
        dir,
      );
      const joined = logs.join('\n');
      expect(joined).toContain(`Created checkpoint ${missionId}-CKPT-0001`);
      expect(joined).toContain('Made progress');
      expect(joined).toContain('step 1');
      expect(joined).toContain('step 2');
      expect(joined).toContain('ctx');
    } finally {
      spy.mockRestore();
    }
  });

  it('runMissionCheckpoint rejects missing required flags with a usage error', async () => {
    const dir = makeTempDir();
    const missionId = await startMissionViaCli(dir);
    await expect(runMissionCheckpoint([missionId], dir)).rejects.toThrow(/Usage: monolith mission checkpoint/);
    await expect(runMissionCheckpoint([], dir)).rejects.toThrow(/Usage: monolith mission checkpoint/);
  });

  it('runMissionCheckpoint surfaces MissionNotFoundError for an unknown mission', async () => {
    const dir = makeTempDir();
    await expect(
      runMissionCheckpoint(['MIS-9999', '--summary', 'x'], dir),
    ).rejects.toBeInstanceOf(MissionNotFoundError);
  });

  it('runMissionCheckpoint surfaces MissionNotActiveError for a finished mission', async () => {
    const dir = makeTempDir();
    const missionId = await startMissionViaCli(dir);
    const spy0 = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runMissionFinish([missionId, '--result', 'completed'], dir);
    } finally {
      spy0.mockRestore();
    }
    await expect(
      runMissionCheckpoint([missionId, '--summary', 'x'], dir),
    ).rejects.toBeInstanceOf(MissionNotActiveError);
  });

  it('runMissionCheckpoints lists checkpoints for a mission', async () => {
    const dir = makeTempDir();
    const missionId = await startMissionViaCli(dir);
    const spy0 = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runMissionCheckpoint([missionId, '--summary', 'first'], dir);
      await runMissionCheckpoint([missionId, '--summary', 'second'], dir);
    } finally {
      spy0.mockRestore();
    }

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg);
    });
    try {
      await runMissionCheckpoints([missionId], dir);
      const joined = logs.join('\n');
      expect(joined).toContain('Checkpoints for mission');
      expect(joined).toContain('first');
      expect(joined).toContain('second');
    } finally {
      spy.mockRestore();
    }
  });

  it('runMissionCheckpoints reports no checkpoints for a mission with none yet', async () => {
    const dir = makeTempDir();
    const missionId = await startMissionViaCli(dir);
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg);
    });
    try {
      await runMissionCheckpoints([missionId], dir);
      expect(logs.join('\n')).toContain('No checkpoints for mission');
    } finally {
      spy.mockRestore();
    }
  });

  it('runMissionCheckpoints rejects a missing missionId argument', async () => {
    const dir = makeTempDir();
    await expect(runMissionCheckpoints([], dir)).rejects.toThrow(/Usage: monolith mission checkpoints/);
  });
});

// ---------------------------------------------------------------------------
// Concurrency — real, independent OS processes, same pattern as
// state-keeper.test.ts's mission concurrency test.
// ---------------------------------------------------------------------------

const COORDINATORIUM_MODULES = ['types', 'errors', 'lock', 'state-keeper', 'mission', 'checkpoint'];

function transpileCoordinatoriumTo(destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const name of COORDINATORIUM_MODULES) {
    const source = readFileSync(join(__dirname, `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: `${name}.ts`,
    });
    let js = outputText;
    for (const mod of COORDINATORIUM_MODULES) {
      js = js.split(`'./${mod}.js'`).join(`'./${mod}.mjs'`).split(`"./${mod}.js"`).join(`"./${mod}.mjs"`);
    }
    writeFileSync(join(destDir, `${name}.mjs`), js, 'utf8');
  }

  const childScript = `
import { createCheckpoint } from './checkpoint.mjs';
const [stateDir, missionId, idx] = process.argv.slice(2);
const checkpoint = await createCheckpoint(stateDir, missionId, { summary: 'Concurrent checkpoint ' + idx });
process.stdout.write(JSON.stringify(checkpoint));
`;
  writeFileSync(join(destDir, 'create-checkpoint-child.mjs'), childScript, 'utf8');
}

function runChild(moduleDir: string, stateDir: string, missionId: string, idx: number): Promise<{ id: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      join(moduleDir, 'create-checkpoint-child.mjs'),
      stateDir,
      missionId,
      String(idx),
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`child ${idx} exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        reject(new Error(`child ${idx} produced non-JSON stdout: ${stdout} / stderr: ${stderr}`));
      }
    });
  });
}

describe('concurrency (independent processes)', () => {
  it(
    'loses no checkpoints and produces unique per-mission ordinals under concurrent writers',
    async () => {
      const stateDir = makeTempDir();
      const moduleDir = makeTempDir();
      transpileCoordinatoriumTo(moduleDir);

      const mission = await startMission(stateDir, { title: 'Concurrency target', system: 'concurrency-test' });

      const N = 8;
      const checkpoints = await Promise.all(
        Array.from({ length: N }, (_, i) => runChild(moduleDir, stateDir, mission.id, i)),
      );

      const ids = checkpoints.map((c) => c.id);
      expect(new Set(ids).size).toBe(N); // all unique — no collisions, no lost updates

      const state = await readState(stateDir);
      const persisted = Object.values(state.tactical.checkpoints).filter((c) => c.missionId === mission.id);
      expect(persisted).toHaveLength(N);
      // revision: 1 for startMission + N for each successful createCheckpoint
      expect(state.revision).toBe(1 + N);
    },
    30_000,
  );
});
