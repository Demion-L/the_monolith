/**
 * Single source of truth for where a MONOLITH instance lives (SEC-001A).
 *
 * Policy (ADR-009):
 *  - `monolithRoot` is a RELATIVE path strictly INSIDE the project root.
 *  - Absent key → documented default `.monolith`. Present but not a
 *    non-empty string → configuration error (never silently defaulted).
 *  - Absolute paths, any `..` segment, and a root that normalizes to the
 *    project root itself are rejected. (`..` is rejected even when it would
 *    lexically stay inside: the kernel resolves `a/..` through `a`, so a
 *    symlinked `a` makes lexical and real resolution diverge.)
 *  - Every existing component of the path must resolve (realpath) inside
 *    the real project root; dangling symlinks and symlink loops fail closed.
 *  - Violations throw RootContainmentError — callers never fall back.
 *
 * This module only reads (lstat/realpath/readFile). It never creates
 * anything. Check-then-use (TOCTOU) races are NOT closed here; see ADR-009.
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from 'fs';
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
  | 'ROOT_UNRESOLVABLE';

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
  const configPath = join(targetDir, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) return { status: 'absent' };
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err) {
    return { status: 'unreadable', detail: errMsg(err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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
 * (`readConfigFile`) to avoid reading twice. A missing/corrupt config file
 * yields the default root; the caller decides how to report corruption.
 */
export function resolveMonolithRoot(targetDir: string, config: ConfigRead = readConfigFile(targetDir)): ResolvedMonolithRoot {
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
