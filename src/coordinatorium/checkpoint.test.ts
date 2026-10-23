import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';
import ts from 'typescript';
import { createCheckpoint, listCheckpoints, getCheckpoint } from './checkpoint.js';
import { startMission, finishMission } from './mission.js';
import { readState, stateFilePath, trustedDirectoryTarget } from './state-keeper.js';
import { STATE_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION_V1 } from './types.js';
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
// Legacy (schemaVersion: 1) fixture helpers — construct a genuine pre-
// COORDINATORIUM-002-shaped file by hand, never via the current
// createInitialState() (which now always stamps schemaVersion: 2).
// ---------------------------------------------------------------------------

function legacyMission(id: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id,
    title: 'Legacy mission',
    system: 'coordinatorium',
    status: 'in_progress',
    startedAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    summary: null,
    ...overrides,
  };
}

function legacyV1Fixture(opts: {
  revision?: number;
  missions?: Record<string, unknown>;
  /** Omit entirely to simulate a genuine pre-002 file with no such key. */
  checkpoints?: Record<string, unknown>;
}): Record<string, unknown> {
  const tactical: Record<string, unknown> = { missions: opts.missions ?? {} };
  if (opts.checkpoints !== undefined) tactical.checkpoints = opts.checkpoints;
  return {
    schemaVersion: LEGACY_SCHEMA_VERSION_V1,
    revision: opts.revision ?? 0,
    strategic: { systems: {} },
    tactical,
  };
}

// ---------------------------------------------------------------------------
// createCheckpoint
// ---------------------------------------------------------------------------

describe('createCheckpoint', () => {
  it('appends a well-formed checkpoint for an active mission', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const checkpoint = await createCheckpoint(trustedDirectoryTarget(dir), mission.id, {
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
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const checkpoint = await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'minimal' });
    expect(checkpoint.remainingSteps).toEqual([]);
    expect(checkpoint.context).toBeNull();
  });

  it('creates multiple checkpoints for one mission with sequential per-mission ordinals', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const c1 = await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'first' });
    const c2 = await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'second' });
    const c3 = await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'third' });
    expect([c1.id, c2.id, c3.id]).toEqual([
      `${mission.id}-CKPT-0001`,
      `${mission.id}-CKPT-0002`,
      `${mission.id}-CKPT-0003`,
    ]);
  });

  it('numbers checkpoints independently per mission', async () => {
    const dir = makeTempDir();
    const a = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const b = await startMission(trustedDirectoryTarget(dir), { title: 'B', system: 's' });

    await createCheckpoint(trustedDirectoryTarget(dir), a.id, { summary: 'a1' });
    const aC2 = await createCheckpoint(trustedDirectoryTarget(dir), a.id, { summary: 'a2' });
    const bC1 = await createCheckpoint(trustedDirectoryTarget(dir), b.id, { summary: 'b1' });

    expect(aC2.id).toBe(`${a.id}-CKPT-0002`);
    expect(bC1.id).toBe(`${b.id}-CKPT-0001`); // independent numbering, not a global counter
  });

  it('increments revision by exactly 1 per successful checkpoint creation', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' }); // revision 1
    await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'c1' }); // revision 2
    const state = await readState(trustedDirectoryTarget(dir));
    expect(state.revision).toBe(2);
    await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'c2' }); // revision 3
    expect((await readState(trustedDirectoryTarget(dir))).revision).toBe(3);
  });

  it('rejects an unknown missionId with MissionNotFoundError', async () => {
    const dir = makeTempDir();
    await expect(createCheckpoint(trustedDirectoryTarget(dir), 'MIS-9999', { summary: 'x' })).rejects.toBeInstanceOf(MissionNotFoundError);
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'rejects checkpoint creation against a %s mission with MissionNotActiveError',
    async (resultStatus) => {
      const dir = makeTempDir();
      const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
      await finishMission(trustedDirectoryTarget(dir), mission.id, { result: resultStatus });
      await expect(createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'x' })).rejects.toBeInstanceOf(
        MissionNotActiveError,
      );
    },
  );

  it('rejects an empty or whitespace-only summary', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    await expect(createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: '   ' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a remainingSteps element that is empty/whitespace-only', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    await expect(
      createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'x', remainingSteps: ['ok', '   '] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects remainingSteps that is not an array', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    // @ts-expect-error — deliberately invalid at the runtime boundary
    await expect(createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'x', remainingSteps: 'nope' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a summary exceeding the max length', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    await expect(createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'x'.repeat(5000) })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a context exceeding the max length', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    await expect(
      createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'x', context: 'y'.repeat(5000) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects more than the maximum number of remainingSteps', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    await expect(
      createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'x', remainingSteps: Array.from({ length: 51 }, (_, i) => `s${i}`) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// listCheckpoints / getCheckpoint
// ---------------------------------------------------------------------------

describe('listCheckpoints', () => {
  it('returns [] for a mission with no checkpoints yet, without throwing', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    expect(await listCheckpoints(trustedDirectoryTarget(dir), mission.id)).toEqual([]);
  });

  it('returns only the requested mission checkpoints, chronologically', async () => {
    const dir = makeTempDir();
    const a = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const b = await startMission(trustedDirectoryTarget(dir), { title: 'B', system: 's' });
    const a1 = await createCheckpoint(trustedDirectoryTarget(dir), a.id, { summary: 'a1' });
    await createCheckpoint(trustedDirectoryTarget(dir), b.id, { summary: 'b1' });
    const a2 = await createCheckpoint(trustedDirectoryTarget(dir), a.id, { summary: 'a2' });

    const listed = await listCheckpoints(trustedDirectoryTarget(dir), a.id);
    expect(listed.map((c) => c.id)).toEqual([a1.id, a2.id]);
  });

  it('remains available for a completed mission', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'before finish' });
    await finishMission(trustedDirectoryTarget(dir), mission.id, { result: 'completed' });
    const listed = await listCheckpoints(trustedDirectoryTarget(dir), mission.id);
    expect(listed).toHaveLength(1);
  });
});

