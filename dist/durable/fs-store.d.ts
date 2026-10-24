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
import { StoreIoError } from './errors.js';
import { type FsOps, type WriteWarning } from '../root/index.js';
import type { CompactionResult, EventStore, LogRead, TaskEvent, Tombstone } from './types.js';
export type FsStoreTarget = {
    scope: 'project';
    projectRoot: string;
    dir: string;
} | {
    scope: 'trusted-directory';
    dir: string;
};
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
export declare const MAX_SEGMENT_BYTES: number;
export declare class AppendOutcomeUnknownError extends StoreIoError {
    readonly taskId: string;
    readonly seq: number;
    constructor(taskId: string, seq: number, cause?: unknown);
}
export declare class FsEventStore implements EventStore {
    private readonly root;
    private readonly boundaryDir;
    private boundaryCache;
    private readonly opts;
    constructor(opts: FsStoreOptions);
    /**
     * The trust boundary. In `trusted-directory` scope the directory is the boundary and is created on the
     * first write if missing (same contract as the state keeper); a read of a store that does not exist yet
     * simply finds nothing. In `project` scope the project root must already exist.
     */
    private boundaryFor;
    private taskDir;
    private eventsDir;
    private segmentsDir;
    private wrapSafe;
    private mapWriteError;
    /** Verified directory (no symlink below the boundary) or `null` if it does not exist. */
    private existingDir;
    private listDir;
    /**
     * The second name of a freshly published file, if (and only if) it is
     * provably this file's staging name: `<name>.tmp.<pid>.<rand>` in the same
     * directory with the same dev/ino. Returns the removed name or `null`.
     */
    private repairResidue;
    /** `null` when the file is missing. Throws on anything unsafe or unreadable. */
    private readManaged;
    listTaskIds(): Promise<string[]>;
    readLog(taskId: string, opts?: {
        afterSeq?: number;
    }): Promise<LogRead>;
    private readTombstone;
    append(event: TaskEvent): Promise<'appended' | 'conflict'>;
    private fileExists;
    private segmentCovers;
    /** Removes `name` only if its bytes are exactly `event` (our own publication). */
    private removeOwnLooseFile;
    compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult>;
    prune(tombstone: Tombstone): Promise<{
        removedFiles: number;
    }>;
    /** fsync `dir` and every ancestor down to the store root: directory entries created by mkdir are not durable until their parent is synced. */
    private fsyncChain;
    private fsyncDir;
}
//# sourceMappingURL=fs-store.d.ts.map