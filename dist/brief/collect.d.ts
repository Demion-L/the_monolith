/**
 * `collect()` — the read-only Collection stage of the brief pipeline.
 *
 * readMonolithRoot → collect() → BriefModel → render(model, budget) → stdout
 *
 * Strictly read-only: no directories, lock files, or state.json are ever
 * created; `mutateState()` is never imported here. state.json is read at
 * most once (one `readFile` call) per invocation — every section that needs
 * Coordinatorium data derives it from that single snapshot via the pure
 * selectors in selectors.ts, never by calling `listMissions()`/
 * `listCheckpoints()` (which each independently re-read the file).
 */
import type { BriefModel } from './types.js';
/** SEC-001B.1: `active.md` is a short hand-written context file (~3 KB today). */
export declare const MAX_ACTIVE_CONTEXT_BYTES: number;
export declare function collect(targetDir: string): Promise<BriefModel>;
//# sourceMappingURL=collect.d.ts.map