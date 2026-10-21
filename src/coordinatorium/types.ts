/**
 * COORDINATORIUM — deterministic project state management subsystem.
 *
 * This file defines the v0.1 state schema. Tactical Coordinatorium
 * (mission lifecycle) is implemented. Strategic Coordinatorium (product /
 * subsystem state) is reserved — `strategic.systems` exists in the schema
 * but nothing in this package writes to it yet.
 */

export const STATE_SCHEMA_VERSION = 1;

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

export interface TacticalState {
  missions: Record<string, Mission>;
}

export interface CoordinatoriumState {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  revision: number;
  strategic: StrategicState;
  tactical: TacticalState;
}

export function createInitialState(): CoordinatoriumState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    revision: 0,
    strategic: { systems: {} },
    tactical: { missions: {} },
  };
}
