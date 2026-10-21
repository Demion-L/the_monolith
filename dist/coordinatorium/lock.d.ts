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
export interface LockOptions {
    /** Total time to wait for the lock before giving up. */
    timeoutMs?: number;
    /** Delay between acquisition attempts. */
    retryDelayMs?: number;
    /** A held lock older than this is assumed to be from a dead process. */
    staleMs?: number;
}
/**
 * Acquire `lockPath` exclusively, waiting and retrying (with stale-lock
 * recovery) up to `timeoutMs`. Returns a release function.
 */
export declare function acquireLock(lockPath: string, options?: LockOptions): Promise<() => void>;
//# sourceMappingURL=lock.d.ts.map