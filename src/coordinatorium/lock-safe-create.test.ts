import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { acquireLock } from './lock.js';
import { LockCreationError, LockTimeoutError } from './errors.js';
import { realFsOps, type FsOps } from '../root/safe-write.js';

// SEC-001B.2: lock staging is created through the shared safe-write
// primitive. Ownership / backoff / recovery semantics are covered by
// lock.test.ts, which runs unchanged; this file covers what is new: file mode,
// symlink refusal, and the publication states of the publish step.
let base: string;
let dir: string;
let outside: string;
let lockPath: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-lock-'));
  dir = join(base, 'state');
  outside = join(base, 'outside');
  mkdirSync(dir);
  mkdirSync(outside);
  lockPath = join(dir, 'state.json.lock');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function errno(code: string): NodeJS.ErrnoException {
  const e = new Error(`injected ${code}`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

function staging(): string[] {
  return readdirSync(dir).filter((n) => n.includes('.creating.'));
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

describe('lock file mode', () => {
  it('the published lock is 0600 regardless of the umask, and no staging name remains', async () => {
    for (const um of [0o022, 0o277, 0]) {
      const old = process.umask(um);
      try {
        const release = await acquireLock(lockPath, { timeoutMs: 1000 });
        expect(lstatSync(lockPath).mode & 0o777).toBe(0o600);
        expect(lstatSync(lockPath).nlink).toBe(1);
        expect(staging()).toEqual([]);
        release();
      } finally {
        process.umask(old);
      }
      expect(existsSync(lockPath)).toBe(false);
    }
  });
});

describe('symlinks and special files at the lock path', () => {
  it('a dangling symlink at the lock path is never written through: the acquire times out and the link is untouched', async () => {
    symlinkSync(join(outside, 'victim'), lockPath);
    await expect(acquireLock(lockPath, { timeoutMs: 150, retryDelayMs: 10 })).rejects.toBeInstanceOf(LockTimeoutError);
    expect(existsSync(join(outside, 'victim'))).toBe(false);
    expect(lstatSync(lockPath).isSymbolicLink()).toBe(true);
    expect(staging()).toEqual([]);
  });

  it('a staging name that cannot be created exclusively fails as staging-open and publishes nothing', async () => {
    const ops: Partial<FsOps> = {
      openSync: (() => {
        throw errno('EEXIST');
      }) as unknown as FsOps['openSync'],
    };
    const err = (await caught(acquireLock(lockPath, { timeoutMs: 200 }, { fsOps: ops }))) as LockCreationError;
    expect(err).toBeInstanceOf(LockCreationError);
    expect(err.phase).toBe('staging-open');
    expect(err.causeCode).toBe('EEXIST');
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('publication states of the publish step', () => {
  it('a link refused as unsupported (EPERM) fails as publish-link, cleans its staging file and publishes nothing', async () => {
    const ops: Partial<FsOps> = {
      linkSync: (() => {
        throw errno('EPERM');
      }) as unknown as FsOps['linkSync'],
    };
    const err = (await caught(acquireLock(lockPath, { timeoutMs: 200 }, { fsOps: ops }))) as LockCreationError;
    expect(err).toBeInstanceOf(LockCreationError);
    expect(err.phase).toBe('publish-link');
    expect(err.publication).toBe('NOT_PUBLISHED');
    expect(err.cleanedUp).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
    expect(staging()).toEqual([]);
  });

  it('link reports EIO but the lock was created: identity verification confirms it, the lock is acquired and owned', async () => {
    let links = 0;
    const ops: Partial<FsOps> = {
      linkSync: ((a: string, b: string) => {
        links++;
        linkSync(a, b);
        throw errno('EIO');
      }) as FsOps['linkSync'],
    };
    const release = await acquireLock(lockPath, { timeoutMs: 1000 }, { fsOps: ops });
    expect(links).toBe(1);
    expect(readFileSync(lockPath, 'utf8')).toMatch(new RegExp(`^${process.pid}:`));
    release();
    expect(existsSync(lockPath)).toBe(false);
    expect(staging()).toEqual([]);
  });

  it('UNKNOWN and undecidable by identity, but the ownership record at the lock path is ours: acquired, no second attempt', async () => {
    let links = 0;
    let linked = false;
    const ops: Partial<FsOps> = {
      linkSync: ((a: string, b: string) => {
        links++;
        linkSync(a, b);
        linked = true;
        throw errno('EIO');
      }) as FsOps['linkSync'],
      lstatSync: ((p: string, o?: unknown) => {
        if (linked) throw errno('EIO'); // the primitive's own verification cannot look
        return realFsOps.lstatSync(p, o as never);
      }) as unknown as FsOps['lstatSync'],
    };
    const release = await acquireLock(lockPath, { timeoutMs: 1000 }, { fsOps: ops });
    expect(links).toBe(1);
    expect(readFileSync(lockPath, 'utf8')).toMatch(new RegExp(`^${process.pid}:`));
    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('UNKNOWN that nothing can decide: fails with publication UNKNOWN, never retries, keeps the staging file', async () => {
    let links = 0;
    let attempted = false;
    const ops: Partial<FsOps> = {
      linkSync: (() => {
        links++;
        attempted = true;
        throw errno('EIO');
      }) as unknown as FsOps['linkSync'],
      lstatSync: ((p: string, o?: unknown) => {
        if (attempted) throw errno('EIO');
        return realFsOps.lstatSync(p, o as never);
      }) as unknown as FsOps['lstatSync'],
    };
    const err = (await caught(acquireLock(lockPath, { timeoutMs: 2000, retryDelayMs: 10 }, { fsOps: ops }))) as LockCreationError;
    expect(err).toBeInstanceOf(LockCreationError);
    expect(err.phase).toBe('publish-link');
    expect(err.publication).toBe('UNKNOWN');
    expect(err.cleanedUp).toBe(false);
    expect(err.message).toMatch(/UNKNOWN/);
    expect(links).toBe(1); // not retried, neither by the primitive nor by the acquire loop
    expect(staging()).toHaveLength(1); // left in place for a human
    expect(existsSync(lockPath)).toBe(false);
  });

  it('a lock published by someone else while we were staging is a lost race, not an error, and is left intact', async () => {
    const ops: Partial<FsOps> = {
      linkSync: ((a: string, b: string) => {
        // another acquirer wins the name between our staging and our link
        require_(b);
        return realFsOps.linkSync(a, b);
      }) as FsOps['linkSync'],
    };
    function require_(target: string): void {
      realFsOps.closeSync(realFsOps.openSync(target, 'wx'));
      writeOther(target);
    }
    function writeOther(target: string): void {
      // a valid foreign record whose owner is alive (this very process' parent)
      const fd = realFsOps.openSync(target, 'w');
      realFsOps.writeSync(fd, `${process.ppid}:other`);
      realFsOps.closeSync(fd);
    }
    await expect(acquireLock(lockPath, { timeoutMs: 120, retryDelayMs: 10 }, { fsOps: ops })).rejects.toBeInstanceOf(LockTimeoutError);
    expect(readFileSync(lockPath, 'utf8')).toBe(`${process.ppid}:other`);
    expect(staging()).toEqual([]);
  });
});
