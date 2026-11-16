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
import { lstatSync, mkdirSync } from 'fs';
import { isAbsolute, join } from 'path';
import { acquireLock } from './lock.js';
import { StateCorruptedError, StateSchemaError, StateFileError } from './errors.js';
import { SafeWriteError, openParent, projectBoundary, readBoundedFileStable, replaceFile, trustedDirectoryBoundary, } from '../root/index.js';
import { STATE_SCHEMA_VERSION, STORY_ID_RE, createInitialState, } from './types.js';
export const STATE_FILE_NAME = 'state.json';
/**
 * Protective ceiling for `state.json` (SEC-001B.1) — NOT a retention policy.
 * Append-only checkpoints grow the file without bound; see STATE-001.
 * Enforced on read (bounded reader) and before an atomic write.
 */
export const MAX_STATE_BYTES = 16 * 1024 * 1024;
export function stateFilePath(stateDir) {
    return join(stateDir, STATE_FILE_NAME);
}
function lockFilePath(stateDir) {
    return `${stateFilePath(stateDir)}.lock`;
}
/** Project-scoped write target (the CLI always uses this). */
export function projectTarget(projectRoot, stateDir, onWarning) {
    return { scope: 'project', projectRoot, stateDir, onWarning };
}
/** Trusted-directory write target: `stateDir` and its ancestors are asserted trusted by the caller. */
export function trustedDirectoryTarget(stateDir, onWarning) {
    return { scope: 'trusted-directory', stateDir, onWarning };
}
function scopeRequired(fn, stateDir) {
    return new SafeWriteError(`${fn} requires an explicit write scope. Replace ${fn}(dir, ...) with ` +
        `${fn}({ scope: 'trusted-directory', stateDir: dir }, ...) when dir and its ancestors are trusted, or with ` +
        `${fn}({ scope: 'project', projectRoot, stateDir }, ...) when acting on a project (ADR-012).`, {
        code: 'WRITE_SCOPE_REQUIRED',
        phase: 'scope',
        publication: 'NOT_PUBLISHED',
        path: typeof stateDir === 'string' ? stateDir : '',
    });
}
/** Validates the scope and builds the boundary. Throws SafeWriteError; touches nothing in `project` scope. */
function resolveWriteTarget(target, fn) {
    if (typeof target !== 'object' || target === null)
        throw scopeRequired(fn, target);
    const t = target;
    if (typeof t.stateDir !== 'string' || t.stateDir.length === 0)
        throw scopeRequired(fn, t.stateDir);
    if (t.scope === 'project') {
        if (typeof t.projectRoot !== 'string' || t.projectRoot.length === 0)
            throw scopeRequired(fn, t.stateDir);
        return { boundary: projectBoundary(t.projectRoot), stateDir: t.stateDir, onWarning: t.onWarning };
    }
    if (t.scope === 'trusted-directory') {
        // The caller vouches for the directory and its ancestors, so creating it
        // (and any missing ancestors) is within the model they chose.
        mkdirSync(t.stateDir, { recursive: true });
        return { boundary: trustedDirectoryBoundary(t.stateDir), stateDir: t.stateDir, onWarning: t.onWarning };
    }
    throw scopeRequired(fn, t.stateDir);
}
/** Validates the read scope; returns the boundary directory. Throws StateFileError, touches nothing. */
function resolveReadTarget(target, fn) {
    const bad = (why) => new StateFileError('READ_BOUNDARY_INVALID', `${fn} requires an explicit read scope (${why}). Use { scope: 'project', projectRoot, stateDir } for a project, ` +
        `or { scope: 'trusted-directory', stateDir } when stateDir is trusted (SEC-001B.1-R).`);
    if (typeof target !== 'object' || target === null)
        throw bad('got a non-object');
    const t = target;
    // Every path is validated here, before any filesystem call: a path that cannot be
    // trusted must never be probed (and so never "not found" -> empty state) (L-2).
    // The cwd is never a boundary, so a relative path is refused, not resolved.
    if (typeof t.stateDir !== 'string' || t.stateDir.length === 0)
        throw bad('stateDir is missing');
    if (!isAbsolute(t.stateDir))
        throw bad('stateDir must be an absolute path');
    if (t.scope === 'project') {
        if (typeof t.projectRoot !== 'string' || t.projectRoot.length === 0)
            throw bad('projectRoot is missing');
        if (!isAbsolute(t.projectRoot))
            throw bad('projectRoot must be an absolute path');
        return { boundary: t.projectRoot, stateDir: t.stateDir };
    }
    if (t.scope === 'trusted-directory')
        return { boundary: t.stateDir, stateDir: t.stateDir };
    throw bad('unknown scope');
}
const MISSION_STATUSES = ['in_progress', 'completed', 'failed', 'cancelled'];
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function validateMission(id, raw) {
    if (!isPlainObject(raw)) {
        throw new StateSchemaError(`Mission "${id}" is not an object`);
    }
    const { title, system, status, startedAt, updatedAt, summary, storyId } = raw;
    if (raw.id !== id) {
        throw new StateSchemaError(`Mission "${id}" has mismatched id field "${String(raw.id)}"`);
    }
    if (typeof title !== 'string' || title.length === 0) {
        throw new StateSchemaError(`Mission "${id}" has an invalid title`);
    }
    if (typeof system !== 'string' || system.length === 0) {
        throw new StateSchemaError(`Mission "${id}" has an invalid system`);
    }
    if (typeof status !== 'string' || !MISSION_STATUSES.includes(status)) {
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
    if (storyId !== undefined && (typeof storyId !== 'string' || !STORY_ID_RE.test(storyId))) {
        throw new StateSchemaError(`Mission "${id}" has an invalid storyId`);
    }
    const mission = { id, title, system, status: status, startedAt, updatedAt, summary };
    if (storyId !== undefined)
        mission.storyId = storyId;
    return mission;
}
function validateCheckpoint(id, raw) {
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
        remainingSteps: [...remainingSteps],
        context: context ?? null,
    };
}
/**
 * Validate the shape of parsed JSON and return a typed, defensively-copied
 * CoordinatoriumState. Throws StateSchemaError for anything that does not
 * match the current schema — this function never "fixes", migrates or
 * partially accepts anything. An older (or newer) `schemaVersion` is rejected
 * outright, so a read-modify-write can never reach its write step and replace
 * a file this binary does not understand (NO LEGACY: BETA-020).
 */
