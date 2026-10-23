import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SafeWriteError,
  createExclusive,
  createFile,
  disposeOwned,
  openParent,
  probeTarget,
  projectBoundary,
  replaceFile,
  trustedDirectoryBoundary,
  type WriteErrorCode,
} from './index.js';
import { realFsOps, type FsOps } from './safe-write.js';

// Every dangerous scenario runs inside a fresh temp tree; `outside` is a
// sibling directory that must never be touched by a refused write.
let base: string;
let project: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-sw-'));
  project = join(base, 'project');
  outside = join(base, 'outside');
  mkdirSync(project);
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function mkfifo(p: string): void {
  execFileSync('mkfifo', [p]);
}

function parentOf(dir: string = project) {
  return openParent(projectBoundary(project), dir);
}

function errno(code: string): NodeJS.ErrnoException {
  const e = new Error(`injected ${code}`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

function catchSafe(fn: () => unknown): SafeWriteError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SafeWriteError);
    return err as SafeWriteError;
  }
  throw new Error('expected SafeWriteError, nothing was thrown');
}

function expectCode(fn: () => unknown, code: WriteErrorCode, publication: 'NOT_PUBLISHED' | 'UNKNOWN' = 'NOT_PUBLISHED'): SafeWriteError {
  const e = catchSafe(fn);
  expect(e.code).toBe(code);
  expect(e.publication).toBe(publication);
  return e;
}

function leftovers(dir: string): string[] {
  return readdirSync(dir).filter((n) => /\.tmp\./.test(n));
}

function mode(p: string): number {
  return lstatSync(p).mode & 0o777;
}

/** Counting wrapper around a real fs op. */
function counted<K extends keyof FsOps>(name: K, impl?: FsOps[K]): { fn: FsOps[K]; calls: () => number } {
  let n = 0;
  const target = (impl ?? realFsOps[name]) as (...a: unknown[]) => unknown;
  const fn = ((...a: unknown[]) => {
    n++;
    return target(...a);
  }) as unknown as FsOps[K];
  return { fn, calls: () => n };
}

const OPTS = { mode: 0o600 } as const;

