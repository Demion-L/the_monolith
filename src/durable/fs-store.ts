/**
 * Filesystem `EventStore`.
 *
 * Layout under the store directory:
 *
 *   tasks/<taskId>/events/<seq,9 digits>.json      one canonical event, immutable
 *   tasks/<taskId>/segments/S<from>-<to>.jsonl     packed, verified events (compaction)
 *   tasks/<taskId>/prune-<n>.prepare.json          prune decision register (ADR-019): one attempt per file pair,
 *   tasks/<taskId>/prune-<n>.decision.json         create-only, never deleted, never rewritten
 *   tasks/<taskId>/tombstone.json                  published from the `commit` record of the register
 *   durable-protocol.json                          version marker; created only by `initializeProtocol()`
 *
 * Concurrency needs no lock file. The one linearizable primitive is "create
 * `<seq>.json` if it does not exist" — `createFile` of the safe-write
 * primitive (temp file, fsync, `link()`, ADR-012). Of N writers racing for the
 * same slot exactly one wins; the others see `conflict`, re-read and retry.
 * There is no owner to declare dead, so none of the stale-lock failure modes
 * (PID reuse across namespaces, wedged lock after a crash; ADR-015) exist.
 *
 * Crash behaviour:
 *  - before `link()`           : nothing is visible; the temp file is a stranger.
 *  - between `link()`/`unlink` : the event is complete and visible, but the file
 *    has two names (`nlink == 2`). The strict reader of ADR-014 refuses such a
 *    file, which would wedge the task for good. Here that state is *provable
 *    residue* — the second name is `<file>.tmp.<pid>.<rand>` with the same
 *    dev/ino — and the reader removes exactly that name and re-reads. Any
 *    other second link stays a hard `StoreSecurityError`.
 *  - compaction / prune       : ordered so that every prefix of the steps is a
 *    consistent state (segment before unlink, tombstone before removal).
 *
 * Out of scope (same as the rest of MONOLITH, ADR-013): a local adversary that
 * swaps directories concurrently (TM-C), NFS/SMB, Windows.
 */

import * as fs from 'fs';
import { dirname, join } from 'path';
import { sha256Hex } from './canonical.js';
import {
  LogCorruptError,
  PruneAttemptLimitError,
  PruneDecisionCorruptError,
  RetentionRefusedError,
  StoreIoError,
  StoreProtocolError,
  StoreSecurityError,
  TaskPrunedError,
  TombstoneCommittedError,
  type PruneCorruptReason,
} from './errors.js';
import {
  MAX_REGISTER_BYTES,
  MAX_WRITE_RESOLVE,
  PROTOCOL_MARKER_FILE,
  STAGING_RE,
  TOMBSTONE_FILE,
  decisionFile,
  derivePruneState,
  encodeDecision,
  encodePrepare,
  encodeTombstone,
  parseDecision,
  parsePrepare,
  parseTombstoneFile,
  prepareFile,
  sameTombstone,
  type Obs,
  type RegisterIO,
} from './register.js';
import { MAX_EVENT_BYTES, ID_PATTERN, parseEvent, serializeEvent, verifyChain } from './log.js';
import { GENESIS_HASH, MAX_PRUNE_ATTEMPTS, type DecisionBy, type PruneOutcome, type PruneState } from './types.js';
import {
  SafeWriteError,
  createFile,
  openParent,
  projectBoundary,
  readBoundedFile,
  trustedDirectoryBoundary,
  type FsOps,
  type WriteBoundary,
  type WriteWarning,
} from '../root/index.js';
import type { CompactionResult, EventStore, LogRead, StoreDiagnostic, TaskEvent, Tombstone } from './types.js';

export type FsStoreTarget =
  | { scope: 'project'; projectRoot: string; dir: string }
  | { scope: 'trusted-directory'; dir: string };

export interface FsStoreOptions {
  target: FsStoreTarget;
  /** Receives non-fatal findings of the write primitive (e.g. directory fsync unsupported). */
  onWarning?: (w: WriteWarning) => void;
  /** `'full'` (default) fsyncs file and directory; `'file'` only the file. */
  durability?: 'full' | 'file';
  /** @internal fault injection for tests. */
  ops?: Partial<FsOps>;
  /** @internal test seam: called between the pre-publish checks and the publication of an event. */
  beforePublish?: (event: TaskEvent) => void | Promise<void>;
  /** @internal test seam: called in `readLog` right after the directory listings, before any file is read. */
  afterListing?: (attempt: number) => void;
  /** @internal Design A G1 (section 24.6): refuse early on a pruned or corrupt task before publishing. Default `true`. Safety does not depend on it. */
  earlyPruneCheck?: boolean;
  /** @internal lowers `MAX_PRUNE_ATTEMPTS` so a test need not write a thousand attempts. */
  maxPruneAttempts?: number;
  /** @internal returns a different (e.g. incomplete) listing of a task directory for the register: listings are not atomic (A7). */
  registerListing?: (taskId: string, names: string[]) => string[];
  /** @internal simulate an I/O error on reading a file of the store: return an errno code (`'EIO'`) to fail with, or nothing. */
  readFault?: (abs: string) => string | null | undefined;
}

/** Packed segments stay well below this; it is the reader's ceiling. */
export const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;

const EVENT_NAME = /^(\d{9})\.json$/;
const SEGMENT_NAME = /^S(\d{9})-(\d{9})\.jsonl$/;
const REF_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/;
const TMP_NAME = STAGING_RE;
const TOMBSTONE_NAME = TOMBSTONE_FILE;
const MAX_TOMBSTONE_BYTES = 4096;
const READ_ATTEMPTS = 8;

export class AppendOutcomeUnknownError extends StoreIoError {
  constructor(readonly taskId: string, readonly seq: number, cause?: unknown) {
    super(`publication of event ${seq} of task "${taskId}" has an unknown outcome; re-read the log to find out.`, cause);
    this.name = 'AppendOutcomeUnknownError';
  }
}

const SECURITY_WRITE_CODES = new Set([
  'WRITE_BOUNDARY_INVALID',
  'WRITE_OUTSIDE_BOUNDARY',
  'WRITE_PARENT_SYMLINK',
  'WRITE_PARENT_NOT_DIRECTORY',
  'WRITE_PARENT_CHANGED',
  'WRITE_TARGET_SYMLINK',
  'WRITE_TARGET_NOT_REGULAR',
  'WRITE_TARGET_HARDLINKED',
]);

const SECURITY_REASONS = new Set(['FILE_SYMLINK', 'FILE_OUTSIDE_PROJECT', 'FILE_NOT_REGULAR', 'READ_BOUNDARY_INVALID', 'FILE_HARDLINKED']);

const SECURITY_READ_CODES = new Set(['FILE_OUTSIDE_PROJECT', 'FILE_SYMLINK', 'FILE_NOT_REGULAR', 'READ_BOUNDARY_INVALID', 'READ_UNSUPPORTED_PLATFORM']);

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const pad = (n: number): string => String(n).padStart(9, '0');

/** What the version marker says about the store (Design A, sections 13 and 46.5). */
export type ProtocolStatus =
  /** `durable-protocol.json` is present and understood: the store may be written. */
  | { mode: 'ready'; version: 2 }
  /** No marker: read-only diagnostics. Nothing is created, nothing is migrated. */
  | { mode: 'diagnostic'; reason: 'uninitialized'; tasksPresent: boolean }
  /** A marker this build does not understand (a newer version, or damaged): the store is not opened as compatible. */
  | { mode: 'incompatible'; reason: 'unsupported-version' | 'invalid-marker' };

/** Canonical content of one slot (Design A, section 40.2). */
type CanonSlot = { t: 'LOOSE' | 'SEGMENT'; line: string } | { t: 'EMPTY' | 'IOERR' | 'BAD' | 'GONE' };

type Cei = { t: 'EVIDENCE'; via: 'loose' | 'segment' } | { t: 'CONFLICT' } | { t: 'LOST' } | { t: 'UNKNOWN' };

/** Outcome of the post-publication check (G2, section 24.2). Nothing it decides ever deletes the published file. */
type Settle = { t: 'CONFIRMED' } | { t: 'PRUNED' } | { t: 'CORRUPT'; state: PruneState } | { t: 'UNKNOWN'; why: string };

