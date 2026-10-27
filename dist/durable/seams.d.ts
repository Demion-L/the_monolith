/**
 * Test seams of the stores. INTERNAL: nothing here is exported from the package entry point (`index.ts`), and the public
 * constructors never read these fields from their options. A store takes its seams from a one-shot hand-over slot that
 * only `testing.ts` fills, immediately before it calls the constructor. The package `exports` map exposes `.` alone, so
 * `testing.ts` cannot be imported from outside the package. This is API hygiene, not a security boundary: code running
 * inside the process can reach anything the process can.
 */
import type { FsOps } from '../root/index.js';
import type { TaskEvent } from './types.js';
export interface FsStoreSeams {
    /** fault injection for the write primitive. */
    ops?: Partial<FsOps>;
    /** called between the pre-publish checks and the publication of an event. */
    beforePublish?: (event: TaskEvent) => void | Promise<void>;
    /** called in `readLog` right after the directory listings, before any file is read. */
    afterListing?: (attempt: number) => void;
    /** Design A G1 (section 24.6): refuse early on a pruned or corrupt task before publishing. Default `true`. Safety does not depend on it. */
    earlyPruneCheck?: boolean;
    /** lowers `MAX_PRUNE_ATTEMPTS` so a test need not write a thousand attempts. */
    maxPruneAttempts?: number;
    /** returns a different (e.g. incomplete) listing of a task directory for the register: listings are not atomic (A7). */
    registerListing?: (taskId: string, names: string[]) => string[];
    /**
     * Register-protocol tests only: skip the F-1 precondition of an irreversible prune, to exercise the register (G2, first
     * writer wins) over logs that are not prunable. Never a production setting.
     */
    skipPrunePrecondition?: boolean;
    /** simulate an I/O error on reading a file of the store: return an errno code (`'EIO'`) to fail with, or nothing. */
    readFault?: (abs: string) => string | null | undefined;
}
export interface MemoryStoreSeams {
    /** lowers `MAX_PRUNE_ATTEMPTS` so a test need not write a thousand attempts. */
    maxPruneAttempts?: number;
}
/** Fills the slot for the next constructor call. Used by `testing.ts` only. */
export declare function handOver(kind: 'fs', seams: FsStoreSeams): void;
export declare function handOver(kind: 'memory', seams: MemoryStoreSeams): void;
export declare function takeFsSeams(): FsStoreSeams;
export declare function takeMemorySeams(): MemoryStoreSeams;
//# sourceMappingURL=seams.d.ts.map