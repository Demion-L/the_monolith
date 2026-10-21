/**
 * Tactical Coordinatorium — mission lifecycle.
 *
 * A mission is a unit of development work tracked across AI sessions.
 * This module owns mission semantics (ID generation, valid transitions);
 * state-keeper.ts owns persistence and never knows what a mission is.
 */
import type { Mission, MissionResult } from './types.js';
export interface StartMissionInput {
    title: string;
    system: string;
}
/**
 * Register a new mission as in_progress. ID generation happens inside the
 * same locked critical section as the write, so concurrent `start` calls
 * from independent processes can never collide on an ID.
 */
export declare function startMission(stateDir: string, input: StartMissionInput): Promise<Mission>;
export declare function listMissions(stateDir: string): Promise<Mission[]>;
export declare function getMission(stateDir: string, id: string): Promise<Mission>;
export interface FinishMissionInput {
    result: MissionResult;
    summary?: string | null;
}
/**
 * Transition a mission from in_progress to a terminal state. Any other
 * starting status (already completed/failed/cancelled) is rejected — once
 * terminal, a mission's lifecycle is closed.
 */
export declare function finishMission(stateDir: string, id: string, input: FinishMissionInput): Promise<Mission>;
//# sourceMappingURL=mission.d.ts.map