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

import {
  writeSync,
  closeSync,
  lstatSync,
  unlinkSync,
  fchmodSync,
  fsyncSync,
  readFileSync,
  readlinkSync,
} from 'fs';
import { basename, dirname } from 'path';
import { randomBytes } from 'crypto';
import { performance } from 'perf_hooks';
import { LockTimeoutError, LockUnsafeError, LockCreationError, ValidationError, type LockCreationPhase } from './errors.js';
import {
  SafeWriteError,
  createExclusive,
  disposeOwned,
  openParent,
  publishLink,
  readBoundedFileStable,
  boundaryPathOf,
  trustedDirectoryBoundary,
  type FsOps,
  type ParentRef,
  type ProjectFileErrorCode,
} from '../root/index.js';

/** A well-formed record (see `LockRecord`) is under 200 bytes; 256 B is generous. */
export const MAX_LOCK_BYTES = 256;

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
  /** Replaces the monotonic clock (milliseconds) that drives the deadline. */
  now?: () => number;
  /** Replaces the jitter source: a value in `[0, 1)`. */
  random?: () => number;
  /** Replaces the wait between attempts; receives the requested milliseconds. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_OPTIONS: Required<LockOptions> = {
  timeoutMs: 5000,
  retryDelayMs: 25,
  fsyncMetadata: false,
};

/**
 * Merge caller options over the defaults. A missing or explicitly `undefined`
 * value takes the default (a plain spread would let `undefined` overwrite it);
 * a present value must be a finite, non-negative number. `NaN` would make the
 * deadline `NaN` — every comparison against it is false, so the wait would
 * never end — and `Infinity` would make it unbounded by construction.
 */
