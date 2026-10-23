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
 * anything. Check-then-use (TOCTOU) races are NOT closed here; see ADR-009
 * and ADR-011.
 *
 * It also hosts the bounded project-file helpers (`checkProjectFile`,
 * `readProjectFile`, SEC-002) used for root-level files such as
 * `project.definition.mjs`, `monolith.config.json` and `AGENTS.md`, which
 * live next to — not below — `monolithRoot`.
 */

import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve, win32 } from 'path';

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
// Bounded project-file access (SEC-002, ADR-011)
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
  | 'FILE_UNREADABLE';

export interface ProjectFileOptions {
  /** Size cap in bytes. Defaults to MAX_PROJECT_FILE_BYTES. */
  maxBytes?: number;
  /** Accept a zero-byte file. Defaults to false. */
  allowEmpty?: boolean;
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

/**
 * Shared implementation. Order matters:
 *  1. containment of every existing path component (realpath) — no I/O on the file;
 *  2. `stat` (follows links) and refusal of anything but a regular file BEFORE
 *     `open`, so a FIFO or device is never opened;
 *  3. `open` with O_NONBLOCK (a FIFO that slipped in after step 2 cannot block
 *     the open) and O_NOCTTY;
 *  4. `fstat` on the descriptor: still a regular file, same dev/ino as step 2,
 *     size within bounds — all before any content is read;
 *  5. optional read of at most `maxBytes + 1` bytes (the file may grow after
 *     fstat; the cap applies to bytes actually read);
 *  6. the descriptor is always closed.
 * Steps 1-2 and 3 are separate syscalls, so a local attacker racing a path
 * component swap is NOT stopped (TOCTOU, SEC-001B).
 */
function openProjectFile(
  projectRoot: string,
  relPath: string,
  opts: ProjectFileOptions,
  wantContent: boolean,
): ProjectFileRead | ProjectFileCheck {
  const root = resolve(projectRoot);

  let rootReal: string;
  try {
    rootReal = realProjectRoot(root);
    assertSegmentsContained(rootReal, relPath.split('/'), relPath);
  } catch (err) {
    if (!(err instanceof RootContainmentError)) throw err;
    return fail(err.code === 'ROOT_SYMLINK_ESCAPE' ? 'FILE_OUTSIDE_PROJECT' : 'FILE_UNRESOLVABLE', err.message);
  }

  return readBoundedFile(join(root, relPath), relPath, opts, wantContent);
}

/**
 * Steps 2-6 of `openProjectFile`, for a path whose containment the caller has
 * already established (or does not need to: e.g. a lock file next to
 * `state.json`, whose directory was resolved through `resolveMonolithRoot`).
 * `label` is only used in diagnostics. A file replaced between `stat` and
 * `open` is reported as FILE_CHANGED (transient, retryable), not as a fault.
 */
export function readBoundedFile(
  abs: string,
  label: string,
  opts: ProjectFileOptions,
  wantContent: boolean,
): ProjectFileRead | ProjectFileCheck {
  const maxBytes = opts.maxBytes ?? MAX_PROJECT_FILE_BYTES;
  let before;
  try {
    before = statSync(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fail('FILE_MISSING', `${label} does not exist.`);
    return fail('FILE_UNREADABLE', `${label} cannot be inspected: ${errMsg(err)}`);
  }
  if (!before.isFile()) return fail('FILE_NOT_REGULAR', `${label} is not a regular file.`);

  let fd: number;
  try {
    fd = openSync(abs, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOCTTY);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fail('FILE_MISSING', `${label} does not exist.`);
    return fail('FILE_UNREADABLE', `${label} cannot be opened: ${errMsg(err)}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return fail('FILE_NOT_REGULAR', `${label} is not a regular file.`);
    if (st.dev !== before.dev || st.ino !== before.ino) {
      return fail('FILE_CHANGED', `${label} changed while it was being inspected.`);
    }
    if (st.size === 0 && !opts.allowEmpty) return fail('FILE_EMPTY', `${label} is empty.`);
    if (st.size > maxBytes) return fail('FILE_TOO_LARGE', `${label} is ${st.size} bytes; the limit is ${maxBytes}.`);
    if (!wantContent) return { ok: true, path: abs, size: st.size };

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

/**
 * `readBoundedFile`, retried while the file is atomically replaced under us
 * (FILE_CHANGED). For readers that race a rename-based writer or a lock
 * release/re-acquire: those are normal, not faults. After the retries it
 * still reports FILE_CHANGED rather than guessing.
 */
export function readBoundedFileStable(
  abs: string,
  label: string,
  opts: ProjectFileOptions,
  wantContent: boolean,
): ProjectFileRead | ProjectFileCheck {
  let r = readBoundedFile(abs, label, opts, wantContent);
  for (let i = 1; i < CHANGED_RETRIES && !r.ok && r.code === 'FILE_CHANGED'; i++) {
    r = readBoundedFile(abs, label, opts, wantContent);
  }
  return r;
}

/**
 * Static check of a file below the PROJECT root (not `monolithRoot`): exists,
 * stays inside the project (symlinks that stay inside are allowed), is a
 * regular file, is non-empty (unless `allowEmpty`) and within `maxBytes`.
 * The content is never read. `relPath` is `/`-separated and must be trusted/fixed.
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
