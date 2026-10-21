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
 * A fourth, narrower rule governs recovery specifically:
 *
 *   4. Recovering a dead owner's lock is itself serialized.
 *      "Read the lock, confirm its owner is dead, re-read it, and delete it
 *      if unchanged" is NOT one atomic operation — the re-read and the
 *      delete are two separate syscalls, and another process can complete
 *      an entire recovery (delete the stale lock, create its own) in the
 *      gap between them. A recovery mutex (`<lockPath>.recovery`, itself
 *      just another `open(..., 'wx')`-guarded file) makes "verify and then
 *      delete a specific stale lock" exclusive, so at most one process is
 *      ever in a position to delete a given dead owner's record.
 *
 * Known limitation: this is a local-filesystem lock built on POSIX rename/
 * open semantics. It does not claim to provide distributed coordination,
 * and its guarantees are not evaluated on network filesystems (NFS, SMB,
 * etc.) where `open(..., 'wx')` atomicity is not always dependable.
 *
 * A fifth invariant governs *creating* a lock (primary or recovery mutex)
 * specifically:
 *
 *   5. A lock is never published in a partially-written state.
 *      Metadata is written in full to a private staging file
 *      (`<lockPath>.creating.<pid>.<nonce>`, a name no other acquirer can
 *      ever guess or collide with) and only published — via `linkSync`,
 *      which is exactly as exclusive a create-if-absent primitive as
 *      `open(path, 'wx')` — once that write (and, if requested, an fsync)
 *      has fully succeeded. If anything fails first, the canonical path
 *      never existed because of this attempt; only this process's own
 *      uniquely-named staging file is ever touched by its own cleanup. See
 *      `createAndPublish` below and ADR-008 for the full argument.
 */
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, linkSync, fsyncSync, } from 'fs';
import { randomBytes } from 'crypto';
import { LockTimeoutError, LockCreationError } from './errors.js';
const DEFAULT_OPTIONS = {
    timeoutMs: 5000,
    retryDelayMs: 25,
    fsyncMetadata: false,
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
function makeOwnRecord() {
    return { pid: process.pid, nonce: randomBytes(8).toString('hex') };
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
/** Read and parse a lock file. Returns null for "does not exist or
 * unreadable/malformed" alike — both are handled identically by callers
 * (uncertain, in the ENOENT case trivially resolved by the next create
 * attempt). */
function readLockRecord(path) {
    try {
        return parseLockRecord(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
/** Write `buffer` to `fd` in full, looping on short writes (a single
 * `writeSync` call is never guaranteed to write the whole buffer). A
 * non-positive byte count from the writer is a hard error, not something
 * to retry forever. `writer` defaults to the real `writeSync` and is
 * overridable only for deterministic fault injection in tests. */
function writeAll(fd, buffer, writer = writeSync) {
    let offset = 0;
    while (offset < buffer.length) {
        const bytesWritten = writer(fd, buffer, offset, buffer.length - offset);
        if (!(bytesWritten > 0)) {
            throw new Error(`write returned ${bytesWritten} bytes with ${buffer.length - offset} of ${buffer.length} ` +
                'bytes still unwritten');
        }
        offset += bytesWritten;
    }
}
function stagingPath(lockPath, record) {
    return `${lockPath}.creating.${record.pid}.${record.nonce}`;
}
/** Best-effort removal of a staging file this process created. Never
 * throws — "already gone" and "couldn't remove it" are both acceptable
 * outcomes here; the caller records whether it succeeded. */
function cleanupStaging(path) {
    try {
        unlinkSync(path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Create `record`'s metadata as `lockPath`, safely.
 *
 * The metadata is written to a private staging file
 * (`<lockPath>.creating.<pid>.<nonce>`) first, in full, and only
 * *published* as `lockPath` — via `linkSync(staging, lockPath)` — once that
 * write (and, if `fsyncMetadata` is set, an fsync) has completely
 * succeeded. `linkSync` fails with `EEXIST` if `lockPath` already exists,
 * exactly like the `open(path, 'wx')` it replaces as the publish step, so
 * it is exactly as exclusive a primitive — the canonical path still never
 * has two simultaneous "creators" — but unlike writing straight into
 * `lockPath`, a failure partway through can never leave the canonical path
 * itself in an empty/partial state, because the canonical path was never
 * touched by this attempt in the first place.
 *
 * `rename()` is deliberately not used for publication: an ordinary rename
 * silently replaces an existing destination, which is exactly the
 * exclusivity `open(path, 'wx')` is relied on for everywhere else in this
 * module. Only `linkSync`'s EEXIST-on-existing-destination behavior
 * preserves that.
 *
 * On any failure, only this process's own uniquely-named staging file is
 * ever removed (best-effort) — `lockPath` itself is never touched by a
 * failed creator, so a failed/paused creator can never delete a valid lock
 * a different, concurrently-succeeding acquirer published in the meantime.
 */
async function createAndPublish(lockPath, record, fsyncMetadata, testHooks) {
    const staging = stagingPath(lockPath, record);
    const metadata = Buffer.from(`${record.pid}:${record.nonce}`, 'utf8');
    let fd;
    try {
        fd = openSync(staging, 'wx');
    }
    catch (err) {
        // The staging name is unique per (pid, nonce); reaching here means we
        // could not even create our own private file. Nothing was created.
        throw new LockCreationError({
            lockPath,
            phase: 'staging-open',
            pid: record.pid,
            nonce: record.nonce,
            cleanedUp: true,
            cause: err,
        });
    }
    const fail = async (phase, cause) => {
        await testHooks.beforeStagingCleanupOnFailure?.();
        const cleanedUp = cleanupStaging(staging);
        throw new LockCreationError({ lockPath, phase, pid: record.pid, nonce: record.nonce, cleanedUp, cause });
    };
    try {
        writeAll(fd, metadata, testHooks.writeMetadata);
    }
    catch (err) {
        closeSync(fd);
        return fail('metadata-write', err);
    }
    if (fsyncMetadata) {
        try {
            fsyncSync(fd);
        }
        catch (err) {
            closeSync(fd);
            return fail('metadata-fsync', err);
        }
    }
    closeSync(fd);
    try {
        linkSync(staging, lockPath);
    }
    catch (err) {
        if (err.code === 'EEXIST') {
            // Lost the race to a concurrent publisher — not a failure. Only our
            // own staging file is ever removed here.
            cleanupStaging(staging);
            return 'lost-race';
        }
        return fail('publish-link', err);
    }
    // Published: lockPath and staging are now two links to the same
    // metadata. Drop our temporary name; the canonical one remains.
    cleanupStaging(staging);
    return 'published';
}
/** Delete `path` only if its current content is still, byte-for-byte, the
 * record we believe we own. Never clears a lock that has changed or is
 * already gone. This is used both for releasing a held primary lock and
 * for releasing the internal recovery mutex. */
function releaseIfOwned(path, record) {
    const current = readLockRecord(path);
    if (sameRecord(current, record)) {
        try {
            unlinkSync(path);
        }
        catch {
            // already gone — fine
        }
    }
}
function recoveryMutexPath(lockPath) {
    return `${lockPath}.recovery`;
}
/**
 * Attempt to recover a lock whose recorded owner was just confirmed dead.
 *
 * The read-confirm-delete sequence for a *specific* stale record is made
 * exclusive by a recovery mutex (`<lockPath>.recovery`, itself just another
 * `wx`-guarded file): a challenger must hold it for the entire re-verify
 * step through the actual `unlink`. Because `open(path, 'wx')` is atomic,
 * at most one challenger ever holds the recovery mutex for a given lock at
 * a time — so at most one challenger is ever in a position to delete a
 * given dead owner's record. A second challenger either fails to get the
 * mutex (returns 'mutex-busy' — it does not block, it just backs off and
 * lets the caller's normal wait/retry loop handle it) or, if it gets the
 * mutex only after the first challenger has already finished, finds the
 * lock file no longer matches what it originally observed and aborts
 * without touching anything ('aborted'). Neither case ever deletes a lock
 * that belongs to a new owner — see ADR-008 for the full argument.
 *
 * The recovery mutex itself is NEVER taken from another process based on
 * age or liveness: if its holder crashes mid-recovery, the mutex simply
 * stays held, and every future recovery attempt for this lock reports
 * 'mutex-busy' until a human removes it by hand. This is a deliberate
 * safety-over-availability trade-off (no recursive stale-mutex recovery)
 * — it never corrupts state.json and never causes double ownership; it
 * only means automatic crash recovery for *this* lock is unavailable
 * until that's cleaned up.
 */
async function recoverDeadOwner(lockPath, observed, fsyncMetadata, hooks) {
    await hooks.beforeRecoveryAttempt?.();
    const mutexPath = recoveryMutexPath(lockPath);
    const mutexRecord = makeOwnRecord();
    // The recovery mutex is created through the same safe staging/publish
    // primitive as the primary lock — its semantics (never recovered by
    // liveness or age, see module doc) are unchanged; only how it is
    // physically created is shared code now.
    if ((await createAndPublish(mutexPath, mutexRecord, fsyncMetadata, hooks)) === 'lost-race') {
        return 'mutex-busy';
    }
    try {
        // Re-verify from scratch now that we exclusively hold the recovery
        // mutex — time has passed since the caller's own read, and this is
        // the check that actually matters: nothing but the mutex holder can
        // delete this specific stale record from here on.
        const current = readLockRecord(lockPath);
        if (current === null || !sameRecord(current, observed)) {
            return 'aborted'; // changed or gone while we were acquiring the mutex
        }
        if (checkLiveness(current.pid) !== 'dead') {
            return 'aborted'; // no longer safe to conclude dead — back off
        }
        await hooks.beforeStaleUnlink?.();
        try {
            unlinkSync(lockPath);
        }
        catch {
            // already gone — fine, the next create attempt will tell us the truth
        }
        return 'recovered';
    }
    finally {
        releaseIfOwned(mutexPath, mutexRecord);
    }
}
/**
 * Acquire `lockPath` exclusively. Waits up to `timeoutMs` for the current
 * owner (if any) to release it, attempting liveness-gated, mutex-serialized
 * recovery only when the owner is confirmed dead. Returns a release
 * function. `testHooks` exists solely to let tests force specific
 * interleavings deterministically — production callers must never pass it.
 */
export async function acquireLock(lockPath, options = {}, testHooks = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const deadline = Date.now() + opts.timeoutMs;
    const own = makeOwnRecord();
    for (;;) {
        if ((await createAndPublish(lockPath, own, opts.fsyncMetadata, testHooks)) === 'published') {
            return () => releaseIfOwned(lockPath, own);
        }
        // 'lost-race': the canonical lock already exists — fall through to the
        // normal observe/wait/recover logic below, exactly as a plain EEXIST
        // did before.
        const observed = readLockRecord(lockPath);
        if (observed !== null) {
            const verdict = checkLiveness(observed.pid);
            if (verdict === 'dead') {
                const outcome = await recoverDeadOwner(lockPath, observed, opts.fsyncMetadata, testHooks);
                if (outcome !== 'mutex-busy') {
                    continue; // we (or whoever holds the mutex) made progress; re-evaluate now
                }
                // mutex-busy: someone else is already handling this exact
                // recovery — fall through to the normal wait/retry below rather
                // than spinning on a mutex we know is currently unavailable.
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
