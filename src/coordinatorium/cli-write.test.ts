import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SafeWriteError, reportWriteWarning, resetWriteWarningState, type WriteWarning } from '../root/index.js';
import { LockCreationError } from './errors.js';
import { UnknownWriteOutcomeError, runMissionCheckpoint, runMissionFinish, runMissionStart, withWriteGuidance } from './cli.js';

// SEC-001B.2: CLI integration — project scope, warnings after publication,
// and the instruction to check state after an UNKNOWN outcome.
let base: string;
let project: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-cliw-'));
  project = join(base, 'project');
  outside = join(base, 'outside');
  mkdirSync(project);
  mkdirSync(outside);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

const START = ['--title', 't', '--system', 's'];

describe('mission commands use project scope', () => {
  it('a normal start creates state.json at 0600 and leaves no temporary names', async () => {
    await runMissionStart(START, project);
    const state = join(project, '.monolith', 'state.json');
    expect(lstatSync(state).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(project, '.monolith')).filter((n) => /\.tmp\.|\.creating\.|\.lock$/.test(n))).toEqual([]);
  });

  it('later commands keep a mode the user chose', async () => {
    await runMissionStart(START, project);
    const state = join(project, '.monolith', 'state.json');
    chmodSync(state, 0o640);
    await runMissionCheckpoint(['MIS-0001', '--summary', 'x'], project);
    await runMissionFinish(['MIS-0001', '--result', 'completed'], project);
    expect(lstatSync(state).mode & 0o777).toBe(0o640);
  });

  it('a symlinked .monolith pointing outside is refused and nothing is written outside', async () => {
    symlinkSync(outside, join(project, '.monolith'));
    await expect(runMissionStart(START, project)).rejects.toThrow();
    expect(readdirSync(outside)).toEqual([]);
  });

  it('a symlinked .monolith that stays inside the project is refused for writes (W-SYM)', async () => {
    mkdirSync(join(project, 'real'));
    symlinkSync(join(project, 'real'), join(project, '.monolith'));
    await expect(runMissionStart(START, project)).rejects.toThrow();
    expect(readdirSync(join(project, 'real'))).toEqual([]);
  });

  it('a dangling symlink at state.json is refused, not written through', async () => {
    mkdirSync(join(project, '.monolith'));
    symlinkSync(join(outside, 'victim'), join(project, '.monolith', 'state.json'));
    await expect(runMissionStart(START, project)).rejects.toThrow();
    expect(existsSync(join(outside, 'victim'))).toBe(false);
  });
});

describe('warnings after publication', () => {
  const w = (code: WriteWarning['code'], message = 'm', path?: string): WriteWarning => ({ code, message, path });

  it('are printed as one line each; the platform note only once per process', () => {
    resetWriteWarningState();
    const lines: string[] = [];
    reportWriteWarning(w('DIR_FSYNC_FAILED', 'dir failed', '/d'), (l) => lines.push(l));
    reportWriteWarning(w('PLATFORM_BEST_EFFORT', 'best effort'), (l) => lines.push(l));
    reportWriteWarning(w('PLATFORM_BEST_EFFORT', 'best effort'), (l) => lines.push(l));
    reportWriteWarning(w('STAGING_RESIDUE', 'second name'), (l) => lines.push(l));
    expect(lines).toEqual([
      'warning [DIR_FSYNC_FAILED]: dir failed (/d)',
      'warning [PLATFORM_BEST_EFFORT]: best effort',
      'warning [STAGING_RESIDUE]: second name',
    ]);
  });

  it('can never turn a published write into a failure, even if printing throws', () => {
    expect(() =>
      reportWriteWarning(w('DIR_FSYNC_FAILED'), () => {
        throw new Error('stderr closed');
      }),
    ).not.toThrow();
  });
});

describe('UNKNOWN outcomes', () => {
  const unknown = (): SafeWriteError =>
    new SafeWriteError('could not determine whether "x" was written', {
      code: 'WRITE_PUBLICATION_UNKNOWN',
      phase: 'publish',
      publication: 'UNKNOWN',
      path: 'x',
    });

  it('tell the user to check the state before repeating, and say nothing was retried', async () => {
    const err = await withWriteGuidance(() => Promise.reject(unknown())).catch((e: unknown) => e as Error);
    expect(err.message).toMatch(/UNKNOWN/);
    expect(err.message).toMatch(/not retried/);
    expect(err.message).toMatch(/mission list/);
  });

  const lockUnknown = (): LockCreationError =>
    new LockCreationError({
      lockPath: '/l/state.json.lock',
      phase: 'publish-link',
      pid: 1,
      nonce: 'n',
      cleanedUp: false,
      publication: 'UNKNOWN',
      cause: new Error('EIO'),
    });

  it('a lock UNKNOWN points at the lock and its staging files, not at the mission list', async () => {
    const err = await withWriteGuidance(() => Promise.reject(lockUnknown())).catch((e: unknown) => e as Error);
    expect(err.message).toMatch(/creating the lock is UNKNOWN/);
    expect(err.message).toMatch(/not retried/);
    expect(err.message).toContain('/l/state.json.lock.creating.*');
    expect(err.message).toContain('/l/state.json.lock.recovery');
    expect(err.message).toMatch(/no state was written/);
    expect(err.message).not.toMatch(/mission list/);
    expect(err.message).toMatch(/never deletes/);
    expect(err.message).not.toMatch(/\b(rm|delete it|remove it)\b/i);
  });

  it('a state UNKNOWN does not talk about the lock', async () => {
    const err = await withWriteGuidance(() => Promise.reject(unknown())).catch((e: unknown) => e as Error);
    expect(err.message).not.toMatch(/creating the lock/);
  });

  it('keeps code, publication, phase, path and the original error for machine readers (state)', async () => {
    const orig = unknown();
    const err = (await withWriteGuidance(() => Promise.reject(orig)).catch((e: unknown) => e)) as UnknownWriteOutcomeError;
    expect(err).toBeInstanceOf(UnknownWriteOutcomeError);
    expect(err).toMatchObject({ code: 'WRITE_PUBLICATION_UNKNOWN', publication: 'UNKNOWN', phase: 'publish', path: 'x', subject: 'state' });
    expect(err.cause).toBe(orig);
  });

  it('keeps code, publication, phase, path and the original error for machine readers (lock)', async () => {
    const orig = lockUnknown();
    const err = (await withWriteGuidance(() => Promise.reject(orig)).catch((e: unknown) => e)) as UnknownWriteOutcomeError;
    expect(err).toMatchObject({ code: 'LOCK_CREATION_FAILED', publication: 'UNKNOWN', phase: 'publish-link', path: '/l/state.json.lock', subject: 'lock' });
    expect(err.cause).toBe(orig);
  });

  it('leave definite failures and unrelated errors untouched', async () => {
    const notPublished = new SafeWriteError('nope', {
      code: 'WRITE_TARGET_SYMLINK',
      phase: 'validate',
      publication: 'NOT_PUBLISHED',
      path: 'x',
    });
    await expect(withWriteGuidance(() => Promise.reject(notPublished))).rejects.toBe(notPublished);
    const other = new Error('other');
    await expect(withWriteGuidance(() => Promise.reject(other))).rejects.toBe(other);
    await expect(withWriteGuidance(() => Promise.resolve(7))).resolves.toBe(7);
  });
});