export function validateState(raw) {
    if (!isPlainObject(raw)) {
        throw new StateSchemaError('State root is not an object');
    }
    if (raw.schemaVersion !== STATE_SCHEMA_VERSION) {
        throw new StateSchemaError(`Incompatible state schemaVersion "${String(raw.schemaVersion)}" (this MONOLITH supports only ${STATE_SCHEMA_VERSION}); ` +
            'the file was not read as state and was not modified. A schemaVersion 2 file can be brought across explicitly with ' +
            '`monolith state adopt <file> --upgrade-v2` (preview first).');
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
    const missions = {};
    for (const [id, m] of Object.entries(raw.tactical.missions)) {
        missions[id] = validateMission(id, m);
    }
    const rawCheckpoints = raw.tactical.checkpoints;
    if (!isPlainObject(rawCheckpoints)) {
        throw new StateSchemaError('Invalid tactical.checkpoints');
    }
    const checkpoints = {};
    for (const [id, c] of Object.entries(rawCheckpoints)) {
        checkpoints[id] = validateCheckpoint(id, c);
    }
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
export async function readState(target) {
    const { boundary, stateDir } = resolveReadTarget(target, 'readState');
    const filePath = stateFilePath(stateDir);
    // A trusted directory that does not exist holds no state (it is the boundary,
    // so it cannot be walked to). In `project` scope a missing directory is
    // reported by the reader itself as FILE_MISSING. Only ENOENT on the path itself
    // counts as "does not exist": `existsSync` would also say so for a dangling
    // symlink or a loop, and an unusable boundary is not an empty state — those fall
    // through to the reader, which refuses them (READ_BOUNDARY_INVALID) (L-2).
    if (target.scope === 'trusted-directory') {
        try {
            lstatSync(stateDir);
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return createInitialState();
        }
    }
    // Unified safe read (SEC-001B.1-R): explicit boundary, no symlink or hardlink,
    // non-blocking (a FIFO at this path cannot hang us), capped at MAX_STATE_BYTES.
    const read = readBoundedFileStable(filePath, `"${filePath}"`, { boundary, maxBytes: MAX_STATE_BYTES, allowEmpty: true }, true);
    if (!read.ok) {
        if (read.code === 'FILE_MISSING')
            return createInitialState();
        throw new StateFileError(read.code, read.detail);
    }
    const raw = 'content' in read ? read.content : '';
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new StateCorruptedError(`"${filePath}" is not valid JSON: ${msg}`);
    }
    return validateState(parsed);
}
/**
 * The read that precedes a write. A symlink or hardlink at the destination is
 * reported with the write-side typed error and `NOT_PUBLISHED`, exactly as before
 * the unified read (SEC-001B.2 compat). Every other read failure — a FIFO or
 * special file included (SEC-001B.1) — stays the StateFileError of the read.
 */
async function readStateForWrite(target, stateDir) {
    try {
        return await readState(target);
    }
    catch (err) {
        if (err instanceof StateFileError) {
            const code = err.fileCode === 'FILE_SYMLINK'
                ? 'WRITE_TARGET_SYMLINK'
                : err.fileCode === 'FILE_HARDLINKED'
                    ? 'WRITE_TARGET_HARDLINKED'
                    : null;
            if (code !== null) {
                throw new SafeWriteError(`${err.message} (refusing to replace it)`, {
                    code,
                    phase: 'validate',
                    publication: 'NOT_PUBLISHED',
                    path: stateFilePath(stateDir),
                    cause: err,
                });
            }
        }
        throw err;
    }
}
/**
 * Persist `state` through the safe-write primitive (SEC-001B.2, ADR-012):
 * temp file (`O_EXCL|O_NOFOLLOW`, `0600`) -> fsync -> `rename`, then fsync of
 * the directory. A new `state.json` is `0600`; an existing one keeps its mode.
 * A symlink, FIFO/special file or hardlinked file at the destination is
 * refused (never replaced). Throws SafeWriteError with publication
 * NOT_PUBLISHED or UNKNOWN; once published nothing throws — later findings are
 * returned as warnings.
 */
function atomicWriteState(parent, filePath, state) {
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    // Refuse BEFORE creating the temp file: an oversized state.json would be
    // unreadable by readState, locking the project out of its own state. The
    // existing state.json is left untouched; nothing is compacted or dropped.
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > MAX_STATE_BYTES) {
        throw new StateFileError('FILE_TOO_LARGE', `refusing to write "${filePath}": ${bytes} bytes exceeds the ${MAX_STATE_BYTES}-byte limit (see STATE-001); state was not modified.`);
    }
    return replaceFile(parent, STATE_FILE_NAME, serialized, {
        mode: 0o600,
        preserveMode: true,
        durability: 'full',
        maxBytes: MAX_STATE_BYTES,
    }).warnings;
}
/** The write is already published; a throwing callback must not turn it into a failure. */
function reportWarnings(warnings, onWarning) {
    if (!onWarning)
        return;
    for (const w of warnings) {
        try {
            onWarning(w);
        }
        catch {
            /* ignored on purpose */
        }
    }
}
/**
 * Read-modify-write under an exclusive cross-process lock. `mutator`
 * receives a deep-cloned draft of the current state and an `applyResult`
 * callback to hand back an arbitrary value (e.g. the mission it just
 * created) alongside the write. The revision is incremented exactly once
 * per successful call, after the mutator returns.
 */