describe('getCheckpoint', () => {
  it('reads a checkpoint by id', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const created = await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'x' });
    const fetched = await getCheckpoint(trustedDirectoryTarget(dir), created.id);
    expect(fetched).toEqual(created);
  });

  it('throws CheckpointNotFoundError for an unknown id', async () => {
    const dir = makeTempDir();
    await expect(getCheckpoint(trustedDirectoryTarget(dir), 'MIS-0001-CKPT-0001')).rejects.toBeInstanceOf(CheckpointNotFoundError);
  });

  it('remains readable for a checkpoint belonging to a completed mission', async () => {
    const dir = makeTempDir();
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const created = await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'x' });
    await finishMission(trustedDirectoryTarget(dir), mission.id, { result: 'completed' });
    const fetched = await getCheckpoint(trustedDirectoryTarget(dir), created.id);
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
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const created = await createCheckpoint(trustedDirectoryTarget(dir), mission.id, { summary: 'x', remainingSteps: ['a'] });
    const read1 = await getCheckpoint(trustedDirectoryTarget(dir), created.id);
    const read2 = await getCheckpoint(trustedDirectoryTarget(dir), created.id);
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
    const mission = await startMission(trustedDirectoryTarget(dir), { title: 'A', system: 's' });
    const created = await createCheckpoint(trustedDirectoryTarget(dir), mission.id, {
      summary: 'roundtrip',
      remainingSteps: ['x', 'y'],
      context: 'ctx',
    });

    const onDisk = JSON.parse(readFileSync(stateFilePath(dir), 'utf8'));
    expect(onDisk.tactical.checkpoints[created.id]).toEqual(created);

    const reRead = await getCheckpoint(trustedDirectoryTarget(dir), created.id);
    expect(reRead).toEqual(created);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: old state.json without tactical.checkpoints
// ---------------------------------------------------------------------------

