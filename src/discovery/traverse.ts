/**
 * Bounded, safe project traversal (DISCOVERY-001B-1, ADR-021).
 *
 * Lists the directory tree of a project and nothing else: it never reads file
 * content, never writes, never runs project code and never touches the network.
 * It is the only code in Discovery that lists directories.
 *
 * What it does:
 *  - lists each directory through `opendir` + `Dir#readSync` (never `readdirSync`),
 *    one open handle at a time, so a hostile directory cannot be loaded whole before
 *    a cap applies; the handle is always closed (`finally`);
 *  - never follows a symlink (it is listed as kind `symlink` and counted; its target is
 *    never looked at); FIFOs, sockets and devices are listed as `other`, never opened;
 *  - excludes the real `<monolithRoot>` (resolved with `resolveMonolithRoot`, not by
 *    the literal name `.monolith`), a fixed list of dependency/build directories, nested
 *    repositories (a directory holding `.git`) and directories on another file system;
 *  - bounds entries, entries per directory, depth and wall-clock time; every bound that
 *    fires yields `PARTIAL` with a typed diagnostic, never a silent cut;
 *  - is deterministic for an unchanged tree: names are ordered by UTF-16 code units
 *    (never `localeCompare`), breadth-first, and the result is sorted before it is
 *    returned. No clock value, absolute path or `readdir` order reaches the result.
 *
 * What it does NOT do (ADR-013, SEC-001B.3 open; TM-C unsupported): it does not defend
 * against a process that swaps a directory for a symlink between the `lstat` and the
 * `opendir`. It compares the identity of a directory before and after listing it
 * (`DIR_CHANGED`); that DETECTS a swap that happened inside that window and narrows
 * nothing else. Do not run it on a tree an untrusted process is modifying.
 *
 * The time budget is checked between entries; a synchronous syscall that hangs in the
 * kernel (e.g. a dead network mount) is not interrupted.
 */

import { lstatSync, opendirSync, statSync, constants, type Dirent } from 'fs';
import { join } from 'path';
import { RootContainmentError, resolveMonolithRoot } from '../root/index.js';

export type TraversalEntryKind = 'file' | 'directory' | 'symlink' | 'other';

export interface TraversalEntry {
  /** Project-relative, `/`-separated; never absolute, never contains `..`. */
  path: string;
  kind: TraversalEntryKind;
}

export interface TraversalLimits {
  /** Directory entries examined in total (included or not); see `LIMIT_ENTRIES`. */
  maxEntries: number;
  /** A directory with more entries than this is opaque (not enumerated). */
  maxEntriesPerDir: number;
  /** Deepest path (in segments) that is listed; a directory at this depth is not entered. */
  maxDepth: number;
  /** Wall-clock budget in milliseconds (monotonic). */
  deadlineMs: number;
}

/** Starting values (ADR-021 Q-10); validated by the 001B-1 benchmark, see the story report. */
export const DEFAULT_TRAVERSAL_LIMITS: Readonly<TraversalLimits> = Object.freeze({
  maxEntries: 50_000,
  maxEntriesPerDir: 10_000,
  maxDepth: 32,
  deadlineMs: 30_000,
});

/** Directories never entered, matched by name at any depth. */
export const EXCLUDED_DIR_NAMES: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
];

/** Directories never entered, matched by project-relative path. */
export const EXCLUDED_DIR_PATHS: readonly string[] = ['.claude/worktrees'];

/** Per code: how many individual paths are listed before only the total is kept. */
const MAX_DIAGNOSTIC_PATHS = 20;
const MAX_NAME_BYTES = 255;

/**
 * Closed list. `affectsCompleteness` codes make the result PARTIAL (something inside
 * the declared scope could not be done). The others report the scope policy.
 * An unknown code is treated as affecting completeness (fail closed).
 */