export async function mutateState(target, mutator, lockOptions) {
    const { boundary, stateDir, onWarning } = resolveWriteTarget(target, 'mutateState');
    const warnings = [];
    // The instance's state directory may not exist yet (e.g. an existing
    // project's first mission before any state.json has ever been written).
    // Creating it here — component by component, refusing symlinks below the
    // boundary — is the "safe, explicit initialization path" for that case; it
    // never touches a state.json that already exists.
    const parent = openParent(boundary, stateDir, { create: true });
    const release = await acquireLock(lockFilePath(stateDir), lockOptions, {}, parent);
    let draft;
    let result;
    try {
        const current = await readStateForWrite(target, stateDir);
        draft = structuredClone(current);
        result = mutator(draft);
        draft.revision = current.revision + 1;
        warnings.push(...atomicWriteState(parent, stateFilePath(stateDir), draft));
    }
    finally {
        release();
    }
    // The write is published and the lock is released: caller code runs outside
    // the critical section, so a slow or re-entrant callback cannot hold up (or
    // deadlock against) other writers.
    reportWarnings(warnings, onWarning);
    return { state: draft, result, warnings };
}
/**
 * Replace the whole state file under the same exclusive lock and the same safe
 * write path as `mutateState` — for `monolith state adopt` only. Unlike
 * `mutateState` it does NOT require the current file to be a valid current-schema
 * state (an incompatible or corrupt destination is exactly what an adoption may
 * have to replace), so it hands the raw bytes to `decide` instead.
 *
 * Order: read raw -> `decide` (may throw: nothing written) -> backup (if asked;
 * a failed backup aborts before the destination is touched) -> atomic replace ->
 * read back and compare. A mismatch after publication throws, and the backup
 * still exists.
 */
export async function replaceStateUnderLock(target, decide, lockOptions) {
    const { boundary, stateDir, onWarning } = resolveWriteTarget(target, 'replaceStateUnderLock');
    const warnings = [];
    const parent = openParent(boundary, stateDir, { create: true });
    const release = await acquireLock(lockFilePath(stateDir), lockOptions, {}, parent);
    let decision;
    let backupPath = null;
    try {
        const filePath = stateFilePath(stateDir);
        const read = readBoundedFileStable(filePath, `"${filePath}"`, { boundary: resolveReadTarget(target, 'replaceStateUnderLock').boundary, maxBytes: MAX_STATE_BYTES, allowEmpty: true }, true);
        let raw = null;
        if (!read.ok) {
            if (read.code !== 'FILE_MISSING')
                throw new StateFileError(read.code, read.detail);
        }
        else {
            raw = 'content' in read ? read.content : '';
        }
        decision = decide({ raw });
        if (decision.backupName !== null && raw !== null) {
            const backupMode = 0o600;
            replaceFile(parent, decision.backupName, raw, { mode: backupMode, preserveMode: false, durability: 'full', maxBytes: MAX_STATE_BYTES });
            backupPath = join(stateDir, decision.backupName);
        }
        warnings.push(...atomicWriteState(parent, filePath, decision.state));
    }
    finally {
        release();
    }
    reportWarnings(warnings, onWarning);
    const back = await readState(target);
    if (JSON.stringify(back) !== JSON.stringify(decision.state)) {
        throw new StateCorruptedError(`"${stateFilePath(stateDir)}" does not match what was written${backupPath ? `; the previous content is preserved at "${backupPath}"` : ''}.`);
    }
    return { state: back, backupPath, warnings };
}