function resolveOptions(options: LockOptions): Required<LockOptions> {
  const out = { ...DEFAULT_OPTIONS };
  for (const key of ['timeoutMs', 'retryDelayMs'] as const) {
    const v: unknown = options[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new ValidationError(`"${key}" must be a finite, non-negative number of milliseconds (got ${String(v)})`);
    }
    out[key] = v;
  }
  if (options.fsyncMetadata !== undefined) out.fsyncMetadata = options.fsyncMetadata;
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Monotonic milliseconds. The deadline never reads the wall clock, so a clock
 * step (NTP, manual change, VM resume) can neither extend nor cut the wait. */
const monotonicNow = (): number => performance.now();

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

const realProcOps: ProcOps = {
  platform: process.platform,
  get pid() {
    return process.pid;
  },
  readText: (path) => readFileSync(path, 'utf8'),
  readlink: (path) => readlinkSync(path),
  kill: (pid, signal) => {
    process.kill(pid, signal);
  },
};

const NO_IDENTITY: OwnerIdentity = { boot: null, pidns: null, start: null };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PIDNS_RE = /^pid:\[[0-9]{1,20}\]$/;
const START_RE = /^[0-9]{1,20}$/;

/** State letter and start ticks from `/proc/<pid>/stat`. The command name is
 * parenthesised and may itself contain spaces and parentheses, so parsing
 * starts after the LAST `)`. */
function parseProcStat(text: string): { state: string; start: string } | null {
  const close = text.lastIndexOf(')');
  if (close < 0) return null;
  const fields = text.slice(close + 2).trim().split(' ');
  const state = fields[0];
  const start = fields[19]; // field 22 overall; fields[0] is field 3
  if (!state || state.length !== 1 || start === undefined || !START_RE.test(start)) return null;
  return { state, start };
}

/** This process's identity, or all-`null` when it cannot be established
 * (non-Linux, or `/proc` that does not belong to our PID namespace). */
export function captureIdentity(ops: ProcOps = realProcOps): OwnerIdentity {
  if (ops.platform !== 'linux') return NO_IDENTITY;
  try {
    // A /proc mounted from another PID namespace would describe other processes.
    if (ops.readlink('/proc/self') !== String(ops.pid)) return NO_IDENTITY;
    const boot = ops.readText('/proc/sys/kernel/random/boot_id').trim();
    const pidns = ops.readlink('/proc/self/ns/pid');
    const stat = parseProcStat(ops.readText('/proc/self/stat'));
    return {
      boot: UUID_RE.test(boot) ? boot : null,
      pidns: PIDNS_RE.test(pidns) ? pidns : null,
      start: stat ? stat.start : null,
    };
  } catch {
    return NO_IDENTITY;
  }
}

let cachedIdentity: { pid: number; identity: OwnerIdentity } | null = null;
function ownIdentity(ops?: Partial<ProcOps>): OwnerIdentity {
  if (ops !== undefined && Object.keys(ops).length > 0) return captureIdentity({ ...realProcOps, ...ops });
  if (cachedIdentity === null || cachedIdentity.pid !== process.pid) {
    cachedIdentity = { pid: process.pid, identity: captureIdentity() };
  }
  return cachedIdentity.identity;
}

const errno = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

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
export function judgeOwner(
  record: LockRecord,
  ours: OwnerIdentity,
  ops: ProcOps = realProcOps,
): { verdict: LivenessVerdict; reason: string } {
  if (ours.boot === null || ours.pidns === null) return { verdict: 'unknown', reason: 'no-local-identity' };
  if (record.boot === null || record.pidns === null) return { verdict: 'unknown', reason: 'weak-record' };
  if (record.boot !== ours.boot) return { verdict: 'unknown', reason: 'boot-mismatch' };
  if (record.pidns !== ours.pidns) return { verdict: 'unknown', reason: 'pidns-mismatch' };
  if (record.pid === ops.pid) return { verdict: 'alive', reason: 'same-process' };

  let killCode: string | undefined;
  try {
    ops.kill(record.pid, 0);
    killCode = undefined;
  } catch (err) {
    killCode = errno(err) ?? 'EUNKNOWN';
  }
  if (killCode === 'EPERM') return { verdict: 'alive', reason: 'eperm' };
  if (killCode !== undefined && killCode !== 'ESRCH') return { verdict: 'unknown', reason: 'probe-error' };

  let statText: string | null = null;
  try {
    statText = ops.readText(`/proc/${record.pid}/stat`);
  } catch (err) {
    if (errno(err) !== 'ENOENT') return { verdict: 'unknown', reason: 'probe-error' };
  }

  if (statText === null) {
    // Absent from /proc: dead only if kill() agrees (ESRCH). If kill() says the
    // process exists, the oracles disagree (e.g. hidepid) — not a death signal.
    return killCode === 'ESRCH'
      ? { verdict: 'dead', reason: 'absent-by-two-oracles' }
      : { verdict: 'unknown', reason: 'oracle-disagreement' };
  }
  if (killCode === 'ESRCH') return { verdict: 'unknown', reason: 'oracle-disagreement' };

  const stat = parseProcStat(statText);
  if (stat === null) return { verdict: 'unknown', reason: 'probe-error' };
  if (stat.state === 'Z') return { verdict: 'unknown', reason: 'zombie' };
  if (stat.state === 'X') return { verdict: 'dead', reason: 'exited' };
  if (record.start === null) return { verdict: 'alive', reason: 'cannot-rule-out-reuse' };
  return record.start !== stat.start
    ? { verdict: 'dead', reason: 'pid-reused' }
    : { verdict: 'alive', reason: 'start-match' };
}

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

const RECORD_KEYS = ['v', 'pid', 'nonce', 'boot', 'pidns', 'start'];

function makeOwnRecord(hooks: LockTestHooks = {}): LockRecord {
  return { pid: process.pid, nonce: randomBytes(8).toString('hex'), ...ownIdentity(hooks.procOps) };
}

/** The exact bytes written as a lock file's body. */
export function formatLockRecord(r: LockRecord): string {
  return JSON.stringify({ v: 2, pid: r.pid, nonce: r.nonce, boot: r.boot, pidns: r.pidns, start: r.start });
}

/** Content identity, not liveness. Used to detect whether a lock file has
 * changed (recovered by someone else, or released) between two reads. */
function sameRecord(a: LockRecord | null, b: LockRecord | null): boolean {
  if (a === null || b === null) return a === b;
  return a.pid === b.pid && a.nonce === b.nonce && a.boot === b.boot && a.pidns === b.pidns && a.start === b.start;
}

/**
 * Parse a lock file's raw content. Returns null for anything that is not
 * unambiguously a well-formed record — including an empty file, a partially
 * written one, garbage, or the unsupported `pid:nonce` format. A null result is
 * NOT treated as "no owner"; callers must treat it as uncertain (invariant 2).
 */
function parseLockRecord(raw: string): LockRecord | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
  const keys = Object.keys(o);
  if (keys.length !== RECORD_KEYS.length || !RECORD_KEYS.every((k) => keys.includes(k))) return null;
  const r = o as Record<string, unknown>;
  const optional = (v: unknown, re: RegExp): string | null | undefined =>
    v === null ? null : typeof v === 'string' && re.test(v) ? v : undefined;
  const boot = optional(r.boot, UUID_RE);
  const pidns = optional(r.pidns, PIDNS_RE);
  const start = optional(r.start, START_RE);
  if (r.v !== 2 || !Number.isInteger(r.pid) || (r.pid as number) <= 0 || (r.pid as number) > 2 ** 31 - 1) return null;
  if (typeof r.nonce !== 'string' || !/^[0-9a-f]{16}$/.test(r.nonce)) return null;
  if (boot === undefined || pidns === undefined || start === undefined) return null;
  const parsed: LockRecord = { pid: r.pid as number, nonce: r.nonce, boot, pidns, start };
  // Canonical form only: `JSON.parse` silently accepts duplicate keys (last one
  // wins), whitespace, reordered keys and a trailing newline. A record is
  // exactly what `formatLockRecord` writes, byte for byte, or it is not a record.
  if (formatLockRecord(parsed) !== raw) return null;
  return parsed;
}