const DIAGNOSTIC_AFFECTS_COMPLETENESS = {
  LIMIT_ENTRIES: true,
  LIMIT_DEPTH: true,
  LIMIT_DIR_ENTRIES: true,
  LIMIT_DEADLINE: true,
  DIR_UNREADABLE: true,
  DIR_VANISHED: true,
  DIR_CHANGED: true,
  DIR_ERROR: true,
  NAME_UNREPRESENTABLE: true,
  EXCLUDED_DIR: false,
  MONOLITH_ROOT_EXCLUDED: false,
  SYMLINK_SKIPPED: false,
  NESTED_REPO_SKIPPED: false,
  MOUNT_SKIPPED: false,
} as const;

export type TraversalDiagnosticCode = keyof typeof DIAGNOSTIC_AFFECTS_COMPLETENESS;

export interface TraversalDiagnostic {
  code: TraversalDiagnosticCode;
  /** Project-relative path, when the diagnostic concerns one. */
  path?: string;
  /** Total occurrences, present on the summary line of a code that exceeded the listed paths. */
  count?: number;
  message: string;
}

export interface TraversalStats {
  /** Entries included in `entries`. */
  entries: number;
  files: number;
  directories: number;
  symlinks: number;
  other: number;
  /** Directory entries examined (the figure `maxEntries` bounds). */
  examined: number;
  /** Directories whose contents were listed. */
  listedDirectories: number;
}

export interface TraversalResult {
  /** `PARTIAL` as soon as something inside the declared scope could not be done. */
  completeness: 'COMPLETE' | 'PARTIAL';
  /** `false` when the time budget fired: where it stopped depends on speed, not on the tree. */
  reproducible: boolean;
  limits: TraversalLimits;
  stats: TraversalStats;
  /** Sorted by `path` in UTF-16 code-unit order. */
  entries: TraversalEntry[];
  /** Sorted: completeness-affecting first, then by code, path, message. */
  diagnostics: TraversalDiagnostic[];
}

export type TraversalErrorCode =
  | 'INVALID_LIMITS'
  | 'ROOT_UNSAFE'
  | 'ROOT_NOT_DIRECTORY'
  | 'UNSUPPORTED_PLATFORM';

/** The traversal cannot start or cannot be trusted; no result exists (FAILED). */
export class TraversalError extends Error {
  readonly code: TraversalErrorCode;
  constructor(code: TraversalErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TraversalError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// File-system seam (production uses the real one; tests substitute faults)
// ---------------------------------------------------------------------------

export interface TraversalDirHandle {
  readSync(): Dirent | null;
  closeSync(): void;
}

export interface TraversalIdentity {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  dev: bigint;
  ino: bigint;
}

export interface TraversalFs {
  opendir(path: string): TraversalDirHandle;
  lstat(path: string): TraversalIdentity;
  stat(path: string): TraversalIdentity;
}

const realFs: TraversalFs = {
  opendir: (path) => opendirSync(path),
  lstat: (path) => lstatSync(path, { bigint: true }),
  stat: (path) => statSync(path, { bigint: true }),
};

export interface TraverseOptions {
  limits?: Partial<TraversalLimits>;
  /** @internal Test seam. */
  fs?: TraversalFs;
  /** @internal Test seam: monotonic milliseconds. */
  now?: () => number;
  /** @internal Test seam: the `open(2)` flags the platform provides. */
  platformFlags?: { noFollow?: number; nonBlock?: number };
}

// ---------------------------------------------------------------------------

function resolveLimits(partial: Partial<TraversalLimits> | undefined): TraversalLimits {
  const limits: TraversalLimits = { ...DEFAULT_TRAVERSAL_LIMITS, ...(partial ?? {}) };
  for (const key of Object.keys(DEFAULT_TRAVERSAL_LIMITS) as (keyof TraversalLimits)[]) {
    const v = limits[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      throw new TraversalError('INVALID_LIMITS', `limit "${key}" must be a positive integer (got ${String(v)}).`);
    }
  }
  return limits;
}

/** Names that cannot be represented faithfully: U+FFFD (invalid UTF-8 was replaced), NUL, C0/C1 controls, over-long. */
function nameIsRepresentable(name: string): boolean {
  if (name.length === 0 || Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0xfffd) return false;
  }
  return true;
}

/** UTF-16 code-unit order (the default `<`), not locale order. */
function compareUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

class DiagnosticLog {
  private readonly byCode = new Map<TraversalDiagnosticCode, { total: number; items: TraversalDiagnostic[] }>();

