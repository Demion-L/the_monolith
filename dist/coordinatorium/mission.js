/**
 * Tactical Coordinatorium — mission lifecycle.
 *
 * A mission is a unit of development work tracked across AI sessions.
 * This module owns mission semantics (ID generation, valid transitions);
 * state-keeper.ts owns persistence and never knows what a mission is.
 */
import { mutateState, readState } from './state-keeper.js';
import { MissionNotFoundError, InvalidTransitionError, ValidationError } from './errors.js';
const MISSION_ID_RE = /^MIS-(\d+)$/;
const MISSION_RESULTS = ['completed', 'failed', 'cancelled'];
function nextMissionId(missions) {
    let max = 0;
    for (const id of Object.keys(missions)) {
        const match = MISSION_ID_RE.exec(id);
        if (match)
            max = Math.max(max, Number(match[1]));
    }
    return `MIS-${String(max + 1).padStart(4, '0')}`;
}
function requireNonEmptyString(value, field) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        throw new ValidationError(`"${field}" must be a non-empty string`);
    }
    return trimmed;
}
/**
 * Register a new mission as in_progress. ID generation happens inside the
 * same locked critical section as the write, so concurrent `start` calls
 * from independent processes can never collide on an ID.
 */
export async function startMission(stateDir, input) {
    const title = requireNonEmptyString(input.title, 'title');
    const system = requireNonEmptyString(input.system, 'system');
    const { result } = await mutateState(stateDir, (draft) => {
        const id = nextMissionId(draft.tactical.missions);
        const now = new Date().toISOString();
        const mission = {
            id,
            title,
            system,
            status: 'in_progress',
            startedAt: now,
            updatedAt: now,
            summary: null,
        };
        draft.tactical.missions[id] = mission;
        return mission;
    });
    return result;
}
export async function listMissions(stateDir) {
    const state = await readState(stateDir);
    return Object.values(state.tactical.missions).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
export async function getMission(stateDir, id) {
    const state = await readState(stateDir);
    const mission = state.tactical.missions[id];
    if (!mission)
        throw new MissionNotFoundError(id);
    return mission;
}
/**
 * Transition a mission from in_progress to a terminal state. Any other
 * starting status (already completed/failed/cancelled) is rejected — once
 * terminal, a mission's lifecycle is closed.
 */
export async function finishMission(stateDir, id, input) {
    if (!MISSION_RESULTS.includes(input.result)) {
        throw new ValidationError(`"result" must be one of ${MISSION_RESULTS.join(', ')}, got "${String(input.result)}"`);
    }
    const { result } = await mutateState(stateDir, (draft) => {
        const mission = draft.tactical.missions[id];
        if (!mission)
            throw new MissionNotFoundError(id);
        if (mission.status !== 'in_progress') {
            throw new InvalidTransitionError(`Mission "${id}" is already "${mission.status}" and cannot transition to "${input.result}"`);
        }
        mission.status = input.result;
        mission.updatedAt = new Date().toISOString();
        if (input.summary !== undefined)
            mission.summary = input.summary;
        return mission;
    });
    return result;
}
