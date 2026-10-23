export type {
  CoordinatoriumState,
  StrategicState,
  TacticalState,
  Mission,
  MissionStatus,
  MissionResult,
  Checkpoint,
} from './types.js';
export { STATE_SCHEMA_VERSION, createInitialState } from './types.js';

export {
  CoordinatoriumError,
  StateCorruptedError,
  StateSchemaError,
  LockTimeoutError,
  LockUnsafeError,
  StateFileError,
  MissionNotFoundError,
  InvalidTransitionError,
  ValidationError,
  MissionNotActiveError,
  CheckpointNotFoundError,
} from './errors.js';
export type { CoordinatoriumErrorCode } from './errors.js';

export {
  readState,
  mutateState,
  validateState,
  stateFilePath,
  STATE_FILE_NAME,
  MAX_STATE_BYTES,
  projectTarget,
  trustedDirectoryTarget,
} from './state-keeper.js';
export type { StateWriteTarget, StateReadTarget } from './state-keeper.js';
export { startMission, listMissions, getMission, finishMission } from './mission.js';
export type { StartMissionInput, FinishMissionInput } from './mission.js';
export { createCheckpoint, listCheckpoints, getCheckpoint } from './checkpoint.js';
export type { CreateCheckpointInput } from './checkpoint.js';
