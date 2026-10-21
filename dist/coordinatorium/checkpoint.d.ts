/**
 * Tactical Coordinatorium — Mission Checkpoints (COORDINATORIUM-002).
 *
 * A Checkpoint is a durable, append-only progress note belonging to exactly
 * one Mission. This module owns checkpoint semantics (ID generation,
 * validation, the "only an active mission may be checkpointed" rule) —
 * state-keeper.ts owns persistence and schema shape, exactly mirroring the
 * mission.ts / state-keeper.ts split established in ADR-008.
 *
 * API surface is deliberately append-only: `createCheckpoint`,
 * `listCheckpoints`, `getCheckpoint`. There is no update or delete path —
 * once written, a checkpoint record never changes.
 */
import type { Checkpoint } from './types.js';
export interface CreateCheckpointInput {
    summary: string;
    remainingSteps?: string[];
    context?: string | null;
}
/**
 * Append a checkpoint to an existing, in_progress mission. Validation
 * happens before the lock is taken (pure input checks); the
 * mission-existence check, the active-status check, and the ID derivation
 * all happen inside the same mutateState critical section as the write, so
 * two concurrent calls for the same mission can never collide on an ID or
 * lose an update — a direct consequence of reusing mutateState, not new
 * concurrency design.
 */
export declare function createCheckpoint(stateDir: string, missionId: string, input: CreateCheckpointInput): Promise<Checkpoint>;
/**
 * List a mission's checkpoints, oldest first. Never throws for an unknown
 * or checkpoint-less mission — returns `[]`, consistent with a purely
 * read-side filter over tactical.checkpoints (mirrors listMissions's
 * "no missions yet" behavior). Remains available for a finished mission —
 * only *creation* is gated on mission status.
 */
export declare function listCheckpoints(stateDir: string, missionId: string): Promise<Checkpoint[]>;
/**
 * Fetch a single checkpoint by id, regardless of its mission's current
 * status — reading history never stops working for a finished mission.
 */
export declare function getCheckpoint(stateDir: string, id: string): Promise<Checkpoint>;
//# sourceMappingURL=checkpoint.d.ts.map