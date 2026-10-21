/**
 * Pure, read-only selectors over an already-loaded CoordinatoriumState.
 *
 * `listMissions()`/`listCheckpoints()` in mission.ts/checkpoint.ts each call
 * `readState()` independently, which would mean re-reading state.json once
 * per section of a brief. Collect-brief reads state.json exactly once (see
 * collect.ts) and derives everything else from that single snapshot through
 * these selectors instead.
 */
import type { CoordinatoriumState, Mission, Checkpoint } from '../coordinatorium/types.js';
/** Stable, locale-independent string comparator (never localeCompare — ADR determinism rule). */
export declare function compareStrings(a: string, b: string): number;
export declare function selectActiveMissions(state: CoordinatoriumState): Mission[];
/**
 * Finished missions (completed/failed/cancelled), most recently updated
 * first, capped to `limit`. Used for the P2 "last finished missions" slice.
 */
export declare function selectRecentFinishedMissions(state: CoordinatoriumState, limit: number): Mission[];
/**
 * The checkpoint with the highest numeric ordinal in its id
 * (`<missionId>-CKPT-NNNN`) — the monotonic per-mission sequence number,
 * exactly as nextCheckpointId() in checkpoint.ts derives it — NOT the one
 * with the latest `createdAt` (section 6 of the brief contract: ID order is
 * authoritative, timestamps are not). Returns null if the mission has no
 * checkpoints.
 */
export declare function selectLatestCheckpoint(state: CoordinatoriumState, missionId: string): Checkpoint | null;
/**
 * True if some other checkpoint for this mission has a strictly later
 * `createdAt` than the one selectLatestCheckpoint() picked by ID ordinal —
 * i.e. timestamps and ID order disagree about which checkpoint is "latest".
 * Purely informational (CHECKPOINT_ORDER_MISMATCH), never changes which
 * checkpoint is reported.
 */
export declare function hasCheckpointOrderMismatch(state: CoordinatoriumState, missionId: string, latest: Checkpoint): boolean;
//# sourceMappingURL=selectors.d.ts.map