/**
 * What an inspection of the lock path found (SEC-001B.1).
 *  - `absent`: no lock, or it vanished / was replaced while being read
 *    (transient — the exclusive create attempt that follows is the arbiter).
 *  - `valid`: a well-formed owner record.
 *  - `unsafe`: something is there that is not a valid record. NEVER read as
 *    "free" and never deleted. `structural` means it can never be a lock
 *    (FIFO/special file, over MAX_LOCK_BYTES, unreadable); `content` means a
 *    regular, in-bounds file whose body is empty or malformed — which an
 *    older, non-staging binary could also produce momentarily, so callers
 *    keep waiting on it exactly as before.
 */
type LockInspection =
  | { kind: 'absent' }
  | { kind: 'valid'; record: LockRecord }
  | { kind: 'unsafe'; class: 'structural' | 'content'; fileCode: ProjectFileErrorCode; detail: string };

function inspectLock(boundary: string, path: string): LockInspection {
  // Unified safe read (SEC-001B.1-R): the lock is read under the boundary its
  // staging files are written under; a symlink or hardlinked lock is `structural`.
  const r = readBoundedFileStable(path, 'lock file', { boundary, maxBytes: MAX_LOCK_BYTES, allowEmpty: true }, true);
  if (r.ok) {
    const record = 'content' in r ? parseLockRecord(r.content) : null;
    if (record) return { kind: 'valid', record };
    return { kind: 'unsafe', class: 'content', fileCode: 'FILE_UNREADABLE', detail: 'lock content is empty, malformed or of an unrecognised format; automatic recovery is not performed' };
  }
  // Missing, or still being released/re-acquired after the retries: not
  // observed. The exclusive create attempt that follows is the arbiter.
  if (r.code === 'FILE_MISSING' || r.code === 'FILE_CHANGED') return { kind: 'absent' };
  return { kind: 'unsafe', class: 'structural', fileCode: r.code, detail: r.detail };
}

/** Valid record or null. `unsafe` is deliberately collapsed to null here for
 * the two callers that must merely refuse to act on it (invariant 2). */
function readLockRecord(boundary: string, path: string): LockRecord | null {
  const i = inspectLock(boundary, path);
  return i.kind === 'valid' ? i.record : null;
}

