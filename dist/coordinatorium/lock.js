/**
 * Minimal cross-process file lock.
 *
 * Acquisition is a single `open(path, 'wx')` syscall — it either creates the
 * file or fails with EEXIST, atomically, on every platform Node supports.
 * That atomicity is what actually prevents two processes from both believing
 * they own the lock at once; the lock file's body (`pid:nonce`) exists only
 * to support crash recovery.
 *
 * Three invariants govern every decision in this module:
 *
 *   1. Lock ownership is not time-based.
 *      The age of the lock file is never, by itself, a reason to take it.
 *   2. Uncertainty never grants ownership.
 *      If we cannot reliably establish that the recorded owner has exited,
 *      the lock is treated as held — we wait, we do not recover it.
 *   3. Timeout ends waiting, not ownership.
 *      `timeoutMs` bounds how long a *challenger* will wait to acquire the
 *      lock. It says nothing about how long the current owner may hold it.
 *
 * Known limitation: this is a local-filesystem lock built on POSIX rename/
 * open semantics. It does not claim to provide distributed coordination,
 * and its guarantees are not evaluated on network filesystems (NFS, SMB,
 * etc.) where `open(..., 'wx')` atomicity is not always dependable.
 */
import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import { LockTimeoutError } from './errors.js';
const DEFAULT_OPTIONS = {
    timeoutMs: 5000,
    retryDelayMs: 25,
};
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * Ask the OS whether `pid` is a live process. Only ESRCH ("no such
 * process") is treated as proof of death. EPERM means the process exists
 * but we lack permission to signal it — it may well be alive, so capture
 * is forbidden. Any other error is NOT evidence of anything and must not
 * be treated as proof of death either (invariant 2).
 */
function checkLiveness(pid) {
    try {
        process.kill(pid, 0);
        return 'alive';
    }
    catch (err) {
        const code = err.code;
        if (code === 'ESRCH')
            return 'dead';
        if (code === 'EPERM')
            return 'alive'; // exists, possibly alive — never treat as dead
        return 'unknown'; // anything else is ambiguous, not a death signal
    }
}
/** Content identity, not liveness. Used to detect whether a lock file has
 * changed (recovered by someone else, or released) between two reads. */
function sameRecord(a, b) {
    if (a === null || b === null)
        return a === b;
    return a.pid === b.pid && a.nonce === b.nonce;
}
/**
 * Parse a lock file's raw content. Returns null for anything that is not
 * unambiguously a well-formed `pid:nonce` record — including an empty
 * file, a partially written one, or garbage. A null result is NOT treated
 * as "no owner"; callers must treat it as uncertain (invariant 2).
 */
function parseLockRecord(raw) {
    const parts = raw.split(':');
    if (parts.length !== 2)
        return null;
    const [pidStr, nonce] = parts;
    const pid = Number(pidStr);
    if (!Number.isInteger(pid) || pid <= 0)
        return null;
    if (nonce.length === 0)
        return null;
    return { pid, nonce };
}
/** Read and parse the current lock file. Returns null for "does not exist
 * or unreadable/malformed" alike — both are handled identically by callers
 * (uncertain, in the ENOENT case trivially resolved by the next create
 * attempt). */
function readLockRecord(lockPath) {
    try {
        return parseLockRecord(readFileSync(lockPath, 'utf8'));
    }
    catch {
        return null;
    }
}
function tryCreate(lockPath, record) {
    try {
        const fd = openSync(lockPath, 'wx');
        try {
            writeSync(fd, `${record.pid}:${record.nonce}`);
        }
        finally {
            closeSync(fd);
        }
        return true;
    }
    catch (err) {
        if (err.code === 'EEXIST')
            return false;
        throw err;
    }
}
/**
 * Attempt to recover a lock whose recorded owner was just confirmed dead.
 * Re-reads the file immediately before deleting it and only deletes if its
 * content is byte-identical to what we based the "dead" verdict on — if it
 * has changed (recovered by a competing challenger, or raced with a fresh
 * acquisition reusing the same path) or disappeared, we do nothing and let
 * the caller's loop re-evaluate from scratch. This is what prevents two
 * simultaneous challengers — both of whom independently observed the same
 * dead owner — from one of them deleting the *other's* freshly-created
 * lock: whichever of them wins the unlink-then-create race becomes the
 * owner; the other sees its own re-check fail and backs off without
 * touching anything. No separate recovery mutex is needed because this
 * compare-then-delete step is itself the serialization point — `unlink`
 * and the next `open(..., 'wx')` are each atomic on their own.
 */
function attemptRecovery(lockPath, observed) {
    const current = readLockRecord(lockPath);
    if (!sameRecord(current, observed)) {
        return; // changed or gone under us — do not touch it
    }
    try {
        unlinkSync(lockPath);
    }
    catch {
        // already gone (e.g. removed by its own owner, or by a racing
        // challenger that reached this point microseconds earlier) — fine,
        // the next create attempt will tell us the truth.
    }
}
/**
 * Acquire `lockPath` exclusively. Waits up to `timeoutMs` for the current
 * owner (if any) to release it, attempting liveness-gated recovery only
 * when the owner is confirmed dead. Returns a release function.
 */
export async function acquireLock(lockPath, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const deadline = Date.now() + opts.timeoutMs;
    const own = { pid: process.pid, nonce: randomBytes(8).toString('hex') };
    for (;;) {
        if (tryCreate(lockPath, own)) {
            return () => {
                // Only release a lock that is still, byte-for-byte, the one we
                // created. If it has changed (because our own TTL-free design
                // never lets that happen while we're alive — but defensively,
                // in case of an unexpected manual deletion/replacement) or is
                // already gone, do nothing. Never clear another holder's lock.
                const current = readLockRecord(lockPath);
                if (sameRecord(current, own)) {
                    try {
                        unlinkSync(lockPath);
                    }
                    catch {
                        // already gone — fine
                    }
                }
            };
        }
        const observed = readLockRecord(lockPath);
        if (observed !== null) {
            const verdict = checkLiveness(observed.pid);
            if (verdict === 'dead') {
                attemptRecovery(lockPath, observed);
                continue; // re-evaluate immediately; no need to wait out a retry delay
            }
            // 'alive' or 'unknown' (including EPERM): invariant 2 — do not recover.
        }
        // observed === null: file vanished, is empty, or is malformed. Do not
        // infer "free" or "stale" from that — just loop back to try creating
        // it again (which also naturally resolves the "vanished" case) after
        // the same waiting/backoff discipline as a confirmed-busy lock.
        if (Date.now() >= deadline) {
            throw new LockTimeoutError(`Timed out after ${opts.timeoutMs}ms waiting for lock at "${lockPath}"`);
        }
        await sleep(opts.retryDelayMs);
    }
}
