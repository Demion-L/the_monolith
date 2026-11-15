/**
 * Safe write primitive (SEC-001B.2, ADR-012).
 *
 * The one code path that PUBLISHES project files (creates a new one or replaces
 * an existing one). It adds, for every write:
 *
 *  - an explicit WRITE BOUNDARY (`projectBoundary` / `trustedDirectoryBoundary`);
 *    there is no boundary-less write;
 *  - refusal of symlinks anywhere below the boundary, including symlinks that
 *    stay inside the project (W-SYM), of non-regular destinations (FIFO,
 *    device, directory) and of hardlinked destinations (`nlink > 1`);
 *  - a temp file opened `O_CREAT|O_EXCL|O_NOFOLLOW` (where the platform has
 *    `O_NOFOLLOW`) and published atomically: `rename()` over a regular file
 *    (`replaceFile`) or `link()` to a name that must not exist (`createFile`);
 *  - explicit PUBLICATION STATES. A failed write is NOT_PUBLISHED or UNKNOWN; a
 *    write that reached the final name is PUBLISHED and never throws. The state
 *    is decided from the identity (`dev/ino`) of the destination and of the
 *    temp name, never from an error code. UNKNOWN is never retried and never
 *    silently downgraded;
 *  - identity-checked cleanup: only a temp file THIS call created, and only if
 *    the name still shows the inode of a separate read-only IDENTITY descriptor,
 *    which stays open until publication and cleanup are finished (an open
 *    descriptor pins the inode, so it cannot be recycled for a foreign file: no
 *    ABA). The WRITING descriptor is closed before publication (ADR-012). The
 *    `lstat` -> `unlink` step itself remains non-atomic (residual race, ADR-012).
 *
 * Not routed through here: lock release and stale-lock recovery (`lock.ts`)
 * unlink the lock path directly, and `trusted-directory` scope creates its
 * directory with `mkdirSync`; see ADR-012 "Single primitive".
 *
 * What this module does NOT do — and must not be described as doing: it does
 * not defend against a local actor who swaps directories or symlinks
 * concurrently with an operation (SEC-001B.3). `ParentRef` is a path plus a
 * `dev/ino` snapshot; re-checking it before an operation is a diagnostic
 * tripwire, not protection, because the operation resolves the path again.
 * Likewise the final `unlink` of an owned temp file cannot be made conditional
 * without `unlinkat`/dirfd: a name swapped between the identity check and the
 * unlink is a residual race.
 *
 * Platform: guarantees are stated for POSIX. Where `O_NOFOLLOW` or directory
 * fsync is missing (Windows) the checks that can still be done with
 * `lstat`/`fstat` are done, and a PLATFORM_BEST_EFFORT warning is returned.
 */

import * as fs from 'fs';
import { randomBytes } from 'crypto';
import { isAbsolute, join, relative, resolve, sep } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PublicationState = 'NOT_PUBLISHED' | 'PUBLISHED' | 'UNKNOWN';

export type WriteErrorCode =
  | 'WRITE_SCOPE_REQUIRED'
  | 'WRITE_BOUNDARY_INVALID'
  | 'WRITE_OUTSIDE_BOUNDARY'
  | 'WRITE_PARENT_SYMLINK'
  | 'WRITE_PARENT_NOT_DIRECTORY'
  | 'WRITE_PARENT_MISSING'
  | 'WRITE_PARENT_CHANGED'
  | 'WRITE_TARGET_SYMLINK'
  | 'WRITE_TARGET_NOT_REGULAR'
  | 'WRITE_TARGET_EXISTS'
  | 'WRITE_TARGET_HARDLINKED'
  | 'WRITE_TMP_COLLISION'
  | 'WRITE_TOO_LARGE'
  | 'WRITE_READONLY'
  | 'WRITE_PERMISSION'
  | 'WRITE_NO_SPACE'
  | 'WRITE_FSYNC_FAILED'
  | 'WRITE_VERIFY_FAILED'
  | 'WRITE_LINK_UNSUPPORTED'
  | 'WRITE_PUBLICATION_UNKNOWN'
  | 'WRITE_FAILED';

export type WriteWarningCode =
  | 'DIR_FSYNC_UNSUPPORTED'
  | 'DIR_FSYNC_FAILED'
  | 'STAGING_RESIDUE'
  /**
   * After a confirmed publication the identity descriptor of the temporary file
   * failed to close. Not data damage, not a leftover file, not a rollback.
   */
  | 'STAGING_DESCRIPTOR_CLOSE_FAILED'
  | 'PUBLICATION_VERIFIED_AFTER_ERROR'
  | 'PLATFORM_BEST_EFFORT';

export interface WriteWarning {
  code: WriteWarningCode;
  message: string;
  path?: string;
}

/** What the caller asked to be fsynced. */
export type DurabilityRequest = 'full' | 'file' | 'none';
/** What was actually achieved. `unknown`: a directory fsync failed with an I/O error. */
export type DurabilityReached = 'full' | 'file' | 'none' | 'unknown';

export interface TempFileInfo {
  name: string;
  /** Ownership (successful `O_EXCL` create + recorded identity) is established. */
  owned: boolean;
  /** `true` removed/absent, `false` left in place, `null` not attempted. */
  removed: boolean | null;
}

export interface SafeWriteErrorInit {
  code: WriteErrorCode;
  phase: string;
  publication: 'NOT_PUBLISHED' | 'UNKNOWN';
  path: string;
  tmp?: TempFileInfo;
  cause?: unknown;
}

export class SafeWriteError extends Error {
  readonly code: WriteErrorCode;
  readonly phase: string;
  readonly publication: 'NOT_PUBLISHED' | 'UNKNOWN';
  readonly path: string;
  readonly tmp?: TempFileInfo;
  readonly cause?: unknown;

  constructor(message: string, init: SafeWriteErrorInit) {
    super(message);
    this.name = 'SafeWriteError';
    this.code = init.code;
    this.phase = init.phase;
    this.publication = init.publication;
    this.path = init.path;
    this.tmp = init.tmp;
    this.cause = init.cause;
  }
}

export interface WriteOutcome {
  publication: 'PUBLISHED';
  durability: DurabilityReached;
  warnings: WriteWarning[];
}

export interface PlatformCaps {
  /** `O_NOFOLLOW` exists. */
  noFollow: boolean;
  /** A directory can be opened and fsynced. */
  dirFsync: boolean;
  /** `process.geteuid` exists, so file ownership can be checked. */
  ownerCheck: boolean;
  /** Security guarantees of ADR-012 are stated for this platform. */
  posix: boolean;
}

export function detectPlatformCaps(): PlatformCaps {
  const posix = process.platform !== 'win32';
  return {
    // `typeof` on purpose: on Windows the constant is `undefined` and
    // `flags | undefined` would silently drop it.
    noFollow: typeof fs.constants.O_NOFOLLOW === 'number',
    dirFsync: posix,
    ownerCheck: typeof process.geteuid === 'function',
    posix,
  };
}

