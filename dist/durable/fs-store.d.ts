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
import { StoreIoError } from './errors.js';
import { type DecisionBy, type PruneOutcome, type PruneState } from './types.js';
import { type WriteWarning } from '../root/index.js';
import type { AppendOutcome, CompactionResult, EventStore, LogRead, TaskEvent, Tombstone } from './types.js';
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
}
/** Packed segments stay well below this; it is the reader's ceiling. */
export declare const MAX_SEGMENT_BYTES: number;
export declare class AppendOutcomeUnknownError extends StoreIoError {
    readonly taskId: string;
    readonly seq: number;
    constructor(taskId: string, seq: number, cause?: unknown);
}
/** What the version marker says about the store (Design A, sections 13 and 46.5). */
export type ProtocolStatus = 
/** `durable-protocol.json` is present and understood: the store may be written. */
{
    mode: 'ready';
    version: 2;
}
/** No marker: read-only diagnostics. Nothing is created, nothing is migrated. */
 | {
    mode: 'diagnostic';
    reason: 'uninitialized';
    tasksPresent: boolean;
}
/** A marker this build does not understand (a newer version, or damaged): the store is not opened as compatible. */
 | {
    mode: 'incompatible';
    reason: 'unsupported-version' | 'invalid-marker';
};
export declare class FsEventStore implements EventStore {
    private readonly root;
    private readonly boundaryDir;
    private boundaryCache;
    private readonly opts;
    /** True once a valid marker was seen. Only then may a read repair anything (it is a mutation). Never reset: the marker is never removed. */
    private ready;
    private readonly maxAttempts;
    private readonly seams;
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
    private refsDir;
    private wrapSafe;
    private mapWriteError;
    private markerRead;
    private hasTasks;
    /**
     * What this store may be used for. Pure observation: it creates nothing and repairs nothing. A store with no marker is
     * `diagnostic` (empty or not): reads work, every mutation is refused until the operator calls `initializeProtocol()`.
     */
    protocolStatus(): Promise<ProtocolStatus>;
    /**
     * Explicit operator action (Design A section 46.5, ADR-018 D3): publish `durable-protocol.json` (`{"v":2}`, create-only)
     * in an EMPTY store, with every runtime of an older version stopped. It refuses a store that holds tasks (that needs the
     * migration decision of the operator, not a bootstrap), refuses a marker of another version, and is a no-op when a valid
     * marker is already there. Opening a store never does this.
     */
    initializeProtocol(): Promise<'initialized' | 'already-initialized'>;
    /** The same operator action as `initializeProtocol`, for scripts and tests that are not async. */
    initializeProtocolSync(): 'initialized' | 'already-initialized';
    /** Called first by every public method. A write needs a valid marker; a read needs the marker to be absent or valid. */
    private gate;
    /** Verified directory (no symlink below the boundary) or `null` if it does not exist. */
    private existingDir;
    private listDir;
    /**
     * The second name of a freshly published file, if (and only if) it is
     * provably this file's staging name: `<name>.tmp.<pid>.<rand>` in the same
     * directory with the same dev/ino. Returns the removed name or `null`.
     * Removing it is a mutation: a store without a valid marker (diagnostics only) never does it.
     */
    private repairResidue;
    /** `null` when the file is missing. Throws on anything unsafe or unreadable. */
    private readManaged;
    /**
     * The same safe read, reported as an observation instead of an exception, for the places that must tell
     * "not there" (`absent`) from "there and wrong" (`bad`: evidence) from "could not find out" (`ioerr`: never evidence).
     */
    private readFileObs;
    private registerIO;
    /** Files of the task still on disk (events, segments, references, staging). `> 0` after a commit means "deleting". */
    private residueCount;
    /** `derivePruneState` over the real directory. Reads only. */
    private derive;
    /** The error a state that grants nothing turns into. */
    private refusal;
    pruneState(taskId: string): Promise<PruneState>;
    private publishRecord;
    /**
     * The precondition of an irreversible prune (F-1): the log, read now, is that of a finished task whose head is the one
     * the tombstone names. Meaningful only for an attempt that is already visible in the register (or, as a refusal that
     * leaves no residue, just before one is published): from the moment the prepare is visible, an append that lands after
     * this read settles through G2, finds the open attempt and closes it with `abort`, so a commit can never follow it.
     */
    private assertPrunable;
    preparePrune(tombstone: Tombstone): Promise<{
        attempt: number;
        created: boolean;
    }>;
    decidePrune(taskId: string, attempt: number, outcome: PruneOutcome, tombstone?: Tombstone, by?: DecisionBy): Promise<PruneOutcome>;
    markPruned(tombstone: Tombstone): Promise<void>;
    withdrawTombstone(tombstone: Tombstone): Promise<void>;
    prune(tombstone: Tombstone, opts?: {
        requireCommit?: boolean;
    }): Promise<{
        removedFiles: number;
    }>;
    /**
     * Prune cleanup (class C, section 30.3): only for a verified, consistent `COMMITTED`. Publishes `tombstone.json` from the
     * commit, then removes the data of the task. It never touches the register, `tombstone.json` or the task directory,
     * decides nothing, and finishing a half-done run is the same call again.
     */
    private rollForward;
    /**
     * G1 (section 24.6): an optional early refusal, so that a write to a pruned or damaged task does not leave a file
     * behind. Safety never depends on it (G2 decides); turning it off changes only how much is left over.
     */
    private earlyCheck;
    /**
     * G2 (section 24.2): after a file was published, ask the register. It never unlinks anything: a published file is
     * shared state (F-1, class A is forbidden). `PREPARING` is closed with an `abort` (always safe), at most
     * `MAX_WRITE_RESOLVE` times; a pruner that keeps opening attempts leaves the outcome UNKNOWN, never a deletion.
     */
    private settle;
    listTaskIds(): Promise<string[]>;
    readLog(taskId: string, opts?: {
        afterSeq?: number;
        rawEvents?: boolean;
    }): Promise<LogRead>;
    private readLogImpl;
    private fileExists;
    private slotName;
    /** The loose file of a slot as an observation (trimmed line), never an exception. */
    private readSlot;
    private listSegments;
    /** A segment as its lines, validated the way `readLog` validates it. */
    private readSegmentLines;
    /**
     * `CanonRead` for the slots `from..to` (section 40.2). Every loose file is read BEFORE the single listing of
     * `segments/` (the order is what makes a slot that was compacted in between visible, section 35.3), and a slot
     * covered by a segment takes the segment's row: a loose file next to it is a copy or an orphan and is not consulted
     * (CEI-2), so an I/O error on it does not matter. Writes nothing.
     */
    private canonRead;
    /**
     * Canonical Event Identity (section 35.2), run right after the `link` of a loose file (or its `EEXIST`): the slot was
     * read first (`slot`), the listing of `segments/` comes strictly after. Confirmation needs the slot to equal the event
     * of the caller, canonically: the row of a covering segment, or — if nothing covers it — the loose file.
     */
    private cei;
    /** AV-4: the error for a write that is not valid, chosen from the register only AFTER the refusal (section 31.1). */
    private refuseWrite;
    append(event: TaskEvent): Promise<AppendOutcome>;
    /** The file is already visible: say so on the corruption error. */
    private published;
    /** Removes `name` only if its bytes are exactly `line` (a copy the caller published itself, class B). */
    private removeOwnLooseFile;
    compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult>;
    /** Removes the loose event file `name` iff its content is exactly `line`. `true` if it was removed. */
    private removeLooseIfIdentical;
    sweepCompacted(taskId: string): Promise<{
        removedFiles: number;
        keptFiles: number;
    }>;
    pinReference(parentId: string, childId: string, at: string): Promise<'pinned' | 'parent-pruned' | 'parent-missing'>;
    listReferences(parentId: string): Promise<Array<{
        childId: string;
        at: string;
    }>>;
    /** fsync `dir` and every ancestor down to the store root: directory entries created by mkdir are not durable until their parent is synced. */
    private fsyncChain;
    /**
     * Mode A (the only mode claimed): a failed directory fsync is a warning of the write primitive, never a reason to refuse or
     * to continue differently — durability verification (`DV`) is Mode B and is not called here (Design A section 18.2).
     */
    private fsyncDir;
}
//# sourceMappingURL=fs-store.d.ts.map