describe('boundary and parent resolution', () => {
  it('refuses a directory outside the project boundary', () => {
    expectCode(() => openParent(projectBoundary(project), outside), 'WRITE_OUTSIDE_BOUNDARY');
    expectCode(() => openParent(projectBoundary(project), join(project, '..', 'outside')), 'WRITE_OUTSIDE_BOUNDARY');
  });

  it('refuses a symlinked parent that points outside, and creates nothing there', () => {
    symlinkSync(outside, join(project, '.monolith'));
    expectCode(() => openParent(projectBoundary(project), join(project, '.monolith', 'sub'), { create: true }), 'WRITE_PARENT_SYMLINK');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses a symlinked parent that stays INSIDE the project (W-SYM)', () => {
    mkdirSync(join(project, 'real'));
    symlinkSync(join(project, 'real'), join(project, 'alias'));
    expectCode(() => openParent(projectBoundary(project), join(project, 'alias')), 'WRITE_PARENT_SYMLINK');
  });

  it('refuses a dangling and a looping symlink as a parent', () => {
    symlinkSync(join(outside, 'nope'), join(project, 'dangling'));
    expectCode(() => openParent(projectBoundary(project), join(project, 'dangling')), 'WRITE_PARENT_SYMLINK');
    symlinkSync(join(project, 'loop'), join(project, 'loop'));
    expectCode(() => openParent(projectBoundary(project), join(project, 'loop')), 'WRITE_PARENT_SYMLINK');
  });

  it('refuses a regular file used as a directory; reports a missing one; creates nested directories on request', () => {
    writeFileSync(join(project, 'file'), 'x');
    expectCode(() => openParent(projectBoundary(project), join(project, 'file', 'sub')), 'WRITE_PARENT_NOT_DIRECTORY');
    expectCode(() => openParent(projectBoundary(project), join(project, 'missing')), 'WRITE_PARENT_MISSING');
    openParent(projectBoundary(project), join(project, 'a', 'b', 'c'), { create: true });
    expect(statSync(join(project, 'a', 'b', 'c')).isDirectory()).toBe(true);
  });

  it('refuses a directory planted by a concurrent actor as a symlink during creation', () => {
    const boundary = projectBoundary(project);
    // The "concurrent actor" runs inside the mkdir call: it wins the race and plants a symlink.
    const mkdirSync2 = ((p: string) => {
      symlinkSync(outside, p);
      throw errno('EEXIST');
    }) as unknown as FsOps['mkdirSync'];
    expectCode(
      () => openParent(boundary, join(project, 'late'), { create: true, ops: { mkdirSync: mkdirSync2 } }),
      'WRITE_PARENT_SYMLINK',
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  it('trusted-directory scope: ancestors of the directory are trusted by the caller (documented property), links below are not', () => {
    symlinkSync(project, join(base, 'alias-of-project'));
    // The boundary itself may sit behind a symlinked ancestor: that is the contract of this mode.
    const boundary = trustedDirectoryBoundary(join(base, 'alias-of-project'));
    const parent = openParent(boundary, join(base, 'alias-of-project'));
    createFile(parent, 'ok.txt', 'ok', OPTS);
    expect(readFileSync(join(project, 'ok.txt'), 'utf8')).toBe('ok');
    // ... but a link BELOW the trusted directory is refused.
    symlinkSync(outside, join(project, 'below'));
    expectCode(() => openParent(boundary, join(base, 'alias-of-project', 'below')), 'WRITE_PARENT_SYMLINK');
  });

  it('trusted-directory scope still refuses a target outside the directory', () => {
    expectCode(() => openParent(trustedDirectoryBoundary(project), outside), 'WRITE_OUTSIDE_BOUNDARY');
  });

  it('rejects an unusable boundary', () => {
    expectCode(() => projectBoundary(join(base, 'does-not-exist')), 'WRITE_BOUNDARY_INVALID');
    expectCode(() => projectBoundary(''), 'WRITE_BOUNDARY_INVALID');
  });

  it('ParentRef is opaque: no fields to read a path from', () => {
    const p = parentOf();
    expect(Object.keys(p)).toEqual([]);
    expect(JSON.stringify(p)).toBe('{}');
  });

  it('tripwire: a parent swapped BEFORE the operation is detected', () => {
    mkdirSync(join(project, 'd'));
    const p = parentOf(join(project, 'd'));
    renameSync(join(project, 'd'), join(project, 'd.moved'));
    symlinkSync(outside, join(project, 'd'));
    expectCode(() => createFile(p, 'x.txt', 'x', OPTS), 'WRITE_PARENT_CHANGED');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('KNOWN LIMITATION (SEC-001B.3): a parent swapped AFTER the re-check is NOT detected', () => {
    mkdirSync(join(project, 'd'));
    const p = parentOf(join(project, 'd'));
    // The swap happens between the tripwire and the open(): the open resolves the path again.
    const swapping = ((path: string, flags: number, mode?: number) => {
      renameSync(join(project, 'd'), join(project, 'd.moved'));
      symlinkSync(outside, join(project, 'd'));
      return realFsOps.openSync(path, flags, mode);
    }) as FsOps['openSync'];
    const owned = createExclusive(p, 'tmp.file', 0o600, { ops: { openSync: swapping } });
    // This documents the gap rather than hiding it: the file was created outside the project.
    expect(existsSync(join(outside, 'tmp.file'))).toBe(true);
    expect(owned.token.name).toBe('tmp.file');
  });

  it('ParentRef cannot be forged', () => {
    expect(() => createFile({} as never, 'x', 'x', OPTS)).toThrow();
  });
});

describe('probeTarget (read-only classification)', () => {
  it('classifies free, existing, dangling symlink, FIFO, bad parents and outside paths', () => {
    const b = projectBoundary(project);
    writeFileSync(join(project, 'exists'), 'x');
    symlinkSync(join(outside, 'victim'), join(project, 'dangling'));
    mkfifo(join(project, 'fifo'));
    symlinkSync(outside, join(project, 'linkdir'));
    writeFileSync(join(project, 'plain'), 'x');

    expect(probeTarget(b, join(project, 'new.txt')).state).toBe('free');
    expect(probeTarget(b, join(project, 'deep', 'er', 'new.txt')).state).toBe('free');
    expect(probeTarget(b, join(project, 'exists')).state).toBe('exists');
    expect(probeTarget(b, join(project, 'dangling')).state).toBe('symlink');
    expect(probeTarget(b, join(project, 'fifo')).state).toBe('special');
    expect(probeTarget(b, join(project, 'linkdir', 'x')).state).toBe('parent-symlink');
    expect(probeTarget(b, join(project, 'plain', 'x')).state).toBe('parent-not-directory');
    expect(probeTarget(b, join(outside, 'x')).state).toBe('outside');
    // read-only
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe('createFile', () => {
  it('creates a complete file at 0600, no temp residue, single link', () => {
    const r = createFile(parentOf(), 'a.txt', 'hello', OPTS);
    expect(r.publication).toBe('PUBLISHED');
    expect(['full', 'file']).toContain(r.durability);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('hello');
    expect(mode(join(project, 'a.txt'))).toBe(0o600);
    expect(lstatSync(join(project, 'a.txt')).nlink).toBe(1);
    expect(leftovers(project)).toEqual([]);
  });

  it('exactMode:false follows the umask', () => {
    const old = process.umask(0o022);
    try {
      createFile(parentOf(), 'doc.md', 'x', { mode: 0o666, exactMode: false });
      expect(mode(join(project, 'doc.md'))).toBe(0o644);
    } finally {
      process.umask(old);
    }
  });

  it('exact 0600 is independent of the umask', () => {
    for (const um of [0o022, 0o277, 0]) {
      const old = process.umask(um);
      try {
        createFile(parentOf(), `s-${um}.json`, '{}', OPTS);
        expect(mode(join(project, `s-${um}.json`))).toBe(0o600);
      } finally {
        process.umask(old);
      }
    }
  });

  it('never overwrites an existing regular file', () => {
    writeFileSync(join(project, 'a.txt'), 'original');
    expectCode(() => createFile(parentOf(), 'a.txt', 'new', OPTS), 'WRITE_TARGET_EXISTS');
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('original');
  });

  it('refuses a dangling symlink at the target and creates nothing outside (the confirmed init vulnerability)', () => {
    symlinkSync(join(outside, 'victim.txt'), join(project, 'CLAUDE.md'));
    expectCode(() => createFile(parentOf(), 'CLAUDE.md', 'x', OPTS), 'WRITE_TARGET_SYMLINK');
    expect(existsSync(join(outside, 'victim.txt'))).toBe(false);
    expect(leftovers(project)).toEqual([]);
  });

  it('refuses a live symlink at the target without touching what it points to', () => {
    writeFileSync(join(outside, 'precious'), 'keep');
    symlinkSync(join(outside, 'precious'), join(project, 'link'));
    expectCode(() => createFile(parentOf(), 'link', 'x', OPTS), 'WRITE_TARGET_SYMLINK');
    expect(readFileSync(join(outside, 'precious'), 'utf8')).toBe('keep');
  });

  it('refuses a FIFO at the target without blocking', () => {
    mkfifo(join(project, 'pipe'));
    expectCode(() => createFile(parentOf(), 'pipe', 'x', OPTS), 'WRITE_TARGET_NOT_REGULAR');
  });

  it('refuses a directory at the target', () => {
    mkdirSync(join(project, 'dir'));
    expectCode(() => createFile(parentOf(), 'dir', 'x', OPTS), 'WRITE_TARGET_NOT_REGULAR');
  });

  it('a target that appears concurrently (after validation) is not overwritten: lost race', () => {
    const linkSync2 = ((src: string, dst: string) => {
      writeFileSync(dst, 'someone else');
      return realFsOps.linkSync(src, dst);
    }) as FsOps['linkSync'];
    const e = expectCode(() => createFile(parentOf(), 'raced.txt', 'mine', { ...OPTS, ops: { linkSync: linkSync2 } }), 'WRITE_TARGET_EXISTS');
    expect(e.tmp?.removed).toBe(true);
    expect(readFileSync(join(project, 'raced.txt'), 'utf8')).toBe('someone else');
    expect(leftovers(project)).toEqual([]);
  });

  it('a symlink that appears concurrently at the target is not written through', () => {
    const linkSync2 = ((src: string, dst: string) => {
      symlinkSync(join(outside, 'victim'), dst);
      return realFsOps.linkSync(src, dst);
    }) as FsOps['linkSync'];
    expectCode(() => createFile(parentOf(), 'raced', 'mine', { ...OPTS, ops: { linkSync: linkSync2 } }), 'WRITE_TARGET_EXISTS');
    expect(existsSync(join(outside, 'victim'))).toBe(false);
    expect(lstatSync(join(project, 'raced')).isSymbolicLink()).toBe(true);
  });

  it('rejects names with separators or traversal', () => {
    for (const n of ['', '.', '..', 'a/b', '../x', 'a\\b', 'a\0b']) {
      expectCode(() => createFile(parentOf(), n, 'x', OPTS), 'WRITE_OUTSIDE_BOUNDARY');
    }
  });

  it('enforces maxBytes before creating anything', () => {
    expectCode(() => createFile(parentOf(), 'big', 'x'.repeat(11), { ...OPTS, maxBytes: 10 }), 'WRITE_TOO_LARGE');
    expect(readdirSync(project)).toEqual([]);
  });
});

describe('replaceFile', () => {
  it('replaces content atomically and keeps no residue', () => {
    writeFileSync(join(project, 'state.json'), 'old');
    const r = replaceFile(parentOf(), 'state.json', 'new', OPTS);
    expect(r.publication).toBe('PUBLISHED');
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('new');
    expect(leftovers(project)).toEqual([]);
  });

  it('creates a missing file at 0600', () => {
    replaceFile(parentOf(), 'state.json', 'new', OPTS);
    expect(mode(join(project, 'state.json'))).toBe(0o600);
  });

  it('preserves the mode of an existing file (not the umask, not 0600)', () => {
    writeFileSync(join(project, 'state.json'), 'old');
    chmodSync(join(project, 'state.json'), 0o640);
    replaceFile(parentOf(), 'state.json', 'new', OPTS);
    expect(mode(join(project, 'state.json'))).toBe(0o640);
  });

  it('does not carry setuid/setgid/sticky bits over', () => {
    writeFileSync(join(project, 'state.json'), 'old');
    chmodSync(join(project, 'state.json'), 0o4755);
    replaceFile(parentOf(), 'state.json', 'new', OPTS);
    expect(lstatSync(join(project, 'state.json')).mode & 0o7000).toBe(0);
    expect(mode(join(project, 'state.json'))).toBe(0o755);
  });

  it('preserveMode:false applies the requested mode', () => {
    writeFileSync(join(project, 'state.json'), 'old');
    chmodSync(join(project, 'state.json'), 0o644);
    replaceFile(parentOf(), 'state.json', 'new', { ...OPTS, preserveMode: false });
    expect(mode(join(project, 'state.json'))).toBe(0o600);
  });

  it('refuses a symlink at the destination (live, dangling) and leaves the link target alone', () => {
    writeFileSync(join(outside, 'real'), 'keep');
    symlinkSync(join(outside, 'real'), join(project, 'state.json'));
    expectCode(() => replaceFile(parentOf(), 'state.json', 'new', OPTS), 'WRITE_TARGET_SYMLINK');
    expect(readFileSync(join(outside, 'real'), 'utf8')).toBe('keep');
    expect(lstatSync(join(project, 'state.json')).isSymbolicLink()).toBe(true);

    unlinkSync(join(project, 'state.json'));
    symlinkSync(join(outside, 'missing'), join(project, 'state.json'));
    expectCode(() => replaceFile(parentOf(), 'state.json', 'new', OPTS), 'WRITE_TARGET_SYMLINK');
    expect(existsSync(join(outside, 'missing'))).toBe(false);
  });

  it('refuses a FIFO and a directory at the destination instead of replacing them', () => {
    mkfifo(join(project, 'pipe'));
    expectCode(() => replaceFile(parentOf(), 'pipe', 'x', OPTS), 'WRITE_TARGET_NOT_REGULAR');
    expect(lstatSync(join(project, 'pipe')).isFIFO()).toBe(true);
    mkdirSync(join(project, 'dir'));
    expectCode(() => replaceFile(parentOf(), 'dir', 'x', OPTS), 'WRITE_TARGET_NOT_REGULAR');
  });

  it('refuses a hardlinked destination (nlink > 1) and changes nothing', () => {
    writeFileSync(join(outside, 'other-name'), 'shared');
    linkSync(join(outside, 'other-name'), join(project, 'state.json'));
    const e = expectCode(() => replaceFile(parentOf(), 'state.json', 'new', OPTS), 'WRITE_TARGET_HARDLINKED');
    expect(e.message).toMatch(/hard links/);
    expect(readFileSync(join(outside, 'other-name'), 'utf8')).toBe('shared');
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('shared');
    expect(lstatSync(join(project, 'state.json')).nlink).toBe(2);
    expect(leftovers(project)).toEqual([]);
  });

  it('a temporary name pre-planted as a symlink is not written through', () => {
    // Even a guessed name cannot redirect the write: O_EXCL refuses it.
    const create = counted('openSync', ((p: string, f: number, m?: number) => {
      if (String(p).includes('.tmp.')) symlinkSync(join(outside, 'tmp-target'), String(p));
      return realFsOps.openSync(p, f, m);
    }) as FsOps['openSync']);
    expectCode(() => replaceFile(parentOf(), 'state.json', 'new', { ...OPTS, ops: { openSync: create.fn } }), 'WRITE_TMP_COLLISION');
    expect(existsSync(join(outside, 'tmp-target'))).toBe(false);
  });

  it('keeps unrelated *.tmp.* and *.creating.* files: nothing is cleaned up by name pattern', () => {
    writeFileSync(join(project, 'state.json.tmp.1.aaaa'), 'orphan?');
    writeFileSync(join(project, 'state.json.lock.creating.1.bbbb'), 'orphan?');
    mkfifo(join(project, 'state.json.lock.recovery'));
    replaceFile(parentOf(), 'state.json', 'new', OPTS);
    expect(readFileSync(join(project, 'state.json.tmp.1.aaaa'), 'utf8')).toBe('orphan?');
    expect(existsSync(join(project, 'state.json.lock.creating.1.bbbb'))).toBe(true);
    expect(lstatSync(join(project, 'state.json.lock.recovery')).isFIFO()).toBe(true);
  });

  it('enforces maxBytes before creating the temp file', () => {
    expectCode(() => replaceFile(parentOf(), 'state.json', 'x'.repeat(5), { ...OPTS, maxBytes: 4 }), 'WRITE_TOO_LARGE');
    expect(readdirSync(project)).toEqual([]);
  });
});

describe('failure injection: before publication (NOT_PUBLISHED)', () => {
  function seeded(): void {
    writeFileSync(join(project, 'state.json'), 'OLD');
  }
  function untouched(): void {
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('OLD');
    expect(leftovers(project)).toEqual([]);
  }

  it('ENOSPC on write: destination unchanged, temp removed, code mapped', () => {
    seeded();
    const w = (() => {
      throw errno('ENOSPC');
    }) as unknown as FsOps['writeSync'];
    const e = expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { writeSync: w } }), 'WRITE_NO_SPACE');
    expect(e.tmp).toMatchObject({ owned: true, removed: true });
    untouched();
  });

  it('a short write followed by an error: still nothing published', () => {
    seeded();
    let n = 0;
    const w = ((fd: number, buf: Buffer, off: number, len: number) => {
      if (n++ === 0) return realFsOps.writeSync(fd, buf, off, 1);
      throw errno('EIO');
    }) as FsOps['writeSync'];
    expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { writeSync: w } }), 'WRITE_FAILED');
    untouched();
  });

  it('a write that returns 0 bytes is an error, not an infinite loop', () => {
    seeded();
    const w = (() => 0) as unknown as FsOps['writeSync'];
    expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { writeSync: w } }), 'WRITE_FAILED');
    untouched();
  });

  it('EIO on fsync: NOT_PUBLISHED, temp removed, fsync is never retried', () => {
    seeded();
    const f = counted('fsyncSync', (() => {
      throw errno('EIO');
    }) as unknown as FsOps['fsyncSync']);
    const e = expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { fsyncSync: f.fn } }), 'WRITE_FSYNC_FAILED');
    expect(e.tmp?.removed).toBe(true);
    expect(f.calls()).toBe(1);
    untouched();
  });

  it('error on close: NOT_PUBLISHED', () => {
    seeded();
    const c = (() => {
      throw errno('EIO');
    }) as unknown as FsOps['closeSync'];
    expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { closeSync: c } }), 'WRITE_FAILED');
    // the fd was leaked by the injected close; the temp file itself must still be removed
    untouched();
  });

  it('fchmod failure: NOT_PUBLISHED', () => {
    seeded();
    const f = (() => {
      throw errno('EPERM');
    }) as unknown as FsOps['fchmodSync'];
    expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { fchmodSync: f } }), 'WRITE_PERMISSION');
    untouched();
  });

  it('descriptor verification failure (unexpected link count): NOT_PUBLISHED', () => {
    seeded();
    const fs2 = ((fd: number, o: { bigint: true }) => {
      const st = realFsOps.fstatSync(fd, o);
      return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { nlink: 2n });
    }) as unknown as FsOps['fstatSync'];
    expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { fstatSync: fs2 } }), 'WRITE_VERIFY_FAILED');
    untouched();
  });

  it('rename fails with an allowlisted errno: NOT_PUBLISHED, one attempt, temp removed', () => {
    seeded();
    const r = counted('renameSync', (() => {
      throw errno('EACCES');
    }) as unknown as FsOps['renameSync']);
    const e = expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { renameSync: r.fn } }), 'WRITE_PERMISSION');
    expect(e.tmp).toMatchObject({ owned: true, removed: true });
    expect(r.calls()).toBe(1);
    untouched();
  });

  it('read-only filesystem on temp creation maps to WRITE_READONLY and creates nothing', () => {
    seeded();
    const o = (() => {
      throw errno('EROFS');
    }) as unknown as FsOps['openSync'];
    expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { openSync: o } }), 'WRITE_READONLY');
    untouched();
  });

  it('a temp file replaced by a foreign file before cleanup is NOT removed (identity check)', () => {
    seeded();
    let tmpPath = '';
    const o = ((p: string, f: number, m?: number) => {
      tmpPath = String(p);
      return realFsOps.openSync(p, f, m);
    }) as FsOps['openSync'];
    const w = (() => {
      // Someone swaps the temp name for their own file, then the write fails.
      unlinkSync(tmpPath);
      writeFileSync(tmpPath, 'FOREIGN');
      throw errno('EIO');
    }) as unknown as FsOps['writeSync'];
    const e = expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { openSync: o, writeSync: w } }), 'WRITE_FAILED');
    expect(e.tmp).toMatchObject({ owned: false, removed: false });
    expect(readFileSync(tmpPath, 'utf8')).toBe('FOREIGN');
    expect(e.message).toMatch(/NOT removed/);
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('OLD');
  });
});

