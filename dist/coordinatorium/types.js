/**
 * COORDINATORIUM — deterministic project state management subsystem.
 *
 * This file defines the v0.1 state schema. Tactical Coordinatorium
 * (mission lifecycle) is implemented. Strategic Coordinatorium (product /
 * subsystem state) is reserved — `strategic.systems` exists in the schema
 * but nothing in this package writes to it yet.
 */
/**
 * Current on-disk schema (BETA-020 Phase 2). Only this version is supported at
 * runtime: an older state file is reported as incompatible and never read,
 * migrated or overwritten implicitly. The one explicit way to bring a schema-2
 * file across is `monolith state adopt --upgrade-v2` (see adopt.ts).
 *
 * v3 over v2: `Mission.storyId` (optional). `Mission.owner` (optional, Autonomous Execution Discipline) is a
 * backward-compatible addition of the same kind: a file without it stays valid and is never re-interpreted,
 * so the schema version is unchanged. (An OLDER binary that rewrites the file drops `owner`; it cannot corrupt it.)
 */
export const STATE_SCHEMA_VERSION = 3;
/** The only older schema `monolith state adopt --upgrade-v2` can carry over (an explicit, one-off operation). */
export const UPGRADABLE_SCHEMA_VERSION_V2 = 2;
/** Same shape as the Story identity accepted by `monolith brief` (freshness.ts). */
export const STORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MAX_PREVIOUS_OWNERS = 10;
export function createInitialState() {
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        revision: 0,
        strategic: { systems: {} },
        tactical: { missions: {}, checkpoints: {} },
    };
}
