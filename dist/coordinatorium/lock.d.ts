/**
 * Minimal cross-process file lock.
 *
 * Acquisition is a single `open(path, 'wx')` syscall — it either creates the
 * file or fails with EEXIST, atomically, on every platform Node supports.
 * That atomicity is what actually prevents two processes from both believing
 * they own the lock at once; the lock file's body (a JSON owner record) exists only
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
 *      ever guess or collide with; created `O_EXCL|O_NOFOLLOW` at mode `0600`
 *      through the shared safe-write primitive, SEC-001B.2) and only
 *      published — via `link()`,
 *      which is exactly as exclusive a create-if-absent primitive as
 *      `open(path, 'wx')` — once that write (and, if requested, an fsync)
 *      has fully succeeded. If anything fails first, the canonical path
 *      never existed because of this attempt; only this process's own
 *      uniquely-named staging file is ever touched by its own cleanup. See
 *      `createAndPublish` below and ADR-008 for the full argument.
 */
import { type FsOps, type ParentRef } from '../root/index.js';
/** A well-formed record (see `LockRecord`) is under 200 bytes; 256 B is generous. */
export declare const MAX_LOCK_BYTES = 256;
export interface LockOptions {
    /** How long a challenger will wait to acquire the lock before giving up. */
    timeoutMs?: number;
    /** Delay between acquisition attempts while waiting. */
    retryDelayMs?: number;
    /** Fsync the staged metadata file before publishing it as the canonical
     * lock. A durability option, not a correctness requirement: mutual
     * exclusion comes entirely from `linkSync`/`open(path, 'wx')` atomicity,
     * with or without this. Default `false` — without it, metadata for a
     * lock acquired just before a hard crash/power loss may not have reached
     * disk yet, though the lock's atomicity and exclusivity guarantees are
     * unaffected either way; this never claims power-loss durability when
     * left at its default. */
    fsyncMetadata?: boolean;
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
    /** Replaces the low-level write call used while writing a lock's staged
     * metadata, so tests can force a deterministic fault (e.g. throw ENOSPC
     * before any byte is written, or write a short chunk and then throw) —
     * never supplied by production code. */
    writeMetadata?: (fd: number, buffer: Buffer, offset: number, length: number) => number;
    /** Invoked after a staging-write/fsync failure is detected (and the fd
     * closed) but before the best-effort cleanup of this process's own
     * staging file — lets tests pause a failed creator at exactly the point
     * where only its own staging file exists on disk. */
    beforeStagingCleanupOnFailure?: () => void | Promise<void>;
    /** Replaces the `unlink` of a confirmed-dead owner's lock during stale
     * recovery, so tests can force a persistent failure (EACCES/EROFS/EIO). */
    unlinkLock?: (path: string) => void;
    /** Replaces the `/proc` and `kill(pid, 0)` probes used to identify this
     * process and to judge a recorded owner — lets tests simulate another PID
     * namespace or boot without real namespace support. */
    procOps?: Partial<ProcOps>;
    /** Replaces individual filesystem calls made by the safe-write primitive
     * while creating, publishing and removing staging files — fault injection
     * for publication states. Never supplied by production code. */
    fsOps?: Partial<FsOps>;
}
export type LivenessVerdict = 'alive' | 'dead' | 'unknown';
/** What identifies a process beyond its PID. A PID is only meaningful inside
 * one PID namespace of one boot, and may be reused after its owner exits. Any
 * field is `null` when the platform cannot provide it. */
export interface OwnerIdentity {
    /** Kernel boot id (`/proc/sys/kernel/random/boot_id`): distinguishes boots and hosts. */
    boot: string | null;
    /** PID namespace (`readlink /proc/self/ns/pid`, `pid:[inode]`). */
    pidns: string | null;
    /** Process start time in clock ticks since boot (`/proc/<pid>/stat`, field 22): detects PID reuse. */
    start: string | null;
}
/** The OS probes liveness decisions rest on; injectable for tests only. */
export interface ProcOps {
    platform: NodeJS.Platform;
    pid: number;
    readText(path: string): string;
    readlink(path: string): string;
    kill(pid: number, signal: 0): void;
}
/** This process's identity, or all-`null` when it cannot be established
 * (non-Linux, or `/proc` that does not belong to our PID namespace). */
export declare function captureIdentity(ops?: ProcOps): OwnerIdentity;
/**
 * Decide whether the owner named by `record` is alive, from verifiable
 * identity rather than from `kill(pid, 0)` alone (H1, LOCK-FIX-001).
 *
 * A PID is only meaningful inside the PID namespace and boot that issued it, so
 * `ESRCH` is NOT proof of death by itself: a process in another namespace
 * sharing the filesystem would see a live owner's PID as "no such process".
 * `dead` therefore requires the record's boot and PID namespace to equal ours,
 * and either a different start time for that PID (it was reused) or two
 * independent probes agreeing it does not exist (`/proc/<pid>` absent AND
 * `ESRCH`). Everything else is `unknown`, which — like `alive` — forbids
 * recovery. Rules are checked top to bottom; the first match decides. The age
 * of the lock plays no part.
 */
export declare function judgeOwner(record: LockRecord, ours: OwnerIdentity, ops?: ProcOps): {
    verdict: LivenessVerdict;
    reason: string;
};
/**
 * The lock file's body: one line of strict JSON. `pid` and `nonce` identify the
 * attempt; `boot`, `pidns` and `start` identify the owning process well enough
 * for another process to judge whether it is dead (H1). There is no support for
 * the earlier `pid:nonce` format: such a file is "unrecognised", never judged
 * and never deleted.
 */
export interface LockRecord extends OwnerIdentity {
    pid: number;
    nonce: string;
}
/** The exact bytes written as a lock file's body. */
export declare function formatLockRecord(r: LockRecord): string;
/**
 * Acquire `lockPath` exclusively. Waits up to `timeoutMs` for the current
 * owner (if any) to release it, attempting liveness-gated, mutex-serialized
 * recovery only when the owner is provably dead (`judgeOwner`). Returns a
 * release function. `testHooks` exists solely to let tests force specific
 * interleavings deterministically — production callers must never pass it.
 *
 * One deadline governs the whole call and is checked at the top of EVERY
 * iteration, so no branch (recovery progress, aborted recovery, a failing
 * `unlink`) can loop past it. Waits between attempts use a bounded exponential
 * backoff. On timeout the last failure is kept in the error.
 */
export declare function acquireLock(lockPath: string, options?: LockOptions, testHooks?: LockTestHooks, parent?: ParentRef): Promise<() => void>;
//# sourceMappingURL=lock.d.ts.map