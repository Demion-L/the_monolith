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
import { LogCorruptError, StoreIoError, StoreSecurityError, TaskPrunedError, } from './errors.js';
import { MAX_EVENT_BYTES, ID_PATTERN, parseEvent, serializeEvent } from './log.js';
import { SafeWriteError, createFile, openParent, projectBoundary, readBoundedFile, trustedDirectoryBoundary, } from '../root/index.js';
/** Packed segments stay well below this; it is the reader's ceiling. */
export const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;
const EVENT_NAME = /^(\d{9})\.json$/;
const SEGMENT_NAME = /^S(\d{9})-(\d{9})\.jsonl$/;
const TMP_NAME = /^(.+)\.tmp\.\d+\.[0-9a-f]{16}$/;
const TOMBSTONE_NAME = 'tombstone.json';
const MAX_TOMBSTONE_BYTES = 4096;
const READ_ATTEMPTS = 8;
export class AppendOutcomeUnknownError extends StoreIoError {
    taskId;
    seq;
    constructor(taskId, seq, cause) {
        super(`publication of event ${seq} of task "${taskId}" has an unknown outcome; re-read the log to find out.`, cause);
        this.taskId = taskId;
        this.seq = seq;
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
function errno(err) {
    return err?.code;
}
function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
const pad = (n) => String(n).padStart(9, '0');
export class FsEventStore {
    root;
    boundaryDir;
    boundaryCache = null;
    opts;
    constructor(opts) {
        this.opts = opts;
        this.root = opts.target.dir;
        this.boundaryDir = opts.target.scope === 'project' ? opts.target.projectRoot : opts.target.dir;
    }
    /**
     * The trust boundary. In `trusted-directory` scope the directory is the boundary and is created on the
     * first write if missing (same contract as the state keeper); a read of a store that does not exist yet
     * simply finds nothing. In `project` scope the project root must already exist.
     */
    boundaryFor(forWrite) {
        if (this.boundaryCache)
            return this.boundaryCache;
        const t = this.opts.target;
        if (t.scope === 'trusted-directory' && !fs.existsSync(t.dir)) {
            if (!forWrite)
                return null;
            fs.mkdirSync(t.dir, { recursive: true, mode: 0o700 });
        }
        this.boundaryCache = this.wrapSafe(() => (t.scope === 'project' ? projectBoundary(t.projectRoot) : trustedDirectoryBoundary(t.dir)));
        return this.boundaryCache;
    }
    // ----- paths --------------------------------------------------------------
    taskDir(taskId) {
        if (!ID_PATTERN.test(taskId))
            throw new StoreSecurityError(`invalid task id "${taskId}".`, 'BAD_ID');
        return join(this.root, 'tasks', taskId);
    }
    eventsDir(taskId) {
        return join(this.taskDir(taskId), 'events');
    }
    segmentsDir(taskId) {
        return join(this.taskDir(taskId), 'segments');
    }
    // ----- error mapping ------------------------------------------------------
    wrapSafe(fn) {
        try {
            return fn();
        }
        catch (err) {
            throw this.mapWriteError(err);
        }
    }
    mapWriteError(err) {
        if (err instanceof SafeWriteError) {
            if (SECURITY_WRITE_CODES.has(err.code))
                return new StoreSecurityError(err.message, err.code);
            return new StoreIoError(err.message, err);
        }
        return err instanceof Error ? err : new StoreIoError(String(err));
    }
    // ----- directory helpers --------------------------------------------------
    /** Verified directory (no symlink below the boundary) or `null` if it does not exist. */
    existingDir(dir) {
        const boundary = this.boundaryFor(false);
        if (!boundary)
            return false;
        try {
            openParent(boundary, dir, { ops: this.opts.ops });
            return true;
        }
        catch (err) {
            if (err instanceof SafeWriteError && err.code === 'WRITE_PARENT_MISSING')
                return false;
            throw this.mapWriteError(err);
        }
    }
    listDir(dir) {
        if (!this.existingDir(dir))
            return null;
        try {
            return fs.readdirSync(dir, { withFileTypes: true });
        }
        catch (err) {
            if (errno(err) === 'ENOENT')
                return null;
            throw new StoreIoError(`cannot list "${dir}": ${err.message}`, err);
        }
    }
    // ----- strict read with residue repair ------------------------------------
    /**
     * The second name of a freshly published file, if (and only if) it is
     * provably this file's staging name: `<name>.tmp.<pid>.<rand>` in the same
     * directory with the same dev/ino. Returns the removed name or `null`.
     */
    repairResidue(abs) {
        const dir = dirname(abs);
        const name = abs.slice(dir.length + 1);
        let final;
        try {
            final = fs.lstatSync(abs, { bigint: true });
        }
        catch {
            return null;
        }
        if (!final.isFile() || final.nlink !== 2n)
            return null;
        let entries;
        try {
            entries = fs.readdirSync(dir);
        }
        catch {
            return null;
        }
        const twins = [];
        for (const e of entries) {
            const m = TMP_NAME.exec(e);
            if (!m || m[1] !== name)
                continue;
            try {
                const st = fs.lstatSync(join(dir, e), { bigint: true });
                if (st.isFile() && st.dev === final.dev && st.ino === final.ino)
                    twins.push(e);
            }
            catch {
                /* vanished: the writer finished itself */
            }
        }
        if (twins.length !== 1)
            return null;
        try {
            fs.unlinkSync(join(dir, twins[0]));
        }
        catch (err) {
            if (errno(err) !== 'ENOENT')
                return null;
        }
        return twins[0];
    }
    /** `null` when the file is missing. Throws on anything unsafe or unreadable. */
    readManaged(abs, label, maxBytes, taskId, diag) {
        let hardlinkTries = 0;
        for (let attempt = 0; attempt < 8; attempt++) {
            const r = readBoundedFile(abs, label, { boundary: this.boundaryDir, maxBytes }, true);
            if (r.ok)
                return r.content;
            if (r.code === 'FILE_MISSING')
                return null;
            if (r.code === 'FILE_CHANGED')
                continue;
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
            if (SECURITY_READ_CODES.has(r.code))
                throw new StoreSecurityError(r.detail, r.code);
            if (r.code === 'FILE_EMPTY')
                throw new LogCorruptError(taskId, null, `${label} is empty`);
            if (r.code === 'FILE_TOO_LARGE')
                throw new LogCorruptError(taskId, null, `${label} exceeds ${maxBytes} bytes`);
            throw new StoreIoError(r.detail);
        }
        throw new StoreIoError(`${label} kept changing while being read.`);
    }
    // ----- EventStore ---------------------------------------------------------
    async listTaskIds() {
        const entries = this.listDir(join(this.root, 'tasks'));
        if (!entries)
            return [];
        return entries
            .filter((e) => e.isDirectory() && ID_PATTERN.test(e.name))
            .map((e) => e.name)
            .sort();
    }
    async readLog(taskId, opts = {}) {
        const after = opts.afterSeq ?? 0;
        const taskDir = this.taskDir(taskId);
        // Segments are immutable: once parsed in this call they are not parsed again on a retry.
        const parsed = new Map();
        for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
            const diagnostics = [];
            if (!this.existingDir(taskDir))
                return { exists: false, tombstone: null, events: [], compactedThrough: 0, diagnostics };
            const tomb = this.readTombstone(taskId, diagnostics);
            if (tomb)
                return { exists: true, tombstone: tomb, events: [], compactedThrough: 0, diagnostics };
            // ORDER MATTERS. Compaction publishes a segment BEFORE it removes the loose files it covers. So if the
            // loose files are listed first and the segments second, an event missing from the first listing was
            // removed before it, hence its segment was already published and appears in the second. Listing in the
            // other order lets a reader that is slow between the two listings see a hole on every attempt.
            const eventEntries = this.listDir(this.eventsDir(taskId)) ?? [];
            const segEntries = this.listDir(this.segmentsDir(taskId)) ?? [];
            this.opts.afterListing?.(attempt);
            const segments = [];
            for (const e of segEntries) {
                const m = SEGMENT_NAME.exec(e.name);
                if (m && e.isFile())
                    segments.push({ name: e.name, from: Number(m[1]), to: Number(m[2]) });
                else if (TMP_NAME.test(e.name))
                    diagnostics.push({ code: 'STAGING_FILE_PRESENT', taskId, name: e.name });
                else
                    diagnostics.push({ code: 'UNKNOWN_ENTRY', taskId, name: e.name });
            }
            segments.sort((a, b) => a.from - b.from || a.to - b.to);
            const segEnd = segments.reduce((m, s) => Math.max(m, s.to), 0);
            // Read the loose files first, right after listing them: they are small and they are what a
            // concurrent compaction removes. The (slow) segment parsing comes after, when a vanished file
            // is already known to be covered.
            const bySeq = new Map();
            let vanished = false;
            for (const e of eventEntries) {
                const m = EVENT_NAME.exec(e.name);
                if (!m) {
                    diagnostics.push({ code: TMP_NAME.test(e.name) ? 'STAGING_FILE_PRESENT' : 'UNKNOWN_ENTRY', taskId, name: e.name });
                    continue;
                }
                if (!e.isFile())
                    throw new StoreSecurityError(`event entry ${e.name} of task "${taskId}" is not a regular file.`, 'FILE_NOT_REGULAR');
                const seq = Number(m[1]);
                if (seq <= after)
                    continue;
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
                if (ev.seq !== seq)
                    throw new LogCorruptError(taskId, seq, `file ${e.name} holds event ${ev.seq}`);
                bySeq.set(seq, ev);
            }
            for (const s of segments) {
                if (s.to <= after)
                    continue;
                let evs = parsed.get(s.name);
                if (!evs) {
                    const content = this.readManaged(join(this.segmentsDir(taskId), s.name), `segment ${s.name}`, MAX_SEGMENT_BYTES, taskId);
                    if (content === null)
                        continue;
                    const lines = content.split('\n').filter((l) => l.length > 0);
                    if (lines.length !== s.to - s.from + 1)
                        throw new LogCorruptError(taskId, s.from, `segment ${s.name} holds ${lines.length} events, its name says ${s.to - s.from + 1}`);
                    evs = lines.map((line, i) => {
                        const ev = parseEvent(line, taskId, s.from + i);
                        if (ev.seq !== s.from + i)
                            throw new LogCorruptError(taskId, ev.seq, `segment ${s.name} is not contiguous`);
                        return ev;
                    });
                    parsed.set(s.name, evs);
                }
                for (const ev of evs) {
                    const dup = bySeq.get(ev.seq);
                    if (dup && dup.hash !== ev.hash)
                        throw new LogCorruptError(taskId, ev.seq, 'overlapping segments disagree');
                    if (ev.seq > after)
                        bySeq.set(ev.seq, ev); // a segment may straddle `after`; hand back only the suffix asked for
                }
            }
            const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
            let contiguous = events.length === 0 || events[0].seq === after + 1;
            for (let i = 1; contiguous && i < events.length; i++)
                contiguous = events[i].seq === events[i - 1].seq + 1;
            if (!contiguous || vanished) {
                // Either a writer is mid-way (a later file listed before an earlier one became visible) or a
                // compaction moved files into a segment after we listed. A fresh pass resolves both.
                if (attempt < READ_ATTEMPTS - 1) {
                    sleepMs(2 * (attempt + 1));
                    continue;
                }
                const firstBad = events.find((ev, i) => (i === 0 ? ev.seq !== after + 1 : ev.seq !== events[i - 1].seq + 1));
                throw new LogCorruptError(taskId, firstBad?.seq ?? null, vanished ? 'event files kept vanishing while being read' : 'events are missing from the log');
            }
            return { exists: true, tombstone: null, events, compactedThrough: segEnd, diagnostics };
        }
        throw new StoreIoError(`could not obtain a stable view of task "${taskId}".`);
    }
    readTombstone(taskId, diag) {
        const content = this.readManaged(join(this.taskDir(taskId), TOMBSTONE_NAME), 'tombstone', MAX_TOMBSTONE_BYTES, taskId, diag);
        if (content === null)
            return null;
        let t;
        try {
            t = JSON.parse(content);
        }
        catch {
            throw new LogCorruptError(taskId, null, 'tombstone is not valid JSON');
        }
        const o = t;
        if (!o || o.v !== 1 || o.taskId !== taskId || typeof o.headHash !== 'string' || typeof o.finalStatus !== 'string') {
            throw new LogCorruptError(taskId, null, 'tombstone is malformed');
        }
        return o;
    }
    async append(event) {
        const taskId = event.taskId;
        const taskDir = this.taskDir(taskId);
        if (this.fileExists(join(taskDir, TOMBSTONE_NAME)))
            throw new TaskPrunedError(taskId);
        const line = `${serializeEvent(event)}\n`;
        const parent = this.wrapSafe(() => openParent(this.boundaryFor(true), this.eventsDir(taskId), { create: true, ops: this.opts.ops }));
        await this.opts.beforePublish?.(event);
        const name = `${pad(event.seq)}.json`;
        try {
            const out = createFile(parent, name, line, {
                mode: 0o600,
                durability: this.opts.durability ?? 'full',
                maxBytes: MAX_EVENT_BYTES + 4096,
                ops: this.opts.ops,
            });
            for (const w of out.warnings)
                this.opts.onWarning?.(w);
        }
        catch (err) {
            if (err instanceof SafeWriteError) {
                if (err.code === 'WRITE_TARGET_EXISTS')
                    return 'conflict';
                if (err.publication === 'UNKNOWN')
                    throw new AppendOutcomeUnknownError(taskId, event.seq, err);
            }
            // The directory we were about to write into is gone or replaced: if the task was pruned meanwhile, say so.
            if (err instanceof SafeWriteError && (err.code === 'WRITE_PARENT_CHANGED' || err.code === 'WRITE_PARENT_MISSING')) {
                if (this.fileExists(join(taskDir, TOMBSTONE_NAME)))
                    throw new TaskPrunedError(taskId);
            }
            throw this.mapWriteError(err);
        }
        if (event.seq === 1 && (this.opts.durability ?? 'full') === 'full')
            this.fsyncChain(join(this.eventsDir(taskId)));
        // Post-publication fence. A writer that was paused while the slot it aimed at was compacted
        // (loose file removed after its segment was published) or pruned would otherwise have forked
        // the log. Both operations publish their marker BEFORE removing anything, so once our file
        // exists, "marker visible" is decidable: if a segment covers our seq or a tombstone exists
        // our event is not part of the log. Take it back (only our own file) and report the loss.
        const covered = this.segmentCovers(taskId, event.seq);
        const pruned = this.fileExists(join(taskDir, TOMBSTONE_NAME));
        if (covered || pruned) {
            this.removeOwnLooseFile(taskId, name, event);
            if (pruned)
                throw new TaskPrunedError(taskId);
            return 'conflict';
        }
        return 'appended';
    }
    fileExists(abs) {
        try {
            fs.lstatSync(abs);
            return true;
        }
        catch (err) {
            if (errno(err) === 'ENOENT')
                return false;
            throw new StoreIoError(`cannot inspect "${abs}": ${err.message}`, err);
        }
    }
    segmentCovers(taskId, seq) {
        const entries = this.listDir(this.segmentsDir(taskId));
        if (!entries)
            return false;
        return entries.some((e) => {
            const m = SEGMENT_NAME.exec(e.name);
            return m !== null && Number(m[1]) <= seq && seq <= Number(m[2]);
        });
    }
    /** Removes `name` only if its bytes are exactly `event` (our own publication). */
    removeOwnLooseFile(taskId, name, event) {
        const abs = join(this.eventsDir(taskId), name);
        try {
            const content = this.readManaged(abs, `event ${name}`, MAX_EVENT_BYTES + 4096, taskId);
            if (content !== null && content.trim() === serializeEvent(event))
                fs.unlinkSync(abs);
        }
        catch {
            /* a leftover loose copy of a compacted/pruned event is ignored by readers (diagnostic) */
        }
    }
    async compact(taskId, throughSeq, events) {
        const taskDir = this.taskDir(taskId);
        if (this.fileExists(join(taskDir, TOMBSTONE_NAME)))
            throw new TaskPrunedError(taskId);
        if (events.length === 0)
            return { segment: null, packedEvents: 0, removedFiles: 0 };
        const first = events[0];
        const last = events[events.length - 1];
        if (last.seq !== throughSeq || last.seq - first.seq + 1 !== events.length) {
            throw new LogCorruptError(taskId, first.seq, 'compaction input is not a contiguous range ending at throughSeq');
        }
        const lines = events.map((e) => serializeEvent(e));
        const data = `${lines.join('\n')}\n`;
        if (Buffer.byteLength(data, 'utf8') > MAX_SEGMENT_BYTES)
            throw new StoreIoError('segment would exceed the size ceiling; pack fewer events.');
        const name = `S${pad(first.seq)}-${pad(last.seq)}.jsonl`;
        const parent = this.wrapSafe(() => openParent(this.boundaryFor(true), this.segmentsDir(taskId), { create: true, ops: this.opts.ops }));
        try {
            const out = createFile(parent, name, data, { mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: MAX_SEGMENT_BYTES, ops: this.opts.ops });
            for (const w of out.warnings)
                this.opts.onWarning?.(w);
        }
        catch (err) {
            if (!(err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS'))
                throw this.mapWriteError(err);
            // A concurrent/interrupted compaction made the same segment: fine iff it is byte-identical.
        }
        this.fsyncChain(this.segmentsDir(taskId));
        const back = this.readManaged(join(this.segmentsDir(taskId), name), `segment ${name}`, MAX_SEGMENT_BYTES, taskId);
        if (back === null || sha256Hex(back) !== sha256Hex(data)) {
            throw new LogCorruptError(taskId, first.seq, `segment ${name} does not read back as written; loose events are kept`);
        }
        // The segment is published and verified: only now are the loose copies redundant.
        let removed = 0;
        const evEntries = this.listDir(this.eventsDir(taskId)) ?? [];
        for (const e of evEntries) {
            const m = EVENT_NAME.exec(e.name);
            if (!m || !e.isFile())
                continue;
            const seq = Number(m[1]);
            if (seq > last.seq)
                continue;
            try {
                fs.unlinkSync(join(this.eventsDir(taskId), e.name));
                removed++;
            }
            catch (err) {
                if (errno(err) !== 'ENOENT')
                    throw new StoreIoError(`cannot remove ${e.name}: ${err.message}`, err);
            }
        }
        this.fsyncDir(this.eventsDir(taskId));
        return { segment: name, packedEvents: events.length, removedFiles: removed };
    }
    async prune(tombstone) {
        const taskId = tombstone.taskId;
        const taskDir = this.taskDir(taskId);
        if (!this.existingDir(taskDir))
            throw new LogCorruptError(taskId, null, 'cannot prune an unknown task');
        const parent = this.wrapSafe(() => openParent(this.boundaryFor(true), taskDir, { ops: this.opts.ops }));
        const line = `${JSON.stringify(tombstone)}\n`;
        try {
            const out = createFile(parent, TOMBSTONE_NAME, line, { mode: 0o600, durability: this.opts.durability ?? 'full', maxBytes: MAX_TOMBSTONE_BYTES, ops: this.opts.ops });
            for (const w of out.warnings)
                this.opts.onWarning?.(w);
        }
        catch (err) {
            if (!(err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS'))
                throw this.mapWriteError(err);
            const existing = this.readTombstone(taskId, []);
            if (!existing || existing.headHash !== tombstone.headHash) {
                throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
            }
        }
        // Tombstone is durable: removal below is idempotent and may be repeated after a crash.
        let removed = 0;
        for (const dir of [this.eventsDir(taskId), this.segmentsDir(taskId)]) {
            const entries = this.listDir(dir);
            if (!entries)
                continue;
            let leftovers = 0;
            for (const e of entries) {
                if (!(e.isFile() && (EVENT_NAME.test(e.name) || SEGMENT_NAME.test(e.name) || TMP_NAME.test(e.name)))) {
                    leftovers++;
                    continue;
                }
                try {
                    fs.unlinkSync(join(dir, e.name));
                    removed++;
                }
                catch (err) {
                    if (errno(err) !== 'ENOENT')
                        throw new StoreIoError(`cannot remove ${e.name}: ${err.message}`, err);
                }
            }
            if (leftovers === 0) {
                try {
                    fs.rmdirSync(dir);
                }
                catch (err) {
                    if (errno(err) !== 'ENOENT' && errno(err) !== 'ENOTEMPTY')
                        throw new StoreIoError(`cannot remove ${dir}: ${err.message}`, err);
                }
            }
        }
        return { removedFiles: removed };
    }
    /** fsync `dir` and every ancestor down to the store root: directory entries created by mkdir are not durable until their parent is synced. */
    fsyncChain(dir) {
        let cur = dir;
        for (let i = 0; i < 6; i++) {
            this.fsyncDir(cur);
            if (cur === this.root)
                return;
            const up = dirname(cur);
            if (up === cur)
                return;
            cur = up;
        }
    }
    fsyncDir(dir) {
        if ((this.opts.durability ?? 'full') !== 'full')
            return;
        let fd = null;
        try {
            fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
            fs.fsyncSync(fd);
        }
        catch {
            /* best effort: the segment itself was fsynced by the write primitive */
        }
        finally {
            if (fd !== null)
                fs.closeSync(fd);
        }
    }
}
