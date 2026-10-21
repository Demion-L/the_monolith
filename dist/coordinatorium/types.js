/**
 * COORDINATORIUM — deterministic project state management subsystem.
 *
 * This file defines the v0.1 state schema. Tactical Coordinatorium
 * (mission lifecycle) is implemented. Strategic Coordinatorium (product /
 * subsystem state) is reserved — `strategic.systems` exists in the schema
 * but nothing in this package writes to it yet.
 */
export const STATE_SCHEMA_VERSION = 2;
/**
 * The only prior schema version `state-keeper.ts` knows how to migrate
 * from. A v1 file has `tactical.missions` but no reliable
 * `tactical.checkpoints` (COORDINATORIUM-002 bumped the version precisely
 * so that a pre-002 binary — hardcoded to `STATE_SCHEMA_VERSION === 1` —
 * refuses to touch a v2 file instead of silently dropping its checkpoints
 * on its next read-modify-write cycle; see ADR-008's 2026-10-21
 * COORDINATORIUM-002 compatibility-fix addendum).
 */
export const LEGACY_SCHEMA_VERSION_V1 = 1;
export function createInitialState() {
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        revision: 0,
        strategic: { systems: {} },
        tactical: { missions: {}, checkpoints: {} },
    };
}