/** Write `buffer` to `fd` in full, looping on short writes (a single
 * `writeSync` call is never guaranteed to write the whole buffer). A
 * non-positive byte count from the writer is a hard error, not something
 * to retry forever. `writer` defaults to the real `writeSync` and is
 * overridable only for deterministic fault injection in tests. */
function writeAll(
  fd: number,
  buffer: Buffer,
  writer: (fd: number, buffer: Buffer, offset: number, length: number) => number = writeSync,
): void {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesWritten = writer(fd, buffer, offset, buffer.length - offset);
    if (!(bytesWritten > 0)) {
      throw new Error(
        `write returned ${bytesWritten} bytes with ${buffer.length - offset} of ${buffer.length} ` +
          'bytes still unwritten',
      );
    }
    offset += bytesWritten;
  }
}

function stagingPath(lockPath: string, record: LockRecord): string {
  return `${lockPath}.creating.${record.pid}.${record.nonce}`;
}

type CreateOutcome = 'published' | 'lost-race';

/**
 * Create `record`'s metadata as `lockPath`, safely.
 *
 * The metadata is written to a private staging file
 * (`<lockPath>.creating.<pid>.<nonce>`) first, in full, and only
 * *published* as `lockPath` — via `link()` — once that write (and, if
 * `fsyncMetadata` is set, an fsync) has completely succeeded. `link()` fails
 * with `EEXIST` if `lockPath` already exists, exactly like the
 * `open(path, 'wx')` it replaces as the publish step, so it is exactly as
 * exclusive a primitive — the canonical path still never has two
 * simultaneous "creators" — but unlike writing straight into `lockPath`, a
 * failure partway through can never leave the canonical path itself in an
 * empty/partial state, because the canonical path was never touched by this
 * attempt in the first place.
 *
 * `rename()` is deliberately not used for publication: an ordinary rename
 * silently replaces an existing destination, which is exactly the
 * exclusivity `open(path, 'wx')` is relied on for everywhere else in this
 * module. Only `link()`'s EEXIST-on-existing-destination behavior
 * preserves that.
 *
 * On any failure, only this process's own staging file is ever removed — and
 * only while its recorded identity (`dev/ino`) still matches. `lockPath`
 * itself is never touched by a failed creator, so a failed/paused creator can
 * never delete a valid lock a different, concurrently-succeeding acquirer
 * published in the meantime.
 *
 * If the publish step ends in a state that cannot be classified (`UNKNOWN`:
 * the link may or may not have happened), the lock is confirmed ONLY by its
 * ownership record — `lockPath` holding exactly this attempt's owner record.
 * Otherwise the attempt fails with `publication: 'UNKNOWN'`; nothing is
 * retried and the staging file is left in place.
 */
