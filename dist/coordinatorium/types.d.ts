/**
 * COORDINATORIUM — deterministic project state management subsystem.
 *
 * This file defines the v0.1 state schema. Tactical Coordinatorium
 * (mission lifecycle) is implemented. Strategic Coordinatorium (product /
 * subsystem state) is reserved — `strategic.systems` exists in the schema
 * but nothing in this package writes to it yet.
 */
export declare const STATE_SCHEMA_VERSION = 2;
/**
 * The only prior schema version `state-keeper.ts` knows how to migrate
 * from. A v1 file has `tactical.missions` but no reliable
 * `tactical.checkpoints` (COORDINATORIUM-002 bumped the version precisely
 * so that a pre-002 binary — hardcoded to `STATE_SCHEMA_VERSION === 1` —
 * refuses to touch a v2 file instead of silently dropping its checkpoints
 * on its next read-modify-write cycle; see ADR-008's 2026-10-21
 * COORDINATORIUM-002 compatibility-fix addendum).
 */
export declare const LEGACY_SCHEMA_VERSION_V1 = 1;
export type MissionStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type MissionResult = Exclude<MissionStatus, 'in_progress'>;
export interface Mission {
    id: string;
    title: string;
    system: string;
    status: MissionStatus;
    startedAt: string;
    updatedAt: string;
    summary: string | null;
}
/** Reserved for the Strategic Coordinatorium. No mutations in v0.1. */
export interface StrategicState {
    systems: Record<string, unknown>;
}
/**
 * A durable, append-only progress note attached to exactly one Mission
 * (COORDINATORIUM-002). Checkpoints are never updated or deleted once
 * created — `id` and `createdAt` are stamped by the keeper, never
 * caller-supplied, exactly like `Mission.id`/`startedAt`.
 */
export interface Checkpoint {
    id: string;
    missionId: string;
    createdAt: string;
    summary: string;
    remainingSteps: string[];
    context: string | null;
}
export interface TacticalState {
    missions: Record<string, Mission>;
    /**
     * Sibling top-level map to `missions`, not nested inside `Mission` — see
     * ADR-008's 2026-10-21 Mission Checkpoints addendum. Required for
     * `schemaVersion: 2` (the current, in-memory shape returned by
     * `validateState`/`readState` — every v2 writer always includes it).
     * A `schemaVersion: 1` file on disk may be missing this key entirely;
     * `state-keeper.ts`'s v1→v2 migration defaults it to `{}` on read. See
     * `LEGACY_SCHEMA_VERSION_V1`.
     */
    checkpoints: Record<string, Checkpoint>;
}
export interface CoordinatoriumState {
    schemaVersion: typeof STATE_SCHEMA_VERSION;
    revision: number;
    strategic: StrategicState;
    tactical: TacticalState;
}
export declare function createInitialState(): CoordinatoriumState;
//# sourceMappingURL=types.d.ts.map