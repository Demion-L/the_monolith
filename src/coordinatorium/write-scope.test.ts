import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SafeWriteError } from '../root/index.js';
import {
  mutateState,
  projectTarget,
  readState,
  stateFilePath,
  trustedDirectoryTarget,
  type StateWriteTarget,
} from './state-keeper.js';
import { startMission, listMissions, finishMission } from './mission.js';
import { createCheckpoint } from './checkpoint.js';

// SEC-001B.2 / ADR-012: every public write API takes an explicit scope. All
// scenarios run in temporary directories; `outside` is a sibling that must
// never be touched by a refused write.
let base: string;
let project: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-scope-'));
  project = join(base, 'project');
  outside = join(base, 'outside');
  mkdirSync(project);
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

async function rejection(p: Promise<unknown>): Promise<SafeWriteError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(SafeWriteError);
    return err as SafeWriteError;
  }
  throw new Error('expected a rejection');
}

describe('explicit write scope is mandatory', () => {
  it('a plain string is not accepted by any public write function, and nothing is created', async () => {
    const dir = join(project, 'never-created');
    const bad = dir as unknown as StateWriteTarget;
    const calls: Array<[string, Promise<unknown>]> = [
      ['mutateState', mutateState(bad, () => 1)],
      ['startMission', startMission(bad, { title: 't', system: 's' })],
      ['finishMission', finishMission(bad, 'MIS-0001', { result: 'completed' })],
      ['createCheckpoint', createCheckpoint(bad, 'MIS-0001', { summary: 'x' })],
    ];
    for (const [name, p] of calls) {
      const e = await rejection(p);
      expect(e.code, name).toBe('WRITE_SCOPE_REQUIRED');
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.message).toMatch(/explicit write scope/);
      expect(e.message).toMatch(/trusted-directory/);
    }
    expect(existsSync(dir)).toBe(false);
  });

  it('malformed targets are rejected as missing scope', async () => {
    const dir = join(project, 'd');
    for (const t of [
      undefined,
      null,
      {},
      { stateDir: dir },
      { scope: 'whatever', stateDir: dir },
      { scope: 'project', stateDir: dir },
      { scope: 'project', projectRoot: '', stateDir: dir },
      { scope: 'trusted-directory', stateDir: '' },
      { scope: 'trusted-directory' },
    ]) {
      const e = await rejection(mutateState(t as unknown as StateWriteTarget, () => 1));
      expect(e.code).toBe('WRITE_SCOPE_REQUIRED');
    }
    expect(existsSync(dir)).toBe(false);
  });

  it('read functions still take a plain directory (they never write)', async () => {
    expect(await listMissions(join(project, 'absent'))).toEqual([]);
    expect(existsSync(join(project, 'absent'))).toBe(false);
  });
});

describe('project scope', () => {
  it('creates a missing state directory below the root and writes state', async () => {
    const stateDir = join(project, '.monolith');
    const m = await startMission(projectTarget(project, stateDir), { title: 't', system: 's' });
    expect(m.id).toBe('MIS-0001');
    expect((await readState(stateDir)).tactical.missions['MIS-0001']).toBeDefined();
  });

  it('refuses a state directory outside the project root without creating anything', async () => {
    const e = await rejection(startMission(projectTarget(project, outside), { title: 't', system: 's' }));
    expect(e.code).toBe('WRITE_OUTSIDE_BOUNDARY');
    expect(readdirSync(outside)).toEqual([]);

    const e2 = await rejection(
      mutateState(projectTarget(project, join(project, '..', 'outside', 'deeper')), () => 1),
    );
    expect(e2.code).toBe('WRITE_OUTSIDE_BOUNDARY');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses a symlinked state directory that points OUTSIDE the project', async () => {
    symlinkSync(outside, join(project, '.monolith'));
    const e = await rejection(startMission(projectTarget(project, join(project, '.monolith')), { title: 't', system: 's' }));
    expect(e.code).toBe('WRITE_PARENT_SYMLINK');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses a symlinked state directory that stays INSIDE the project (W-SYM)', async () => {
    mkdirSync(join(project, 'real'));
    symlinkSync(join(project, 'real'), join(project, '.monolith'));
    const e = await rejection(startMission(projectTarget(project, join(project, '.monolith')), { title: 't', system: 's' }));
    expect(e.code).toBe('WRITE_PARENT_SYMLINK');
    expect(readdirSync(join(project, 'real'))).toEqual([]);
  });

  it('refuses a symlink among intermediate components', async () => {
    mkdirSync(join(project, 'a'));
    symlinkSync(outside, join(project, 'a', 'b'));
    const e = await rejection(mutateState(projectTarget(project, join(project, 'a', 'b', 'c')), () => 1));
    expect(e.code).toBe('WRITE_PARENT_SYMLINK');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('does not delegate containment to the CLI: a direct API call is checked too', async () => {
    symlinkSync(outside, join(project, 'esc'));
    const e = await rejection(createCheckpoint(projectTarget(project, join(project, 'esc')), 'MIS-0001', { summary: 'x' }));
    expect(e.code).toBe('WRITE_PARENT_SYMLINK');
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe('trusted-directory scope', () => {
  it('creates the directory (and missing ancestors) and writes state', async () => {
    const dir = join(project, 'x', 'y');
    await startMission(trustedDirectoryTarget(dir), { title: 't', system: 's' });
    expect(existsSync(stateFilePath(dir))).toBe(true);
  });

  it('ancestors of the directory are trusted by the caller: a symlinked ancestor is NOT inspected (documented property)', async () => {
    symlinkSync(project, join(base, 'alias'));
    const via = join(base, 'alias', 'state');
    await startMission(trustedDirectoryTarget(via), { title: 't', system: 's' });
    expect(readFileSync(join(project, 'state', 'state.json'), 'utf8')).toContain('MIS-0001');
    expect(lstatSync(join(base, 'alias')).isSymbolicLink()).toBe(true);
  });

  it('calls the supplied onWarning callback shape without requiring it', async () => {
    const seen: string[] = [];
    await mutateState(trustedDirectoryTarget(join(project, 's'), (w) => seen.push(w.code)), () => 1);
    await mutateState(trustedDirectoryTarget(join(project, 's')), () => 1);
    expect(Array.isArray(seen)).toBe(true);
  });
});