async function createAndPublish(
  parent: ParentRef,
  lockPath: string,
  record: LockRecord,
  fsyncMetadata: boolean,
  testHooks: LockTestHooks,
): Promise<CreateOutcome> {
  const stagingName = basename(stagingPath(lockPath, record));
  const lockName = basename(lockPath);
  const metadata = Buffer.from(formatLockRecord(record), 'utf8');
  const base = { lockPath, pid: record.pid, nonce: record.nonce };

  let owned;
  try {
    owned = createExclusive(parent, stagingName, 0o600, { ops: testHooks.fsOps });
  } catch (err) {
    // The staging name is unique per (pid, nonce); reaching here means we
    // could not even create our own private file. Normally nothing was
    // created; `cleanedUp` is false only if a file exists whose identity we
    // could not confirm.
    const created = err instanceof SafeWriteError && err.tmp !== undefined;
    throw new LockCreationError({
      ...base,
      phase: 'staging-open',
      cleanedUp: !created,
      cause: err instanceof SafeWriteError ? (err.cause ?? err) : err,
    });
  }
  const { fd, token } = owned;

  const fail = async (phase: LockCreationPhase, cause: unknown): Promise<never> => {
    await testHooks.beforeStagingCleanupOnFailure?.();
    const res = disposeOwned(parent, token, { ops: testHooks.fsOps });
    throw new LockCreationError({ ...base, phase, cleanedUp: res === 'removed' || res === 'absent', cause });
  };

  try {
    fchmodSync(fd, 0o600); // independent of the umask
    writeAll(fd, metadata, testHooks.writeMetadata);
  } catch (err) {
    closeSync(fd);
    return fail('metadata-write', err);
  }

  if (fsyncMetadata) {
    try {
      fsyncSync(fd);
    } catch (err) {
      closeSync(fd);
      return fail('metadata-fsync', err);
    }
  }

  closeSync(fd);

  let result;
  try {
    result = publishLink(parent, token, lockName, { ops: testHooks.fsOps });
  } catch (err) {
    if (!(err instanceof SafeWriteError)) throw err;
    if (err.publication === 'UNKNOWN') {
      const seen = readLockRecord(boundaryPathOf(parent), lockPath);
      if (seen !== null && sameRecord(seen, record)) {
        // The record at the lock path is exactly ours: the link did happen.
        disposeOwned(parent, token, { ops: testHooks.fsOps });
        return 'published';
      }
      throw new LockCreationError({
        ...base,
        phase: 'publish-link',
        cleanedUp: false,
        publication: 'UNKNOWN',
        cause: err.cause ?? err,
      });
    }
    // NOT_PUBLISHED: the staging file was removed if the publish step failed
    // (`err.tmp.removed`); an error raised before it (e.g. the parent changed)
    // leaves it in place and is reported as `cleanedUp: false`.
    throw new LockCreationError({
      ...base,
      phase: 'publish-link',
      cleanedUp: err.tmp?.removed ?? false,
      cause: err.cause ?? err,
    });
  }

  // Lost race: only our own staging file is ever removed. Published:
  // lockPath and staging are now two links to the same metadata; drop our
  // temporary name, the canonical one remains. A failed removal is harmless.
  disposeOwned(parent, token, { ops: testHooks.fsOps });
  return result.outcome;
}

/** Delete `path` only if its current content is still, byte-for-byte, the
 * record we believe we own. Never clears a lock that has changed or is
 * already gone. This is used both for releasing a held primary lock and
 * for releasing the internal recovery mutex. */
function releaseIfOwned(boundary: string, path: string, record: LockRecord): void {
  const current = readLockRecord(boundary, path);
  if (sameRecord(current, record)) {
    try {
      unlinkSync(path);
    } catch {
      // already gone — fine
    }
  }
}

function recoveryMutexPath(lockPath: string): string {
  return `${lockPath}.recovery`;
}

type RecoveryResult =
  | { outcome: 'recovered' }
  | { outcome: 'mutex-busy' }
  /** The lock changed or its owner is no longer provably dead: nothing was touched. */
  | { outcome: 'aborted'; reason: string }
  /** The owner is dead but its lock could not be removed (EACCES/EROFS/EIO, …),
   * or `unlink` reported success and the same file is still there. */
  | { outcome: 'unlink-failed'; cause: unknown };

/** `dev:ino` of what is at `path`, `null` if nothing is, `undefined` if that
 * cannot be told (an error other than ENOENT). */
