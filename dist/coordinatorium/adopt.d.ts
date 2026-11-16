/**
 * `monolith state adopt <source>` — explicitly make one chosen state file the
 * canonical state (BETA-020 Phase 2).
 *
 * What this is NOT: a merge, a "latest wins" heuristic, a migration framework or
 * a runtime adapter for old schemas. The user names the source; nothing else is
 * ever picked, combined or deleted.
 *
 * Without `apply` it is a preview and writes nothing. With `apply` it:
 *  1. re-validates source and destination under the state lock,
 *  2. keeps a byte-exact backup of an existing destination (a failed backup
 *     aborts before the destination is touched),
 *  3. publishes through the State Keeper's safe-write path,
 *  4. reads the result back and compares it,
 * and always leaves the source file where it was.
 *
 * Old data: a `schemaVersion: 2` source is accepted only with the explicit
 * `upgradeV2` option. That is the single, one-off path across the schema change
 * (v3 only adds the optional `Mission.storyId`, so the file is relabelled and
 * then validated by the ordinary current-schema validator). Anything else —
 * schema 1, unknown, corrupt — is refused.
 */
import { type StateFileInfo, type StateLocation } from './state-location.js';
import type { WriteWarning } from '../root/index.js';
export interface AdoptOptions {
    /** Actually write. Without it this is a preview. */
    apply: boolean;
    /** Accept a `schemaVersion: 2` source and carry it to the current schema. */
    upgradeV2: boolean;
    onWarning?: (w: WriteWarning) => void;
}
export interface AdoptPlan {
    sourcePath: string;
    source: StateFileInfo;
    destinationPath: string;
    destination: StateFileInfo;
    /** `v2-to-v3` when the source is relabelled; `none` when it already is the current schema. */
    upgrade: 'none' | 'v2-to-v3';
    /** Revision the adopted state will carry: max(source, destination) + 1, so a reader never sees it go backwards. */
    resultingRevision: number | null;
    /** Blocking: `apply` is refused while any exist. */
    conflicts: string[];
    /** Not blocking, but the user should know before applying. */
    warnings: string[];
    actions: string[];
    canApply: boolean;
}
export interface AdoptResult {
    plan: AdoptPlan;
    applied: boolean;
    backupPath: string | null;
}
/** Build the preview. Reads only. */
export declare function planAdoption(loc: StateLocation, sourceArg: string, options: Pick<AdoptOptions, 'upgradeV2'>, cwd?: string): AdoptPlan;
/** Preview, and (with `apply`) adopt. A refused plan throws `StateAdoptError` only when `apply` was requested. */
export declare function adoptState(loc: StateLocation, sourceArg: string, options: AdoptOptions, cwd?: string): Promise<AdoptResult>;
/** Lines for the CLI. */
export declare function formatPlan(plan: AdoptPlan, applied: boolean, backupPath: string | null): string[];
//# sourceMappingURL=adopt.d.ts.map