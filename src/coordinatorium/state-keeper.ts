/**
 * State Keeper — the single point of read/write access to state.json.
 *
 * Guarantees:
 * - Atomic persistence: writes land via write-temp-then-rename, so a reader
 *   never observes a partially written file.
 * - No lost updates: every mutation runs inside a cross-process lock (see
 *   lock.ts), read-modify-write, with a monotonic revision bump.
 * - Never silently overwrites corrupted or unsupported state: malformed
 *   JSON or a schema mismatch throws before anything is written.
 *
 * AI reports state; this module validates and persists it. It has no
 * knowledge of what a "mission" is — that belongs to mission.ts.
 */

import { writeFile, rename, unlink } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { acquireLock, type LockOptions } from './lock.js';
import { StateCorruptedError, StateSchemaError, StateFileError } from './errors.js';
import { readBoundedFileStable } from '../root/index.js';
import {
  STATE_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION_V1,
  createInitialState,
  type CoordinatoriumState,
  type Mission,
  type MissionStatus,
  type Checkpoint,
} from './types.js';

export const STATE_FILE_NAME = 'state.json';

/**
 * Protective ceiling for `state.json` (SEC-001B.1) — NOT a retention policy.
 * Append-only checkpoints grow the file without bound; see STATE-001.
 * Enforced on read (bounded reader) and before an atomic write.
 */
export const MAX_STATE_BYTES = 16 * 1024 * 1024;

export function stateFilePath(stateDir: string): string {
  return join(stateDir, STATE_FILE_NAME);
}

function lockFilePath(stateDir: string): string {
  return `${stateFilePath(stateDir)}.lock`;
}

