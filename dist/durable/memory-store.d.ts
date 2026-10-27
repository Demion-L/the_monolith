/**
 * In-memory `EventStore`. For tests of application logic built on Durable
 * State and for embedding where durability is not wanted. It implements the
 * same contract as the filesystem store (the shared conformance suite runs
 * against both), including the prune decision register (ADR-019) and the
 * canonical-input rules of compaction (Design A, section 40), but nothing
 * survives the process. There is no version marker: it belongs to the
 * filesystem layout.
 */
import type { AppendOutcome, CompactionResult, DecisionBy, EventStore, LogRead, PruneOutcome, PruneState, TaskEvent, Tombstone } from './types.js';
export interface MemoryStoreOptions {
    /** @internal lowers `MAX_PRUNE_ATTEMPTS` so a test need not write a thousand attempts. */
    maxPruneAttempts?: number;
}
export declare class MemoryEventStore implements EventStore {
    private readonly tasks;
    private readonly maxAttempts;
    constructor(opts?: MemoryStoreOptions);
    private derive;
    private refusal;
    pruneState(taskId: string): Promise<PruneState>;
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
    /** G2 (section 24.2): the register is asked AFTER a write became visible; nothing visible is ever taken back. */
    private settle;
    readLog(taskId: string, opts?: {
        afterSeq?: number;
        rawEvents?: boolean;
    }): Promise<LogRead>;
    append(event: TaskEvent): Promise<AppendOutcome>;
    listTaskIds(): Promise<string[]>;
    /**
     * Nothing to pack in memory. The input is still checked against the canonical log exactly as the filesystem store checks
     * it (CC-1, CC-2): every event must equal the stored one byte for byte, and a slot that has no stored event is refused.
     */
    compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult>;
    pinReference(parentId: string, childId: string, at: string): Promise<'pinned' | 'parent-pruned' | 'parent-missing'>;
    listReferences(parentId: string): Promise<Array<{
        childId: string;
        at: string;
    }>>;
}
//# sourceMappingURL=memory-store.d.ts.map