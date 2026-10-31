/**
 * `monolith update` (DX-UPDATE-001): bring an existing instance up to the
 * Idea Capture & Recall infrastructure without touching project memory.
 *
 * Contract (see docs/reference/cli.md → `monolith update`):
 *  - No template version is stored in an instance, so components are detected
 *    by content (does the file already carry the Idea Capture wiring?).
 *  - The only thing `--apply` ever does is CREATE a missing, MONOLITH-owned
 *    file (the `idea-capture` skill). Nothing that exists is overwritten,
 *    appended to or rewritten — mixed files (CLAUDE.md, AGENTS.md, routing-map,
 *    skills index) are reported as CONFLICT with the exact text to add.
 *  - Writes go through the safe-write primitive (project boundary, no symlinks,
 *    exclusive create). Reads use the unified bounded safe read. Not
 *    transactional and not coordinated between processes (SEC-001B.3); a
 *    re-run is the recovery.
 */
import { RootContainmentError, type WriteWarning } from '../root/index.js';
export type UpdateAction = 'ADD' | 'UNCHANGED' | 'CONFLICT' | 'SKIP';
export interface UpdateItem {
    /** Path relative to the project root, `/`-separated. */
    path: string;
    action: UpdateAction;
    /** Why, in one line. */
    reason: string;
    /** For CONFLICT: the text the user needs to add by hand. */
    proposal?: string;
    /** For ADD: what will be created. */
    content?: string;
}
export interface UpdatePlan {
    monolithRoot: string;
    items: UpdateItem[];
}
/**
 * Read-only. Throws RootContainmentError when the root/config is unusable and
 * `Error` when the directory is not a MONOLITH instance.
 */
export declare function planUpdate(target: string): UpdatePlan;
/** Integration is complete only when nothing is left to add or to resolve by hand. */
export declare function integrationComplete(plan: UpdatePlan): boolean;
export interface ApplyResult {
    created: string[];
    warnings: WriteWarning[];
}
/** Create every ADD item, exclusively. Stops at the first failure (earlier files stay; re-running continues). */
export declare function applyPlan(target: string, plan: UpdatePlan): ApplyResult;
export { RootContainmentError };
//# sourceMappingURL=index.d.ts.map