const MISSION_STATUSES: readonly MissionStatus[] = ['in_progress', 'completed', 'failed', 'cancelled'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateMission(id: string, raw: unknown): Mission {
  if (!isPlainObject(raw)) {
    throw new StateSchemaError(`Mission "${id}" is not an object`);
  }
  const { title, system, status, startedAt, updatedAt, summary } = raw;
  if (raw.id !== id) {
    throw new StateSchemaError(`Mission "${id}" has mismatched id field "${String(raw.id)}"`);
  }
  if (typeof title !== 'string' || title.length === 0) {
    throw new StateSchemaError(`Mission "${id}" has an invalid title`);
  }
  if (typeof system !== 'string' || system.length === 0) {
    throw new StateSchemaError(`Mission "${id}" has an invalid system`);
  }
  if (typeof status !== 'string' || !MISSION_STATUSES.includes(status as MissionStatus)) {
    throw new StateSchemaError(`Mission "${id}" has an invalid status "${String(status)}"`);
  }
  if (typeof startedAt !== 'string') {
    throw new StateSchemaError(`Mission "${id}" has an invalid startedAt`);
  }
  if (typeof updatedAt !== 'string') {
    throw new StateSchemaError(`Mission "${id}" has an invalid updatedAt`);
  }
  if (summary !== null && typeof summary !== 'string') {
    throw new StateSchemaError(`Mission "${id}" has an invalid summary`);
  }
  return { id, title, system, status: status as MissionStatus, startedAt, updatedAt, summary };
}

function validateCheckpoint(id: string, raw: unknown): Checkpoint {
  if (!isPlainObject(raw)) {
    throw new StateSchemaError(`Checkpoint "${id}" is not an object`);
  }
  const { missionId, createdAt, summary, remainingSteps, context } = raw;
  if (raw.id !== id) {
    throw new StateSchemaError(`Checkpoint "${id}" has mismatched id field "${String(raw.id)}"`);
  }
  if (typeof missionId !== 'string' || missionId.length === 0) {
    throw new StateSchemaError(`Checkpoint "${id}" has an invalid missionId`);
  }
  if (typeof createdAt !== 'string') {
    throw new StateSchemaError(`Checkpoint "${id}" has an invalid createdAt`);
  }
  if (typeof summary !== 'string' || summary.length === 0) {
    throw new StateSchemaError(`Checkpoint "${id}" has an invalid summary`);
  }
  if (!Array.isArray(remainingSteps) || !remainingSteps.every((s) => typeof s === 'string' && s.length > 0)) {
    throw new StateSchemaError(`Checkpoint "${id}" has an invalid remainingSteps`);
  }
  if (context !== null && typeof context !== 'string') {
    throw new StateSchemaError(`Checkpoint "${id}" has an invalid context`);
  }
  return {
    id,
    missionId,
    createdAt,
    summary,
    remainingSteps: [...(remainingSteps as string[])],
    context: (context as string | null) ?? null,
  };
}

/**
 * Validate the shape of parsed JSON and return a typed, defensively-copied
 * CoordinatoriumState. Throws StateSchemaError for anything that does not
 * match a supported schema version — this function never "fixes" or
 * partially accepts malformed state.
 *
 * Supports exactly two on-disk shapes:
 * - `schemaVersion: 2` (current) — `tactical.checkpoints` is required.
 * - `schemaVersion: 1` (legacy, pre-COORDINATORIUM-002) — migrated
 *   in-memory to v2 on read (see `migrateV1ToV2`). Anything else
 *   (including a *newer* version this binary doesn't know about) is
 *   rejected outright — this is the deliberate fix for the compatibility
 *   gap an independent review found in the first COORDINATORIUM-002 cut:
 *   that cut kept `schemaVersion` at 1 while adding `tactical.checkpoints`,
 *   so an *older* binary (hardcoded to `schemaVersion === 1`, with no
 *   notion of checkpoints) could read a checkpoint-bearing v1-tagged file,
 *   reconstruct state from only the fields it knew about (`tactical: {
 *   missions }`, dropping checkpoints entirely — this function has never
 *   been a passthrough for unknown fields), and silently overwrite the
 *   file on its next mutateState call, destroying checkpoint history with
 *   no error raised. Bumping to 2 converts that silent data loss into a
 *   loud, immediate `StateSchemaError` for any reader that doesn't
 *   understand v2 — the version check below runs before anything is ever
 *   read into a mutable draft, so mutateState never reaches its write step
 *   (same proven pattern as the existing corrupted-JSON guard).
 */
export function validateState(raw: unknown): CoordinatoriumState {
  if (!isPlainObject(raw)) {
    throw new StateSchemaError('State root is not an object');
  }
  if (raw.schemaVersion !== STATE_SCHEMA_VERSION && raw.schemaVersion !== LEGACY_SCHEMA_VERSION_V1) {
    throw new StateSchemaError(
      `Unsupported schemaVersion "${String(raw.schemaVersion)}" ` +
        `(expected ${STATE_SCHEMA_VERSION}, or legacy ${LEGACY_SCHEMA_VERSION_V1} for migration)`,
    );
  }
  if (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 0) {
    throw new StateSchemaError(`Invalid revision "${String(raw.revision)}"`);
  }
  if (!isPlainObject(raw.strategic) || !isPlainObject(raw.strategic.systems)) {
    throw new StateSchemaError('Invalid strategic.systems');
  }
  if (!isPlainObject(raw.tactical) || !isPlainObject(raw.tactical.missions)) {
    throw new StateSchemaError('Invalid tactical.missions');
  }

  const missions: Record<string, Mission> = {};
  for (const [id, m] of Object.entries(raw.tactical.missions)) {
    missions[id] = validateMission(id, m);
  }

  const rawCheckpoints = raw.tactical.checkpoints;
  const checkpoints: Record<string, Checkpoint> = {};
  if (raw.schemaVersion === LEGACY_SCHEMA_VERSION_V1) {
    // v1→v2 migration path: a genuine pre-COORDINATORIUM-002 file has no
    // `checkpoints` key at all — default to {}. Tolerate (and validate) one
    // being present anyway, defensively, in case a file was ever written by
    // the since-corrected transitional code that kept schemaVersion at 1
    // while already writing checkpoints — nothing is lost either way.
    if (rawCheckpoints !== undefined && !isPlainObject(rawCheckpoints)) {
      throw new StateSchemaError('Invalid tactical.checkpoints');
    }
    if (rawCheckpoints !== undefined) {
      for (const [id, c] of Object.entries(rawCheckpoints)) {
        checkpoints[id] = validateCheckpoint(id, c);
      }
    }
  } else {
    // schemaVersion === STATE_SCHEMA_VERSION (2): every v2 writer always
    // serializes tactical.checkpoints (even as {}), so its absence here is
    // itself a sign of a malformed/hand-edited file, not a legacy case —
    // required, not defaulted.
    if (!isPlainObject(rawCheckpoints)) {
      throw new StateSchemaError('Invalid tactical.checkpoints');
    }
    for (const [id, c] of Object.entries(rawCheckpoints)) {
      checkpoints[id] = validateCheckpoint(id, c);
    }
  }

  // Migration is applied purely in-memory here — revision and every
  // mission/checkpoint field are carried over exactly, only schemaVersion
  // is relabeled. No write happens during a read (same "reads are never a
  // side effect" rule as the missing-file case in readState below); the
  // migrated v2 shape is only ever persisted to disk the next time
  // mutateState's existing atomic read-modify-write cycle runs — no
  // separate migration-write path, no new on-disk mechanism.
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    revision: raw.revision,
    strategic: { systems: { ...raw.strategic.systems } },
    tactical: { missions, checkpoints },
  };
}

