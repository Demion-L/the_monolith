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
  unlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { acquireLock } from './lock.js';
import { realFsOps, type FsOps } from '../root/safe-write.js';

// SEC-001B.1-R, finding L-1 — characterization of `releaseIfOwned` (reached through the function
// `acquireLock` returns). These tests pin the CURRENT behaviour; they do not change it.
//
//   * Fail-closed holds: a lock is removed only after its record was read through the unified safe
//     read and matched this process's own `pid:nonce`. Anything else (second link, replaced by
//     another owner, symlink, unreadable) leaves the lock file exactly as found.
//   * It is also SILENT: `release()` returns void, and neither a refusal nor a failed `unlink`
//     reaches the caller. That is LOCK-RELEASE-001 (tech-debt.md) and it stays OPEN: making release
//     observable changes the public `() => void` contract and the mutateState critical section, so
//     it is a separate, decided change. See the engineering proposal in the SEC-001B.1-R report.
//
// If one of these "stays silent" assertions starts to fail because release became observable, that
// is the intended resolution of LOCK-RELEASE-001: update the test together with ADR-012/ADR-014.

let base: string;
let dir: string;
let lockPath: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-l1-'));
  dir = join(base, 'state');
  mkdirSync(dir);
  lockPath = join(dir, 'state.json.lock');
});

afterEach(() => {
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* removed already */
  }
  rmSync(base, { recursive: true, force: true });
});

function staging(): string[] {
  return readdirSync(dir).filter((n) => n.includes('.creating.'));
}

describe('L-1 — release of our own lock', () => {
  it('removes a lock that holds our record and has one link', async () => {
    const release = await acquireLock(lockPath, { timeoutMs: 1000 });
    expect(existsSync(lockPath)).toBe(true);
    release();
    expect(existsSync(lockPath)).toBe(false);
    expect(staging()).toEqual([]);
  });

  it('release is idempotent: a second call on an already-released lock does nothing', async () => {
    const release = await acquireLock(lockPath, { timeoutMs: 1000 });
    release();
    expect(() => release()).not.toThrow();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('a second release does not remove a lock that another owner acquired in the meantime', async () => {
    const release = await acquireLock(lockPath, { timeoutMs: 1000 });
    release();
    const other = await acquireLock(lockPath, { timeoutMs: 1000 });
    const record = readFileSync(lockPath, 'utf8');
    release(); // stale handle of the first owner
    expect(readFileSync(lockPath, 'utf8')).toBe(record);
    other();
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('L-1 — release is fail-closed (lock is left untouched)', () => {
  it('FILE_HARDLINKED: a second link to the lock → not unlinked, no exception (silent)', async () => {
    const release = await acquireLock(lockPath, { timeoutMs: 1000 });
    const extra = join(dir, 'extra-link');
    linkSync(lockPath, extra);
    const before = readFileSync(lockPath, 'utf8');
    expect(() => release()).not.toThrow(); // LOCK-RELEASE-001: refusal is invisible to the caller
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(before);
    expect(lstatSync(lockPath).nlink).toBe(2);
  });

  it('FILE_HARDLINKED from a staging name that could not be removed after link(): the held lock cannot be released', async () => {
    // The real-world trigger: publication succeeded, removing our own staging name failed
    // (disposeOwned is best effort), so the lock keeps two links.
    const ops: Partial<FsOps> = {
      unlinkSync: ((p: string) => {
        if (p.includes('.creating.')) {
          const e = new Error('injected EIO') as NodeJS.ErrnoException;
          e.code = 'EIO';
          throw e;
        }
        return realFsOps.unlinkSync(p);
      }) as FsOps['unlinkSync'],
    };
    const release = await acquireLock(lockPath, { timeoutMs: 1000 }, { fsOps: ops });
    expect(lstatSync(lockPath).nlink).toBe(2);
    expect(staging()).toHaveLength(1);
    expect(() => release()).not.toThrow(); // silent
    // Fail closed: the lock is NOT removed, and the staging leftover is NOT deleted by name either
    // (no path-based recovery; FS-CLEAN-001).
    expect(existsSync(lockPath)).toBe(true);
    expect(staging()).toHaveLength(1);
    expect(readFileSync(lockPath, 'utf8')).toMatch(new RegExp(`"pid":${process.pid},`));
  });

  it('FILE_CHANGED / other owner: a lock now holding someone else\'s record is never removed', async () => {
    const release = await acquireLock(lockPath, { timeoutMs: 1000 });
    unlinkSync(lockPath);
    writeFileSync(lockPath, `${process.ppid}:someone-else`, { mode: 0o600 });
    release();
    expect(readFileSync(lockPath, 'utf8')).toBe(`${process.ppid}:someone-else`);
  });

  it('a lock replaced by a symlink is not followed and not removed; the target is untouched', async () => {
    const release = await acquireLock(lockPath, { timeoutMs: 1000 });
    const own = readFileSync(lockPath, 'utf8');
    const target = join(base, 'target');
    writeFileSync(target, own); // would match our own record if it were followed
    unlinkSync(lockPath);
    symlinkSync(target, lockPath);
    expect(() => release()).not.toThrow();
    expect(lstatSync(lockPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(own);
  });

  it('an unreadable lock record (empty/malformed) is not removed', async () => {
    const release = await acquireLock(lockPath, { timeoutMs: 1000 });
    unlinkSync(lockPath);
    writeFileSync(lockPath, '', { mode: 0o600 });
    release();
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('');
  });

  it.skipIf(process.getuid?.() === 0)('unlink failure (EACCES on the directory) after ownership is confirmed: lock stays, release stays silent', async () => {
    const release = await acquireLock(lockPath, { timeoutMs: 1000 });
    chmodSync(dir, 0o500); // read + traverse, no write: unlink fails with EACCES
    try {
      expect(() => release()).not.toThrow(); // LOCK-RELEASE-001: the failed release is swallowed
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      chmodSync(dir, 0o700);
    }
    // The leftover lock still holds our own record: the safe, owner-checked release works once
    // the cause is gone, so nothing needs a path-based recovery.
    release();
    expect(existsSync(lockPath)).toBe(false);
  });
});
