/**
 * Stores with test seams. INTERNAL: not exported from `index.ts`, so not part of the published API (see `seams.ts`).
 */
import { FsEventStore, type FsStoreOptions } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { type FsStoreSeams, type MemoryStoreSeams } from './seams.js';
export type { FsStoreSeams, MemoryStoreSeams };
export type FsStoreInternalOptions = FsStoreOptions & FsStoreSeams;
export declare function createFsStoreWithSeams(opts: FsStoreInternalOptions): FsEventStore;
export declare function createMemoryStoreWithSeams(seams?: MemoryStoreSeams): MemoryEventStore;
//# sourceMappingURL=testing.d.ts.map