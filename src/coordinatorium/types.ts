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
 * v3 over v2: `Mission.storyId` (optional).
 */
export const STATE_SCHEMA_VERSION = 3;

/** The only older schema `monolith state adopt --upgrade-v2` can carry over (an explicit, one-off operation). */
export const UPGRADABLE_SCHEMA_VERSION_V2 = 2;

/** Same shape as the Story identity accepted by `monolith brief` (freshness.ts). */
export const STORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
  /**
   * Optional link to a Story (v3). Only the identifier's format is checked: the
   * Story need not exist, and it is never inferred from the title or from the
   * current Story.
   */
  storyId?: string;
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
  /** Sibling top-level map to `missions` (ADR-008). Required in the current schema. */
  checkpoints: Record<string, Checkpoint>;
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
    tactical: { missions: {}, checkpoints: {} },
  };
}