describe('schemaVersion migration (v1 → v2)', () => {
  it('readState migrates a genuine pre-002 v1 file in-memory: schemaVersion becomes 2, checkpoints defaults to {}, nothing on disk is touched', async () => {
    const dir = makeTempDir();
    const legacy = legacyV1Fixture({ revision: 3, missions: { 'MIS-0001': legacyMission('MIS-0001') } });
    writeFileSync(stateFilePath(dir), JSON.stringify(legacy, null, 2), 'utf8');
    const before = readFileSync(stateFilePath(dir), 'utf8');

    const state = await readState(trustedDirectoryTarget(dir));
    expect(state.schemaVersion).toBe(STATE_SCHEMA_VERSION); // 2, in-memory
    expect(state.tactical.checkpoints).toEqual({});
    expect(state.revision).toBe(3); // preserved exactly
    expect(state.tactical.missions['MIS-0001'].title).toBe('Legacy mission');
    expect(await listCheckpoints(trustedDirectoryTarget(dir), 'MIS-0001')).toEqual([]);

    // Pure read — no side effect, exactly like the existing missing-file case.
    expect(readFileSync(stateFilePath(dir), 'utf8')).toBe(before);
    expect(JSON.parse(before).schemaVersion).toBe(1);
  });

  it('tolerates (and preserves) a v1-tagged file that already has checkpoints — the since-fixed transitional shape', async () => {
    const dir = makeTempDir();
    const existingCheckpoint = {
      id: 'MIS-0001-CKPT-0001',
      missionId: 'MIS-0001',
      createdAt: '2026-10-21T00:00:00.000Z',
      summary: 'written by the vulnerable transitional code',
      remainingSteps: [],
      context: null,
    };
    const legacy = legacyV1Fixture({
      revision: 1,
      missions: { 'MIS-0001': legacyMission('MIS-0001') },
      checkpoints: { [existingCheckpoint.id]: existingCheckpoint },
    });
    writeFileSync(stateFilePath(dir), JSON.stringify(legacy, null, 2), 'utf8');

    const state = await readState(trustedDirectoryTarget(dir));
    expect(state.tactical.checkpoints[existingCheckpoint.id]).toEqual(existingCheckpoint);
    expect(await getCheckpoint(trustedDirectoryTarget(dir), existingCheckpoint.id)).toEqual(existingCheckpoint);
  });

  it('createCheckpoint against a legacy v1 file migrates and persists it as v2 on disk, preserving the existing mission', async () => {
    const dir = makeTempDir();
    const legacy = legacyV1Fixture({ revision: 1, missions: { 'MIS-0001': legacyMission('MIS-0001') } });
    writeFileSync(stateFilePath(dir), JSON.stringify(legacy, null, 2), 'utf8');

    const checkpoint = await createCheckpoint(trustedDirectoryTarget(dir), 'MIS-0001', { summary: 'first ever checkpoint' });
    expect(checkpoint.id).toBe('MIS-0001-CKPT-0001');

    // The on-disk file is now v2 — the migration is persisted as a side
    // effect of the ordinary mutateState write, not a separate mechanism.
    const onDisk = JSON.parse(readFileSync(stateFilePath(dir), 'utf8'));
    expect(onDisk.schemaVersion).toBe(2);
    expect(onDisk.tactical.missions['MIS-0001'].title).toBe('Legacy mission');
    expect(onDisk.tactical.checkpoints[checkpoint.id]).toEqual(checkpoint);
    expect(onDisk.revision).toBe(2); // 1 (legacy) + 1 (this mutation) — revision preserved, then incremented once

    const state = await readState(trustedDirectoryTarget(dir));
    expect(state.tactical.checkpoints[checkpoint.id]).toEqual(checkpoint);
  });

  it('an ordinary mission mutation (not just createCheckpoint) also migrates a legacy v1 file to v2 on disk', async () => {
    const dir = makeTempDir();
    const legacy = legacyV1Fixture({ revision: 5, missions: { 'MIS-0001': legacyMission('MIS-0001') } });
    writeFileSync(stateFilePath(dir), JSON.stringify(legacy, null, 2), 'utf8');

    await finishMission(trustedDirectoryTarget(dir), 'MIS-0001', { result: 'completed' });

    const onDisk = JSON.parse(readFileSync(stateFilePath(dir), 'utf8'));
    expect(onDisk.schemaVersion).toBe(2);
    expect(onDisk.tactical.checkpoints).toEqual({});
    expect(onDisk.tactical.missions['MIS-0001'].status).toBe('completed');
    expect(onDisk.revision).toBe(6);
  });

  it('rejects a v2-tagged file whose tactical.checkpoints key is missing (required, not defaulted, once on v2)', async () => {
    const dir = makeTempDir();
    const malformed = {
      schemaVersion: STATE_SCHEMA_VERSION,
      revision: 0,
      strategic: { systems: {} },
      tactical: { missions: {} }, // no checkpoints — not a legacy v1 file, so this is corruption
    };
    writeFileSync(stateFilePath(dir), JSON.stringify(malformed, null, 2), 'utf8');
    await expect(readState(trustedDirectoryTarget(dir))).rejects.toThrow(/tactical\.checkpoints/);
  });

  it('rejects an unsupported schemaVersion (neither current nor the one known legacy version)', async () => {
    const dir = makeTempDir();
    const bad = legacyV1Fixture({ missions: {} });
    bad.schemaVersion = 99;
    writeFileSync(stateFilePath(dir), JSON.stringify(bad, null, 2), 'utf8');
    await expect(readState(trustedDirectoryTarget(dir))).rejects.toThrow(/schemaVersion/i);
  });

  it(
    'concurrent checkpoint creation against the same legacy v1 file migrates exactly once, with no lost updates and no duplicate ids',
    async () => {
      const dir = makeTempDir();
      const legacy = legacyV1Fixture({ revision: 1, missions: { 'MIS-0001': legacyMission('MIS-0001') } });
      writeFileSync(stateFilePath(dir), JSON.stringify(legacy, null, 2), 'utf8');

      const N = 6;
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) => createCheckpoint(trustedDirectoryTarget(dir), 'MIS-0001', { summary: `concurrent ${i}` })),
      );
      const ids = results.map((c) => c.id);
      expect(new Set(ids).size).toBe(N);

      const onDisk = JSON.parse(readFileSync(stateFilePath(dir), 'utf8'));
      expect(onDisk.schemaVersion).toBe(2);
      expect(Object.keys(onDisk.tactical.checkpoints)).toHaveLength(N);
      expect(onDisk.revision).toBe(1 + N); // legacy revision 1, then +1 per successful mutation
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Pre-COORDINATORIUM-002 binary safety against a v2 file.
//
// This is the regression test for the exact defect an independent review
// found in the first cut of this story: that cut kept schemaVersion at 1
// while adding checkpoints, so an OLD binary (hardcoded to schemaVersion
// === 1, with no concept of checkpoints) could read a checkpoint-bearing
// file, silently reconstruct it without checkpoints, and overwrite it on
// its next write. To prove the fix concretely (not just by code reading),
// this test transpiles the ACTUAL pre-002 sources from git history (commit
// 681d88d — the last commit before this story) and runs them, for real, as
// a separate child process against a real v2 file with real checkpoints.
// ---------------------------------------------------------------------------

const PRE_002_COMMIT = '681d88d';
const HISTORICAL_MODULES = ['types', 'errors', 'lock', 'state-keeper', 'mission'];

function gitShowFile(sha: string, relPath: string): string {
  return execFileSync('git', ['show', `${sha}:${relPath}`], { cwd: __dirname, encoding: 'utf8' });
}

/** Transpiles the historical (pre-002) coordinatorium sources at `sha` into plain ESM .mjs in destDir. */
function transpileHistoricalCoordinatoriumTo(destDir: string, sha: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const name of HISTORICAL_MODULES) {
    const source = gitShowFile(sha, `src/coordinatorium/${name}.ts`);
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: `${name}.ts`,
    });
    let js = outputText;
    for (const mod of HISTORICAL_MODULES) {
      js = js.split(`'./${mod}.js'`).join(`'./${mod}.mjs'`).split(`"./${mod}.js"`).join(`"./${mod}.mjs"`);
    }
    writeFileSync(join(destDir, `${name}.mjs`), js, 'utf8');
  }

  // The historical mission.ts only exports startMission/listMissions/getMission/finishMission —
  // exercising startMission is enough to drive the full historical
  // readState -> validateState -> mutateState -> write cycle.
  const childScript = `
import { startMission } from './mission.mjs';
const [stateDir] = process.argv.slice(2);
try {
  const mission = await startMission(stateDir, { title: 'should never be written', system: 'old-binary-probe' });
  process.stdout.write(JSON.stringify({ ok: true, mission }));
} catch (err) {
  process.stderr.write(String(err && err.message ? err.message : err));
  process.exitCode = 1;
}
`;
  writeFileSync(join(destDir, 'old-binary-probe-child.mjs'), childScript, 'utf8');
}