describe('failure injection: publication states', () => {
  function seeded(): void {
    writeFileSync(join(project, 'state.json'), 'OLD');
  }

  it('rename fails with EIO but did not happen: verification proves NOT_PUBLISHED, one rename, temp removed', () => {
    seeded();
    const r = counted('renameSync', (() => {
      throw errno('EIO');
    }) as unknown as FsOps['renameSync']);
    const e = expectCode(() => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { renameSync: r.fn } }), 'WRITE_FAILED');
    expect(e.tmp?.removed).toBe(true);
    expect(r.calls()).toBe(1);
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('OLD');
    expect(leftovers(project)).toEqual([]);
  });

  it('rename happened but reported EIO: verification proves PUBLISHED (a warning, not an error), one rename', () => {
    seeded();
    const r = counted('renameSync', ((a: string, b: string) => {
      renameSync(a, b);
      throw errno('EIO');
    }) as FsOps['renameSync']);
    const out = replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { renameSync: r.fn } });
    expect(out.publication).toBe('PUBLISHED');
    expect(out.warnings.map((w) => w.code)).toContain('PUBLICATION_VERIFIED_AFTER_ERROR');
    expect(r.calls()).toBe(1);
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('NEW');
  });

  it('UNKNOWN: rename fails with EIO and the verification cannot decide -> thrown as UNKNOWN, never retried, nothing deleted', () => {
    seeded();
    const r = counted('renameSync', (() => {
      throw errno('EIO');
    }) as unknown as FsOps['renameSync']);
    const u = counted('unlinkSync');
    let afterRename = false;
    const lstat = ((p: string, o?: unknown) => {
      if (r.calls() > 0) afterRename = true;
      if (afterRename) throw errno('EIO');
      return realFsOps.lstatSync(p, o as never);
    }) as unknown as FsOps['lstatSync'];
    const e = expectCode(
      () => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, ops: { renameSync: r.fn, unlinkSync: u.fn, lstatSync: lstat } }),
      'WRITE_PUBLICATION_UNKNOWN',
      'UNKNOWN',
    );
    expect(e.message).toMatch(/Check its current state before repeating/);
    expect(r.calls()).toBe(1);
    expect(u.calls()).toBe(0);
    expect(leftovers(project).length).toBe(1);
    expect(e.tmp).toMatchObject({ owned: true, removed: false });
  });

  it('an unknown errno is treated as UNKNOWN (not as NOT_PUBLISHED) when verification is undecided', () => {
    seeded();
    const r = (() => {
      throw errno('ESTALE');
    }) as unknown as FsOps['renameSync'];
    const lstat = ((p: string, o?: unknown) => {
      if (String(p).endsWith('state.json') || String(p).includes('.tmp.')) {
        // after staging: make every inspection of the two names fail
        if (stagingDone) throw errno('EIO');
      }
      return realFsOps.lstatSync(p, o as never);
    }) as unknown as FsOps['lstatSync'];
    let stagingDone = false;
    const f = ((fd: number) => {
      stagingDone = true;
      return realFsOps.fsyncSync(fd);
    }) as FsOps['fsyncSync'];
    expectCode(
      () => replaceFile(parentOf(), 'state.json', 'NEW', { ...OPTS, durability: 'file', ops: { renameSync: r, lstatSync: lstat, fsyncSync: f } }),
      'WRITE_PUBLICATION_UNKNOWN',
      'UNKNOWN',
    );
  });

  it('link: EEXIST with link count 1 is a lost race (NOT_PUBLISHED); the other file is intact', () => {
    // covered by the createFile "appears concurrently" tests; here via the link primitive's own counter
    const l = counted('linkSync', ((_: string, dst: string) => {
      writeFileSync(dst, 'theirs');
      throw errno('EEXIST');
    }) as FsOps['linkSync']);
    const e = expectCode(() => createFile(parentOf(), 'n.txt', 'mine', { ...OPTS, ops: { linkSync: l.fn } }), 'WRITE_TARGET_EXISTS');
    expect(e.tmp?.removed).toBe(true);
    expect(l.calls()).toBe(1);
    expect(readFileSync(join(project, 'n.txt'), 'utf8')).toBe('theirs');
  });

  it('link: EEXIST but our link count is 2 (lost reply) -> PUBLISHED with a warning, no second link()', () => {
    const l = counted('linkSync', ((a: string, b: string) => {
      linkSync(a, b);
      throw errno('EEXIST');
    }) as FsOps['linkSync']);
    const out = createFile(parentOf(), 'n.txt', 'mine', { ...OPTS, ops: { linkSync: l.fn } });
    expect(out.warnings.map((w) => w.code)).toContain('PUBLICATION_VERIFIED_AFTER_ERROR');
    expect(l.calls()).toBe(1);
    expect(readFileSync(join(project, 'n.txt'), 'utf8')).toBe('mine');
    expect(lstatSync(join(project, 'n.txt')).nlink).toBe(1);
  });

  it('link: EPERM means hard links are unsupported here; nothing published, temp removed', () => {
    const l = (() => {
      throw errno('EPERM');
    }) as unknown as FsOps['linkSync'];
    const e = expectCode(() => createFile(parentOf(), 'n.txt', 'mine', { ...OPTS, ops: { linkSync: l } }), 'WRITE_LINK_UNSUPPORTED');
    expect(e.tmp?.removed).toBe(true);
    expect(existsSync(join(project, 'n.txt'))).toBe(false);
    expect(leftovers(project)).toEqual([]);
  });

  it('link: EIO that did happen is verified as PUBLISHED; EIO that did not happen is NOT_PUBLISHED', () => {
    const did = createFile(parentOf(), 'a.txt', 'A', {
      ...OPTS,
      ops: {
        linkSync: ((a: string, b: string) => {
          linkSync(a, b);
          throw errno('EIO');
        }) as FsOps['linkSync'],
      },
    });
    expect(did.warnings.map((w) => w.code)).toContain('PUBLICATION_VERIFIED_AFTER_ERROR');
    expectCode(
      () =>
        createFile(parentOf(), 'b.txt', 'B', {
          ...OPTS,
          ops: {
            linkSync: (() => {
              throw errno('EIO');
            }) as unknown as FsOps['linkSync'],
          },
        }),
      'WRITE_FAILED',
    );
    expect(existsSync(join(project, 'b.txt'))).toBe(false);
    expect(leftovers(project)).toEqual([]);
  });
});

