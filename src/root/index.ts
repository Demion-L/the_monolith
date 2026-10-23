/**
 * Single source of truth for where a MONOLITH instance lives (SEC-001A).
 *
 * Policy (ADR-009):
 *  - `monolithRoot` is a RELATIVE path strictly INSIDE the project root.
 *  - Absent config file, or absent `monolithRoot` key → documented default
 *    `.monolith`. A config file that EXISTS but cannot be used (unreadable,
 *    invalid JSON, not an object) or a `monolithRoot` that is present but not
 *    a non-empty string → configuration error (never silently defaulted).
 *  - Absolute paths, any `..` segment, and a root that normalizes to the
 *    project root itself are rejected. (`..` is rejected even when it would
 *    lexically stay inside: the kernel resolves `a/..` through `a`, so a
 *    symlinked `a` makes lexical and real resolution diverge.)
 *  - Every existing component of the path must resolve (realpath) inside
 *    the real project root; dangling symlinks and symlink loops fail closed.
 *  - Violations throw RootContainmentError — callers never fall back.
 *
 * This module only reads (lstat/realpath/open+read). It never creates
 * anything. Check-then-use (TOCTOU) races are NOT closed here; see ADR-009,
 * ADR-011 and ADR-014 (the unified safe read contract implemented below).
 *
 * It also hosts the bounded project-file helpers (`checkProjectFile`,
 * `readProjectFile`, SEC-002) used for root-level files such as
 * `project.definition.mjs`, `monolith.config.json` and `AGENTS.md`, which
 * live next to — not below — `monolithRoot`.
 */

import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'path';

export const DEFAULT_MONOLITH_ROOT = '.monolith';
export const CONFIG_FILE_NAME = 'monolith.config.json';

export type RootErrorCode =
  | 'ROOT_INVALID_TYPE'
  | 'ROOT_EMPTY'
  | 'ROOT_ABSOLUTE'
  | 'ROOT_TRAVERSAL'
  | 'ROOT_IS_PROJECT_ROOT'
  | 'ROOT_SYMLINK_ESCAPE'
  | 'ROOT_UNRESOLVABLE'
  | 'ROOT_CONFIG_INVALID';

export class RootContainmentError extends Error {
  readonly code: RootErrorCode;

  constructor(code: RootErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RootContainmentError';
    this.code = code;
  }
}

export type ConfigRead =
  | { status: 'absent' }
  | { status: 'ok'; cfg: Record<string, unknown> }
  | { status: 'unreadable' | 'invalid-json' | 'not-object'; detail: string };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read `monolith.config.json` without interpreting `monolithRoot`. */