function runOldBinaryProbe(moduleDir: string, stateDir: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(moduleDir, 'old-binary-probe-child.mjs'), stateDir]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ exitCode: code ?? -1, stdout, stderr }));
  });
}

describe('pre-COORDINATORIUM-002 binary safety against a v2 file', () => {
  it(
    'a real pre-002 binary (historical code from git) refuses to touch a v2 state.json with real checkpoints — it throws before any write, so the file on disk is untouched',
    async () => {
      const stateDir = makeTempDir();
      const moduleDir = makeTempDir();

      // Build a REAL, current-format (v2) state.json with real checkpoint
      // data, via the current code under test.
      const mission = await startMission(trustedDirectoryTarget(stateDir), { title: 'A', system: 's' });
      await createCheckpoint(trustedDirectoryTarget(stateDir), mission.id, { summary: 'must survive untouched' });
      const before = readFileSync(stateFilePath(stateDir), 'utf8');
      const beforeParsed = JSON.parse(before);
      expect(beforeParsed.schemaVersion).toBe(2);
      expect(Object.keys(beforeParsed.tactical.checkpoints)).toHaveLength(1);

      transpileHistoricalCoordinatoriumTo(moduleDir, PRE_002_COMMIT);
      const outcome = await runOldBinaryProbe(moduleDir, stateDir);

      // The old binary must fail loudly, not silently succeed.
      expect(outcome.exitCode).not.toBe(0);
      expect(outcome.stderr).toMatch(/schemaVersion/i);
      expect(outcome.stdout).toBe(''); // never reached the "it worked" branch

      // And the file on disk — checkpoints included — must be byte-for-byte
      // untouched: the old binary's readState threw before mutateState ever
      // reached its write step.
      const after = readFileSync(stateFilePath(stateDir), 'utf8');
      expect(after).toBe(before);
    },
    30_000,
  );
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
  // lock.ts / state-keeper.ts import the shared bounded reader from root/.
  writeFileSync(
    join(destDir, 'root.mjs'),
    ts.transpileModule(readFileSync(join(__dirname, '..', 'root', 'index.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: 'index.ts',
    }).outputText.split(`'./safe-write.js'`).join(`'./safe-write.mjs'`).split(`'./write-artifacts.js'`).join(`'./write-artifacts.mjs'`),
    'utf8',
  );
  // root/index.ts re-exports the safe-write primitive (SEC-001B.2).
  writeFileSync(
    join(destDir, 'safe-write.mjs'),
    ts.transpileModule(readFileSync(join(__dirname, '..', 'root', 'safe-write.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: 'safe-write.ts',
    }).outputText,
    'utf8',
  );
  writeFileSync(
    join(destDir, 'write-artifacts.mjs'),
    ts.transpileModule(readFileSync(join(__dirname, '..', 'root', 'write-artifacts.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: 'write-artifacts.ts',
    }).outputText,
    'utf8',
  );
  for (const name of COORDINATORIUM_MODULES) {
    const source = readFileSync(join(__dirname, `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: `${name}.ts`,
    });
    let js = outputText.split(`'../root/index.js'`).join(`'./root.mjs'`);
    for (const mod of COORDINATORIUM_MODULES) {
      js = js.split(`'./${mod}.js'`).join(`'./${mod}.mjs'`).split(`"./${mod}.js"`).join(`"./${mod}.mjs"`);
    }
    writeFileSync(join(destDir, `${name}.mjs`), js, 'utf8');
  }

  const childScript = `
import { createCheckpoint } from './checkpoint.mjs';
import { trustedDirectoryTarget } from './state-keeper.mjs';
const [stateDir, missionId, idx] = process.argv.slice(2);
const checkpoint = await createCheckpoint(trustedDirectoryTarget(stateDir), missionId, { summary: 'Concurrent checkpoint ' + idx });
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

      const mission = await startMission(trustedDirectoryTarget(stateDir), { title: 'Concurrency target', system: 'concurrency-test' });

      const N = 8;
      const checkpoints = await Promise.all(
        Array.from({ length: N }, (_, i) => runChild(moduleDir, stateDir, mission.id, i)),
      );

      const ids = checkpoints.map((c) => c.id);
      expect(new Set(ids).size).toBe(N); // all unique — no collisions, no lost updates

      const state = await readState(trustedDirectoryTarget(stateDir));
      const persisted = Object.values(state.tactical.checkpoints).filter((c) => c.missionId === mission.id);
      expect(persisted).toHaveLength(N);
      // revision: 1 for startMission + N for each successful createCheckpoint
      expect(state.revision).toBe(1 + N);
    },
    30_000,
  );
});
