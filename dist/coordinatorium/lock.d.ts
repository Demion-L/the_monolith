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
 */
export interface LockOptions {
    /** How long a challenger will wait to acquire the lock before giving up. */
    timeoutMs?: number;
    /** Delay between acquisition attempts while waiting. */
    retryDelayMs?: number;
}
/**
 * Test-only hooks for forcing specific, otherwise-timing-dependent
 * interleavings deterministically. Every hook defaults to a no-op; no
 * production code path (in particular, `state-keeper.ts`) ever supplies
 * one. Do not use this outside tests.
 */
export interface LockTestHooks {
    /** Invoked right after an owner is confirmed dead, before attempting to
     * acquire the recovery mutex. */
    beforeRecoveryAttempt?: () => void | Promise<void>;
    /** Invoked immediately before the confirmed-dead owner's lock file is
     * actually unlinked, while still holding the recovery mutex. */
    beforeStaleUnlink?: () => void | Promise<void>;
}
/**
 * Acquire `lockPath` exclusively. Waits up to `timeoutMs` for the current
 * owner (if any) to release it, attempting liveness-gated, mutex-serialized
 * recovery only when the owner is confirmed dead. Returns a release
 * function. `testHooks` exists solely to let tests force specific
 * interleavings deterministically — production callers must never pass it.
 */
export declare function acquireLock(lockPath: string, options?: LockOptions, testHooks?: LockTestHooks): Promise<() => void>;
//# sourceMappingURL=lock.d.ts.map