function fileIdentity(path: string): string | null | undefined {
  try {
    const st = lstatSync(path, { bigint: true });
    return `${st.dev}:${st.ino}`;
  } catch (err) {
    return errno(err) === 'ENOENT' ? null : undefined;
  }
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
async function recoverDeadOwner(
  parent: ParentRef,
  lockPath: string,
  observed: LockRecord,
  fsyncMetadata: boolean,
  hooks: LockTestHooks,
): Promise<RecoveryResult> {
  await hooks.beforeRecoveryAttempt?.();

  const mutexPath = recoveryMutexPath(lockPath);
  const mutexRecord = makeOwnRecord(hooks);

  // The recovery mutex is created through the same safe staging/publish
  // primitive as the primary lock — its semantics (never recovered by
  // liveness or age, see module doc) are unchanged; only how it is
  // physically created is shared code now.
  if ((await createAndPublish(parent, mutexPath, mutexRecord, fsyncMetadata, hooks)) === 'lost-race') {
    return { outcome: 'mutex-busy' };
  }

  try {
    // Re-verify from scratch now that we exclusively hold the recovery
    // mutex — time has passed since the caller's own read, and this is
    // the check that actually matters: nothing but the mutex holder can
    // delete this specific stale record from here on.
    const current = readLockRecord(boundaryPathOf(parent), lockPath);
    if (current === null || !sameRecord(current, observed)) {
      return { outcome: 'aborted', reason: 'lock changed or vanished while acquiring the recovery mutex' };
    }
    const judged = judgeOwner(current, ownIdentity(hooks.procOps), { ...realProcOps, ...hooks.procOps });
    if (judged.verdict !== 'dead') {
      return { outcome: 'aborted', reason: `owner no longer provably dead (${judged.verdict}: ${judged.reason})` };
    }

    const before = fileIdentity(lockPath);

    await hooks.beforeStaleUnlink?.();

    try {
      (hooks.unlinkLock ?? unlinkSync)(lockPath);
    } catch (err) {
      // Already gone is fine. Any other failure is NOT recovery: report it so
      // the caller backs off within its deadline instead of pretending progress.
      if (errno(err) !== 'ENOENT') return { outcome: 'unlink-failed', cause: err };
    }
    // A successful syscall is not proof that the lock is gone (some filesystems
    // and fault layers report success without effect). Recovery is declared only
    // from observation: the path is absent, or it now holds a different file.
    const after = fileIdentity(lockPath);
    if (after === undefined) {
      return { outcome: 'unlink-failed', cause: new Error('could not observe the lock path after unlink') };
    }
    if (after !== null && after === before) {
      return { outcome: 'unlink-failed', cause: new Error('unlink reported success but the same lock file is still present') };
    }
    return { outcome: 'recovered' };
  } finally {
    releaseIfOwned(boundaryPathOf(parent), mutexPath, mutexRecord);
  }
}

/** Upper bound of the delay between attempts, as a multiple of `retryDelayMs`. */
const BACKOFF_CAP_FACTOR = 8;

/** Consecutive iterations that may skip the wait after a verified recovery or a
 * changed observation. Beyond this a pause is mandatory, so a filesystem that
 * keeps "recovering" the same lock cannot turn the loop into a busy spin. */
const MAX_PROGRESS_WITHOUT_SLEEP = 3;

function describeFailure(err: unknown): string {
  const code = errno(err);
  const msg = err instanceof Error ? err.message : String(err);
  return code !== undefined && !msg.includes(code) ? `${code}: ${msg}` : msg;
}

/**
 * Acquire `lockPath` exclusively. Waits up to `timeoutMs` for the current
 * owner (if any) to release it, attempting liveness-gated, mutex-serialized
 * recovery only when the owner is provably dead (`judgeOwner`). Returns a
 * release function. `testHooks` exists solely to let tests force specific
 * interleavings deterministically — production callers must never pass it.
 *
 * One monotonic deadline governs the whole call and is checked at the top of
 * EVERY iteration, and the only `continue` sits at the tail after all
 * bookkeeping, so no branch (recovery progress, aborted recovery, a failing
 * `unlink`) can skip the check or the wait. Waits are a bounded exponential backoff with jitter in `[d/2, d]`,
 * never longer than the time remaining. After a recovery the lock path is
 * observed again rather than assumed free; at most
 * `MAX_PROGRESS_WITHOUT_SLEEP` iterations in a row may run without waiting.
 *
 * The deadline bounds the waiting loop and the number of retries. It does not
 * bound a single synchronous filesystem call that hangs inside the kernel
 * (e.g. a stuck mount): no timer can run while it blocks.
 */
export async function acquireLock(
  lockPath: string,
  options: LockOptions = {},
  testHooks: LockTestHooks = {},
  parent: ParentRef = openParent(trustedDirectoryBoundary(dirname(lockPath)), dirname(lockPath)),
): Promise<() => void> {
  // `parent` is the already-verified directory that holds the lock. State
  // keeper passes the one it opened under the caller's write scope. When it
  // is omitted (internal/test callers) the lock's directory itself is the
  // trust boundary (trusted-directory semantics, ADR-012).
  const opts = resolveOptions(options);
  const now = testHooks.now ?? monotonicNow;
  const random = testHooks.random ?? Math.random;
  const wait = testHooks.sleep ?? sleep;
  const started = now();
  const deadline = started + opts.timeoutMs;
  const own = makeOwnRecord(testHooks);
  const ours = ownIdentity(testHooks.procOps);
  const probeOps: ProcOps = { ...realProcOps, ...testHooks.procOps };
  const baseDelay = Math.max(1, opts.retryDelayMs);
  const maxDelay = baseDelay * BACKOFF_CAP_FACTOR;

  let attempts = 0;
  let delay = baseDelay;
  let freeRuns = 0;
  let lastKey = '';
  let observation = 'lock is held';
  let lastFailure: unknown;
  let lastFailureText = '';

  for (;;) {
    if (attempts > 0 && now() >= deadline) {
      const failure = lastFailureText ? `; last failure: ${lastFailureText}` : '';
      throw new LockTimeoutError(
        `Timed out after ${opts.timeoutMs}ms (${attempts} attempts) waiting for lock at "${lockPath}" (${observation}${failure})`,
        { lastFailure },
      );
    }
    attempts++;

    if ((await createAndPublish(parent, lockPath, own, opts.fsyncMetadata, testHooks)) === 'published') {
      return () => releaseIfOwned(boundaryPathOf(parent), lockPath, own);
    }
    // 'lost-race': the canonical lock already exists — observe it below.

    const inspection = inspectLock(boundaryPathOf(parent), lockPath);
    if (inspection.kind === 'unsafe' && inspection.class === 'structural') {
      // A FIFO / oversize / unreadable lock can never become a valid one:
      // refuse with a diagnostic instead of waiting out the timeout. The
      // file is left exactly as found and the lock is not acquired.
      throw new LockUnsafeError(lockPath, inspection.fileCode, inspection.detail);
    }

    // True only when this iteration verifiably changed the situation (a dead
    // owner's lock was removed and observed gone); only then may the next
    // iteration start without waiting.
    let progressed = false;
    // What we are waiting on, so the backoff restarts when it changes.
    let key: string = inspection.kind;
    if (inspection.kind === 'unsafe') {
      observation = `${inspection.detail}; the file was left untouched`;
    } else if (inspection.kind === 'valid') {
      key = `${inspection.record.pid}:${inspection.record.nonce}`;
      const judged = judgeOwner(inspection.record, ours, probeOps);
      observation = `owner pid ${inspection.record.pid} is ${judged.verdict} (${judged.reason})`;
      if (judged.verdict === 'dead') {
        const result = await recoverDeadOwner(parent, lockPath, inspection.record, opts.fsyncMetadata, testHooks);
        if (result.outcome === 'recovered') {
          progressed = true;
          lastFailure = undefined;
          lastFailureText = '';
        } else if (result.outcome === 'unlink-failed') {
          lastFailure = result.cause;
          lastFailureText = `could not remove the stale lock of dead owner pid ${inspection.record.pid} (${describeFailure(result.cause)})`;
        } else if (result.outcome === 'aborted') {
          observation += `; recovery aborted: ${result.reason}`;
        } else {
          observation += '; another process holds the recovery mutex';
        }
      }
      // 'alive' or 'unknown': invariant 2 — do not recover.
    }
    // inspection absent: the file vanished — try creating it again after the
    // same waiting/backoff discipline as a confirmed-busy lock.

    if (key !== lastKey) {
      delay = baseDelay;
      lastKey = key;
    }
    if (progressed && freeRuns < MAX_PROGRESS_WITHOUT_SLEEP) {
      freeRuns++;
      continue; // the deadline check at the top still runs
    }
    freeRuns = 0;

    const remaining = Math.max(0, deadline - now());
    const jittered = delay / 2 + random() * (delay / 2);
    await wait(Math.min(jittered, remaining));
    delay = Math.min(delay * 2, maxDelay);
  }
}
