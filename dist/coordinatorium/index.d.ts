export type { CoordinatoriumState, StrategicState, TacticalState, Mission, MissionStatus, MissionResult, } from './types.js';
export { STATE_SCHEMA_VERSION, createInitialState } from './types.js';
export { CoordinatoriumError, StateCorruptedError, StateSchemaError, LockTimeoutError, MissionNotFoundError, InvalidTransitionError, ValidationError, } from './errors.js';
export type { CoordinatoriumErrorCode } from './errors.js';
export { readState, mutateState, validateState, stateFilePath, STATE_FILE_NAME } from './state-keeper.js';
export { startMission, listMissions, getMission, finishMission } from './mission.js';
export type { StartMissionInput, FinishMissionInput } from './mission.js';
//# sourceMappingURL=index.d.ts.map