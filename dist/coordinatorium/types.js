/**
 * COORDINATORIUM — deterministic project state management subsystem.
 *
 * This file defines the v0.1 state schema. Tactical Coordinatorium
 * (mission lifecycle) is implemented. Strategic Coordinatorium (product /
 * subsystem state) is reserved — `strategic.systems` exists in the schema
 * but nothing in this package writes to it yet.
 */
export const STATE_SCHEMA_VERSION = 1;
export function createInitialState() {
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        revision: 0,
        strategic: { systems: {} },
        tactical: { missions: {} },
    };
}
