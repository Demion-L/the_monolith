/**
 * Filesystem `EventStore`.
 *
 * Layout under the store directory:
 *
 *   tasks/<taskId>/events/<seq,9 digits>.json      one canonical event, immutable
 *   tasks/<taskId>/segments/S<from>-<to>.jsonl     packed, verified events (compaction)
 *   tasks/<taskId>/tombstone.json                  present iff the task was pruned
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
  StoreIoError,
  StoreSecurityError,
  TaskPrunedError,
} from './errors.js';
import { MAX_EVENT_BYTES, ID_PATTERN, parseEvent, serializeEvent, verifyChain } from './log.js';
import { GENESIS_HASH } from './types.js';
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
}

/** Packed segments stay well below this; it is the reader's ceiling. */
export const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;

const EVENT_NAME = /^(\d{9})\.json$/;
const SEGMENT_NAME = /^S(\d{9})-(\d{9})\.jsonl$/;
const REF_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/;
const TMP_NAME = /^(.+)\.tmp\.\d+\.[0-9a-f]{16}$/;
const TOMBSTONE_NAME = 'tombstone.json';
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

const SECURITY_READ_CODES = new Set(['FILE_OUTSIDE_PROJECT', 'FILE_SYMLINK', 'FILE_NOT_REGULAR', 'READ_BOUNDARY_INVALID', 'READ_UNSUPPORTED_PLATFORM']);

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const pad = (n: number): string => String(n).padStart(9, '0');

export class FsEventStore implements EventStore {
  private readonly root: string;
  private readonly boundaryDir: string;
  private boundaryCache: WriteBoundary | null = null;
  private readonly opts: FsStoreOptions;

