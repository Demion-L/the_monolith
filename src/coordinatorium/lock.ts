/**
 * Minimal cross-process file lock.
 *
 * Acquisition is a single `open(path, 'wx')` syscall — it either creates the
 * file or fails with EEXIST, atomically, on every platform Node supports.
 * That atomicity (not the later rename of state.json) is what actually
 * prevents lost updates between independent `monolith` processes.
 *
 * The lock file's contents (`pid:timestamp`) exist only to recover from a
 * crashed holder: if the recorded pid is no longer alive, or the lock is
 * older than `staleMs`, a waiter may steal it.
 */

import { openSync, writeSync, closeSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { LockTimeoutError } from './errors.js';

export interface LockOptions {
  /** Total time to wait for the lock before giving up. */
  timeoutMs?: number;
  /** Delay between acquisition attempts. */
  retryDelayMs?: number;
  /** A held lock older than this is assumed to be from a dead process. */
  staleMs?: number;
}

const DEFAULT_OPTIONS: Required<LockOptions> = {
  timeoutMs: 5000,
  retryDelayMs: 25,
  staleMs: 30_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ESRCH: no such process. EPERM: process exists, owned by someone else.
    return code === 'EPERM';
  }
}

function readLockHolder(lockPath: string): { pid: number; acquiredAt: number } | null {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    const [pidStr, tsStr] = raw.split(':');
    const pid = Number(pidStr);
    const acquiredAt = Number(tsStr);
    if (!Number.isInteger(pid) || !Number.isFinite(acquiredAt)) return null;
    return { pid, acquiredAt };
  } catch {
    return null;
  }
}

function isStale(lockPath: string, staleMs: number): boolean {
  const holder = readLockHolder(lockPath);
  if (holder === null) return true; // unreadable/malformed lock — treat as stale
  if (!isPidAlive(holder.pid)) return true;
  return Date.now() - holder.acquiredAt > staleMs;
}

function tryAcquire(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, 'wx');
    try {
      writeSync(fd, `${process.pid}:${Date.now()}`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

/**
 * Acquire `lockPath` exclusively, waiting and retrying (with stale-lock
 * recovery) up to `timeoutMs`. Returns a release function.
 */
export async function acquireLock(
  lockPath: string,
  options: LockOptions = {},
): Promise<() => void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const deadline = Date.now() + opts.timeoutMs;

  for (;;) {
    if (tryAcquire(lockPath)) {
      return () => {
        // Only release a lock we still own — never clear another holder's lock.
        const holder = readLockHolder(lockPath);
        if (holder !== null && holder.pid === process.pid && existsSync(lockPath)) {
          try {
            unlinkSync(lockPath);
          } catch {
            // already gone — fine
          }
        }
      };
    }

    if (isStale(lockPath, opts.staleMs)) {
      try {
        unlinkSync(lockPath);
      } catch {
        // someone else already cleaned it up — retry loop will re-check
      }
      continue;
    }

    if (Date.now() >= deadline) {
      throw new LockTimeoutError(
        `Timed out after ${opts.timeoutMs}ms waiting for lock at "${lockPath}"`,
      );
    }

    await sleep(opts.retryDelayMs);
  }
}