interface SegmentRef {
  name: string;
  from: number;
  to: number;
}

export class FsEventStore implements EventStore {
  private readonly root: string;
  private readonly boundaryDir: string;
  private boundaryCache: WriteBoundary | null = null;
  private readonly opts: FsStoreOptions;
  /** True once a valid marker was seen. Only then may a read repair anything (it is a mutation). Never reset: the marker is never removed. */
  private ready = false;
  private readonly maxAttempts: number;

  constructor(opts: FsStoreOptions) {
    this.opts = opts;
    this.root = opts.target.dir;
    this.boundaryDir = opts.target.scope === 'project' ? opts.target.projectRoot : opts.target.dir;
    this.maxAttempts = opts.maxPruneAttempts ?? MAX_PRUNE_ATTEMPTS;
  }

  /**
   * The trust boundary. In `trusted-directory` scope the directory is the boundary and is created on the
   * first write if missing (same contract as the state keeper); a read of a store that does not exist yet
   * simply finds nothing. In `project` scope the project root must already exist.
   */
  private boundaryFor(forWrite: boolean): WriteBoundary | null {
    if (this.boundaryCache) return this.boundaryCache;
    const t = this.opts.target;
    if (t.scope === 'trusted-directory' && !fs.existsSync(t.dir)) {
      if (!forWrite) return null;
      fs.mkdirSync(t.dir, { recursive: true, mode: 0o700 });
    }
    this.boundaryCache = this.wrapSafe(() => (t.scope === 'project' ? projectBoundary(t.projectRoot) : trustedDirectoryBoundary(t.dir)));
    return this.boundaryCache;
  }

  // ----- paths --------------------------------------------------------------

  private taskDir(taskId: string): string {
    if (!ID_PATTERN.test(taskId)) throw new StoreSecurityError(`invalid task id "${taskId}".`, 'BAD_ID');
    return join(this.root, 'tasks', taskId);
  }
  private eventsDir(taskId: string): string {
    return join(this.taskDir(taskId), 'events');
  }
  private segmentsDir(taskId: string): string {
    return join(this.taskDir(taskId), 'segments');
  }
  private refsDir(taskId: string): string {
    return join(this.taskDir(taskId), 'refs');
  }

  // ----- error mapping ------------------------------------------------------

  private wrapSafe<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  private mapWriteError(err: unknown): Error {
    if (err instanceof SafeWriteError) {
      if (SECURITY_WRITE_CODES.has(err.code)) return new StoreSecurityError(err.message, err.code);
      return new StoreIoError(err.message, err);
    }
    return err instanceof Error ? err : new StoreIoError(String(err));
  }

  // ----- version marker, bootstrap and diagnostic mode (Design A sections 13, 46.5) -----------------------------

  private markerRead(): Obs<number> {
    // The marker's own staging twin (a crash between link() and unlink(tmp) of its publication) may be repaired by whoever
    // reads it: the marker is there, so the store is initialized, and removing a provable twin changes no state.
    const r = this.readFileObs(join(this.root, PROTOCOL_MARKER_FILE), PROTOCOL_MARKER_FILE, 1024, true);
    if (r.k === 'bad' && SECURITY_REASONS.has(r.reason)) {
      throw new StoreSecurityError(`${PROTOCOL_MARKER_FILE} or a directory above it is not what a managed file must be (${r.reason}); refusing to use the store.`, r.reason);
    }
    if (r.k !== 'ok') return r;
    try {
      const o = JSON.parse(r.v) as unknown;
      if (typeof o === 'object' && o !== null && !Array.isArray(o) && Object.keys(o).join() === 'v') {
        const v = (o as { v: unknown }).v;
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return { k: 'ok', v };
      }
    } catch {
      /* falls through */
    }
    return { k: 'bad', reason: 'schema' };
  }

  private hasTasks(): boolean {
    return (this.listDir(join(this.root, 'tasks')) ?? []).some((e) => e.isDirectory() || e.isSymbolicLink());
  }

  /**
   * What this store may be used for. Pure observation: it creates nothing and repairs nothing. A store with no marker is
   * `diagnostic` (empty or not): reads work, every mutation is refused until the operator calls `initializeProtocol()`.
   */
  async protocolStatus(): Promise<ProtocolStatus> {
    const m = this.markerRead();
    if (m.k === 'ioerr') throw new StoreIoError(`cannot read ${PROTOCOL_MARKER_FILE}: ${m.reason}`);
    if (m.k === 'bad') return { mode: 'incompatible', reason: 'invalid-marker' };
    if (m.k === 'ok') {
      if (m.v !== 2) return { mode: 'incompatible', reason: 'unsupported-version' };
      this.ready = true;
      return { mode: 'ready', version: 2 };
    }
    return { mode: 'diagnostic', reason: 'uninitialized', tasksPresent: this.hasTasks() };
  }

  /**
   * Explicit operator action (Design A section 46.5, ADR-018 D3): publish `durable-protocol.json` (`{"v":2}`, create-only)
   * in an EMPTY store, with every runtime of an older version stopped. It refuses a store that holds tasks (that needs the
   * migration decision of the operator, not a bootstrap), refuses a marker of another version, and is a no-op when a valid
   * marker is already there. Opening a store never does this.
   */
  async initializeProtocol(): Promise<'initialized' | 'already-initialized'> {
    return this.initializeProtocolSync();
  }

