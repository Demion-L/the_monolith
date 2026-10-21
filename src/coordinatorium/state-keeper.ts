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

import { readFile, writeFile, rename, unlink } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { acquireLock, type LockOptions } from './lock.js';
import { StateCorruptedError, StateSchemaError } from './errors.js';
import { STATE_SCHEMA_VERSION, createInitialState, type CoordinatoriumState, type Mission, type MissionStatus } from './types.js';

export const STATE_FILE_NAME = 'state.json';

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

/**
 * Validate the shape of parsed JSON and return a typed, defensively-copied
 * CoordinatoriumState. Throws StateSchemaError for anything that does not
 * match the v1 schema — this function never "fixes" or partially accepts
 * malformed state.
 */
export function validateState(raw: unknown): CoordinatoriumState {
  if (!isPlainObject(raw)) {
    throw new StateSchemaError('State root is not an object');
  }
  if (raw.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new StateSchemaError(
      `Unsupported schemaVersion "${String(raw.schemaVersion)}" (expected ${STATE_SCHEMA_VERSION})`,
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

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    revision: raw.revision,
    strategic: { systems: { ...raw.strategic.systems } },
    tactical: { missions },
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
  if (!existsSync(filePath)) {
    return createInitialState();
  }

  const raw = await readFile(filePath, 'utf8');
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
  const tmpPath = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
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