describe('after publication: warnings, never errors', () => {
  it('a staging unlink that fails leaves a second name: success + STAGING_RESIDUE, file complete', () => {
    const u = ((p: string) => {
      if (String(p).includes('.tmp.')) throw errno('EBUSY');
      return realFsOps.unlinkSync(p);
    }) as FsOps['unlinkSync'];
    const out = createFile(parentOf(), 'a.txt', 'complete', { ...OPTS, ops: { unlinkSync: u } });
    expect(out.publication).toBe('PUBLISHED');
    expect(out.warnings.map((w) => w.code)).toContain('STAGING_RESIDUE');
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('complete');
  });

  it('directory fsync unsupported (EINVAL): success, durability downgraded to file, warning', () => {
    const o = ((p: string, f: number, m?: number) => {
      if ((f & constants.O_DIRECTORY) !== 0) throw errno('EINVAL');
      return realFsOps.openSync(p, f, m);
    }) as FsOps['openSync'];
    const out = replaceFile(parentOf(), 'state.json', 'x', { ...OPTS, ops: { openSync: o } });
    expect(out.durability).toBe('file');
    expect(out.warnings.map((w) => w.code)).toContain('DIR_FSYNC_UNSUPPORTED');
  });

  it('directory fsync fails with EIO: success, durability unknown, warning, no exception', () => {
    let dirFd = -1;
    const o = ((p: string, f: number, m?: number) => {
      const fd = realFsOps.openSync(p, f, m);
      if ((f & constants.O_DIRECTORY) !== 0) dirFd = fd;
      return fd;
    }) as FsOps['openSync'];
    const f = ((fd: number) => {
      if (fd === dirFd) throw errno('EIO');
      return realFsOps.fsyncSync(fd);
    }) as FsOps['fsyncSync'];
    const out = replaceFile(parentOf(), 'state.json', 'x', { ...OPTS, ops: { openSync: o, fsyncSync: f } });
    expect(out.publication).toBe('PUBLISHED');
    expect(out.durability).toBe('unknown');
    expect(out.warnings.map((w) => w.code)).toContain('DIR_FSYNC_FAILED');
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('x');
  });

  it('durability levels control which fsyncs run', () => {
    const none = counted('fsyncSync');
    expect(replaceFile(parentOf(), 'a', 'x', { ...OPTS, durability: 'none', ops: { fsyncSync: none.fn } }).durability).toBe('none');
    expect(none.calls()).toBe(0);
    const file = counted('fsyncSync');
    expect(replaceFile(parentOf(), 'b', 'x', { ...OPTS, durability: 'file', ops: { fsyncSync: file.fn } }).durability).toBe('file');
    expect(file.calls()).toBe(1);
    const full = counted('fsyncSync');
    replaceFile(parentOf(), 'c', 'x', { ...OPTS, durability: 'full', ops: { fsyncSync: full.fn } });
    expect(full.calls()).toBe(2);
  });

  it('the documented order holds: write, fchmod, fstat, fsync(file), close, publish, fsync(dir)', () => {
    const seq: string[] = [];
    const wrap = <K extends keyof FsOps>(name: K, tag: string): FsOps[K] =>
      ((...a: unknown[]) => {
        seq.push(tag);
        return (realFsOps[name] as unknown as (...x: unknown[]) => unknown)(...a);
      }) as unknown as FsOps[K];
    replaceFile(parentOf(), 'o.json', 'x', {
      ...OPTS,
      ops: {
        writeSync: wrap('writeSync', 'write'),
        fchmodSync: wrap('fchmodSync', 'fchmod'),
        fstatSync: wrap('fstatSync', 'fstat'),
        fsyncSync: wrap('fsyncSync', 'fsync'),
        closeSync: wrap('closeSync', 'close'),
        renameSync: wrap('renameSync', 'rename'),
      },
    });
    // create (fstat records identity) -> write -> fchmod -> verify (fstat) -> fsync(file) -> close -> publish -> fsync(dir) -> close(dir)
    expect(seq).toEqual(['fstat', 'write', 'fchmod', 'fstat', 'fsync', 'close', 'rename', 'fsync', 'close']);
  });
});