  /** The same operator action as `initializeProtocol`, for scripts and tests that are not async. */
  initializeProtocolSync(): 'initialized' | 'already-initialized' {
    const m = this.markerRead();
    if (m.k === 'ioerr') throw new StoreIoError(`cannot read ${PROTOCOL_MARKER_FILE}: ${m.reason}`);
    if (m.k === 'bad' || (m.k === 'ok' && m.v !== 2)) {
      throw new StoreProtocolError(`the store carries a ${PROTOCOL_MARKER_FILE} this version does not understand; it will not be touched.`, 'PROTOCOL_UNSUPPORTED');
    }
    if (m.k === 'ok') {
      this.ready = true;
      return 'already-initialized';
    }
    if (this.hasTasks()) {
      throw new StoreProtocolError('the store already holds tasks; a store with tasks and no marker is only for diagnostics until the operator migrates it.', 'PROTOCOL_STORE_NOT_EMPTY');
    }
    const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, this.root, { create: true, ops: this.opts.ops }));
    try {
      const out = createFile(parent, PROTOCOL_MARKER_FILE, '{"v":2}\n', { mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: 1024, ops: this.opts.ops });
      for (const w of out.warnings) this.opts.onWarning?.(w);
    } catch (err) {
      if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS') {
        const again = this.markerRead();
        if (again.k === 'ok' && again.v === 2) {
          this.ready = true;
          return 'already-initialized';
        }
        throw new StoreProtocolError(`another ${PROTOCOL_MARKER_FILE} appeared that this version does not understand; it will not be touched.`, 'PROTOCOL_UNSUPPORTED');
      }
      throw this.mapWriteError(err);
    }
    this.fsyncChain(this.root);
    this.ready = true;
    return 'initialized';
  }

  /** Called first by every public method. A write needs a valid marker; a read needs the marker to be absent or valid. */
  private gate(kind: 'read' | 'write'): void {
    if (this.ready) return;
    const m = this.markerRead();
    if (m.k === 'ok' && m.v === 2) {
      this.ready = true;
      return;
    }
    if (m.k === 'ioerr') throw new StoreIoError(`cannot read ${PROTOCOL_MARKER_FILE}: ${m.reason}`);
    if (m.k === 'bad' || m.k === 'ok') {
      throw new StoreProtocolError(`the store carries a ${PROTOCOL_MARKER_FILE} this version does not understand; it is not opened as compatible.`, 'PROTOCOL_UNSUPPORTED');
    }
    if (kind === 'write') {
      throw new StoreProtocolError(
        `the durable store has no ${PROTOCOL_MARKER_FILE}: it is open for diagnostics only. An operator must initialize it explicitly (initializeProtocol) on an empty store; a store with tasks needs the migration procedure.`,
        'PROTOCOL_NOT_INITIALIZED',
      );
    }
  }

  // ----- directory helpers --------------------------------------------------

  /** Verified directory (no symlink below the boundary) or `null` if it does not exist. */
  private existingDir(dir: string): boolean {
    const boundary = this.boundaryFor(false);
    if (!boundary) return false;
    try {
      openParent(boundary, dir, { ops: this.opts.ops });
      return true;
    } catch (err) {
      if (err instanceof SafeWriteError && err.code === 'WRITE_PARENT_MISSING') return false;
      throw this.mapWriteError(err);
    }
  }

  private listDir(dir: string): fs.Dirent[] | null {
    if (!this.existingDir(dir)) return null;
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (errno(err) === 'ENOENT') return null;
      throw new StoreIoError(`cannot list "${dir}": ${(err as Error).message}`, err);
    }
  }

  // ----- strict read with residue repair ------------------------------------

  /**
   * The second name of a freshly published file, if (and only if) it is
   * provably this file's staging name: `<name>.tmp.<pid>.<rand>` in the same
   * directory with the same dev/ino. Returns the removed name or `null`.
   * Removing it is a mutation: a store without a valid marker (diagnostics only) never does it.
   */
  private repairResidue(abs: string, force = false): string | null {
    if (!this.ready && !force) return null;
    const dir = dirname(abs);
    const name = abs.slice(dir.length + 1);
    let final: fs.BigIntStats;
    try {
      final = fs.lstatSync(abs, { bigint: true });
    } catch {
      return null;
    }
    if (!final.isFile() || final.nlink !== 2n) return null;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return null;
    }
    const twins: string[] = [];
    for (const e of entries) {
      const m = TMP_NAME.exec(e);
      if (!m || m[1] !== name) continue;
      try {
        const st = fs.lstatSync(join(dir, e), { bigint: true });
        if (st.isFile() && st.dev === final.dev && st.ino === final.ino) twins.push(e);
      } catch {
        /* vanished: the writer finished itself */
      }
    }
    if (twins.length !== 1) return null;
    try {
      fs.unlinkSync(join(dir, twins[0] as string));
    } catch (err) {
      if (errno(err) !== 'ENOENT') return null;
    }
    return twins[0] as string;
  }

  /** `null` when the file is missing. Throws on anything unsafe or unreadable. */
  private readManaged(abs: string, label: string, maxBytes: number, taskId: string, diag?: StoreDiagnostic[]): string | null {
    let hardlinkTries = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = readBoundedFile(abs, label, { boundary: this.boundaryDir, maxBytes }, true) as
        | { ok: true; content: string }
        | { ok: false; code: string; detail: string };
      if (r.ok) return r.content;
      if (r.code === 'FILE_MISSING') return null;
      if (r.code === 'FILE_CHANGED') continue;
      if (r.code === 'FILE_HARDLINKED') {
        const repaired = this.repairResidue(abs);
        if (repaired) {
          diag?.push({ code: 'STAGING_RESIDUE_REPAIRED', taskId, name: repaired });
          continue;
        }
        // A live writer may be between link() and unlink(): give it a moment before judging.
        if (hardlinkTries++ < 3) {
          sleepMs(2);
          continue;
        }
        throw new StoreSecurityError(`${label} has a second hard link that is not its own staging name; refusing to read it.`, r.code);
      }
      if (SECURITY_READ_CODES.has(r.code)) throw new StoreSecurityError(r.detail, r.code);
      if (r.code === 'FILE_EMPTY') throw new LogCorruptError(taskId, null, `${label} is empty`);
      if (r.code === 'FILE_TOO_LARGE') throw new LogCorruptError(taskId, null, `${label} exceeds ${maxBytes} bytes`);
      throw new StoreIoError(r.detail);
    }
    throw new StoreIoError(`${label} kept changing while being read.`);
  }

  /**
   * The same safe read, reported as an observation instead of an exception, for the places that must tell
   * "not there" (`absent`) from "there and wrong" (`bad`: evidence) from "could not find out" (`ioerr`: never evidence).
   */
  private readFileObs(abs: string, label: string, maxBytes: number, repair = false): Obs<string> {
    const fault = this.opts.readFault?.(abs);
    if (fault) return { k: 'ioerr', reason: `${fault}:${label}` };
    if (!fs.existsSync(this.boundaryDir)) return { k: 'absent' };
    let hardlinkTries = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = readBoundedFile(abs, label, { boundary: this.boundaryDir, maxBytes }, true) as
        | { ok: true; content: string }
        | { ok: false; code: string; detail: string };
      if (r.ok) return { k: 'ok', v: r.content };
      switch (r.code) {
        case 'FILE_MISSING':
          return { k: 'absent' };
        case 'FILE_CHANGED':
          continue;
        case 'FILE_HARDLINKED': {
          if (this.repairResidue(abs, repair)) continue;
          if (hardlinkTries++ < 3) {
            sleepMs(2);
            continue;
          }
          // Without a marker nothing may be repaired: the crash residue of a publisher is not evidence of damage.
          return this.ready || repair ? { k: 'bad', reason: r.code } : { k: 'ioerr', reason: `${r.code}:${label}` };
        }
        case 'FILE_SYMLINK':
        case 'FILE_OUTSIDE_PROJECT':
        case 'FILE_NOT_REGULAR':
        case 'READ_BOUNDARY_INVALID':
        case 'FILE_EMPTY':
        case 'FILE_TOO_LARGE':
          return { k: 'bad', reason: r.code };
        default:
          return { k: 'ioerr', reason: `${r.code}:${label}` };
      }
    }
    return { k: 'ioerr', reason: `FILE_CHANGED:${label}` };
  }

  // ----- the prune decision register ----------------------------------------

  private registerIO(taskId: string): RegisterIO {
    const dir = this.taskDir(taskId);
    const read = <T>(name: string, max: number, parse: (t: string) => Obs<T>): Obs<T> => {
      const r = this.readFileObs(join(dir, name), name, max);
      return r.k === 'ok' ? parse(r.v) : r;
    };
    return {
      prepare: (n) => read(prepareFile(n), MAX_REGISTER_BYTES, (t) => parsePrepare(t, n, taskId)),
      decision: (n) => read(decisionFile(n), MAX_REGISTER_BYTES, (t) => parseDecision(t, n, taskId)),
      tombstone: () => read(TOMBSTONE_NAME, MAX_TOMBSTONE_BYTES, (t) => parseTombstoneFile(t, taskId)),
    };
  }

  /** Files of the task still on disk (events, segments, references, staging). `> 0` after a commit means "deleting". */
  private residueCount(taskId: string): number {
    let n = 0;
    try {
      for (const dir of [this.eventsDir(taskId), this.segmentsDir(taskId), this.refsDir(taskId)]) {
        for (const e of this.listDir(dir) ?? []) {
          if (e.isFile() && (EVENT_NAME.test(e.name) || SEGMENT_NAME.test(e.name) || REF_NAME.test(e.name) || TMP_NAME.test(e.name))) n++;
        }
      }
    } catch {
      return 1; // unknown: assume there is something left; no decision depends on "gone"
    }
    return n;
  }

  /** `derivePruneState` over the real directory. Reads only. */
  private derive(taskId: string): PruneState {
    const dir = this.taskDir(taskId);
    if (!this.existingDir(dir)) return { kind: 'missing' };
    let names: string[];
    try {
      names = fs.readdirSync(dir);
      if (this.opts.registerListing) names = this.opts.registerListing(taskId, names);
    } catch (err) {
      if (errno(err) === 'ENOENT') return { kind: 'missing' };
      return { kind: 'unreadable', reason: `io:list:${errno(err) ?? 'error'}` };
    }
    const st = derivePruneState(names, this.registerIO(taskId), this.maxAttempts);
    if (st.kind === 'committed') st.residue = this.residueCount(taskId);
    return st;
  }

  /** The error a state that grants nothing turns into. */
  private refusal(taskId: string, st: PruneState): Error {
    switch (st.kind) {
      case 'corrupt':
        return new PruneDecisionCorruptError(taskId, (st.reason ?? 'register') as PruneCorruptReason, st.file ?? null, st.attempt ?? null);
      case 'legacy':
        return new PruneDecisionCorruptError(taskId, 'legacy-tombstone-unmigrated');
      case 'missing':
        return new PruneDecisionCorruptError(taskId, 'task-dir-missing');
      case 'unreadable':
        return new StoreIoError(`the prune state of task "${taskId}" cannot be read now (${st.reason ?? 'unknown'}); nothing was changed. Try again.`);
      case 'committed':
        return new TaskPrunedError(taskId);
      default:
        return new StoreIoError(`unexpected prune state "${st.kind}" for task "${taskId}".`);
    }
  }

  async pruneState(taskId: string): Promise<PruneState> {
    this.gate('read');
    return this.derive(taskId);
  }

  private publishRecord(taskId: string, name: string, data: string): 'created' | 'exists' {
    const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, this.taskDir(taskId), { ops: this.opts.ops }));
    try {
      const out = createFile(parent, name, data, { mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: MAX_REGISTER_BYTES, ops: this.opts.ops });
      for (const w of out.warnings) this.opts.onWarning?.(w);
      return 'created';
    } catch (err) {
      if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS') return 'exists';
      throw this.mapWriteError(err);
    }
  }

  async preparePrune(tombstone: Tombstone): Promise<{ attempt: number; created: boolean }> {
    this.gate('write');
    const taskId = tombstone.taskId;
    for (let i = 0; i < 8; i++) {
      const st = this.derive(taskId);
      switch (st.kind) {
        case 'missing':
          throw new LogCorruptError(taskId, null, 'cannot prune an unknown task');
        case 'preparing':
          return { attempt: st.attempt as number, created: false };
        case 'live': {
          const n = (st.attempt ?? 0) + 1;
          if (n > this.maxAttempts) throw new PruneAttemptLimitError(taskId, this.maxAttempts);
          if (this.publishRecord(taskId, prepareFile(n), encodePrepare(n, tombstone)) === 'created') return { attempt: n, created: true };
          continue; // somebody opened attempt n first: look again and accept theirs
        }
        default:
          throw this.refusal(taskId, st);
      }
    }
    throw new StoreIoError(`prune attempts of task "${taskId}" kept changing; try again.`);
  }

  async decidePrune(taskId: string, attempt: number, outcome: PruneOutcome, tombstone?: Tombstone, by?: DecisionBy): Promise<PruneOutcome> {
    this.gate('write');
    if (!Number.isInteger(attempt) || attempt < 1) throw new LogCorruptError(taskId, null, `invalid prune attempt ${attempt}`);
    if (outcome !== 'commit' && outcome !== 'abort') throw new LogCorruptError(taskId, null, 'a prune decision is either "commit" or "abort"');
    const io = this.registerIO(taskId);
    // Only for an attempt whose valid prepare is visible to the caller.
    const p = io.prepare(attempt);
    if (p.k === 'absent') throw new LogCorruptError(taskId, null, `there is no prepare for prune attempt ${attempt}; a decision needs one`);
    if (p.k === 'bad') throw new PruneDecisionCorruptError(taskId, 'register', prepareFile(attempt), attempt);
    if (p.k === 'ioerr') throw new StoreIoError(`cannot read ${prepareFile(attempt)} of task "${taskId}": ${p.reason}`);
    if (outcome === 'commit' && (!tombstone || !sameTombstone(tombstone, p.v.tombstone))) {
      throw new LogCorruptError(taskId, null, 'a commit must carry the tombstone of its attempt');
    }

    const existing = (): PruneOutcome => {
      const d = io.decision(attempt);
      if (d.k === 'ok') return d.v.outcome;
      if (d.k === 'bad') throw new PruneDecisionCorruptError(taskId, 'register', decisionFile(attempt), attempt);
      throw new StoreIoError(`cannot read ${decisionFile(attempt)} of task "${taskId}": ${d.k === 'ioerr' ? d.reason : 'vanished'}`);
    };
    // A later attempt can only exist if this one was decided; if its decision is missing the register has a hole,
    // and a hole is never filled in (it is what a deleted record looks like).
    if (io.prepare(attempt + 1).k !== 'absent') {
      const d = io.decision(attempt);
      if (d.k === 'absent') throw new PruneDecisionCorruptError(taskId, 'gap', decisionFile(attempt), attempt);
      return existing();
    }
    const data = encodeDecision(attempt, outcome, p.v.tombstone, by);
    return this.publishRecord(taskId, decisionFile(attempt), data) === 'created' ? outcome : existing();
  }

  // ----- adapters of the pre-register operations ----------------------------------------------------------------

  async markPruned(tombstone: Tombstone): Promise<void> {
    this.gate('write');
    const taskId = tombstone.taskId;
    const st = this.derive(taskId);
    if (st.kind === 'preparing' || st.kind === 'committed') {
      if ((st.tombstone as Tombstone).headHash !== tombstone.headHash) throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
      return;
    }
    await this.preparePrune(tombstone);
  }

  async withdrawTombstone(tombstone: Tombstone): Promise<void> {
    this.gate('write');
    const taskId = tombstone.taskId;
    const st = this.derive(taskId);
    if (st.kind === 'live' || st.kind === 'missing') return; // already withdrawn
    if (st.kind === 'committed') throw new TombstoneCommittedError(taskId, 'the prune is committed; the tombstone cannot be withdrawn');
    if (st.kind !== 'preparing') throw this.refusal(taskId, st);
    if ((st.tombstone as Tombstone).headHash !== tombstone.headHash) throw new LogCorruptError(taskId, null, 'a different tombstone exists; refusing to withdraw it');
    const w = await this.decidePrune(taskId, st.attempt as number, 'abort', undefined, 'creator');
    if (w === 'commit') throw new TombstoneCommittedError(taskId, 'the prune is committed; the tombstone cannot be withdrawn');
  }

  async prune(tombstone: Tombstone, opts: { requireCommit?: boolean } = {}): Promise<{ removedFiles: number }> {
    this.gate('write');
    const taskId = tombstone.taskId;
    let committed: Tombstone | null = null;
    for (let i = 0; i < 8 && committed === null; i++) {
      const st = this.derive(taskId);
      switch (st.kind) {
        case 'missing':
          throw new LogCorruptError(taskId, null, 'cannot prune an unknown task');
        case 'committed':
          if ((st.tombstone as Tombstone).headHash !== tombstone.headHash) throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
          committed = st.tombstone as Tombstone;
          break;
        case 'live':
        case 'preparing': {
          if (opts.requireCommit) throw new RetentionRefusedError(taskId, 'no prune decision has been committed for it');
          // The low-level form starts a prune by itself only when none was ever attempted. Once an attempt exists it can
          // only be finished: an attempt that was ABORTED (by a task that needs the parent) is not silently replaced by a
          // new one that commits without looking for referrers. A pruner that wants another try calls `markPruned` again
          // and does its own check.
          if (st.kind === 'live' && (st.attempt ?? 0) > 0) throw new RetentionRefusedError(taskId, 'its last prune attempt was aborted by a task that needs it');
          if (st.kind === 'preparing' && (st.tombstone as Tombstone).headHash !== tombstone.headHash) {
            throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
          }
          // The low-level form: publish the attempt and its commit without looking for referrers. The register
          // decides, so a concurrent abort wins over this call or this call wins over it, never both.
          const attempt = (await this.preparePrune(tombstone)).attempt;
          const prepared = this.registerIO(taskId).prepare(attempt);
          const tomb = prepared.k === 'ok' ? prepared.v.tombstone : tombstone;
          if (tomb.headHash !== tombstone.headHash) throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
          const w = await this.decidePrune(taskId, attempt, 'commit', tomb, 'pruner');
          if (w === 'abort') throw new RetentionRefusedError(taskId, 'the prune attempt was aborted by a task that needs it');
          break;
        }
        default:
          throw this.refusal(taskId, st);
      }
    }
    if (committed === null) throw new StoreIoError(`the prune state of task "${taskId}" kept changing; try again.`);
    return this.rollForward(taskId, committed);
  }

  /**
   * Prune cleanup (class C, section 30.3): only for a verified, consistent `COMMITTED`. Publishes `tombstone.json` from the
   * commit, then removes the data of the task. It never touches the register, `tombstone.json` or the task directory,
   * decides nothing, and finishing a half-done run is the same call again.
   */
  private rollForward(taskId: string, tombstone: Tombstone): { removedFiles: number } {
    const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, this.taskDir(taskId), { ops: this.opts.ops }));
    try {
      const out = createFile(parent, TOMBSTONE_NAME, encodeTombstone(tombstone), { mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: MAX_TOMBSTONE_BYTES, ops: this.opts.ops });
      for (const w of out.warnings) this.opts.onWarning?.(w);
    } catch (err) {
      if (!(err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS')) throw this.mapWriteError(err);
      const t = parseTombstoneFile(this.readManaged(join(this.taskDir(taskId), TOMBSTONE_NAME), 'tombstone', MAX_TOMBSTONE_BYTES, taskId) ?? '', taskId);
      if (t.k !== 'ok' || !sameTombstone(t.v, tombstone)) throw new PruneDecisionCorruptError(taskId, 'commit-audit', TOMBSTONE_NAME);
    }
    let removed = 0;
    for (const dir of [this.eventsDir(taskId), this.segmentsDir(taskId), this.refsDir(taskId)]) {
      const entries = this.listDir(dir);
      if (!entries) continue;
      let leftovers = 0;
      for (const e of entries) {
        if (!(e.isFile() && (EVENT_NAME.test(e.name) || SEGMENT_NAME.test(e.name) || REF_NAME.test(e.name) || TMP_NAME.test(e.name)))) {
          leftovers++;
          continue;
        }
        try {
          fs.unlinkSync(join(dir, e.name));
          removed++;
        } catch (err) {
          if (errno(err) !== 'ENOENT') throw new StoreIoError(`cannot remove ${e.name}: ${(err as Error).message}`, err);
        }
      }
      if (leftovers === 0) {
        try {
          fs.rmdirSync(dir);
        } catch (err) {
          if (errno(err) !== 'ENOENT' && errno(err) !== 'ENOTEMPTY') throw new StoreIoError(`cannot remove ${dir}: ${(err as Error).message}`, err);
        }
      }
    }
    return { removedFiles: removed };
  }

  // ----- G1 / G2 ---------------------------------------------------------------------------------------------------

  /**
   * G1 (section 24.6): an optional early refusal, so that a write to a pruned or damaged task does not leave a file
   * behind. Safety never depends on it (G2 decides); turning it off changes only how much is left over.
   */
  private earlyCheck(taskId: string): PruneState {
    const st = this.derive(taskId);
    if (this.opts.earlyPruneCheck === false) return st;
    if (st.kind === 'committed' || st.kind === 'corrupt' || st.kind === 'legacy' || st.kind === 'unreadable') throw this.refusal(taskId, st);
    return st;
  }

  /**
   * G2 (section 24.2): after a file was published, ask the register. It never unlinks anything: a published file is
   * shared state (F-1, class A is forbidden). `PREPARING` is closed with an `abort` (always safe), at most
   * `MAX_WRITE_RESOLVE` times; a pruner that keeps opening attempts leaves the outcome UNKNOWN, never a deletion.
   */
  private async settle(taskId: string, by: DecisionBy): Promise<Settle> {
    let last = 'attempts kept being opened';
    for (let i = 0; i < MAX_WRITE_RESOLVE; i++) {
      const st = this.derive(taskId);
      switch (st.kind) {
        case 'live':
          return { t: 'CONFIRMED' };
        case 'committed':
          return { t: 'PRUNED' };
        case 'corrupt':
        case 'legacy':
          return { t: 'CORRUPT', state: st };
        case 'preparing':
          try {
            await this.decidePrune(taskId, st.attempt as number, 'abort', undefined, by);
          } catch (err) {
            if (err instanceof PruneDecisionCorruptError) return { t: 'CORRUPT', state: { kind: 'corrupt', reason: err.reason, ...(err.file ? { file: err.file } : {}) } };
            if (err instanceof StoreIoError) return { t: 'UNKNOWN', why: err.message };
            throw err;
          }
          last = 'a new prune attempt was opened while the previous one was being closed';
          continue;
        default:
          return { t: 'UNKNOWN', why: st.kind === 'missing' ? 'the task directory disappeared' : `unreadable: ${st.reason ?? ''}` };
      }
    }
    return { t: 'UNKNOWN', why: last };
  }

  // ----- EventStore ---------------------------------------------------------

  async listTaskIds(): Promise<string[]> {
    this.gate('read');
    const entries = this.listDir(join(this.root, 'tasks'));
    if (!entries) return [];
    return entries
      .filter((e) => e.isDirectory() && ID_PATTERN.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  async readLog(taskId: string, opts: { afterSeq?: number; rawEvents?: boolean } = {}): Promise<LogRead> {
    this.gate('read');
    return this.readLogImpl(taskId, opts);
  }

  private readLogImpl(taskId: string, opts: { afterSeq?: number; rawEvents?: boolean }): LogRead {
    const after = opts.afterSeq ?? 0;
    const taskDir = this.taskDir(taskId);
    // Segments are immutable: once parsed in this call they are not parsed again on a retry.
    const parsed = new Map<string, TaskEvent[]>();
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      const diagnostics: StoreDiagnostic[] = [];
      if (!this.existingDir(taskDir)) return { exists: false, tombstone: null, events: [], compactedThrough: 0, diagnostics };

      const st = this.derive(taskId);
      if (st.kind === 'unreadable') throw this.refusal(taskId, st);
      const hidden = st.kind === 'committed' || st.kind === 'legacy' || (st.kind === 'preparing' && !opts.rawEvents);
      if (hidden) {
        // Pruned (or a prune attempt is open). An open attempt is shown the way the pre-register protocol showed a published
        // tombstone — "tombstone visible, data intact" — because the consumers of this store (claim, createTask) rely on
        // that to refuse work against a task that may be about to disappear. `prune.kind` is the authority.
        for (const dir of [this.eventsDir(taskId), this.segmentsDir(taskId)]) {
          for (const e of this.listDir(dir) ?? []) {
            if (e.isFile() && (EVENT_NAME.test(e.name) || SEGMENT_NAME.test(e.name) || TMP_NAME.test(e.name))) {
              diagnostics.push({ code: 'PRUNE_INCOMPLETE', taskId, name: e.name });
            }
          }
        }
        for (const a of st.anomalies ?? []) diagnostics.push({ code: 'UNKNOWN_PRUNE_ARTIFACT', taskId, name: a.replace(/^UNKNOWN_PRUNE:/, '') });
        return { exists: true, tombstone: st.tombstone as Tombstone, prune: st, events: [], compactedThrough: 0, diagnostics };
      }
      for (const a of st.anomalies ?? []) diagnostics.push({ code: 'UNKNOWN_PRUNE_ARTIFACT', taskId, name: a.replace(/^UNKNOWN_PRUNE:/, '') });

      // ORDER MATTERS. Compaction publishes a segment BEFORE it removes the loose files it covers. So if the
      // loose files are listed first and the segments second, an event missing from the first listing was
      // removed before it, hence its segment was already published and appears in the second. Listing in the
      // other order lets a reader that is slow between the two listings see a hole on every attempt.
      const eventEntries = this.listDir(this.eventsDir(taskId)) ?? [];
      const segEntries = this.listDir(this.segmentsDir(taskId)) ?? [];

      this.opts.afterListing?.(attempt);

      const segments: { name: string; from: number; to: number }[] = [];
      for (const e of segEntries) {
        const m = SEGMENT_NAME.exec(e.name);
        if (m && e.isFile()) segments.push({ name: e.name, from: Number(m[1]), to: Number(m[2]) });
        else if (TMP_NAME.test(e.name)) diagnostics.push({ code: 'STAGING_FILE_PRESENT', taskId, name: e.name });
        else diagnostics.push({ code: 'UNKNOWN_ENTRY', taskId, name: e.name });
      }
      segments.sort((a, b) => a.from - b.from || a.to - b.to);
      const segEnd = segments.reduce((m, s) => Math.max(m, s.to), 0);

      // Read the loose files first, right after listing them: they are small and they are what a
      // concurrent compaction removes. The (slow) segment parsing comes after, when a vanished file
      // is already known to be covered.
      const bySeq = new Map<number, TaskEvent>();
      let vanished = false;
      for (const e of eventEntries) {
        const m = EVENT_NAME.exec(e.name);
        if (!m) {
          diagnostics.push({ code: TMP_NAME.test(e.name) ? 'STAGING_FILE_PRESENT' : 'UNKNOWN_ENTRY', taskId, name: e.name });
          continue;
        }
        if (!e.isFile()) throw new StoreSecurityError(`event entry ${e.name} of task "${taskId}" is not a regular file.`, 'FILE_NOT_REGULAR');
        const seq = Number(m[1]);
        if (seq <= after) continue;
        if (seq <= segEnd) {
          diagnostics.push({ code: 'LOOSE_COPY_OF_COMPACTED_EVENT', taskId, name: e.name });
          continue;
        }
        const content = this.readManaged(join(this.eventsDir(taskId), e.name), `event ${e.name}`, MAX_EVENT_BYTES + 4096, taskId, diagnostics);
        if (content === null) {
          vanished = true;
          continue;
        }
        const ev = parseEvent(content.trim(), taskId, seq);
        if (ev.seq !== seq) throw new LogCorruptError(taskId, seq, `file ${e.name} holds event ${ev.seq}`);
        bySeq.set(seq, ev);
      }

      for (const s of segments) {
        if (s.to <= after) continue;
        let evs = parsed.get(s.name);
        if (!evs) {
          const content = this.readManaged(join(this.segmentsDir(taskId), s.name), `segment ${s.name}`, MAX_SEGMENT_BYTES, taskId);
          if (content === null) continue;
          const lines = content.split('\n').filter((l) => l.length > 0);
          if (lines.length !== s.to - s.from + 1) throw new LogCorruptError(taskId, s.from, `segment ${s.name} holds ${lines.length} events, its name says ${s.to - s.from + 1}`);
          evs = lines.map((line, i) => {
            const ev = parseEvent(line, taskId, s.from + i);
            if (ev.seq !== s.from + i) throw new LogCorruptError(taskId, ev.seq, `segment ${s.name} is not contiguous`);
            return ev;
          });
          parsed.set(s.name, evs);
        }
        for (const ev of evs) {
          const dup = bySeq.get(ev.seq);
          if (dup && dup.hash !== ev.hash) throw new LogCorruptError(taskId, ev.seq, 'overlapping segments disagree');
          if (ev.seq > after) bySeq.set(ev.seq, ev); // a segment may straddle `after`; hand back only the suffix asked for
        }
      }

      const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      let contiguous = events.length === 0 || events[0]!.seq === after + 1;
      for (let i = 1; contiguous && i < events.length; i++) contiguous = events[i]!.seq === events[i - 1]!.seq + 1;
      if (!contiguous || vanished) {
        // Either a writer is mid-way (a later file listed before an earlier one became visible) or a
        // compaction moved files into a segment after we listed. A fresh pass resolves both.
        if (attempt < READ_ATTEMPTS - 1) {
          sleepMs(2 * (attempt + 1));
          continue;
        }
        const firstBad = events.find((ev, i) => (i === 0 ? ev.seq !== after + 1 : ev.seq !== events[i - 1]!.seq + 1));
        throw new LogCorruptError(taskId, firstBad?.seq ?? null, vanished ? 'event files kept vanishing while being read' : 'events are missing from the log');
      }
      return { exists: true, tombstone: null, ...(st.kind === 'live' ? {} : { prune: st }), events, compactedThrough: segEnd, diagnostics };
    }
    throw new StoreIoError(`could not obtain a stable view of task "${taskId}".`);
  }

  private fileExists(abs: string): boolean {
    try {
      fs.lstatSync(abs);
      return true;
    } catch (err) {
      if (errno(err) === 'ENOENT') return false;
      throw new StoreIoError(`cannot inspect "${abs}": ${(err as Error).message}`, err);
    }
  }

  // ----- slots, segments, canonical content (Design A sections 35 and 40) ---------------------------------------

  private slotName(seq: number): string {
    return `${pad(seq)}.json`;
  }

  /** The loose file of a slot as an observation (trimmed line), never an exception. */
  private readSlot(taskId: string, seq: number): Obs<string> {
    const r = this.readFileObs(join(this.eventsDir(taskId), this.slotName(seq)), `event ${this.slotName(seq)}`, MAX_EVENT_BYTES + 4096);
    return r.k === 'ok' ? { k: 'ok', v: r.v.trim() } : r;
  }

  private listSegments(taskId: string): SegmentRef[] {
    const out: SegmentRef[] = [];
    for (const e of this.listDir(this.segmentsDir(taskId)) ?? []) {
      const m = SEGMENT_NAME.exec(e.name);
      if (m && e.isFile()) out.push({ name: e.name, from: Number(m[1]), to: Number(m[2]) });
    }
    return out.sort((a, b) => a.from - b.from || a.to - b.to);
  }

  /** A segment as its lines, validated the way `readLog` validates it. */
  private readSegmentLines(taskId: string, seg: SegmentRef): Obs<string[]> {
    const r = this.readFileObs(join(this.segmentsDir(taskId), seg.name), `segment ${seg.name}`, MAX_SEGMENT_BYTES);
    if (r.k !== 'ok') return r;
    const lines = r.v.split('\n').filter((l) => l.length > 0);
    if (lines.length !== seg.to - seg.from + 1) return { k: 'bad', reason: 'line-count' };
    try {
      lines.forEach((line, i) => {
        if (parseEvent(line, taskId, seg.from + i).seq !== seg.from + i) throw new Error('not contiguous');
      });
    } catch {
      return { k: 'bad', reason: 'content' };
    }
    return { k: 'ok', v: lines };
  }

  /**
   * `CanonRead` for the slots `from..to` (section 40.2). Every loose file is read BEFORE the single listing of
   * `segments/` (the order is what makes a slot that was compacted in between visible, section 35.3), and a slot
   * covered by a segment takes the segment's row: a loose file next to it is a copy or an orphan and is not consulted
   * (CEI-2), so an I/O error on it does not matter. Writes nothing.
   */
  private canonRead(taskId: string, from: number, to: number): Map<number, CanonSlot> {
    const loose = new Map<number, Obs<string>>();
    for (let s = from; s <= to; s++) loose.set(s, this.readSlot(taskId, s));
    const segs = this.listSegments(taskId);
    const cache = new Map<string, Obs<string[]>>();
    const out = new Map<number, CanonSlot>();
    for (let s = from; s <= to; s++) {
      const cov = segs.filter((g) => g.from <= s && s <= g.to);
      if (cov.length > 0) {
        let row: string | null = null;
        let verdict: CanonSlot | null = null;
        for (const g of cov) {
          let lines = cache.get(g.name);
          if (!lines) {
            lines = this.readSegmentLines(taskId, g);
            cache.set(g.name, lines);
          }
          if (lines.k === 'ioerr') verdict = { t: 'IOERR' };
          else if (lines.k === 'bad') verdict = { t: 'BAD' };
          else if (lines.k === 'absent') verdict = { t: 'GONE' };
          else {
            const mine = lines.v[s - g.from] as string;
            if (row !== null && row !== mine) verdict = { t: 'BAD' }; // overlapping segments disagree
            row = mine;
          }
          if (verdict) break;
        }
        out.set(s, verdict ?? { t: 'SEGMENT', line: row as string });
        continue;
      }
      const c = loose.get(s) as Obs<string>;
      out.set(s, c.k === 'ok' ? { t: 'LOOSE', line: c.v } : c.k === 'absent' ? { t: 'EMPTY' } : c.k === 'ioerr' ? { t: 'IOERR' } : { t: 'BAD' });
    }
    return out;
  }

  /**
   * Canonical Event Identity (section 35.2), run right after the `link` of a loose file (or its `EEXIST`): the slot was
   * read first (`slot`), the listing of `segments/` comes strictly after. Confirmation needs the slot to equal the event
   * of the caller, canonically: the row of a covering segment, or — if nothing covers it — the loose file.
   */
  private cei(taskId: string, seq: number, line: string, mode: 'own' | 'adopt', slot: string): Cei {
    let cov: SegmentRef[];
    try {
      cov = this.listSegments(taskId).filter((g) => g.from <= seq && seq <= g.to);
    } catch {
      return { t: 'UNKNOWN' };
    }
    if (cov.length === 0) return slot === line ? { t: 'EVIDENCE', via: 'loose' } : { t: 'CONFLICT' };
    let row: string | null = null;
    for (const g of cov) {
      const lines = this.readSegmentLines(taskId, g);
      if (lines.k === 'ioerr') return { t: 'UNKNOWN' };
      if (lines.k === 'bad') throw new LogCorruptError(taskId, seq, `segment ${g.name} is not readable as a log segment; refusing to judge event ${seq}.`);
      if (lines.k === 'absent') return { t: 'LOST' };
      const mine = lines.v[seq - g.from] as string;
      if (row !== null && row !== mine) throw new LogCorruptError(taskId, seq, 'overlapping segments disagree');
      row = mine;
    }
    // The caller's own copy in a covered slot is a redundant file (class B): readers ignore it. Only the publisher of a
    // file may remove it, and only if it is byte-identical to what the publisher wrote.
    if (mode === 'own') this.removeOwnLooseFile(taskId, this.slotName(seq), line);
    return row === line ? { t: 'EVIDENCE', via: 'segment' } : { t: 'CONFLICT' };
  }

  /** AV-4: the error for a write that is not valid, chosen from the register only AFTER the refusal (section 31.1). */
  private refuseWrite(taskId: string, otherwise: Error): Error {
    const st = this.derive(taskId);
    if (st.kind === 'committed' || st.kind === 'corrupt' || st.kind === 'legacy') return this.refusal(taskId, st);
    return otherwise;
  }

  async append(event: TaskEvent): Promise<'appended' | 'conflict'> {
    this.gate('write');
    const taskId = event.taskId;
    const seq = event.seq;
    const taskDir = this.taskDir(taskId);
    const line = serializeEvent(event);
    const name = this.slotName(seq);

    // AV (section 31.1): validity of the append. Mandatory, independent of G1, reads only the log.
    if (seq > 1) {
      if (!this.existingDir(taskDir)) throw new PruneDecisionCorruptError(taskId, 'task-dir-missing');
      let hasPredecessor = this.fileExists(join(this.eventsDir(taskId), this.slotName(seq - 1)));
      if (!hasPredecessor) hasPredecessor = this.listSegments(taskId).some((g) => g.from <= seq - 1 && seq - 1 <= g.to);
      if (!hasPredecessor) throw this.refuseWrite(taskId, new LogCorruptError(taskId, seq, 'predecessor event is missing; refusing to publish past a hole'));
    }
    this.earlyCheck(taskId);

    const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, this.eventsDir(taskId), { create: true, ops: this.opts.ops }));
    await this.opts.beforePublish?.(event);
    let mode: 'own' | 'adopt' = 'own';
    let slot = line;
    for (let attempt = 0; ; attempt++) {
      try {
        const out = createFile(parent, name, `${line}\n`, {
          mode: 0o600,
          durability: this.opts.durability ?? 'full',
          maxBytes: MAX_EVENT_BYTES + 4096,
          ops: this.opts.ops,
        });
        for (const w of out.warnings) this.opts.onWarning?.(w);
        mode = 'own';
        slot = line;
        break;
      } catch (err) {
        if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS') {
          // Not a verdict: the slot is occupied, by whom and with what is decided by CEI, never by "the bytes are equal".
          const r = this.readSlot(taskId, seq);
          if (r.k === 'ok') {
            mode = 'adopt';
            slot = r.v;
            break;
          }
          if (r.k === 'ioerr') throw new AppendOutcomeUnknownError(taskId, seq, new Error(r.reason));
          if (r.k === 'bad') throw new LogCorruptError(taskId, seq, `the file in slot ${seq} cannot be judged (${r.reason}); refusing to confirm anything.`);
          // The file was taken away between the EEXIST and the read (compaction cleanup): publish again.
          if (attempt + 1 >= MAX_WRITE_RESOLVE) throw new StoreIoError(`slot ${seq} of task "${taskId}" kept changing; nothing was published or confirmed.`);
          continue;
        }
        if (err instanceof SafeWriteError && err.publication === 'UNKNOWN') throw new AppendOutcomeUnknownError(taskId, seq, err);
        // The directory we were about to write into is gone or replaced: if the task was pruned meanwhile, say so.
        if (err instanceof SafeWriteError && (err.code === 'WRITE_PARENT_CHANGED' || err.code === 'WRITE_PARENT_MISSING')) {
          if (this.derive(taskId).kind === 'committed') throw new TaskPrunedError(taskId);
        }
        throw this.mapWriteError(err);
      }
    }

    if (seq === 1 && mode === 'own' && (this.opts.durability ?? 'full') === 'full') this.fsyncChain(join(this.eventsDir(taskId)));

    const ev = this.cei(taskId, seq, line, mode, slot);
    if (ev.t === 'CONFLICT') return 'conflict';
    if (ev.t === 'UNKNOWN') throw new AppendOutcomeUnknownError(taskId, seq, new Error('the slot could not be examined'));
    const g2 = await this.settle(taskId, 'append');
    if (g2.t === 'PRUNED') throw new TaskPrunedError(taskId);
    if (g2.t === 'CORRUPT') throw this.published(this.refusal(taskId, g2.state));
    if (ev.t === 'LOST' || g2.t === 'UNKNOWN') throw new AppendOutcomeUnknownError(taskId, seq, new Error(g2.t === 'UNKNOWN' ? g2.why : 'the covering segment is gone'));
    return 'appended';
  }

  /** The file is already visible: say so on the corruption error. */
  private published(err: Error): Error {
    if (err instanceof PruneDecisionCorruptError) return new PruneDecisionCorruptError(err.taskId, err.reason, err.file, err.attempt, true);
    return err;
  }

  /** Removes `name` only if its bytes are exactly `line` (a copy the caller published itself, class B). */
  private removeOwnLooseFile(taskId: string, name: string, line: string): void {
    const abs = join(this.eventsDir(taskId), name);
    try {
      const content = this.readManaged(abs, `event ${name}`, MAX_EVENT_BYTES + 4096, taskId);
      if (content !== null && content.trim() === line) fs.unlinkSync(abs);
    } catch {
      /* a leftover loose copy of a compacted event is ignored by readers (diagnostic) */
    }
  }

  async compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult> {
    this.gate('write');
    const taskDir = this.taskDir(taskId);
    // K0 (section 40.3)
    if (this.fileExists(join(taskDir, TOMBSTONE_NAME))) throw new TaskPrunedError(taskId);
    const early = this.earlyCheck(taskId);
    if (events.length === 0) return { segment: null, packedEvents: 0, removedFiles: 0 };
    const first = events[0] as TaskEvent;
    const last = events[events.length - 1] as TaskEvent;
    if (last.seq !== throughSeq || last.seq - first.seq + 1 !== events.length) {
      throw new LogCorruptError(taskId, first.seq, 'compaction input is not a contiguous range ending at throughSeq');
    }
    const lines = events.map((e) => serializeEvent(e));
    const data = `${lines.join('\n')}\n`;
    if (Buffer.byteLength(data, 'utf8') > MAX_SEGMENT_BYTES) throw new StoreIoError('segment would exceed the size ceiling; pack fewer events.');

    // K1: the task directory must be there; compaction never creates a task.
    if (early.kind === 'missing' || !this.existingDir(taskDir)) throw new PruneDecisionCorruptError(taskId, 'task-dir-missing');

    // K2 (CC-1, CC-2, CC-4): before anything is created or published, every slot of the input must equal the canonical
    // content of that slot. The store enforces it; the caller is not trusted. A refusal leaves no trace.
    const canon = this.canonRead(taskId, first.seq, last.seq);
    for (let i = 0; i < events.length; i++) {
      const seq = (events[i] as TaskEvent).seq;
      const c = canon.get(seq) as CanonSlot;
      if (c.t === 'LOOSE' || c.t === 'SEGMENT') {
        if (c.line !== lines[i]) throw this.refuseWrite(taskId, new LogCorruptError(taskId, seq, 'compaction input is not the canonical log'));
      } else if (c.t === 'EMPTY') {
        throw this.refuseWrite(taskId, new LogCorruptError(taskId, seq, 'compaction input slot has no canonical event'));
      } else if (c.t === 'IOERR') {
        throw new StoreIoError(`slot ${seq} of task "${taskId}" cannot be read now; nothing was published. Try again.`);
      } else if (c.t === 'GONE') {
        throw new TaskPrunedError(taskId);
      } else {
        throw this.refuseWrite(taskId, new LogCorruptError(taskId, seq, 'the canonical content of the slot cannot be judged'));
      }
    }

    // K3: publish
    const name = `S${pad(first.seq)}-${pad(last.seq)}.jsonl`;
    const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, this.segmentsDir(taskId), { create: true, ops: this.opts.ops }));
    try {
      const out = createFile(parent, name, data, { mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: MAX_SEGMENT_BYTES, ops: this.opts.ops });
      for (const w of out.warnings) this.opts.onWarning?.(w);
    } catch (err) {
      if (!(err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS')) throw this.mapWriteError(err);
      // A concurrent/interrupted compaction made the same segment: fine iff it is byte-identical (checked below).
    }
    this.fsyncChain(this.segmentsDir(taskId));
    // K4: read the segment back; this proves the bytes, not the canonical identity (that was K2).
    const back = this.readManaged(join(this.segmentsDir(taskId), name), `segment ${name}`, MAX_SEGMENT_BYTES, taskId);
    if (back === null || sha256Hex(back) !== sha256Hex(data)) {
      throw new LogCorruptError(taskId, first.seq, `segment ${name} does not read back as written; loose events are kept`);
    }

    // K5: the segment is published and verified: only now are the loose copies of THESE events redundant (class B,
    // CL-1..CL-4). A loose file is removed only if it is byte-identical to the event just packed.
    const lineBySeq = new Map<number, string>(events.map((e, i) => [e.seq, lines[i] as string]));
    let removed = 0;
    for (const e of this.listDir(this.eventsDir(taskId)) ?? []) {
      const m = EVENT_NAME.exec(e.name);
      if (!m || !e.isFile()) continue;
      const want = lineBySeq.get(Number(m[1]));
      if (want === undefined) continue;
      if (this.removeLooseIfIdentical(taskId, e.name, want)) removed++;
    }
    this.fsyncDir(this.eventsDir(taskId));

    // K6: G2. It never takes the segment back.
    const g2 = await this.settle(taskId, 'compact');
    if (g2.t === 'PRUNED') throw new TaskPrunedError(taskId);
    if (g2.t === 'CORRUPT') throw this.published(this.refusal(taskId, g2.state));
    if (g2.t === 'UNKNOWN') throw new StoreIoError(`segment ${name} of task "${taskId}" was published, but the prune state could not be settled (${g2.why}); the segment stays. Try again.`);
    return { segment: name, packedEvents: events.length, removedFiles: removed };
  }

  /** Removes the loose event file `name` iff its content is exactly `line`. `true` if it was removed. */
  private removeLooseIfIdentical(taskId: string, name: string, line: string): boolean {
    const abs = join(this.eventsDir(taskId), name);
    const content = this.readManaged(abs, `event ${name}`, MAX_EVENT_BYTES + 4096, taskId);
    if (content === null || content.trim() !== line) return false;
    try {
      fs.unlinkSync(abs);
      return true;
    } catch (err) {
      if (errno(err) === 'ENOENT') return false;
      throw new StoreIoError(`cannot remove ${name}: ${(err as Error).message}`, err);
    }
  }

  async sweepCompacted(taskId: string): Promise<{ removedFiles: number; keptFiles: number }> {
    this.gate('write');
    const st = this.derive(taskId);
    if (st.kind === 'committed') throw new TaskPrunedError(taskId);
    if (st.kind === 'corrupt' || st.kind === 'legacy' || st.kind === 'unreadable') throw this.refusal(taskId, st);
    const log = this.readLogImpl(taskId, { rawEvents: true }); // verified view; events up to `compactedThrough` come from the segments
    if (log.compactedThrough === 0) return { removedFiles: 0, keptFiles: 0 };
    const lineBySeq = new Map<number, string>(log.events.filter((e) => e.seq <= log.compactedThrough).map((e) => [e.seq, serializeEvent(e)]));
    let removedFiles = 0;
    let keptFiles = 0;
    for (const e of this.listDir(this.eventsDir(taskId)) ?? []) {
      const m = EVENT_NAME.exec(e.name);
      if (!m || !e.isFile()) continue;
      const want = lineBySeq.get(Number(m[1]));
      if (want === undefined) continue; // newer than the segments: a live event, not ours to touch
      if (this.removeLooseIfIdentical(taskId, e.name, want)) removedFiles++;
      else if (this.fileExists(join(this.eventsDir(taskId), e.name))) keptFiles++; // differs: possibly a paused writer's file or foreign data
    }
    this.fsyncDir(this.eventsDir(taskId));
    return { removedFiles, keptFiles };
  }

  async pinReference(parentId: string, childId: string, at: string): Promise<'pinned' | 'parent-pruned' | 'parent-missing'> {
    this.gate('write');
    if (!ID_PATTERN.test(childId)) throw new StoreSecurityError(`invalid task id "${childId}".`, 'BAD_ID');
    const taskDir = this.taskDir(parentId);
    if (!this.existingDir(taskDir)) return 'parent-missing';
    const before = this.derive(parentId);
    if (before.kind === 'committed') return 'parent-pruned';
    if (before.kind === 'corrupt' || before.kind === 'legacy' || before.kind === 'unreadable') throw this.refusal(parentId, before);
    if (before.kind === 'missing') return 'parent-missing';
    const name = `${childId}.json`;
    try {
      const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, this.refsDir(parentId), { create: true, ops: this.opts.ops }));
      const out = createFile(parent, name, `${JSON.stringify({ v: 1, childId, at })}\n`, {
        mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: 1024, ops: this.opts.ops,
      });
      for (const w of out.warnings) this.opts.onWarning?.(w);
    } catch (err) {
      if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS') {
        /* pinned before (a retry of the same creation): the pin is shared, not owned */
      } else if (err instanceof SafeWriteError && (err.code === 'WRITE_PARENT_CHANGED' || err.code === 'WRITE_PARENT_MISSING') && this.derive(parentId).kind === 'committed') {
        return 'parent-pruned';
      } else {
        throw this.mapWriteError(err);
      }
    }
    this.fsyncChain(this.refsDir(parentId));
    // The pin is visible. G2 asks the register only AFTER publishing: a prune that opened its attempt before this point is
    // closed here with an `abort` (or has committed, and the pin is left for the roll-forward); one that opens it later
    // will find the pin. The pin is never taken back (section 24.1).
    const g2 = await this.settle(parentId, 'pin');
    if (g2.t === 'PRUNED') return 'parent-pruned';
    if (g2.t === 'CORRUPT') throw this.refusal(parentId, g2.state);
    if (g2.t === 'UNKNOWN') throw new StoreIoError(`the reference to task "${parentId}" was recorded, but its prune state could not be settled (${g2.why}); the pin stays. Try again.`);
    return 'pinned';
  }

  async listReferences(parentId: string): Promise<Array<{ childId: string; at: string }>> {
    this.gate('read');
    const out: Array<{ childId: string; at: string }> = [];
    for (const e of this.listDir(this.refsDir(parentId)) ?? []) {
      const m = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.json$/.exec(e.name);
      if (!m || !e.isFile()) continue;
      const content = this.readManaged(join(this.refsDir(parentId), e.name), `reference ${e.name}`, 1024 + 4096, parentId);
      if (content === null) continue;
      let at = new Date(0).toISOString(); // unreadable: counts as old, so only an existing active child still blocks
      try {
        const o = JSON.parse(content) as { at?: unknown };
        if (typeof o.at === 'string' && Number.isFinite(Date.parse(o.at))) at = o.at;
      } catch {
        /* keep the default */
      }
      out.push({ childId: m[1] as string, at });
    }
    return out.sort((a, b) => (a.childId < b.childId ? -1 : 1));
  }

  /** fsync `dir` and every ancestor down to the store root: directory entries created by mkdir are not durable until their parent is synced. */
  private fsyncChain(dir: string): void {
    let cur = dir;
    for (let i = 0; i < 6; i++) {
      this.fsyncDir(cur);
      if (cur === this.root) return;
      const up = dirname(cur);
      if (up === cur) return;
      cur = up;
    }
  }

  /**
   * Mode A (the only mode claimed): a failed directory fsync is a warning of the write primitive, never a reason to refuse or
   * to continue differently — durability verification (`DV`) is Mode B and is not called here (Design A section 18.2).
   */
  private fsyncDir(dir: string): void {
    if ((this.opts.durability ?? 'full') !== 'full') return;
    let fd: number | null = null;
    try {
      fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      fs.fsyncSync(fd);
    } catch {
      /* best effort: the segment itself was fsynced by the write primitive */
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }
}
