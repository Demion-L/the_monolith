/**
 * In-memory `EventStore`. For tests of application logic built on Durable
 * State and for embedding where durability is not wanted. It implements the
 * same contract as the filesystem store (the shared conformance suite runs
 * against both), but nothing survives the process.
 */
import type { CompactionResult, EventStore, LogRead, TaskEvent, Tombstone } from './types.js';
export declare class MemoryEventStore implements EventStore {
    private readonly tasks;
    readLog(taskId: string, opts?: {
        afterSeq?: number;
    }): Promise<LogRead>;
    append(event: TaskEvent): Promise<'appended' | 'conflict'>;
    listTaskIds(): Promise<string[]>;
    /** Nothing to pack in memory; verifies the events are the stored ones so the contract is still exercised. */
    compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult>;
    markPruned(tombstone: Tombstone): Promise<void>;
    withdrawTombstone(tombstone: Tombstone): Promise<void>;
    pinReference(parentId: string, childId: string, at: string): Promise<'pinned' | 'parent-pruned' | 'parent-missing'>;
    listReferences(parentId: string): Promise<Array<{
        childId: string;
        at: string;
    }>>;
    prune(tombstone: Tombstone): Promise<{
        removedFiles: number;
    }>;
}
//# sourceMappingURL=memory-store.d.ts.map