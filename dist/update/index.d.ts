/**
 * `monolith update` (DX-UPDATE-001/003): bring an existing instance up to the
 * current agent integration (stable `AGENT.md` entry point, Idea Capture)
 * without touching project memory.
 *
 * Ownership model (no template version is stored in an instance, so state is
 * read from the files themselves):
 *  - MONOLITH-owned, created when absent: `<root>/AGENT.md`, the `idea-capture`
 *    skill. An existing skill is never overwritten, whatever it contains.
 *  - `finalize-story` skill (DOGFOOD-002): created when absent; replaced ONLY when
 *    it is byte-identical to a known older MONOLITH template (sha256 list in
 *    legacy-skills.ts), so nothing of the user's is lost. A customized one is
 *    never replaced: without the `finalize plan` / `finalize apply` contract it
 *    is a CONFLICT (possible contract drift), with it a SKIP. Its content is
 *    only classified, never trusted as authority and never executed.
 *  - Mixed (user-owned file + MONOLITH text): CLAUDE.md / AGENTS.md /
 *    .cursorrules / .windsurfrules, routing-map, skills index. MONOLITH text
 *    lives only in checksummed managed blocks (src/managed). A missing block is
 *    appended; an unedited block is refreshed in place; an edited, malformed or
 *    competing one is a CONFLICT and nothing is written. Bytes outside a block
 *    are never changed (asserted before every write).
 *  - User memory (state.json, memory/, ideas): never touched.
 *
 * Reads use the bounded safe read; writes use the safe-write primitives
 * (project boundary, no symlinks, exclusive create / atomic replace). Update is
 * not transactional and not coordinated between processes (SEC-001B.3): apply
 * re-plans just before writing and refuses a change whose preconditions moved;
 * a re-run is the recovery. Nothing is executed and no user text is interpreted
 * as code.
 */
import { RootContainmentError, type WriteWarning } from '../root/index.js';
export type UpdateAction = 'ADD' | 'UPDATE' | 'UNCHANGED' | 'CONFLICT' | 'SKIP';
export interface UpdateItem {
    /** Path relative to the project root, `/`-separated. */
    path: string;
    action: UpdateAction;
    /** Why, in one line. */
    reason: string;
    /** For CONFLICT: how to resolve it by hand. */
    proposal?: string;
    /** For ADD / UPDATE: the complete file content to write. */
    content?: string;
    /** For UPDATE: sha256 of the file as planned against; apply refuses if it moved. */
    before?: string;
    /** For ADD / UPDATE: what it makes available. */
    effect?: string;
}
/** One link of Agent Instructions → Routing → Skill → CLI → Storage. */
export interface ChainCheck {
    link: string;
    ok: boolean;
    detail: string;
}
export interface UpdatePlan {
    monolithRoot: string;
    items: UpdateItem[];
    chain: ChainCheck[];
}
/**
 * Read-only. Throws RootContainmentError when the root/config is unusable and
 * `Error` when the directory is not a MONOLITH instance.
 */
export declare function planUpdate(target: string): UpdatePlan;
/**
 * "Complete" is a structural statement: every managed component is installed,
 * unedited-or-current, and the static chain checks out. It says nothing about
 * what an AI model will do with the text. Integration is complete only when nothing is left to add, change or resolve AND every link of the chain checks out. */
export declare function integrationComplete(plan: UpdatePlan): boolean;
export interface ApplyResult {
    created: string[];
    updated: string[];
    /** Planned changes not applied because the file changed since planning (or could not be written). */
    stale: string[];
    warnings: WriteWarning[];
}
/**
 * Write every ADD and UPDATE of `plan`. The tree is re-planned first and an
 * item is applied only if the file is exactly as planned: an `ADD` target that
 * appeared is skipped, an `UPDATE` whose file changed is reported as stale and
 * left alone. Stops at the first write failure (earlier files stay; re-run).
 */
export declare function applyPlan(target: string, plan: UpdatePlan): ApplyResult;
export { RootContainmentError };
//# sourceMappingURL=index.d.ts.map