export function readConfigFile(targetDir: string): ConfigRead {
  // Bounded, containment-checked read (SEC-002): a FIFO/device/oversized config
  // or a symlink leaving the project is "unreadable" (fail closed), never
  // blocking and never read past MAX_PROJECT_FILE_BYTES. An absent file, and
  // only an absent file, is "absent".
  const read = readProjectFile(targetDir, CONFIG_FILE_NAME, { allowEmpty: true });
  if (!read.ok) {
    if (read.code === 'FILE_MISSING') return { status: 'absent' };
    return { status: 'unreadable', detail: `${read.code}: ${read.detail}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.content);
  } catch (err) {
    return { status: 'invalid-json', detail: errMsg(err) };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'not-object', detail: 'does not contain a JSON object' };
  }
  return { status: 'ok', cfg: parsed as Record<string, unknown> };
}

/**
 * Lexical validation. Returns the normalized root: `/`-joined segments with
 * empty and `.` segments removed. Throws RootContainmentError otherwise.
 */
export function normalizeMonolithRoot(value: unknown): string {
  if (typeof value !== 'string') {
    throw new RootContainmentError(
      'ROOT_INVALID_TYPE',
      `monolithRoot must be a string, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}.`,
    );
  }
  if (value.length === 0) {
    throw new RootContainmentError('ROOT_EMPTY', 'monolithRoot must not be an empty string.');
  }
  if (value.includes('\0')) {
    throw new RootContainmentError('ROOT_INVALID_TYPE', 'monolithRoot must not contain NUL bytes.');
  }
  // Both flavors are rejected on every platform: a config must mean the same thing everywhere.
  if (isAbsolute(value) || win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new RootContainmentError('ROOT_ABSOLUTE', `monolithRoot must be relative to the project root, got "${value}".`);
  }
  const segments = value.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) {
    throw new RootContainmentError('ROOT_TRAVERSAL', `monolithRoot must not contain ".." segments, got "${value}".`);
  }
  if (segments.length === 0) {
    throw new RootContainmentError(
      'ROOT_IS_PROJECT_ROOT',
      `monolithRoot "${value}" resolves to the project root itself; use a subdirectory such as "${DEFAULT_MONOLITH_ROOT}".`,
    );
  }
  return segments.join('/');
}

/** Path-component-aware containment (never a string prefix test). */
function isInside(baseAbs: string, candidateAbs: string): boolean {
  const rel = relative(baseAbs, candidateAbs);
  return rel === '' || (rel.split(/[\\/]/)[0] !== '..' && !isAbsolute(rel));
}

function realProjectRoot(projectRoot: string): string {
  try {
    return realpathSync(projectRoot);
  } catch (err) {
    throw new RootContainmentError('ROOT_UNRESOLVABLE', `project root "${projectRoot}" cannot be resolved: ${errMsg(err)}`);
  }
}

/**
 * Walk `segments` below the real project root. Each component that exists
 * is realpath'd and must stay inside; the first missing component ends the
 * walk (the nearest existing ancestor has already been verified). A symlink
 * whose target is missing, or a loop, is refused.
 */
function assertSegmentsContained(projectRootReal: string, segments: string[], label: string): void {
  let current = projectRootReal;
  for (const seg of segments) {
    const next = join(current, seg);
    let isLink: boolean;
    try {
      isLink = lstatSync(next).isSymbolicLink();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new RootContainmentError('ROOT_UNRESOLVABLE', `"${label}" cannot be inspected at "${seg}": ${errMsg(err)}`);
    }
    let real: string;
    try {
      real = realpathSync(next);
    } catch (err) {
      const why = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'dangling symlink' : errMsg(err);
      throw new RootContainmentError('ROOT_UNRESOLVABLE', `"${label}" cannot be resolved at "${seg}" (${why}).`);
    }
    if (!isInside(projectRootReal, real)) {
      throw new RootContainmentError(
        'ROOT_SYMLINK_ESCAPE',
        `"${label}" leaves the project root at "${seg}"${isLink ? ' (symlink)' : ''}.`,
      );
    }
    current = real;
  }
}

export interface ResolvedMonolithRoot {
  /** Absolute, lexical project root (`resolve(targetDir)`). */
  projectRoot: string;
  /** Real (symlink-free) project root. */
  projectRootReal: string;
  /** Validated relative root, `/`-separated, never empty. */
  monolithRoot: string;
  /** `projectRoot` + `monolithRoot`. Not realpath'd, so display paths stay stable. */
  rootAbs: string;
  source: 'config' | 'default';
}

/** Validate a root value against a project directory (no config read). */
export function resolveMonolithRootValue(targetDir: string, value: unknown): ResolvedMonolithRoot {
  const monolithRoot = normalizeMonolithRoot(value);
  const projectRoot = resolve(targetDir);
  const projectRootReal = realProjectRoot(projectRoot);
  assertSegmentsContained(projectRootReal, monolithRoot.split('/'), monolithRoot);
  return {
    projectRoot,
    projectRootReal,
    monolithRoot,
    rootAbs: join(projectRoot, monolithRoot),
    source: 'default',
  };
}

/**
 * Resolve the instance root for `targetDir`. Pass an already-read config
 * (`readConfigFile`) to avoid reading twice. Only an ABSENT config file yields
 * the default root; an existing but unusable one throws ROOT_CONFIG_INVALID
 * (fail closed) so a broken config can never redirect writes to `.monolith`.
 */
export function resolveMonolithRoot(targetDir: string, config: ConfigRead = readConfigFile(targetDir)): ResolvedMonolithRoot {
  if (config.status !== 'absent' && config.status !== 'ok') {
    throw new RootContainmentError(
      'ROOT_CONFIG_INVALID',
      `${CONFIG_FILE_NAME} exists but is unusable (${config.status}: ${config.detail}); refusing to fall back to "${DEFAULT_MONOLITH_ROOT}".`,
    );
  }
  if (config.status === 'ok' && Object.prototype.hasOwnProperty.call(config.cfg, 'monolithRoot')) {
    return { ...resolveMonolithRootValue(targetDir, config.cfg.monolithRoot), source: 'config' };
  }
  return resolveMonolithRootValue(targetDir, DEFAULT_MONOLITH_ROOT);
}

/**
 * Verify a fixed file below the instance root (state.json, active.md,
 * state.json.lock, ...) against the real project root, so a symlinked file
 * or a symlinked intermediate directory cannot redirect I/O outside.
 * Returns the lexical absolute path. `relFromRoot` must be trusted/fixed.
 */
export function assertContainedFile(root: ResolvedMonolithRoot, relFromRoot: string): string {
  const segments = [...root.monolithRoot.split('/'), ...relFromRoot.split('/')];
  assertSegmentsContained(root.projectRootReal, segments, `${root.monolithRoot}/${relFromRoot}`);
  return join(root.rootAbs, relFromRoot);
}

/** Non-throwing variant for read paths that report diagnostics. */
export function checkContainedFile(root: ResolvedMonolithRoot, relFromRoot: string): RootContainmentError | null {
  try {
    assertContainedFile(root, relFromRoot);
    return null;
  } catch (err) {
    if (err instanceof RootContainmentError) return err;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Unified safe read contract (SEC-002, ADR-011; SEC-001B.1-R, ADR-014)
// ---------------------------------------------------------------------------

/** Upper bound for any file this module inspects or reads (1 MiB). */
export const MAX_PROJECT_FILE_BYTES = 1024 * 1024;

const READ_CHUNK_BYTES = 64 * 1024;

export type ProjectFileErrorCode =
  | 'FILE_MISSING'
  | 'FILE_OUTSIDE_PROJECT'
  | 'FILE_UNRESOLVABLE'
  | 'FILE_NOT_REGULAR'
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'FILE_CHANGED'
  | 'FILE_UNREADABLE'
  // SEC-001B.1-R
  | 'FILE_SYMLINK'
  | 'FILE_HARDLINKED'
  | 'READ_BOUNDARY_INVALID'
  | 'READ_UNSUPPORTED_PLATFORM';

/**
 * Codes that mean "the file system layout is not what a MONOLITH-managed file
 * must look like" — as opposed to missing, empty, oversized or a transient
 * replacement. A caller may want to surface these differently from an I/O fault.
 */
export const READ_SECURITY_CODES: readonly ProjectFileErrorCode[] = [
  'FILE_OUTSIDE_PROJECT',
  'FILE_SYMLINK',
  'FILE_HARDLINKED',
  'FILE_NOT_REGULAR',
  'READ_BOUNDARY_INVALID',
  'READ_UNSUPPORTED_PLATFORM',
];

export function isReadSecurityViolation(code: ProjectFileErrorCode): boolean {
  return READ_SECURITY_CODES.includes(code);
}

export interface ProjectFileOptions {
  /** Size cap in bytes. Defaults to MAX_PROJECT_FILE_BYTES. */
  maxBytes?: number;
  /** Accept a zero-byte file. Defaults to false. */
  allowEmpty?: boolean;
}

/**
 * Options of the unified reader. `boundary` is mandatory and explicit: an
 * absolute directory whose ANCESTORS (and the directory itself) are trusted —
 * the project root the user pointed at, or, for a caller that says so, the
 * directory that holds the file. Every component below it is checked.
 */
export interface BoundedReadOptions extends ProjectFileOptions {
  boundary: string;
  /**
   * @internal Test seam: the `open(2)` flags the platform provides. Omitted in
   * production (taken from `fs.constants`). A missing flag makes the read fail
   * closed with READ_UNSUPPORTED_PLATFORM.
   */
  platformFlags?: { noFollow?: number; nonBlock?: number };
  /** @internal Test seam: runs between the `lstat` walk and the `open`, so a test can swap the file deterministically. */
  afterInspect?: () => void;
}

export type ProjectFileCheck =
  | { ok: true; path: string; size: number }
  | { ok: false; code: ProjectFileErrorCode; detail: string };

export type ProjectFileRead =
  | { ok: true; path: string; size: number; content: string }
  | { ok: false; code: ProjectFileErrorCode; detail: string };

function fail(code: ProjectFileErrorCode, detail: string): { ok: false; code: ProjectFileErrorCode; detail: string } {
  return { ok: false, code, detail };
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** Segments of `abs` below `base`, or `null` when it is not strictly inside. */
function segmentsBelow(base: string, abs: string): string[] | null {
  const rel = relative(base, abs);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).filter((s) => s.length > 0);
}

/**
 * The unified safe read (SEC-001B.1-R). One policy for every MONOLITH-managed
 * file; there is no permissive variant. Order matters:
 *  1. platform capabilities (`O_NOFOLLOW`, `O_NONBLOCK`) — absent → fail closed;
 *  2. explicit boundary: `abs` and `boundary` must be absolute (never the cwd),
 *     the boundary must be a directory, `abs` must lie strictly below it;
 *  3. `lstat` of EVERY component below the boundary: none may be a symlink
 *     (inside the project or not, dangling or not); the last must be a regular
 *     file with a single link — decided BEFORE `open`, so a FIFO/device/socket
 *     is never opened;
 *  4. `open` with `O_NOFOLLOW|O_NONBLOCK|O_NOCTTY`;
 *  5. `fstat` on the descriptor: still a regular file, same `dev/ino` as step 3,
 *     still one link, size within bounds — all before any content is read;
 *  6. optional read of at most `maxBytes + 1` bytes (the cap applies to bytes
 *     actually read); the descriptor is always closed.
 * Steps 3 and 4 are separate syscalls: this does NOT defend against a local
 * actor swapping a directory or file between them (dynamic TOCTOU, SEC-001B.3).
 * The identity check detects a swap of the FILE only. `label` is for diagnostics.
 * A file replaced between `lstat` and `open` is FILE_CHANGED (transient,
 * retryable), not a fault.
 */
export function readBoundedFile(
  abs: string,
  label: string,
  opts: BoundedReadOptions,
  wantContent: boolean,
): ProjectFileRead | ProjectFileCheck {
  const noFollow = opts.platformFlags ? opts.platformFlags.noFollow : constants.O_NOFOLLOW;
  const nonBlock = opts.platformFlags ? opts.platformFlags.nonBlock : constants.O_NONBLOCK;
  if (typeof noFollow !== 'number' || noFollow === 0 || typeof nonBlock !== 'number' || nonBlock === 0) {
    return fail(
      'READ_UNSUPPORTED_PLATFORM',
      `${label}: this platform lacks O_NOFOLLOW/O_NONBLOCK, so a managed file cannot be read safely; refusing.`,
    );
  }

  const boundary = opts.boundary;
  if (typeof boundary !== 'string' || boundary.length === 0 || !isAbsolute(boundary)) {
    return fail('READ_BOUNDARY_INVALID', `${label}: a read requires an explicit absolute boundary directory (never the cwd).`);
  }
  if (typeof abs !== 'string' || abs.length === 0 || !isAbsolute(abs)) {
    return fail('READ_BOUNDARY_INVALID', `${label}: the path must be absolute (never resolved against the cwd).`);
  }
  const boundaryLexical = resolve(boundary);
  let boundaryReal: string;
  try {
    boundaryReal = realpathSync(boundaryLexical);
    if (!statSync(boundaryReal).isDirectory()) throw new Error('not a directory');
  } catch (err) {
    return fail('READ_BOUNDARY_INVALID', `${label}: boundary "${boundaryLexical}" is not a usable directory: ${errMsg(err)}`);
  }

  const target = resolve(abs);
  let base = boundaryLexical;
  let segs = segmentsBelow(boundaryLexical, target);
  if (segs === null) {
    base = boundaryReal;
    segs = segmentsBelow(boundaryReal, target);
  }
  if (segs === null) {
    return fail('FILE_OUTSIDE_PROJECT', `${label} is not strictly inside the read boundary "${boundaryLexical}".`);
  }

  let before;
  let current = base;
  for (let i = 0; i < segs.length; i++) {
    current = join(current, segs[i]);
    const last = i === segs.length - 1;
    let st;
    try {
      st = lstatSync(current, { bigint: true });
    } catch (err) {
      if (errCode(err) === 'ENOENT') return fail('FILE_MISSING', `${label} does not exist.`);
      return fail('FILE_UNRESOLVABLE', `${label} cannot be inspected at "${segs[i]}": ${errMsg(err)}`);
    }
    if (st.isSymbolicLink()) {
      return fail('FILE_SYMLINK', `${label} passes through a symbolic link at "${segs[i]}"; managed files must not.`);
    }
    if (!last) {
      if (!st.isDirectory()) return fail('FILE_UNRESOLVABLE', `${label} cannot be resolved: "${segs[i]}" is not a directory.`);
      continue;
    }
    if (!st.isFile()) return fail('FILE_NOT_REGULAR', `${label} is not a regular file.`);
    if (st.nlink > 1n) return fail('FILE_HARDLINKED', `${label} has ${st.nlink} hard links; managed files must have exactly one.`);
    before = st;
  }
  if (before === undefined) return fail('READ_BOUNDARY_INVALID', `${label} is the boundary itself, not a file below it.`);

  const maxBytes = opts.maxBytes ?? MAX_PROJECT_FILE_BYTES;
  opts.afterInspect?.();
  let fd: number;
  try {
    fd = openSync(current, constants.O_RDONLY | noFollow | nonBlock | constants.O_NOCTTY);
  } catch (err) {
    if (errCode(err) === 'ENOENT') return fail('FILE_MISSING', `${label} does not exist.`);
    // O_NOFOLLOW on a symlink: the path became a link after the lstat.
    if (errCode(err) === 'ELOOP') return fail('FILE_SYMLINK', `${label} became a symbolic link while being opened.`);
    return fail('FILE_UNREADABLE', `${label} cannot be opened: ${errMsg(err)}`);
  }
  try {
    const st = fstatSync(fd, { bigint: true });
    if (!st.isFile()) return fail('FILE_NOT_REGULAR', `${label} is not a regular file.`);
    if (st.dev !== before.dev || st.ino !== before.ino) {
      return fail('FILE_CHANGED', `${label} changed while it was being inspected.`);
    }
    if (st.nlink > 1n) return fail('FILE_HARDLINKED', `${label} has ${st.nlink} hard links; managed files must have exactly one.`);
    if (st.size === 0n && !opts.allowEmpty) return fail('FILE_EMPTY', `${label} is empty.`);
    if (st.size > BigInt(maxBytes)) return fail('FILE_TOO_LARGE', `${label} is ${st.size} bytes; the limit is ${maxBytes}.`);
    if (!wantContent) return { ok: true, path: abs, size: Number(st.size) };

    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buf = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total));
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      if (total > maxBytes) return fail('FILE_TOO_LARGE', `${label} grew beyond the limit of ${maxBytes} bytes while being read.`);
      chunks.push(buf.subarray(0, n));
    }
    return { ok: true, path: abs, size: total, content: Buffer.concat(chunks).toString('utf8') };
  } catch (err) {
    return fail('FILE_UNREADABLE', `${label} cannot be read: ${errMsg(err)}`);
  } finally {
    closeSync(fd);
  }
}

const CHANGED_RETRIES = 3;
const LINKED_RETRIES = 5;
const LINKED_RETRY_DELAY_MS = 2;

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * `readBoundedFile`, retried across the two states MONOLITH's own writers pass
 * through (neither is a fault): the file is atomically replaced under us
 * (FILE_CHANGED, `rename`), or it has a second link for an instant
 * (FILE_HARDLINKED: a lock is published by `link()`ing its staging file and
 * the staging name is removed right after, SEC-001B.2). After the retries the
 * result is reported as it is — a link that stays is refused, never accepted.
 * Same policy, same options.
 */
export function readBoundedFileStable(
  abs: string,
  label: string,
  opts: BoundedReadOptions,
  wantContent: boolean,
): ProjectFileRead | ProjectFileCheck {
  let r = readBoundedFile(abs, label, opts, wantContent);
  let changed = 1;
  let linked = 1;
  while (!r.ok) {
    if (r.code === 'FILE_CHANGED' && changed < CHANGED_RETRIES) {
      changed++;
    } else if (r.code === 'FILE_HARDLINKED' && linked < LINKED_RETRIES) {
      linked++;
      sleepMs(LINKED_RETRY_DELAY_MS);
    } else {
      break;
    }
    r = readBoundedFile(abs, label, opts, wantContent);
  }
  return r;
}

/** `projectRoot` is the explicit boundary; `relPath` is `/`-separated and must be trusted/fixed. */
function openProjectFile(
  projectRoot: string,
  relPath: string,
  opts: ProjectFileOptions,
  wantContent: boolean,
): ProjectFileRead | ProjectFileCheck {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0 || !isAbsolute(projectRoot)) {
    return fail('READ_BOUNDARY_INVALID', `${relPath}: the project root must be an explicit absolute path (never the cwd).`);
  }
  return readBoundedFile(join(projectRoot, relPath), relPath, { ...opts, boundary: projectRoot }, wantContent);
}

/**
 * Static check of a file below the PROJECT root (not `monolithRoot`) under the
 * unified read policy: exists, no symlink in any component below the root,
 * regular file with one link, non-empty (unless `allowEmpty`) and within
 * `maxBytes`. The content is never read.
 */
export function checkProjectFile(projectRoot: string, relPath: string, opts: ProjectFileOptions = {}): ProjectFileCheck {
  return openProjectFile(projectRoot, relPath, opts, false);
}

/** `checkProjectFile` plus a bounded UTF-8 read of the content. */
export function readProjectFile(projectRoot: string, relPath: string, opts: ProjectFileOptions = {}): ProjectFileRead {
  return openProjectFile(projectRoot, relPath, opts, true) as ProjectFileRead;
}

// ---------------------------------------------------------------------------
// Safe writes (SEC-001B.2, ADR-012)
// ---------------------------------------------------------------------------

export {
  SafeWriteError,
  WriteBoundary,
  ParentRef,
  projectBoundary,
  trustedDirectoryBoundary,
  openParent,
  boundaryPathOf,
  probeTarget,
  createExclusive,
  disposeOwned,
  publishLink,
  createFile,
  replaceFile,
  detectPlatformCaps,
  reportWriteWarning,
  resetWriteWarningState,
} from './safe-write.js';
export { findWriteArtifacts, describeWriteArtifacts } from './write-artifacts.js';
export type { WriteArtifact, WriteArtifactKind } from './write-artifacts.js';
export type {
  PublicationState,
  WriteErrorCode,
  WriteWarning,
  WriteWarningCode,
  WriteScopeMode,
  WriteOptions,
  WriteOutcome,
  DurabilityRequest,
  DurabilityReached,
  TargetProbe,
  OwnedToken,
  OwnedFile,
  DisposeResult,
  PlatformCaps,
  TempFileInfo,
  LinkPublishResult,
  FsOps,
} from './safe-write.js';