/**
 * Read current state without taking a lock. If the file does not exist,
 * returns a fresh initial state WITHOUT persisting it — read paths never
 * have the side effect of creating state.json. Corrupted JSON or an
 * unsupported schema throws rather than being silently replaced.
 */
export async function readState(stateDir: string): Promise<CoordinatoriumState> {
  const filePath = stateFilePath(stateDir);
  // Bounded, non-blocking read (a FIFO at this path cannot hang us); the
  // reader is synchronous and capped at MAX_STATE_BYTES.
  const read = readBoundedFileStable(filePath, `"${filePath}"`, { maxBytes: MAX_STATE_BYTES, allowEmpty: true }, true);
  if (!read.ok) {
    if (read.code === 'FILE_MISSING') return createInitialState();
    throw new StateFileError(read.code, read.detail);
  }
  const raw = 'content' in read ? read.content : '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StateCorruptedError(`"${filePath}" is not valid JSON: ${msg}`);
  }
  return validateState(parsed);
}

async function atomicWriteState(stateDir: string, state: CoordinatoriumState): Promise<void> {
  const filePath = stateFilePath(stateDir);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  // Refuse BEFORE creating the temp file: an oversized state.json would be
  // unreadable by readState, locking the project out of its own state. The
  // existing state.json is left untouched; nothing is compacted or dropped.
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_STATE_BYTES) {
    throw new StateFileError(
      'FILE_TOO_LARGE',
      `refusing to write "${filePath}": ${bytes} bytes exceeds the ${MAX_STATE_BYTES}-byte limit (see STATE-001); state was not modified.`,
    );
  }
  const tmpPath = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  await writeFile(tmpPath, serialized, 'utf8');
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

/**
 * Read-modify-write under an exclusive cross-process lock. `mutator`
 * receives a deep-cloned draft of the current state and an `applyResult`
 * callback to hand back an arbitrary value (e.g. the mission it just
 * created) alongside the write. The revision is incremented exactly once
 * per successful call, after the mutator returns.
 */
export async function mutateState<T>(
  stateDir: string,
  mutator: (draft: CoordinatoriumState) => T,
  lockOptions?: LockOptions,
): Promise<{ state: CoordinatoriumState; result: T }> {
  // The instance's state directory may not exist yet (e.g. an existing
  // project's first mission before any state.json has ever been written).
  // Creating it here is the "safe, explicit initialization path" for that
  // case — it never touches a state.json that already exists.
  mkdirSync(stateDir, { recursive: true });
  const release = await acquireLock(lockFilePath(stateDir), lockOptions);
  try {
    const current = await readState(stateDir);
    const draft: CoordinatoriumState = structuredClone(current);
    const result = mutator(draft);
    draft.revision = current.revision + 1;
    await atomicWriteState(stateDir, draft);
    return { state: draft, result };
  } finally {
    release();
  }
}