  add(code: TraversalDiagnosticCode, message: string, path?: string): void {
    let slot = this.byCode.get(code);
    if (!slot) {
      slot = { total: 0, items: [] };
      this.byCode.set(code, slot);
    }
    slot.total++;
    if (slot.items.length < MAX_DIAGNOSTIC_PATHS) {
      slot.items.push(path === undefined ? { code, message } : { code, path, message });
    }
  }

  has(code: TraversalDiagnosticCode): boolean {
    return this.byCode.has(code);
  }

  affectsCompleteness(): boolean {
    for (const code of this.byCode.keys()) {
      if (DIAGNOSTIC_AFFECTS_COMPLETENESS[code] !== false) return true;
    }
    return false;
  }

  toSortedList(): TraversalDiagnostic[] {
    const out: TraversalDiagnostic[] = [];
    for (const [code, slot] of this.byCode) {
      out.push(...slot.items);
      if (slot.total > slot.items.length) {
        out.push({ code, count: slot.total, message: `${slot.total} occurrences in total; the first ${slot.items.length} are listed.` });
      }
    }
    const rank = (d: TraversalDiagnostic): number => (DIAGNOSTIC_AFFECTS_COMPLETENESS[d.code] !== false ? 0 : 1);
    return out.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        compareUnits(a.code, b.code) ||
        compareUnits(a.path ?? '', b.path ?? '') ||
        compareUnits(a.message, b.message),
    );
  }
}

type ListOutcome =
  | { ok: true; dirents: { name: string; dirent: Dirent }[] }
  | { ok: false; reason: 'unreadable' | 'vanished' | 'error' | 'opaque'; detail: string };

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** List one directory with a hard cap. Always closes the handle. */
function listDirectory(fs: TraversalFs, abs: string, maxEntriesPerDir: number): ListOutcome {
  let handle: TraversalDirHandle;
  try {
    handle = fs.opendir(abs);
  } catch (err) {
    return failureOf(err);
  }
  const dirents: { name: string; dirent: Dirent }[] = [];
  let outcome: ListOutcome;
  try {
    for (;;) {
      const dirent = handle.readSync();
      if (dirent === null) break;
      if (dirents.length >= maxEntriesPerDir) {
        // One entry more than the cap: stop reading, the directory is opaque.
        return { ok: false, reason: 'opaque', detail: `more than ${maxEntriesPerDir} entries` };
      }
      dirents.push({ name: dirent.name, dirent });
    }
    outcome = { ok: true, dirents };
  } catch (err) {
    outcome = failureOf(err);
  } finally {
    try {
      handle.closeSync();
    } catch {
      // A failed close of a read-only handle changes nothing we returned.
    }
  }
  return outcome;
}

function failureOf(err: unknown): ListOutcome {
  const code = errno(err);
  if (code === 'EACCES' || code === 'EPERM') return { ok: false, reason: 'unreadable', detail: `${code}` };
  if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'vanished', detail: `${code}` };
  return { ok: false, reason: 'error', detail: code ?? errMessage(err) };
}

function direntKind(fs: TraversalFs, dirent: Dirent, abs: string): TraversalEntryKind {
  if (dirent.isSymbolicLink()) return 'symlink';
  if (dirent.isDirectory()) return 'directory';
  if (dirent.isFile()) return 'file';
  // DT_UNKNOWN: the file system does not report a type in the listing; ask, without following.
  try {
    const st = fs.lstat(abs);
    if (st.isSymbolicLink()) return 'symlink';
    if (st.isDirectory()) return 'directory';
    if (st.isFile()) return 'file';
  } catch {
    return 'other';
  }
  return 'other';
}

