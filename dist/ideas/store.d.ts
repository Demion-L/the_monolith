/**
 * Idea store (IDEA-001A): one Markdown file per idea in `<monolithRoot>/memory/long-term/ideas/`.
 *
 * - Writes go through the safe-write primitive in `src/root/` (PROJECT scope:
 *   a symlink anywhere below the project root is refused; the file is created
 *   exclusively via `link()`, so an existing file is never overwritten).
 * - Reads go through the unified bounded reader (`readBoundedFile`).
 * - Ids are allocated by exclusive creation, not by trusting a counter: the
 *   next number is only a candidate, and a lost race (`WRITE_TARGET_EXISTS`)
 *   re-scans and tries again. Two processes can therefore never publish the same id.
 *
 * Not defended: a local actor swapping directories concurrently (SEC-001B.3,
 * TM-C unsupported). Ids are not reused while their file exists; if a person
 * deletes the highest-numbered file, its number can be handed out again
 * (archive an idea with `status: archived` instead of deleting it).
 */
import { type WriteBoundary, type WriteWarning } from '../root/index.js';
import type { FsOps } from '../root/index.js';
import { type Idea, type IdeaEntry, type NewIdea } from './types.js';
export interface IdeaStore {
    projectRoot: string;
    rootAbs: string;
    dirAbs: string;
    boundary: WriteBoundary;
}
/** Resolve (and contain) the ideas directory of the instance rooted at `targetDir`. */
export declare function ideaStore(targetDir: string): IdeaStore;
export interface AddIdeaOptions {
    /** Clock seam for tests. */
    now?: () => Date;
    /** Fault-injection seam for tests (forwarded to the safe-write primitive). */
    ops?: Partial<FsOps>;
    /** Receives post-publication findings (the idea IS saved when these fire). */
    onWarning?: (w: WriteWarning) => void;
}
export interface AddIdeaResult {
    idea: Idea;
    path: string;
}
export declare function addIdea(store: IdeaStore, input: NewIdea, opts?: AddIdeaOptions): AddIdeaResult;
/** Read one idea. Throws IDEA_INVALID_ID / IDEA_NOT_FOUND / IDEA_UNSAFE_PATH / IDEA_CORRUPT. Never writes. */
export declare function getIdea(store: IdeaStore, id: string): Idea;
/**
 * All ideas, ordered by number. A file that cannot be read as an idea appears as
 * a non-ok entry instead of aborting the listing. A symlinked ideas directory
 * is refused as a whole. Never writes.
 */
export declare function listIdeas(store: IdeaStore): IdeaEntry[];
//# sourceMappingURL=store.d.ts.map