/**
 * Stores with test seams. INTERNAL: not exported from `index.ts`, so not part of the published API (see `seams.ts`).
 */
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { handOver, takeFsSeams, takeMemorySeams } from './seams.js';
export function createFsStoreWithSeams(opts) {
    const { ops, beforePublish, afterListing, earlyPruneCheck, maxPruneAttempts, registerListing, skipPrunePrecondition, readFault, ...pub } = opts;
    handOver('fs', { ops, beforePublish, afterListing, earlyPruneCheck, maxPruneAttempts, registerListing, skipPrunePrecondition, readFault });
    try {
        return new FsEventStore(pub);
    }
    finally {
        takeFsSeams(); // an unused hand-over never leaks into the next constructor call
    }
}
export function createMemoryStoreWithSeams(seams = {}) {
    handOver('memory', seams);
    try {
        return new MemoryEventStore();
    }
    finally {
        takeMemorySeams();
    }
}