  constructor(opts: FsStoreOptions) {
    this.opts = opts;
    this.root = opts.target.dir;
    this.boundaryDir = opts.target.scope === 'project' ? opts.target.projectRoot : opts.target.dir;
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
   */
  private repairResidue(abs: string): string | null {
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

  // ----- EventStore ---------------------------------------------------------

  async listTaskIds(): Promise<string[]> {
    const entries = this.listDir(join(this.root, 'tasks'));
    if (!entries) return [];
    return entries
      .filter((e) => e.isDirectory() && ID_PATTERN.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  async readLog(taskId: string, opts: { afterSeq?: number } = {}): Promise<LogRead> {
    return this.readLogImpl(taskId, opts, false);
  }

  /** `ignoreTombstone`: read the data as it is, even though the task is marked pruned (used to prove it is intact). */
  private readLogImpl(taskId: string, opts: { afterSeq?: number }, ignoreTombstone: boolean): LogRead {
    const after = opts.afterSeq ?? 0;
    const taskDir = this.taskDir(taskId);
    // Segments are immutable: once parsed in this call they are not parsed again on a retry.
    const parsed = new Map<string, TaskEvent[]>();
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      const diagnostics: StoreDiagnostic[] = [];
      if (!this.existingDir(taskDir)) return { exists: false, tombstone: null, events: [], compactedThrough: 0, diagnostics };

      const tomb = ignoreTombstone ? null : this.readTombstone(taskId, diagnostics);
      if (tomb) {
        // The tombstone is published BEFORE the data is removed; data still present means the prune was interrupted.
        for (const dir of [this.eventsDir(taskId), this.segmentsDir(taskId)]) {
          for (const e of this.listDir(dir) ?? []) {
            if (e.isFile() && (EVENT_NAME.test(e.name) || SEGMENT_NAME.test(e.name) || TMP_NAME.test(e.name))) {
              diagnostics.push({ code: 'PRUNE_INCOMPLETE', taskId, name: e.name });
            }
          }
        }
        return { exists: true, tombstone: tomb, events: [], compactedThrough: 0, diagnostics };
      }

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
      return { exists: true, tombstone: null, events, compactedThrough: segEnd, diagnostics };
    }
    throw new StoreIoError(`could not obtain a stable view of task "${taskId}".`);
  }

  private readTombstone(taskId: string, diag: StoreDiagnostic[]): Tombstone | null {
    const content = this.readManaged(join(this.taskDir(taskId), TOMBSTONE_NAME), 'tombstone', MAX_TOMBSTONE_BYTES, taskId, diag);
    if (content === null) return null;
    let t: unknown;
    try {
      t = JSON.parse(content);
    } catch {
      throw new LogCorruptError(taskId, null, 'tombstone is not valid JSON');
    }
    const o = t as Partial<Tombstone> | null;
    if (!o || o.v !== 1 || o.taskId !== taskId || typeof o.headHash !== 'string' || typeof o.finalStatus !== 'string') {
      throw new LogCorruptError(taskId, null, 'tombstone is malformed');
    }
    return o as Tombstone;
  }

  async append(event: TaskEvent): Promise<'appended' | 'conflict'> {
    const taskId = event.taskId;
    const taskDir = this.taskDir(taskId);
    if (this.fileExists(join(taskDir, TOMBSTONE_NAME))) throw new TaskPrunedError(taskId);
    const line = `${serializeEvent(event)}\n`;
    const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, this.eventsDir(taskId), { create: true, ops: this.opts.ops }));
    await this.opts.beforePublish?.(event);
    const name = `${pad(event.seq)}.json`;
    try {
      const out = createFile(parent, name, line, {
        mode: 0o600,
        durability: this.opts.durability ?? 'full',
        maxBytes: MAX_EVENT_BYTES + 4096,
        ops: this.opts.ops,
      });
      for (const w of out.warnings) this.opts.onWarning?.(w);
    } catch (err) {
      if (err instanceof SafeWriteError) {
        if (err.code === 'WRITE_TARGET_EXISTS') return 'conflict';
        if (err.publication === 'UNKNOWN') throw new AppendOutcomeUnknownError(taskId, event.seq, err);
      }
      // The directory we were about to write into is gone or replaced: if the task was pruned meanwhile, say so.
      if (err instanceof SafeWriteError && (err.code === 'WRITE_PARENT_CHANGED' || err.code === 'WRITE_PARENT_MISSING')) {
        if (this.fileExists(join(taskDir, TOMBSTONE_NAME))) throw new TaskPrunedError(taskId);
      }
      throw this.mapWriteError(err);
    }

    if (event.seq === 1 && (this.opts.durability ?? 'full') === 'full') this.fsyncChain(join(this.eventsDir(taskId)));

    // Post-publication fence. A writer that was paused while the slot it aimed at was compacted
    // (loose file removed after its segment was published) or pruned would otherwise have forked
    // the log. Both operations publish their marker BEFORE removing anything, so once our file
    // exists, "marker visible" is decidable: if a segment covers our seq or a tombstone exists
    // our event is not part of the log. Take it back (only our own file) and report the loss.
    const covered = this.segmentCovers(taskId, event.seq);
    const pruned = this.fileExists(join(taskDir, TOMBSTONE_NAME));
    if (covered || pruned) {
      this.removeOwnLooseFile(taskId, name, event);
      if (pruned) throw new TaskPrunedError(taskId);
      return 'conflict';
    }
    return 'appended';
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

  private segmentCovers(taskId: string, seq: number): boolean {
    const entries = this.listDir(this.segmentsDir(taskId));
    if (!entries) return false;
    return entries.some((e) => {
      const m = SEGMENT_NAME.exec(e.name);
      return m !== null && Number(m[1]) <= seq && seq <= Number(m[2]);
    });
  }

  /** Removes `name` only if its bytes are exactly `event` (our own publication). */
  private removeOwnLooseFile(taskId: string, name: string, event: TaskEvent): void {
    const abs = join(this.eventsDir(taskId), name);
    try {
      const content = this.readManaged(abs, `event ${name}`, MAX_EVENT_BYTES + 4096, taskId);
      if (content !== null && content.trim() === serializeEvent(event)) fs.unlinkSync(abs);
    } catch {
      /* a leftover loose copy of a compacted/pruned event is ignored by readers (diagnostic) */
    }
  }

  async compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult> {
    const taskDir = this.taskDir(taskId);
    if (this.fileExists(join(taskDir, TOMBSTONE_NAME))) throw new TaskPrunedError(taskId);
    if (events.length === 0) return { segment: null, packedEvents: 0, removedFiles: 0 };
    const first = events[0] as TaskEvent;
    const last = events[events.length - 1] as TaskEvent;
    if (last.seq !== throughSeq || last.seq - first.seq + 1 !== events.length) {
      throw new LogCorruptError(taskId, first.seq, 'compaction input is not a contiguous range ending at throughSeq');
    }
    const lines = events.map((e) => serializeEvent(e));
    const data = `${lines.join('\n')}\n`;
    if (Buffer.byteLength(data, 'utf8') > MAX_SEGMENT_BYTES) throw new StoreIoError('segment would exceed the size ceiling; pack fewer events.');

    const name = `S${pad(first.seq)}-${pad(last.seq)}.jsonl`;
    const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, this.segmentsDir(taskId), { create: true, ops: this.opts.ops }));
    try {
      const out = createFile(parent, name, data, { mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: MAX_SEGMENT_BYTES, ops: this.opts.ops });
      for (const w of out.warnings) this.opts.onWarning?.(w);
    } catch (err) {
      if (!(err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS')) throw this.mapWriteError(err);
      // A concurrent/interrupted compaction made the same segment: fine iff it is byte-identical.
    }
    this.fsyncChain(this.segmentsDir(taskId));
    const back = this.readManaged(join(this.segmentsDir(taskId), name), `segment ${name}`, MAX_SEGMENT_BYTES, taskId);
    if (back === null || sha256Hex(back) !== sha256Hex(data)) {
      throw new LogCorruptError(taskId, first.seq, `segment ${name} does not read back as written; loose events are kept`);
    }

    // The segment is published and verified: only now are the loose copies of THESE events redundant. A loose
    // file is removed only if it is byte-identical to the event just packed; copies of earlier ranges are
    // handled by `sweepCompacted`, which proves them against the segments they belong to.
    const lineBySeq = new Map<number, string>(events.map((e, i) => [e.seq, lines[i] as string]));
    let removed = 0;
    for (const e of this.listDir(this.eventsDir(taskId)) ?? []) {
      const m = EVENT_NAME.exec(e.name);
      if (!m || !e.isFile()) continue;
      const seq = Number(m[1]);
      const want = lineBySeq.get(seq);
      if (want === undefined) continue;
      if (this.removeLooseIfIdentical(taskId, e.name, want)) removed++;
    }
    this.fsyncDir(this.eventsDir(taskId));
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
    if (this.fileExists(join(this.taskDir(taskId), TOMBSTONE_NAME))) throw new TaskPrunedError(taskId);
    const log = await this.readLog(taskId); // verified view; events up to `compactedThrough` come from the segments
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

  async markPruned(tombstone: Tombstone): Promise<void> {
    const taskId = tombstone.taskId;
    const taskDir = this.taskDir(taskId);
    if (!this.existingDir(taskDir)) throw new LogCorruptError(taskId, null, 'cannot prune an unknown task');
    const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, taskDir, { ops: this.opts.ops }));
    const line = `${JSON.stringify(tombstone)}\n`;
    try {
      const out = createFile(parent, TOMBSTONE_NAME, line, { mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: MAX_TOMBSTONE_BYTES, ops: this.opts.ops });
      for (const w of out.warnings) this.opts.onWarning?.(w);
    } catch (err) {
      if (!(err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS')) throw this.mapWriteError(err);
      const existing = this.readTombstone(taskId, []);
      if (!existing || existing.headHash !== tombstone.headHash) {
        throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
      }
    }
  }

  async withdrawTombstone(tombstone: Tombstone): Promise<void> {
    const taskId = tombstone.taskId;
    const abs = join(this.taskDir(taskId), TOMBSTONE_NAME);
    const existing = this.readTombstone(taskId, []);
    if (!existing) return; // already withdrawn
    if (existing.headHash !== tombstone.headHash) throw new LogCorruptError(taskId, null, 'a different tombstone exists; refusing to withdraw it');
    // Only while nothing has been removed: the data must still be the complete log the tombstone describes.
    const log = this.readLogImpl(taskId, {}, true);
    const last = log.events[log.events.length - 1];
    if (!last || last.seq !== tombstone.headSeq || last.hash !== tombstone.headHash) {
      throw new LogCorruptError(taskId, null, 'the data of the pruned task is no longer complete; the tombstone cannot be withdrawn');
    }
    verifyChain(taskId, log.events, 0, GENESIS_HASH);
    try {
      fs.unlinkSync(abs);
    } catch (err) {
      if (errno(err) !== 'ENOENT') throw new StoreIoError(`cannot remove the tombstone: ${(err as Error).message}`, err);
    }
    this.fsyncDir(this.taskDir(taskId));
  }

  private refsDir(taskId: string): string {
    return join(this.taskDir(taskId), 'refs');
  }

  async pinReference(parentId: string, childId: string, at: string): Promise<'pinned' | 'parent-pruned' | 'parent-missing'> {
    if (!ID_PATTERN.test(childId)) throw new StoreSecurityError(`invalid task id "${childId}".`, 'BAD_ID');
    const taskDir = this.taskDir(parentId);
    const tomb = join(taskDir, TOMBSTONE_NAME);
    if (!this.existingDir(taskDir)) return 'parent-missing';
    if (this.fileExists(tomb)) return 'parent-pruned';
    const name = `${childId}.json`;
    try {
      const parent = this.wrapSafe(() => openParent(this.boundaryFor(true) as WriteBoundary, this.refsDir(parentId), { create: true, ops: this.opts.ops }));
      const out = createFile(parent, name, `${JSON.stringify({ v: 1, childId, at })}\n`, {
        mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: 1024, ops: this.opts.ops,
      });
      for (const w of out.warnings) this.opts.onWarning?.(w);
    } catch (err) {
      if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS') {
        /* pinned before (a retry of the same creation) */
      } else if (err instanceof SafeWriteError && (err.code === 'WRITE_PARENT_CHANGED' || err.code === 'WRITE_PARENT_MISSING') && this.fileExists(tomb)) {
        return 'parent-pruned';
      } else {
        throw this.mapWriteError(err);
      }
    }
    this.fsyncChain(this.refsDir(parentId));
    // The pin is visible now. Looking at the tombstone only AFTER publishing the pin is what makes this safe:
    // a prune that published its tombstone before this point is seen here; one that publishes it later will see the pin.
    if (this.fileExists(tomb)) {
      try {
        fs.unlinkSync(join(this.refsDir(parentId), name));
      } catch {
        /* a leftover pin of a child that was never created is harmless: it expires (see referenceGraceMs) */
      }
      return 'parent-pruned';
    }
    return 'pinned';
  }

  async listReferences(parentId: string): Promise<Array<{ childId: string; at: string }>> {
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

  async prune(tombstone: Tombstone): Promise<{ removedFiles: number }> {
    const taskId = tombstone.taskId;
    await this.markPruned(tombstone);
    // Tombstone is durable: removal below is idempotent and may be repeated after a crash.
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
