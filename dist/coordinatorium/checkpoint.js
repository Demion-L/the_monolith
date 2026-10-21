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
import { mutateState, readState } from './state-keeper.js';
import { MissionNotFoundError, MissionNotActiveError, CheckpointNotFoundError, ValidationError } from './errors.js';
// `context` must not become an unbounded free-form blob (explicit
// requirement for this story) — every text field carries an explicit upper
// bound, enforced here at creation time. These are generous for a human/AI
// progress note but not unbounded.
const MAX_SUMMARY_LENGTH = 4000;
const MAX_CONTEXT_LENGTH = 4000;
const MAX_REMAINING_STEP_LENGTH = 500;
const MAX_REMAINING_STEPS = 50;
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function requireBoundedString(value, field, maxLength) {
    if (typeof value !== 'string') {
        throw new ValidationError(`"${field}" must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        throw new ValidationError(`"${field}" must be a non-empty string`);
    }
    if (trimmed.length > maxLength) {
        throw new ValidationError(`"${field}" must be at most ${maxLength} characters (got ${trimmed.length})`);
    }
    return trimmed;
}
/**
 * Derive the next per-mission checkpoint ordinal by scanning existing
 * checkpoint IDs for the given mission, inside the caller's locked
 * mutateState section — same pattern, same rationale, as mission.ts's
 * nextMissionId: no separate counter field, one source of truth, computed
 * atomically with the write so concurrent creators can never collide.
 */
function nextCheckpointId(checkpoints, missionId) {
    const re = new RegExp(`^${escapeRegExp(missionId)}-CKPT-(\\d+)$`);
    let max = 0;
    for (const id of Object.keys(checkpoints)) {
        const match = re.exec(id);
        if (match)
            max = Math.max(max, Number(match[1]));
    }
    return `${missionId}-CKPT-${String(max + 1).padStart(4, '0')}`;
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
export async function createCheckpoint(stateDir, missionId, input) {
    const summary = requireBoundedString(input.summary, 'summary', MAX_SUMMARY_LENGTH);
    const remainingStepsRaw = input.remainingSteps ?? [];
    if (!Array.isArray(remainingStepsRaw)) {
        throw new ValidationError('"remainingSteps" must be an array of strings');
    }
    if (remainingStepsRaw.length > MAX_REMAINING_STEPS) {
        throw new ValidationError(`"remainingSteps" must contain at most ${MAX_REMAINING_STEPS} items`);
    }
    const remainingSteps = remainingStepsRaw.map((s, i) => requireBoundedString(s, `remainingSteps[${i}]`, MAX_REMAINING_STEP_LENGTH));
    let context = null;
    if (input.context !== undefined && input.context !== null) {
        context = requireBoundedString(input.context, 'context', MAX_CONTEXT_LENGTH);
    }
    const { result } = await mutateState(stateDir, (draft) => {
        const mission = draft.tactical.missions[missionId];
        if (!mission)
            throw new MissionNotFoundError(missionId);
        if (mission.status !== 'in_progress') {
            throw new MissionNotActiveError(missionId, mission.status);
        }
        const id = nextCheckpointId(draft.tactical.checkpoints, missionId);
        const checkpoint = {
            id,
            missionId,
            createdAt: new Date().toISOString(),
            summary,
            remainingSteps,
            context,
        };
        draft.tactical.checkpoints[id] = checkpoint;
        return checkpoint;
    });
    return result;
}
/**
 * List a mission's checkpoints, oldest first. Never throws for an unknown
 * or checkpoint-less mission — returns `[]`, consistent with a purely
 * read-side filter over tactical.checkpoints (mirrors listMissions's
 * "no missions yet" behavior). Remains available for a finished mission —
 * only *creation* is gated on mission status.
 */
export async function listCheckpoints(stateDir, missionId) {
    const state = await readState(stateDir);
    return Object.values(state.tactical.checkpoints)
        .filter((c) => c.missionId === missionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
/**
 * Fetch a single checkpoint by id, regardless of its mission's current
 * status — reading history never stops working for a finished mission.
 */
export async function getCheckpoint(stateDir, id) {
    const state = await readState(stateDir);
    const checkpoint = state.tactical.checkpoints[id];
    if (!checkpoint)
        throw new CheckpointNotFoundError(id);
    return checkpoint;
}