/** The filesystem calls the primitive makes. Overridable ONLY by tests, for fault injection. */
export interface FsOps {
  openSync: typeof fs.openSync;
  writeSync: typeof fs.writeSync;
  fchmodSync: typeof fs.fchmodSync;
  fstatSync: typeof fs.fstatSync;
  fsyncSync: typeof fs.fsyncSync;
  closeSync: typeof fs.closeSync;
  renameSync: typeof fs.renameSync;
  linkSync: typeof fs.linkSync;
  unlinkSync: typeof fs.unlinkSync;
  lstatSync: typeof fs.lstatSync;
  mkdirSync: typeof fs.mkdirSync;
}

export const realFsOps: FsOps = {
  openSync: fs.openSync,
  writeSync: fs.writeSync,
  fchmodSync: fs.fchmodSync,
  fstatSync: fs.fstatSync,
  fsyncSync: fs.fsyncSync,
  closeSync: fs.closeSync,
  renameSync: fs.renameSync,
  linkSync: fs.linkSync,
  unlinkSync: fs.unlinkSync,
  lstatSync: fs.lstatSync,
  mkdirSync: fs.mkdirSync,
};

/** Test-only knobs; production callers never pass them. */
export interface InternalOptions {
  ops?: Partial<FsOps>;
  caps?: Partial<PlatformCaps>;
}

interface Ctx {
  ops: FsOps;
  caps: PlatformCaps;
}