/**
 * Walk the project at `projectRoot` and return its structure.
 *
 * `projectRoot` is the explicit, caller-resolved project directory (for the CLI: `cwd`).
 * The instance root is resolved with `resolveMonolithRoot` and excluded. Throws
 * `TraversalError` when the walk cannot start or be trusted; otherwise returns a
 * result that says whether it is `COMPLETE` or `PARTIAL`.
 */
export function traverseProject(projectRoot: string, options: TraverseOptions = {}): TraversalResult {
  const flags = options.platformFlags ?? { noFollow: constants.O_NOFOLLOW, nonBlock: constants.O_NONBLOCK };
  if (typeof flags.noFollow !== 'number' || flags.noFollow === 0 || typeof flags.nonBlock !== 'number' || flags.nonBlock === 0) {
    throw new TraversalError('UNSUPPORTED_PLATFORM', 'this platform lacks O_NOFOLLOW/O_NONBLOCK; Discovery fails closed here (ADR-021).');
  }
  const limits = resolveLimits(options.limits);
  const fs = options.fs ?? realFs;
  const now = options.now ?? ((): number => Number(process.hrtime.bigint() / 1_000_000n));

  let monolithRoot: string;
  try {
    monolithRoot = resolveMonolithRoot(projectRoot).monolithRoot;
  } catch (err) {
    if (err instanceof RootContainmentError) throw new TraversalError('ROOT_UNSAFE', err.message, { cause: err });
    throw err;
  }

  let rootIdentity: TraversalIdentity;
  try {
    rootIdentity = fs.stat(projectRoot);
  } catch (err) {
    throw new TraversalError('ROOT_NOT_DIRECTORY', `project root is not accessible (${errno(err) ?? errMessage(err)}).`, { cause: err });
  }
  if (!rootIdentity.isDirectory()) throw new TraversalError('ROOT_NOT_DIRECTORY', 'project root is not a directory.');

  const startedAt = now();
  const diagnostics = new DiagnosticLog();
  const entries: TraversalEntry[] = [];
  const stats: TraversalStats = { entries: 0, files: 0, directories: 0, symlinks: 0, other: 0, examined: 0, listedDirectories: 0 };
  let stopped = false;
  let deadlineFired = false;

  const overDeadline = (): boolean => {
    if (now() - startedAt > limits.deadlineMs) {
      if (!deadlineFired) diagnostics.add('LIMIT_DEADLINE', `time budget of ${limits.deadlineMs} ms exhausted; the walk stopped.`);
      deadlineFired = true;
      stopped = true;
    }
    return stopped;
  };

  // Breadth-first: a limit cuts the deepest levels first, so a partial result is still a map of the top.
  interface QueuedDir {
    rel: string; // '' for the root
    depth: number; // segments of `rel`
    identity: TraversalIdentity;
  }
  const queue: QueuedDir[] = [{ rel: '', depth: 0, identity: rootIdentity }];

  for (let qi = 0; qi < queue.length && !overDeadline(); qi++) {
    const dir = queue[qi];
    const abs = dir.rel === '' ? projectRoot : join(projectRoot, dir.rel);
    const label = dir.rel === '' ? '.' : dir.rel;

    const listed = listDirectory(fs, abs, limits.maxEntriesPerDir);

    if (!listed.ok) {
      if (listed.reason === 'opaque') {
        diagnostics.add('LIMIT_DIR_ENTRIES', `directory has more than ${limits.maxEntriesPerDir} entries; not enumerated.`, label);
        // The directory is opaque: its cost is a fixed, order-independent amount.
        stats.examined += limits.maxEntriesPerDir + 1;
        if (stats.examined > limits.maxEntries) {
          diagnostics.add('LIMIT_ENTRIES', `more than ${limits.maxEntries} entries examined; the walk stopped.`);
          stopped = true;
        }
      } else if (listed.reason === 'unreadable') {
        diagnostics.add('DIR_UNREADABLE', `directory cannot be read (${listed.detail}).`, label);
      } else if (listed.reason === 'vanished') {
        diagnostics.add('DIR_VANISHED', `directory disappeared during the walk (${listed.detail}); the tree is being modified.`, label);
      } else {
        diagnostics.add('DIR_ERROR', `directory cannot be listed (${listed.detail}).`, label);
      }
      continue;
    }

    // Identity after listing must match the identity before (detects a swap inside the window; see header).
    let after: TraversalIdentity;
    try {
      after = dir.rel === '' ? fs.stat(abs) : fs.lstat(abs);
    } catch (err) {
      diagnostics.add('DIR_VANISHED', `directory disappeared during the walk (${errno(err) ?? errMessage(err)}); the tree is being modified.`, label);
      continue;
    }
    if (after.dev !== dir.identity.dev || after.ino !== dir.identity.ino || (dir.rel !== '' && !after.isDirectory())) {
      diagnostics.add('DIR_CHANGED', 'directory was replaced while it was being listed; its contents are discarded.', label);
      continue;
    }
    stats.listedDirectories++;

    const hasGit = listed.dirents.some((d) => d.name === '.git');
    if (dir.rel !== '' && hasGit) {
      diagnostics.add('NESTED_REPO_SKIPPED', 'nested repository or worktree (contains .git); not entered.', label);
      continue;
    }

    const sorted = listed.dirents.sort((a, b) => compareUnits(a.name, b.name));
    for (const { name, dirent } of sorted) {
      if (overDeadline()) break;
      stats.examined++;
      if (stats.examined > limits.maxEntries) {
        diagnostics.add('LIMIT_ENTRIES', `more than ${limits.maxEntries} entries examined; the walk stopped.`);
        stopped = true;
        break;
      }
      const rel = dir.rel === '' ? name : `${dir.rel}/${name}`;
      if (!nameIsRepresentable(name)) {
        diagnostics.add('NAME_UNREPRESENTABLE', 'a name with invalid UTF-8, control characters or over-long was excluded.', dir.rel === '' ? undefined : dir.rel);
        continue;
      }
      if (rel === monolithRoot) {
        diagnostics.add('MONOLITH_ROOT_EXCLUDED', 'the MONOLITH instance root is not part of the inventory.', rel);
        continue;
      }
      const kind = direntKind(fs, dirent, join(projectRoot, rel));
      if (kind === 'directory' && (EXCLUDED_DIR_NAMES.includes(name) || EXCLUDED_DIR_PATHS.includes(rel))) {
        diagnostics.add('EXCLUDED_DIR', `excluded directory "${name}".`, rel);
        continue;
      }

      entries.push({ path: rel, kind });
      stats.entries++;
      if (kind === 'file') stats.files++;
      else if (kind === 'directory') stats.directories++;
      else if (kind === 'symlink') {
        stats.symlinks++;
        diagnostics.add('SYMLINK_SKIPPED', 'symbolic link listed, not followed.', rel);
      } else stats.other++;

      if (kind !== 'directory') continue;
      const depth = dir.depth + 1;
      if (depth >= limits.maxDepth) {
        diagnostics.add('LIMIT_DEPTH', `directory is at the maximum depth of ${limits.maxDepth}; not entered.`, rel);
        continue;
      }
      let identity: TraversalIdentity;
      try {
        identity = fs.lstat(join(projectRoot, rel));
      } catch (err) {
        diagnostics.add('DIR_VANISHED', `directory disappeared during the walk (${errno(err) ?? errMessage(err)}); the tree is being modified.`, rel);
        continue;
      }
      if (!identity.isDirectory()) {
        diagnostics.add('DIR_CHANGED', 'entry listed as a directory is no longer one; not entered.', rel);
        continue;
      }
      if (identity.dev !== rootIdentity.dev) {
        diagnostics.add('MOUNT_SKIPPED', 'directory is on another file system; not entered.', rel);
        continue;
      }
      queue.push({ rel, depth, identity });
    }
  }

  entries.sort((a, b) => compareUnits(a.path, b.path));
  return {
    completeness: diagnostics.affectsCompleteness() ? 'PARTIAL' : 'COMPLETE',
    reproducible: !deadlineFired,
    limits,
    stats,
    entries,
    diagnostics: diagnostics.toSortedList(),
  };
}
