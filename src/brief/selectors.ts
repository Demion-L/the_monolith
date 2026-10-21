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
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function selectActiveMissions(state: CoordinatoriumState): Mission[] {
  return Object.values(state.tactical.missions)
    .filter((m) => m.status === 'in_progress')
    .sort((a, b) => compareStrings(a.startedAt, b.startedAt) || compareStrings(a.id, b.id));
}

/**
 * Finished missions (completed/failed/cancelled), most recently updated
 * first, capped to `limit`. Used for the P2 "last finished missions" slice.
 */
export function selectRecentFinishedMissions(state: CoordinatoriumState, limit: number): Mission[] {
  return Object.values(state.tactical.missions)
    .filter((m) => m.status !== 'in_progress')
    .sort((a, b) => compareStrings(b.updatedAt, a.updatedAt) || compareStrings(b.id, a.id))
    .slice(0, limit);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All checkpoints belonging to one mission, in no particular order. */
function checkpointsForMission(state: CoordinatoriumState, missionId: string): Checkpoint[] {
  return Object.values(state.tactical.checkpoints).filter((c) => c.missionId === missionId);
}

/**
 * The checkpoint with the highest numeric ordinal in its id
 * (`<missionId>-CKPT-NNNN`) — the monotonic per-mission sequence number,
 * exactly as nextCheckpointId() in checkpoint.ts derives it — NOT the one
 * with the latest `createdAt` (section 6 of the brief contract: ID order is
 * authoritative, timestamps are not). Returns null if the mission has no
 * checkpoints.
 */
export function selectLatestCheckpoint(state: CoordinatoriumState, missionId: string): Checkpoint | null {
  const re = new RegExp(`^${escapeRegExp(missionId)}-CKPT-(\\d+)$`);
  let best: { checkpoint: Checkpoint; ordinal: number } | null = null;
  for (const c of checkpointsForMission(state, missionId)) {
    const match = re.exec(c.id);
    const ordinal = match ? Number(match[1]) : -1;
    if (!best || ordinal > best.ordinal || (ordinal === best.ordinal && compareStrings(c.id, best.checkpoint.id) < 0)) {
      best = { checkpoint: c, ordinal };
    }
  }
  return best?.checkpoint ?? null;
}

/**
 * True if some other checkpoint for this mission has a strictly later
 * `createdAt` than the one selectLatestCheckpoint() picked by ID ordinal —
 * i.e. timestamps and ID order disagree about which checkpoint is "latest".
 * Purely informational (CHECKPOINT_ORDER_MISMATCH), never changes which
 * checkpoint is reported.
 */
export function hasCheckpointOrderMismatch(state: CoordinatoriumState, missionId: string, latest: Checkpoint): boolean {
  for (const c of checkpointsForMission(state, missionId)) {
    if (c.id === latest.id) continue;
    if (compareStrings(c.createdAt, latest.createdAt) > 0) return true;
  }
  return false;
}