describe('platform capabilities (simulated; real Windows is unverified)', () => {
  it('without O_NOFOLLOW the flag is not OR-ed with undefined, a warning is returned, and symlinks are still refused', () => {
    const seen: number[] = [];
    const o = ((p: string, f: number, m?: number) => {
      seen.push(f);
      return realFsOps.openSync(p, f, m);
    }) as FsOps['openSync'];
    const caps = { noFollow: false, dirFsync: false, posix: false };
    const out = createFile(parentOf(), 'a.txt', 'x', { ...OPTS, caps, ops: { openSync: o } });
    expect(out.warnings.map((w) => w.code)).toContain('PLATFORM_BEST_EFFORT');
    expect(out.durability).toBe('file');
    expect(seen[0]).toBe(constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);

    symlinkSync(join(outside, 'v'), join(project, 'link'));
    expectCode(() => createFile(parentOf(), 'link', 'x', { ...OPTS, caps }), 'WRITE_TARGET_SYMLINK');
    writeFileSync(join(outside, 'o'), 'shared');
    linkSync(join(outside, 'o'), join(project, 'hard'));
    expectCode(() => replaceFile(parentOf(), 'hard', 'x', { ...OPTS, caps }), 'WRITE_TARGET_HARDLINKED');
    mkfifo(join(project, 'pipe'));
    expectCode(() => replaceFile(parentOf(), 'pipe', 'x', { ...OPTS, caps }), 'WRITE_TARGET_NOT_REGULAR');
    expect(existsSync(join(outside, 'v'))).toBe(false);
  });

  it('on a POSIX host with O_NOFOLLOW no platform warning is produced', () => {
    if (process.platform === 'win32') return;
    expect(replaceFile(parentOf(), 'a', 'x', OPTS).warnings.map((w) => w.code)).not.toContain('PLATFORM_BEST_EFFORT');
  });
});

