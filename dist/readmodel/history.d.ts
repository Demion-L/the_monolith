/**
 * `buildDevelopmentHistory(state)` — read-only history of Missions and Checkpoints (GOV-EVOLUTION Phase 3).
 *
 * Pure and deterministic. It reads the already-loaded `CoordinatoriumState` and adds nothing: no new
 * journal, no inferred checkpoints, no inferred Story links. It does not rely on `activeMissions`, so
 * finished missions and their checkpoints are visible. Output is bounded; a cut list says so.
 */
import type { CoordinatoriumState } from '../coordinatorium/types.js';
import type { DevelopmentHistory } from './types.js';
export declare const MAX_HISTORY_MISSIONS = 200;
export declare const MAX_HISTORY_CHECKPOINTS_PER_MISSION = 50;
export declare const MAX_HISTORY_RECENT = 10;
export declare function buildDevelopmentHistory(state: CoordinatoriumState | null): DevelopmentHistory;
//# sourceMappingURL=history.d.ts.map