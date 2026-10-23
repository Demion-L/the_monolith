import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { SafeWriteError } from '../root/index.js';
import { mutateState, projectTarget, readState, stateFilePath, trustedDirectoryTarget } from './state-keeper.js';
import { StateFileError } from './errors.js';
import { startMission } from './mission.js';

// SEC-001B.2: state.json is written through the safe-write primitive. Every
// scenario runs in a temporary tree; `outside` must never change.
let base: string;
let project: string;
let mon: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-sk-'));
  project = join(base, 'project');
  mon = join(project, '.monolith');
  outside = join(base, 'outside');
  mkdirSync(mon, { recursive: true });
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const bump = () => 1;

async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

function modeOf(p: string): number {
  return lstatSync(p).mode & 0o777;
}

function noResidue(): void {
  expect(readdirSync(mon).filter((n) => /\.tmp\.|\.creating\.|\.lock$|\.recovery$/.test(n))).toEqual([]);
}

describe('state.json permissions', () => {
  it('a new state.json is 0600 in project scope, whatever the umask', async () => {
    for (const um of [0o022, 0o277, 0]) {
      rmSync(mon, { recursive: true, force: true });
      mkdirSync(mon);
      const old = process.umask(um);
      try {
        await mutateState(projectTarget(project, mon), bump);
      } finally {
        process.umask(old);
      }
      expect(modeOf(stateFilePath(mon))).toBe(0o600);
    }
  });

  it('a new state.json is 0600 in trusted-directory scope', async () => {
    await mutateState(trustedDirectoryTarget(mon), bump);
    expect(modeOf(stateFilePath(mon))).toBe(0o600);
  });

  it('an existing state.json keeps its mode across rewrites (it used to be reset to 0666 & ~umask)', async () => {
    await mutateState(projectTarget(project, mon), bump);
    chmodSync(stateFilePath(mon), 0o640);
    await mutateState(projectTarget(project, mon), bump);
    await mutateState(projectTarget(project, mon), bump);
    expect(modeOf(stateFilePath(mon))).toBe(0o640);
    expect((await readState(mon)).revision).toBe(3);
  });

  it('the file stays readable by its owner at 0600 and leaves no temporary residue', async () => {
    await startMission(projectTarget(project, mon), { title: 't', system: 's' });
    expect((await readState(mon)).tactical.missions['MIS-0001']?.title).toBe('t');
    noResidue();
  });
});

describe('destinations that must not be replaced', () => {
  it.each([
    ['a symlink to a valid state file outside the project', true, 'WRITE_TARGET_SYMLINK'],
    ['a dangling symlink', false, undefined],
  ])('%s is refused; nothing outside is created or changed; the lock is released', async (_name, live, code) => {
    const initial = JSON.stringify(await readState(mon), null, 2);
    if (live) {
      writeFileSync(join(outside, 'real'), initial);
      symlinkSync(join(outside, 'real'), stateFilePath(mon));
    } else {
      symlinkSync(join(outside, 'missing'), stateFilePath(mon));
    }
    const err = await failure(mutateState(projectTarget(project, mon), bump));
    if (code) {
      expect(err).toBeInstanceOf(SafeWriteError);
      expect((err as SafeWriteError).code).toBe(code);
      expect((err as SafeWriteError).publication).toBe('NOT_PUBLISHED');
    } else {
      // A dangling state.json reads as "missing", so the write path itself must refuse it.
      expect(err).toBeInstanceOf(SafeWriteError);
      expect((err as SafeWriteError).code).toBe('WRITE_TARGET_SYMLINK');
    }
    if (live) expect(readFileSync(join(outside, 'real'), 'utf8')).toBe(initial);
    expect(existsSync(join(outside, 'missing'))).toBe(false);
    expect(lstatSync(stateFilePath(mon)).isSymbolicLink()).toBe(true);
    noResidue();
  });

  it('an in-project symlink is refused for writes (W-SYM) while reads keep working', async () => {
    writeFileSync(join(project, 'real-state.json'), JSON.stringify((await readState(mon)), null, 2));
    symlinkSync(join(project, 'real-state.json'), stateFilePath(mon));
    expect((await readState(mon)).revision).toBe(0);
    const err = await failure(mutateState(projectTarget(project, mon), bump));
    expect(err).toBeInstanceOf(SafeWriteError);
    expect((err as SafeWriteError).code).toBe('WRITE_TARGET_SYMLINK');
    expect(lstatSync(stateFilePath(mon)).isSymbolicLink()).toBe(true);
    noResidue();
  });

  it('a hardlinked state.json is refused with its own code and is not detached', async () => {
    await mutateState(projectTarget(project, mon), bump);
    linkSync(stateFilePath(mon), join(outside, 'other-name'));
    const before = readFileSync(stateFilePath(mon), 'utf8');
    const err = (await failure(mutateState(projectTarget(project, mon), bump))) as SafeWriteError;
    expect(err).toBeInstanceOf(SafeWriteError);
    expect(err.code).toBe('WRITE_TARGET_HARDLINKED');
    expect(err.publication).toBe('NOT_PUBLISHED');
    expect(readFileSync(stateFilePath(mon), 'utf8')).toBe(before);
    expect(readFileSync(join(outside, 'other-name'), 'utf8')).toBe(before);
    expect(lstatSync(stateFilePath(mon)).nlink).toBe(2);
    noResidue();
  });

  it('a FIFO at state.json neither hangs nor gets replaced', async () => {
    execFileSync('mkfifo', [stateFilePath(mon)]);
    const err = await failure(mutateState(projectTarget(project, mon), bump));
    expect(err).toBeInstanceOf(StateFileError);
    expect(lstatSync(stateFilePath(mon)).isFIFO()).toBe(true);
    noResidue();
  });
});

describe('orphans are never cleaned up automatically', () => {
  it('pre-existing temp / staging / recovery leftovers survive successful writes untouched', async () => {
    writeFileSync(join(mon, 'state.json.tmp.1.deadbeef'), 'maybe an orphan, maybe a live writer');
    writeFileSync(join(mon, 'state.json.lock.creating.1.cafe'), 'x');
    await mutateState(projectTarget(project, mon), bump);
    await mutateState(projectTarget(project, mon), bump);
    expect(readFileSync(join(mon, 'state.json.tmp.1.deadbeef'), 'utf8')).toBe('maybe an orphan, maybe a live writer');
    expect(existsSync(join(mon, 'state.json.lock.creating.1.cafe'))).toBe(true);
  });
});

describe('size limit is enforced before any temp file exists', () => {
  it('refuses an oversized state with FILE_TOO_LARGE and creates nothing', async () => {
    const err = await failure(
      mutateState(projectTarget(project, mon), (d) => {
        d.strategic.systems['huge'] = { blob: 'x'.repeat(17 * 1024 * 1024) } as never;
      }),
    );
    expect(err).toBeInstanceOf(StateFileError);
    expect((err as StateFileError).fileCode).toBe('FILE_TOO_LARGE');
    expect(existsSync(stateFilePath(mon))).toBe(false);
    noResidue();
  });
});