describe('createExclusive / disposeOwned', () => {
  it('createExclusive refuses an existing name (file or symlink) and touches nothing', () => {
    writeFileSync(join(project, 'taken'), 'x');
    symlinkSync(join(outside, 'v'), join(project, 'lnk'));
    expectCode(() => createExclusive(parentOf(), 'taken', 0o600), 'WRITE_TMP_COLLISION');
    expectCode(() => createExclusive(parentOf(), 'lnk', 0o600), 'WRITE_TMP_COLLISION');
    expect(readFileSync(join(project, 'taken'), 'utf8')).toBe('x');
    expect(existsSync(join(outside, 'v'))).toBe(false);
  });

  it('disposeOwned removes only the file it created', () => {
    const p = parentOf();
    const a = createExclusive(p, 'mine', 0o600);
    expect(disposeOwned(p, a.token)).toBe('removed');
    expect(existsSync(join(project, 'mine'))).toBe(false);
    expect(disposeOwned(p, a.token)).toBe('absent');

    const b = createExclusive(p, 'mine2', 0o600);
    unlinkSync(join(project, 'mine2'));
    writeFileSync(join(project, 'mine2'), 'foreign');
    expect(disposeOwned(p, b.token)).toBe('not-owned');
    expect(readFileSync(join(project, 'mine2'), 'utf8')).toBe('foreign');

    const c = createExclusive(p, 'mine3', 0o600);
    unlinkSync(join(project, 'mine3'));
    symlinkSync(join(outside, 'x'), join(project, 'mine3'));
    expect(disposeOwned(p, c.token)).toBe('not-owned');
    expect(lstatSync(join(project, 'mine3')).isSymbolicLink()).toBe(true);
  });

  it('when the identity cannot be recorded, ownership is not claimed and the file is left in place', () => {
    const fs2 = (() => {
      throw errno('EIO');
    }) as unknown as FsOps['fstatSync'];
    const e = expectCode(() => createExclusive(parentOf(), 'orphaned', 0o600, { ops: { fstatSync: fs2 } }), 'WRITE_VERIFY_FAILED');
    expect(e.tmp).toMatchObject({ owned: false, removed: null });
    expect(existsSync(join(project, 'orphaned'))).toBe(true);
  });
});