function ctxOf(o: InternalOptions | undefined): Ctx {
  return {
    ops: { ...realFsOps, ...(o?.ops ?? {}) },
    caps: { ...detectPlatformCaps(), ...(o?.caps ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type BigStats = fs.BigIntStats;

function errnoOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function bigLstat(ctx: Ctx, p: string): BigStats {
  return ctx.ops.lstatSync(p, { bigint: true }) as BigStats;
}

/** `null` when the path does not exist; any other error propagates. */
function bigLstatOrNull(ctx: Ctx, p: string): BigStats | null {
  try {
    return bigLstat(ctx, p);
  } catch (err) {
    if (errnoOf(err) === 'ENOENT') return null;
    throw err;
  }
}

function sameId(st: BigStats, dev: bigint, ino: bigint): boolean {
  return st.dev === dev && st.ino === ino;
}

function platformWarnings(ctx: Ctx): WriteWarning[] {
  if (ctx.caps.posix && ctx.caps.noFollow) return [];
  return [
    {
      code: 'PLATFORM_BEST_EFFORT',
      message:
        'Write-protection guarantees are stated for POSIX only; on this platform symlink/special-file/hardlink checks ' +
        'are best-effort and unverified (ADR-012).',
    },
  ];
}

function codeForErrno(err: unknown, fallback: WriteErrorCode = 'WRITE_FAILED'): WriteErrorCode {
  switch (errnoOf(err)) {
    case 'EROFS':
      return 'WRITE_READONLY';
    case 'EACCES':
    case 'EPERM':
      return 'WRITE_PERMISSION';
    case 'ENOSPC':
    case 'EDQUOT':
      return 'WRITE_NO_SPACE';
    default:
      return fallback;
  }
}

// ---------------------------------------------------------------------------
// Boundary and parent
// ---------------------------------------------------------------------------

export type WriteScopeMode = 'project' | 'trusted-directory';

interface BoundaryData {
  mode: WriteScopeMode;
  lexical: string;
  realDir: string;
}

const boundaryData = new WeakMap<WriteBoundary, BoundaryData>();

/**
 * Trust boundary of a write. Created only by `projectBoundary` /
 * `trustedDirectoryBoundary`. In both modes the ANCESTORS of the boundary are
 * trusted (in `project` mode: the root the user pointed at; in
 * `trusted-directory` mode: because the caller asserts it); every component
 * below the boundary is checked.
 */
export class WriteBoundary {
  private constructor() {
    /* created via the factory functions only */
  }

  get mode(): WriteScopeMode {
    return dataOf(this).mode;
  }

  /** @internal */
  static create(mode: WriteScopeMode, dir: string): WriteBoundary {
    if (typeof dir !== 'string' || dir.length === 0) {
      throw new SafeWriteError('write boundary requires a non-empty directory path.', {
        code: 'WRITE_BOUNDARY_INVALID',
        phase: 'boundary',
        publication: 'NOT_PUBLISHED',
        path: String(dir),
      });
    }
    const lexical = resolve(dir);
    let realDir: string;
    try {
      realDir = fs.realpathSync(lexical);
      if (!fs.statSync(realDir).isDirectory()) throw new Error('not a directory');
    } catch (err) {
      throw new SafeWriteError(`write boundary "${lexical}" cannot be resolved to a directory: ${errMsg(err)}`, {
        code: 'WRITE_BOUNDARY_INVALID',
        phase: 'boundary',
        publication: 'NOT_PUBLISHED',
        path: lexical,
        cause: err,
      });
    }
    const b = new WriteBoundary();
    boundaryData.set(b, { mode, lexical, realDir });
    return b;
  }
}

function dataOf(b: WriteBoundary): BoundaryData {
  const d = boundaryData.get(b);
  if (!d) throw new TypeError('not a WriteBoundary; use projectBoundary() or trustedDirectoryBoundary()');
  return d;
}

/** Project scope: `projectRoot` is the boundary; target directories must lie inside it. */
export function projectBoundary(projectRoot: string): WriteBoundary {
  return WriteBoundary.create('project', projectRoot);
}

/** Trusted-directory scope: the caller asserts `dir` and ALL its ancestors are trusted. */
export function trustedDirectoryBoundary(dir: string): WriteBoundary {
  return WriteBoundary.create('trusted-directory', dir);
}

interface ParentData {
  path: string;
  dev: bigint;
  ino: bigint;
  boundary: WriteBoundary;
}

const parentData = new WeakMap<ParentRef, ParentData>();

/**
 * A verified directory below a boundary. Opaque on purpose: code outside this
 * module must not read its path. Today it is a path with a `dev/ino` snapshot;
 * SEC-001B.3 may replace it with a directory descriptor. It is NOT a security
 * handle (see the module comment).
 */
export class ParentRef {
  private constructor() {
    /* created by openParent only */
  }

  /** @internal */
  static create(data: ParentData): ParentRef {
    const p = new ParentRef();
    parentData.set(p, data);
    return p;
  }
}

/**
 * Absolute path of the boundary a verified parent lies below, for the READ side
 * of the same trust decision (SEC-001B.1-R): a lock file is read under the
 * boundary its staging files are written under. Not a handle; a path.
 */
export function boundaryPathOf(p: ParentRef): string {
  return dataOf(pdata(p).boundary).lexical;
}

function pdata(p: ParentRef): ParentData {
  const d = parentData.get(p);
  if (!d) throw new TypeError('not a ParentRef');
  return d;
}

/** Relative segments of `dirAbs` below the boundary, or `null` if outside. */
function segmentsBelow(b: BoundaryData, dirAbs: string): string[] | null {
  const abs = resolve(dirAbs);
  for (const base of [b.lexical, b.realDir]) {
    const rel = relative(base, abs);
    if (rel === '') return [];
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
    return rel.split(sep).filter((s) => s.length > 0);
  }
  return null;
}

function outsideError(b: BoundaryData, abs: string): SafeWriteError {
  return new SafeWriteError(
    `"${abs}" is outside the ${b.mode} write boundary "${b.lexical}"; refusing to write.`,
    { code: 'WRITE_OUTSIDE_BOUNDARY', phase: 'boundary', publication: 'NOT_PUBLISHED', path: abs },
  );
}

export interface OpenParentOptions extends InternalOptions {
  /** Create missing directories (one `mkdir` per component, never `recursive`). */
  create?: boolean;
}

/**
 * Walk `dirAbs` below the boundary, `lstat`-ing every component: it must be a
 * real directory, never a symlink (W-SYM) — including a symlink that stays
 * inside the project. Missing components are created only with `create`.
 */
export function openParent(boundary: WriteBoundary, dirAbs: string, opts: OpenParentOptions = {}): ParentRef {
  const ctx = ctxOf(opts);
  const b = dataOf(boundary);
  const abs = resolve(dirAbs);
  const segs = segmentsBelow(b, abs);
  if (segs === null) throw outsideError(b, abs);

  let current = b.realDir;
  for (const seg of segs) {
    const next = join(current, seg);
    let st = bigLstatOrNullSafe(ctx, next, abs);
    if (st === null) {
      if (!opts.create) {
        throw new SafeWriteError(`directory "${next}" does not exist.`, {
          code: 'WRITE_PARENT_MISSING',
          phase: 'parent',
          publication: 'NOT_PUBLISHED',
          path: next,
        });
      }
      try {
        ctx.ops.mkdirSync(next);
      } catch (err) {
        if (errnoOf(err) !== 'EEXIST') {
          throw new SafeWriteError(`cannot create directory "${next}": ${errMsg(err)}`, {
            code: codeForErrno(err),
            phase: 'mkdir',
            publication: 'NOT_PUBLISHED',
            path: next,
            cause: err,
          });
        }
      }
      // Re-inspect: whatever is there now (ours, or planted concurrently) is judged the same way.
      st = bigLstatOrNullSafe(ctx, next, abs);
      if (st === null) {
        throw new SafeWriteError(`directory "${next}" disappeared right after it was created.`, {
          code: 'WRITE_PARENT_CHANGED',
          phase: 'parent',
          publication: 'NOT_PUBLISHED',
          path: next,
        });
      }
    }
    assertDirectoryEntry(st, next);
    current = next;
  }

  const st = bigLstatOrNullSafe(ctx, current, abs);
  if (st === null) {
    throw new SafeWriteError(`directory "${current}" does not exist.`, {
      code: 'WRITE_PARENT_MISSING',
      phase: 'parent',
      publication: 'NOT_PUBLISHED',
      path: current,
    });
  }
  assertDirectoryEntry(st, current);
  return ParentRef.create({ path: current, dev: st.dev, ino: st.ino, boundary });
}

function bigLstatOrNullSafe(ctx: Ctx, p: string, whole: string): BigStats | null {
  try {
    return bigLstatOrNull(ctx, p);
  } catch (err) {
    throw new SafeWriteError(`cannot inspect "${p}" (while resolving "${whole}"): ${errMsg(err)}`, {
      code: codeForErrno(err),
      phase: 'parent',
      publication: 'NOT_PUBLISHED',
      path: p,
      cause: err,
    });
  }
}

function assertDirectoryEntry(st: BigStats, p: string): void {
  if (st.isSymbolicLink()) {
    throw new SafeWriteError(
      `"${p}" is a symbolic link. Writes refuse symlinks below the write boundary, even ones that stay inside the ` +
        'project (W-SYM, ADR-012); replace the link with a real directory.',
      { code: 'WRITE_PARENT_SYMLINK', phase: 'parent', publication: 'NOT_PUBLISHED', path: p },
    );
  }
  if (!st.isDirectory()) {
    throw new SafeWriteError(`"${p}" exists but is not a directory.`, {
      code: 'WRITE_PARENT_NOT_DIRECTORY',
      phase: 'parent',
      publication: 'NOT_PUBLISHED',
      path: p,
    });
  }
}

/**
 * Tripwire, not protection: detects a parent that was swapped BEFORE this
 * check. The operation that follows resolves the path again.
 */
function assertParentUnchanged(parent: ParentRef, ctx: Ctx): void {
  const d = pdata(parent);
  let st: BigStats | null;
  try {
    st = bigLstatOrNull(ctx, d.path);
  } catch (err) {
    throw new SafeWriteError(`cannot re-inspect directory "${d.path}": ${errMsg(err)}`, {
      code: codeForErrno(err, 'WRITE_PARENT_CHANGED'),
      phase: 'parent-recheck',
      publication: 'NOT_PUBLISHED',
      path: d.path,
      cause: err,
    });
  }
  if (st === null || !st.isDirectory() || !sameId(st, d.dev, d.ino)) {
    throw new SafeWriteError(`directory "${d.path}" changed while the write was being prepared.`, {
      code: 'WRITE_PARENT_CHANGED',
      phase: 'parent-recheck',
      publication: 'NOT_PUBLISHED',
      path: d.path,
    });
  }
}

// ---------------------------------------------------------------------------
// Read-only probing of a target (scaffold preflight)
// ---------------------------------------------------------------------------

export type TargetProbe =
  | { state: 'free'; path: string }
  | { state: 'exists'; path: string }
  | { state: 'symlink'; path: string }
  | { state: 'special'; path: string }
  | { state: 'parent-symlink'; path: string }
  | { state: 'parent-not-directory'; path: string }
  | { state: 'outside'; path: string }
  | { state: 'unreadable'; path: string; detail: string };

/**
 * Read-only: classify what is at `fileAbs` without writing. Missing parent
 * directories make the target `free` (they would be created). A dangling
 * symlink is a `symlink`, never `free`.
 */
export function probeTarget(boundary: WriteBoundary, fileAbs: string, opts: InternalOptions = {}): TargetProbe {
  const ctx = ctxOf(opts);
  const b = dataOf(boundary);
  const abs = resolve(fileAbs);
  const segs = segmentsBelow(b, abs);
  if (segs === null || segs.length === 0) return { state: 'outside', path: abs };

  let current = b.realDir;
  for (let i = 0; i < segs.length; i++) {
    const next = join(current, segs[i]);
    let st: BigStats | null;
    try {
      st = bigLstatOrNull(ctx, next);
    } catch (err) {
      return { state: 'unreadable', path: next, detail: errMsg(err) };
    }
    if (st === null) return { state: 'free', path: abs };
    const last = i === segs.length - 1;
    if (!last) {
      if (st.isSymbolicLink()) return { state: 'parent-symlink', path: next };
      if (!st.isDirectory()) return { state: 'parent-not-directory', path: next };
      current = next;
      continue;
    }
    if (st.isSymbolicLink()) return { state: 'symlink', path: next };
    if (!st.isFile()) return { state: 'special', path: next };
    return { state: 'exists', path: next };
  }
  return { state: 'free', path: abs };
}

// ---------------------------------------------------------------------------
// Owned temp files
// ---------------------------------------------------------------------------

/** Proof that THIS call created the file: the identity recorded from the descriptor. */
export interface OwnedToken {
  readonly name: string;
  readonly dev: bigint;
  readonly ino: bigint;
}

export interface OwnedFile {
  fd: number;
  token: OwnedToken;
}

export type DisposeResult = 'removed' | 'absent' | 'not-owned' | 'failed';

function openFlags(ctx: Ctx): number {
  const c = fs.constants;
  return c.O_WRONLY | c.O_CREAT | c.O_EXCL | (ctx.caps.noFollow ? c.O_NOFOLLOW : 0);
}

/**
 * Create a brand-new file `name` in `parent`: `O_CREAT|O_EXCL|O_NOFOLLOW` at
 * `mode`. Success proves this call created it; its identity is recorded
 * immediately. If the identity cannot be recorded, ownership is NOT claimed:
 * the descriptor is closed, the file is left alone and the error says so.
 */
export function createExclusive(parent: ParentRef, name: string, mode: number, opts: InternalOptions = {}): OwnedFile {
  const ctx = ctxOf(opts);
  const d = pdata(parent);
  const path = join(d.path, name);
  assertParentUnchanged(parent, ctx);

  let fd: number;
  try {
    fd = ctx.ops.openSync(path, openFlags(ctx), mode);
  } catch (err) {
    if (errnoOf(err) === 'EEXIST') {
      throw new SafeWriteError(`temporary name "${path}" is already taken; refusing to reuse it.`, {
        code: 'WRITE_TMP_COLLISION',
        phase: 'create',
        publication: 'NOT_PUBLISHED',
        path,
        cause: err,
      });
    }
    if (errnoOf(err) === 'ELOOP') {
      throw new SafeWriteError(`"${path}" is a symbolic link; refusing to write through it.`, {
        code: 'WRITE_TARGET_SYMLINK',
        phase: 'create',
        publication: 'NOT_PUBLISHED',
        path,
        cause: err,
      });
    }
    throw new SafeWriteError(`cannot create "${path}": ${errMsg(err)}`, {
      code: codeForErrno(err),
      phase: 'create',
      publication: 'NOT_PUBLISHED',
      path,
      cause: err,
    });
  }

  let st: BigStats;
  try {
    st = ctx.ops.fstatSync(fd, { bigint: true }) as BigStats;
    if (!ctx.caps.noFollow) {
      // No O_NOFOLLOW: the path must still be the very file we just created.
      const at = bigLstat(ctx, path);
      if (at.isSymbolicLink() || !sameId(at, st.dev, st.ino)) throw new Error('path no longer names the created file');
    }
  } catch (err) {
    safeClose(ctx, fd);
    throw new SafeWriteError(
      `created "${path}" but could not confirm its identity, so it is left in place untouched: ${errMsg(err)}`,
      {
        code: 'WRITE_VERIFY_FAILED',
        phase: 'create',
        publication: 'NOT_PUBLISHED',
        path,
        tmp: { name, owned: false, removed: null },
        cause: err,
      },
    );
  }
  return { fd, token: { name, dev: st.dev, ino: st.ino } };
}

function safeClose(ctx: Ctx, fd: number): void {
  try {
    ctx.ops.closeSync(fd);
  } catch {
    /* best effort */
  }
}

/**
 * The temp file of one write call together with the descriptor opened when it
 * was created (ABA hardening, ALPHA4-SEC-SAFEWRITE-001/002).
 *
 * OWNERSHIP OF THE DESCRIPTOR: `stage` returns the IDENTITY descriptor open (the
 * writing one is closed inside `stage`, before publication); from then on the
 * single logical owner is the publishing function (`replaceFile`, `createFile`),
 * which closes it exactly once through `releaseHeld`, after publication and
 * cleanup. While it is open the inode cannot be recycled, so
 * `fstat(fd)` is a live proof of identity and `lstat(name)` is compared against
 * it - never against a number remembered after the descriptor was closed.
 *
 * `fd === null` is the legacy shape used by callers that already closed their
 * descriptor (`publishLink`, `disposeOwned` from `lock.ts`): only the recorded
 * `dev/ino` is available, which is WEAKER (inode reuse is possible) and is kept
 * only because those callers are outside this task's scope.
 */
interface Held {
  readonly token: OwnedToken;
  readonly fd: number | null;
  closed: boolean;
}

/**
 * Does `st` (an `lstat` of the temp name) show the file this call created?
 * Throws if the proof itself cannot be obtained (fstat failed, or the
 * descriptor no longer shows the recorded identity): callers treat a throw as
 * "ownership NOT shown".
 */
function showsOwned(ctx: Ctx, held: Held, st: BigStats): boolean {
  if (!st.isFile()) return false;
  if (held.fd === null) return sameId(st, held.token.dev, held.token.ino);
  if (held.closed) throw new Error('descriptor already released; ownership cannot be proven');
  const live = ctx.ops.fstatSync(held.fd, { bigint: true }) as BigStats;
  if (!live.isFile() || !sameId(live, held.token.dev, held.token.ino)) throw new Error('descriptor identity changed');
  return sameId(st, live.dev, live.ino);
}

function disposeHeld(parent: ParentRef, held: Held, ctx: Ctx): DisposeResult {
  const path = join(pdata(parent).path, held.token.name);
  let st: BigStats | null;
  try {
    st = bigLstatOrNull(ctx, path);
  } catch {
    return 'failed';
  }
  if (st === null) return 'absent';
  let ours: boolean;
  try {
    ours = showsOwned(ctx, held, st);
  } catch {
    return 'failed'; // ownership could not be established: do NOT unlink
  }
  if (!ours) return 'not-owned';
  try {
    ctx.ops.unlinkSync(path);
    return 'removed';
  } catch (err) {
    return errnoOf(err) === 'ENOENT' ? 'absent' : 'failed';
  }
}

/**
 * Remove `token`'s file iff the name still shows the recorded identity. Never
 * removes anything else. This token-only form has no live descriptor and so
 * cannot exclude inode reuse after the caller closed its own; the writes in
 * this module use `disposeHeld`. The unlink itself is not conditional (no
 * `unlinkat`): a name swapped between the check and the unlink is a residual race.
 */
export function disposeOwned(parent: ParentRef, token: OwnedToken, opts: InternalOptions = {}): DisposeResult {
  return disposeHeld(parent, { token, fd: null, closed: true }, ctxOf(opts));
}

/** Close the held descriptor exactly once. Never throws; returns the close error, if any. */
function releaseHeld(ctx: Ctx, held: Held): unknown {
  if (held.fd === null || held.closed) return undefined;
  held.closed = true;
  try {
    ctx.ops.closeSync(held.fd);
  } catch (err) {
    return err;
  }
  return undefined;
}

/** Keep the original failure; mention a failed release of the descriptor. */
function withCloseNote(err: unknown, closeErr: unknown): unknown {
  if (closeErr === undefined || !(err instanceof SafeWriteError)) return err;
  return new SafeWriteError(`${err.message} The identity descriptor also failed to close: ${errMsg(closeErr)}.`, {
    code: err.code,
    phase: err.phase,
    publication: err.publication,
    path: err.path,
    tmp: err.tmp,
    cause: err.cause,
  });
}

function tmpInfo(res: DisposeResult, name: string): TempFileInfo {
  switch (res) {
    case 'removed':
    case 'absent':
      return { name, owned: true, removed: true };
    case 'not-owned':
      return { name, owned: false, removed: false };
    case 'failed':
      return { name, owned: true, removed: false };
  }
}

function residueNote(info: TempFileInfo, dir: string): string {
  if (info.removed) return '';
  return info.owned
    ? ` The temporary file "${info.name}" in "${dir}" could not be removed and was left in place.`
    : ` The temporary file "${info.name}" in "${dir}" no longer matches the file this call created, so it was NOT removed.`;
}

// ---------------------------------------------------------------------------
// Write options
// ---------------------------------------------------------------------------

export interface WriteOptions extends InternalOptions {
  /** Mode for a NEW file (`0o600` for state). With `exactMode: false` it is only the creation mode (umask applies). */
  mode: number;
  /** `fchmod` the file to exactly `mode` (default). Set `false` for documents that follow the umask. */
  exactMode?: boolean;
  /** `replaceFile` only: keep the mode (`& 0o777`) of an existing destination. Default `true`. */
  preserveMode?: boolean;
  /** `'full'` (default): fsync file and directory. `'file'`: file only. `'none'`. */
  durability?: DurabilityRequest;
  /** Refuse data larger than this. */
  maxBytes?: number;
}

function toBuffer(data: string | Buffer): Buffer {
  return typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
}

function tempName(finalName: string): string {
  return `${finalName}.tmp.${process.pid}.${randomBytes(8).toString('hex')}`;
}

function validName(name: string, parent: ParentRef): void {
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new SafeWriteError(`invalid file name "${name}".`, {
      code: 'WRITE_OUTSIDE_BOUNDARY',
      phase: 'validate',
      publication: 'NOT_PUBLISHED',
      path: join(pdata(parent).path, name),
    });
  }
}

interface TargetState {
  existing: BigStats | null;
}

function inspectTarget(parent: ParentRef, name: string, ctx: Ctx, mode: 'replace' | 'create'): TargetState {
  const path = join(pdata(parent).path, name);
  let st: BigStats | null;
  try {
    st = bigLstatOrNull(ctx, path);
  } catch (err) {
    throw new SafeWriteError(`cannot inspect "${path}": ${errMsg(err)}`, {
      code: codeForErrno(err),
      phase: 'validate',
      publication: 'NOT_PUBLISHED',
      path,
      cause: err,
    });
  }
  if (st === null) return { existing: null };
  if (st.isSymbolicLink()) {
    throw new SafeWriteError(
      `"${path}" is a symbolic link (possibly dangling); writes refuse symlinks (W-SYM, ADR-012). Remove the link yourself.`,
      { code: 'WRITE_TARGET_SYMLINK', phase: 'validate', publication: 'NOT_PUBLISHED', path },
    );
  }
  if (!st.isFile()) {
    throw new SafeWriteError(`"${path}" exists but is not a regular file (FIFO, device, socket or directory).`, {
      code: 'WRITE_TARGET_NOT_REGULAR',
      phase: 'validate',
      publication: 'NOT_PUBLISHED',
      path,
    });
  }
  if (mode === 'create') {
    throw new SafeWriteError(`"${path}" already exists; it is never overwritten.`, {
      code: 'WRITE_TARGET_EXISTS',
      phase: 'validate',
      publication: 'NOT_PUBLISHED',
      path,
    });
  }
  if (st.nlink > 1n) {
    throw new SafeWriteError(
      `"${path}" has ${st.nlink} hard links; replacing it would silently detach them, so the write is refused. ` +
        'Make it a standalone copy (for example copy it to a new file and rename that over it), then retry.',
      { code: 'WRITE_TARGET_HARDLINKED', phase: 'validate', publication: 'NOT_PUBLISHED', path },
    );
  }
  return { existing: st };
}

/**
 * The staged temp file as handed to the publishing function. `fd` is the
 * IDENTITY descriptor (read-only, opened separately from the writing one,
 * ALPHA4-SEC-SAFEWRITE-005); the writing descriptor is already closed.
 */
interface Staged extends Held {
  tmpPath: string;
}

/**
 * Flags of the identity descriptor: `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`. Without
 * `O_NOFOLLOW` (Windows, best-effort per ADR-012) the flag is simply absent and
 * `stage` compensates with an `lstat` check; that is NOT equivalent protection.
 * `O_NONBLOCK` keeps a swapped-in FIFO from blocking the open.
 */
function identityFlags(ctx: Ctx): number | null {
  const c = fs.constants;
  const nonBlock = typeof c.O_NONBLOCK === 'number' ? c.O_NONBLOCK : 0;
  // On POSIX a missing O_NONBLOCK would allow a blocking open of a swapped FIFO: refuse.
  if (nonBlock === 0 && ctx.caps.posix) return null;
  return c.O_RDONLY | (ctx.caps.noFollow ? c.O_NOFOLLOW : 0) | nonBlock;
}

/**
 * Steps of the durability order (ADR-012) with TWO descriptors:
 *
 *  - WRITING fd (from `createExclusive`): write, fchmod, verify, fsync, then
 *    CLOSED before publication (a deferred write error surfaces at `close` and
 *    must make the write NOT_PUBLISHED);
 *  - IDENTITY fd (separate read-only `open`, not `dup`): opened right after the
 *    create while the writing fd is open, proven to be the same inode, and
 *    returned STILL OPEN. Its owner from here on is the caller, which releases
 *    it with `releaseHeld` after publication and cleanup. It pins the inode
 *    (no ABA) for verification and cleanup.
 *
 * Any failure leaves the destination untouched, removes the temp file only if
 * ownership still verifies against a live descriptor, and closes every
 * descriptor still owned here exactly once (`releaseHeld` marks before closing,
 * so a failed close is never repeated).
 */
function stage(
  parent: ParentRef,
  finalName: string,
  data: Buffer,
  finalMode: number | null,
  createMode: number,
  fsyncFile: boolean,
  ctx: Ctx,
): Staged {
  const dir = pdata(parent).path;
  const owned = createExclusive(parent, tempName(finalName), createMode, { ops: ctx.ops, caps: ctx.caps });
  const { fd, token } = owned;
  const tmpPath = join(dir, token.name);
  const writing: Held = { token, fd, closed: false };
  let identity: Held | null = null;
  let identityProven = false; // until proven, only the writing descriptor vouches for ownership
  // Owner-read elevation (ALPHA4-SEC-SAFEWRITE-008): the mode the file really had
  // after creation, set ONLY while `0o400` was temporarily added so the read-only
  // identity descriptor can be opened. `null` = no elevation outstanding.
  let restoreMode: number | null = null;

  const abort = (code: WriteErrorCode, phase: string, what: string, cause: unknown): never => {
    // Put the mode back first, while the writing descriptor is still open. A
    // failure here never replaces the original error; it is reported in the message.
    let modeNote = '';
    let modeRestoreFailed = false;
    if (restoreMode !== null && !writing.closed) {
      try {
        ctx.ops.fchmodSync(fd, restoreMode);
        restoreMode = null;
      } catch (restoreErr) {
        modeRestoreFailed = true;
        modeNote = ` The original mode of the temporary file could not be restored after the temporary owner-read elevation: ${errMsg(restoreErr)}.`;
      }
    }
    // Cleanup next, while a live descriptor still proves what the name must show.
    const info = tmpInfo(disposeHeld(parent, identityProven && identity ? identity : writing, ctx), token.name);
    if (modeRestoreFailed && info.owned && !info.removed) modeNote += ' The temporary file was left with the owner-read permission added.';
    const closeErrs = [releaseHeld(ctx, writing), identity ? releaseHeld(ctx, identity) : undefined].filter((e) => e !== undefined);
    const note = closeErrs.length === 0 ? '' : ` A descriptor also failed to close: ${closeErrs.map(errMsg).join('; ')}.`;
    throw new SafeWriteError(`${what}: ${errMsg(cause)}.${residueNote(info, dir)}${modeNote}${note}`, {
      code,
      phase,
      publication: 'NOT_PUBLISHED',
      path: tmpPath,
      tmp: info,
      cause,
    });
  };

  // Owner-read elevation: the identity descriptor is read-only, so a staging
  // file created without owner-read (e.g. `exactMode:false` with 0o200/0o000)
  // could not be opened. Only the mode bit is added, only on the file THIS call
  // created, and only when `0o400` is missing; the mode is restored at the
  // `fchmod` step below, before fsync and close.
  let createdMode: number;
  try {
    const st = ctx.ops.fstatSync(fd, { bigint: true }) as BigStats;
    if (!st.isFile()) throw new Error('not a regular file');
    createdMode = Number(st.mode) & 0o7777;
  } catch (err) {
    return abort('WRITE_VERIFY_FAILED', 'identity', `cannot inspect the mode of "${tmpPath}"`, err);
  }
  if ((createdMode & 0o400) === 0) {
    try {
      ctx.ops.fchmodSync(fd, createdMode | 0o400);
    } catch (err) {
      return abort(codeForErrno(err), 'chmod', `cannot add owner-read to "${tmpPath}" for the identity descriptor`, err);
    }
    restoreMode = createdMode;
  }

  // Identity descriptor: opened before fchmod, while the writing one is open.
  let idFd: number;
  try {
    const flags = identityFlags(ctx);
    if (flags === null) throw new Error('O_NONBLOCK is unavailable, so a swapped-in FIFO could block the open');
    idFd = ctx.ops.openSync(tmpPath, flags);
    identity = { token, fd: idFd, closed: false };
    const w = ctx.ops.fstatSync(fd, { bigint: true }) as BigStats;
    const i = ctx.ops.fstatSync(idFd, { bigint: true }) as BigStats;
    if (!w.isFile() || !i.isFile()) throw new Error('not a regular file');
    if (!sameId(i, w.dev, w.ino) || !sameId(i, token.dev, token.ino)) throw new Error('identity descriptor shows a different file');
    if (!ctx.caps.noFollow) {
      // No O_NOFOLLOW: the name must still be the very file both descriptors show.
      const at = bigLstat(ctx, tmpPath);
      if (at.isSymbolicLink() || !sameId(at, w.dev, w.ino)) throw new Error('path no longer names the created file');
    }
    identityProven = true;
  } catch (err) {
    return abort('WRITE_VERIFY_FAILED', 'identity', `cannot establish the identity descriptor of "${tmpPath}"`, err);
  }

  try {
    let off = 0;
    while (off < data.length) {
      const n = ctx.ops.writeSync(fd, data, off, data.length - off);
      if (!(n > 0)) throw new Error(`write returned ${n} with ${data.length - off} bytes unwritten`);
      off += n;
    }
  } catch (err) {
    return abort(codeForErrno(err), 'write', `cannot write "${tmpPath}"`, err);
  }

  // The final mode, or (after an elevation) the original mode. Without either
  // there is no `fchmod` at all: ordinary modes are never touched.
  const targetMode = finalMode ?? restoreMode;
  if (targetMode !== null) {
    try {
      ctx.ops.fchmodSync(fd, targetMode);
      restoreMode = null;
    } catch (err) {
      return abort(codeForErrno(err), 'chmod', `cannot set the mode of "${tmpPath}"`, err);
    }
  }

  try {
    const st = ctx.ops.fstatSync(fd, { bigint: true }) as BigStats;
    if (!st.isFile()) throw new Error('not a regular file');
    if (st.nlink !== 1n) throw new Error(`link count is ${st.nlink}`);
    if (st.size !== BigInt(data.length)) throw new Error(`size is ${st.size}, expected ${data.length}`);
    if (!sameId(st, token.dev, token.ino)) throw new Error('identity changed');
    if (targetMode !== null && (Number(st.mode) & 0o777) !== (finalMode !== null ? finalMode : targetMode & 0o777)) throw new Error('mode does not match');
    if (ctx.caps.ownerCheck && Number(st.uid) !== process.geteuid!()) throw new Error('not owned by the effective user');
  } catch (err) {
    return abort('WRITE_VERIFY_FAILED', 'verify', `temporary file "${tmpPath}" failed verification`, err);
  }

  if (fsyncFile) {
    try {
      ctx.ops.fsyncSync(fd);
    } catch (err) {
      // Never retried: after an fsync error the state of the pages is undefined.
      return abort('WRITE_FSYNC_FAILED', 'fsync', `cannot fsync "${tmpPath}"`, err);
    }
  }

  // The writing descriptor is closed BEFORE publication (ADR-012): a close error
  // forbids publishing. Whatever close reports, the fd number is spent and is
  // never closed again.
  const closeErr = releaseHeld(ctx, writing);
  if (closeErr !== undefined) {
    return abort(codeForErrno(closeErr), 'close', `cannot close "${tmpPath}"`, closeErr);
  }

  // The identity descriptor must still show the same, complete file.
  try {
    const st = ctx.ops.fstatSync(idFd, { bigint: true }) as BigStats;
    if (!st.isFile() || !sameId(st, token.dev, token.ino)) throw new Error('identity changed after close');
    if (st.nlink !== 1n) throw new Error(`link count is ${st.nlink}`);
    if (st.size !== BigInt(data.length)) throw new Error(`size is ${st.size}, expected ${data.length}`);
  } catch (err) {
    return abort('WRITE_VERIFY_FAILED', 'verify', `temporary file "${tmpPath}" failed verification after close`, err);
  }

  return { token, fd: idFd, closed: false, tmpPath };
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

type Verdict = 'published' | 'not-published' | 'lost-race' | 'unknown';

type PublishKind = 'rename' | 'link';

/**
 * Is `st` the file this call created? Decided against the LIVE descriptor
 * (`fstat(fd)`), not a remembered `dev/ino`. A throw means the proof could not
 * be obtained and must be read as "unknown" by the caller.
 */
function isOurs(st: BigStats | null, staged: Staged, ctx: Ctx): boolean {
  return st !== null && showsOwned(ctx, staged, st);
}

/**
 * One read-only look at the two names after a publish call failed. NO errno is
 * taken as proof that the destination is untouched: an error can be reported
 * for an operation that took effect (a lost reply), and which errors can follow
 * success depends on the filesystem, so the decision is made from identity
 * (`dev/ino` recorded from the descriptor), never from the error code.
 *
 *  - the destination is our file                          -> `published`;
 *  - the temp name is still our file and the destination is not
 *    (`link`+`EEXIST`: the name is held by something else) -> `lost-race`, else
 *    `not-published`;
 *  - anything else, or a failed inspection                  -> `unknown`.
 *
 * For `link`+`EEXIST` the link count of the temp file is deliberately NOT
 * evidence: a second hard link to the temp name (a backup tool, another actor)
 * would otherwise make a foreign destination look like ours.
 * Never retries the publish and never removes anything.
 */
function verifyPublication(kind: PublishKind, errno: string | undefined, targetPath: string, staged: Staged, ctx: Ctx): Verdict {
  try {
    const t = bigLstatOrNull(ctx, targetPath);
    if (isOurs(t, staged, ctx)) return 'published';
    const m = bigLstatOrNull(ctx, staged.tmpPath);
    if (isOurs(m, staged, ctx)) {
      if (kind === 'link' && errno === 'EEXIST') {
        // Held by another object, or it vanished again while our temp name was
        // never linked (link count 1): either way nothing of ours was published.
        if (t !== null || m!.nlink === 1n) return 'lost-race';
        return 'unknown';
      }
      return 'not-published';
    }
  } catch {
    /* the verification itself failed: undecided */
  }
  return 'unknown';
}

function publishFailure(
  kind: PublishKind,
  err: unknown,
  parent: ParentRef,
  staged: Staged,
  targetPath: string,
  ctx: Ctx,
  warnings: WriteWarning[],
): 'published' | 'lost-race' {
  const dir = pdata(parent).path;
  const errno = errnoOf(err);
  const notPublished = (code: WriteErrorCode, what: string): never => {
    const info = tmpInfo(disposeHeld(parent, staged, ctx), staged.token.name);
    throw new SafeWriteError(`${what}: ${errMsg(err)}. The destination was not modified.${residueNote(info, dir)}`, {
      code,
      phase: 'publish',
      publication: 'NOT_PUBLISHED',
      path: targetPath,
      tmp: info,
      cause: err,
    });
  };

  const verdict = verifyPublication(kind, errno, targetPath, staged, ctx);
  if (verdict === 'published') {
    warnings.push({
      code: 'PUBLICATION_VERIFIED_AFTER_ERROR',
      message: `${kind} reported "${errMsg(err)}" but the destination holds the new file; treated as published.`,
      path: targetPath,
    });
    return 'published';
  }
  if (verdict === 'lost-race') return 'lost-race';
  if (verdict === 'not-published') {
    if (kind === 'link' && (errno === 'EPERM' || errno === 'EXDEV')) {
      return notPublished('WRITE_LINK_UNSUPPORTED', `the filesystem does not support hard links here`);
    }
    return notPublished(codeForErrno(err), `cannot publish "${targetPath}"`);
  }
  throw new SafeWriteError(
    `could not determine whether "${targetPath}" was written (${kind} failed with: ${errMsg(err)}). ` +
      `Check its current state before repeating the operation; nothing was retried or removed` +
      ` (temporary file: "${staged.tmpPath}").`,
    {
      code: 'WRITE_PUBLICATION_UNKNOWN',
      phase: 'publish',
      publication: 'UNKNOWN',
      path: targetPath,
      tmp: { name: staged.token.name, owned: true, removed: false },
      cause: err,
    },
  );
}

export interface LinkPublishResult {
  outcome: 'published' | 'lost-race';
  warnings: WriteWarning[];
}

/**
 * Publish an owned, completely written and closed temp file under `finalName`
 * with `link()`, which fails if the name exists (symlink, FIFO or file alike).
 * `lost-race`: somebody else owns the name — nothing of ours was published
 * (the temp file is NOT removed here; the caller disposes it). Errors follow
 * the publication-state rules in the module comment.
 */
export function publishLink(
  parent: ParentRef,
  token: OwnedToken,
  finalName: string,
  opts: InternalOptions = {},
): LinkPublishResult {
  const ctx = ctxOf(opts);
  validName(finalName, parent);
  const dir = pdata(parent).path;
  // The caller already closed its descriptor: token-only (legacy) identity, see `Held`.
  const staged: Staged = { token, fd: null, closed: true, tmpPath: join(dir, token.name) };
  const targetPath = join(dir, finalName);
  const warnings: WriteWarning[] = [];
  assertParentUnchanged(parent, ctx);
  try {
    ctx.ops.linkSync(staged.tmpPath, targetPath);
    return { outcome: 'published', warnings };
  } catch (err) {
    return { outcome: publishFailure('link', err, parent, staged, targetPath, ctx, warnings), warnings };
  }
}

/** fsync the directory. Returns what was reached; failures become warnings. */
function syncDirectory(parent: ParentRef, ctx: Ctx, warnings: WriteWarning[]): DurabilityReached {
  const dir = pdata(parent).path;
  if (!ctx.caps.dirFsync) return 'file';
  const c = fs.constants;
  let fd: number | null = null;
  try {
    fd = ctx.ops.openSync(dir, c.O_RDONLY | (c.O_DIRECTORY ?? 0));
    ctx.ops.fsyncSync(fd);
    return 'full';
  } catch (err) {
    const errno = errnoOf(err);
    if (errno !== undefined && ['EINVAL', 'ENOTSUP', 'ENOSYS', 'EPERM', 'EACCES', 'EBADF', 'EISDIR', 'ENOTDIR'].includes(errno)) {
      warnings.push({
        code: 'DIR_FSYNC_UNSUPPORTED',
        message: `directory fsync is not supported here (${errno}); the file is durable, the directory entry may not be.`,
        path: dir,
      });
      return 'file';
    }
    warnings.push({
      code: 'DIR_FSYNC_FAILED',
      message: `directory fsync failed (${errMsg(err)}); the write is published but its durability is unknown.`,
      path: dir,
    });
    return 'unknown';
  } finally {
    if (fd !== null) safeClose(ctx, fd);
  }
}

function checkSize(path: string, data: Buffer, max: number | undefined): void {
  if (max !== undefined && data.length > max) {
    throw new SafeWriteError(`refusing to write ${data.length} bytes to "${path}": the limit is ${max}.`, {
      code: 'WRITE_TOO_LARGE',
      phase: 'validate',
      publication: 'NOT_PUBLISHED',
      path,
    });
  }
}

function plan(opts: WriteOptions): { finalExact: boolean; fsyncFile: boolean; fsyncDir: boolean; requested: DurabilityRequest } {
  const requested = opts.durability ?? 'full';
  return {
    finalExact: opts.exactMode !== false,
    fsyncFile: requested !== 'none',
    fsyncDir: requested === 'full',
    requested,
  };
}

function reached(requested: DurabilityRequest, dir: DurabilityReached): DurabilityReached {
  if (requested === 'none') return 'none';
  if (requested === 'file') return 'file';
  return dir;
}

/**
 * Atomically replace `name` in `parent` (or create it if absent): temp file ->
 * fsync -> `rename`. The destination must be absent or a regular file with a
 * single link; its mode is kept unless `preserveMode: false`. Throws
 * `SafeWriteError` (NOT_PUBLISHED / UNKNOWN); once published it never throws.
 */
export function replaceFile(parent: ParentRef, name: string, data: string | Buffer, opts: WriteOptions): WriteOutcome {
  const ctx = ctxOf(opts);
  validName(name, parent);
  const buf = toBuffer(data);
  const dir = pdata(parent).path;
  const targetPath = join(dir, name);
  const p = plan(opts);
  checkSize(targetPath, buf, opts.maxBytes);
  assertParentUnchanged(parent, ctx);

  const { existing } = inspectTarget(parent, name, ctx, 'replace');
  let finalMode: number | null;
  if (existing && opts.preserveMode !== false) finalMode = Number(existing.mode) & 0o777;
  else finalMode = p.finalExact ? opts.mode : null;

  const warnings = platformWarnings(ctx);
  const staged = stage(parent, name, buf, finalMode, p.finalExact || existing ? 0o600 : opts.mode, p.fsyncFile, ctx);

  // The staging descriptor stays open through publication and cleanup and is
  // closed exactly once, whatever happens (a failure keeps its own error).
  try {
    assertParentUnchangedOrDispose(parent, staged, ctx, targetPath);
    try {
      ctx.ops.renameSync(staged.tmpPath, targetPath);
    } catch (err) {
      publishFailure('rename', err, parent, staged, targetPath, ctx, warnings);
    }
  } catch (err) {
    throw withCloseNote(err, releaseHeld(ctx, staged));
  }
  noteIdentityCloseFailure(releaseHeld(ctx, staged), warnings, staged.tmpPath);

  const dirReached = p.fsyncDir ? syncDirectory(parent, ctx, warnings) : 'file';
  return { publication: 'PUBLISHED', durability: reached(p.requested, dirReached), warnings };
}

/**
 * The write is already published: a failed release of the IDENTITY descriptor
 * never changes the result. It is reported as `STAGING_DESCRIPTOR_CLOSE_FAILED`
 * (appended to the existing warnings), NOT as `STAGING_RESIDUE`, which means "a
 * temporary file is left behind". The close is never retried. Only the errno
 * code is reported, not the raw message.
 */
function noteIdentityCloseFailure(closeErr: unknown, warnings: WriteWarning[], tmpPath: string): void {
  if (closeErr === undefined) return;
  warnings.push({
    code: 'STAGING_DESCRIPTOR_CLOSE_FAILED',
    message: `the staging descriptor failed to close after publication (${errnoOf(closeErr) ?? 'unknown error'}); the write is published and unaffected.`,
    path: tmpPath,
  });
}

function assertParentUnchangedOrDispose(parent: ParentRef, staged: Staged, ctx: Ctx, targetPath: string): void {
  try {
    assertParentUnchanged(parent, ctx);
  } catch (err) {
    const info = tmpInfo(disposeHeld(parent, staged, ctx), staged.token.name);
    if (err instanceof SafeWriteError) {
      throw new SafeWriteError(`${err.message}${residueNote(info, pdata(parent).path)}`, {
        code: err.code,
        phase: err.phase,
        publication: 'NOT_PUBLISHED',
        path: targetPath,
        tmp: info,
        cause: err.cause,
      });
    }
    throw err;
  }
}

/**
 * Create `name` in `parent` without ever overwriting: temp file -> fsync ->
 * `link()`, then the temp name is removed. The final name never shows a
 * partially written file. A destination that exists in any form (file,
 * symlink, FIFO, ...) is refused. Failures after the link succeeded are
 * warnings (`STAGING_RESIDUE`, directory fsync), never errors.
 */
export function createFile(parent: ParentRef, name: string, data: string | Buffer, opts: WriteOptions): WriteOutcome {
  const ctx = ctxOf(opts);
  validName(name, parent);
  const buf = toBuffer(data);
  const dir = pdata(parent).path;
  const targetPath = join(dir, name);
  const p = plan(opts);
  checkSize(targetPath, buf, opts.maxBytes);
  assertParentUnchanged(parent, ctx);
  inspectTarget(parent, name, ctx, 'create');

  const warnings = platformWarnings(ctx);
  const staged = stage(parent, name, buf, p.finalExact ? opts.mode : null, p.finalExact ? 0o600 : opts.mode, p.fsyncFile, ctx);

  // One owner for the staging descriptor: it is held until the second name has
  // been disposed (the identity check needs it) and closed exactly once.
  let removed: DisposeResult;
  try {
    assertParentUnchangedOrDispose(parent, staged, ctx, targetPath);
    let outcome: 'published' | 'lost-race';
    try {
      ctx.ops.linkSync(staged.tmpPath, targetPath);
      outcome = 'published';
    } catch (err) {
      outcome = publishFailure('link', err, parent, staged, targetPath, ctx, warnings);
    }

    if (outcome === 'lost-race') {
      const info = tmpInfo(disposeHeld(parent, staged, ctx), staged.token.name);
      throw new SafeWriteError(`"${targetPath}" appeared while it was being created; it is never overwritten.${residueNote(info, dir)}`, {
        code: 'WRITE_TARGET_EXISTS',
        phase: 'publish',
        publication: 'NOT_PUBLISHED',
        path: targetPath,
        tmp: info,
      });
    }

    // Published: the temp name is now a second link (nlink 2) to OUR inode; the
    // live descriptor still identifies it, so only that name is removed.
    removed = disposeHeld(parent, staged, ctx);
  } catch (err) {
    throw withCloseNote(err, releaseHeld(ctx, staged));
  }
  noteIdentityCloseFailure(releaseHeld(ctx, staged), warnings, staged.tmpPath);
  if (removed !== 'removed' && removed !== 'absent') {
    warnings.push({
      code: 'STAGING_RESIDUE',
      message: `"${staged.tmpPath}" is a second name of the published file and could not be removed (${removed}); the file itself is complete.`,
      path: staged.tmpPath,
    });
  }
  const dirReached = p.fsyncDir ? syncDirectory(parent, ctx, warnings) : 'file';
  return { publication: 'PUBLISHED', durability: reached(p.requested, dirReached), warnings };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

let platformNoticePrinted = false;

/**
 * Print a post-publication finding as one `warning` line (stderr by default).
 * The platform note is printed once per process, however many files are written.
 * Never throws: the write it reports on is already published.
 */
export function reportWriteWarning(
  warning: WriteWarning,
  print: (line: string) => void = (line) => {
    process.stderr.write(`${line}\n`);
  },
): void {
  try {
    if (warning.code === 'PLATFORM_BEST_EFFORT') {
      if (platformNoticePrinted) return;
      platformNoticePrinted = true;
    }
    print(`warning [${warning.code}]: ${warning.message}${warning.path ? ` (${warning.path})` : ''}`);
  } catch {
    /* ignored on purpose */
  }
}

/** Test-only: forget that the platform note was printed. */
export function resetWriteWarningState(): void {
  platformNoticePrinted = false;
}
