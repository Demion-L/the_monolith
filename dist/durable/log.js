/**
 * Event envelope: stamping, hashing, strict parsing, chain verification.
 *
 * Each event commits to its predecessor (`prev`) and to its own content
 * (`hash`), and the task id is part of the hashed content. A flipped bit, a
 * deleted or reordered event, or an event copied from another task is
 * therefore detected on read instead of being folded into the state.
 */
import { canonicalize, sha256Hex, toJson } from './canonical.js';
import { LogCorruptError, LogUnsupportedError, ValidationError } from './errors.js';
import { EVENT_FORMAT_VERSION, EVENT_TYPES, GENESIS_HASH, } from './types.js';
/** Protective ceiling for one event (payloads are application data). */
export const MAX_EVENT_BYTES = 256 * 1024;
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export function assertId(label, value) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw new ValidationError(`${label} must match ${ID_PATTERN} (letters, digits, "_" and "-", at most 64).`);
    }
}
export function assertNonEmpty(label, value, max) {
    if (typeof value !== 'string' || value.trim().length === 0)
        throw new ValidationError(`${label} must be a non-empty string.`);
    if (value.length > max)
        throw new ValidationError(`${label} is longer than ${max} characters.`);
}
export function computeHash(e) {
    return sha256Hex(canonicalize(e));
}
export function stampEvent(taskId, seq, at, prev, draft) {
    const body = {
        v: EVENT_FORMAT_VERSION,
        taskId,
        seq,
        at,
        type: draft.type,
        actor: draft.actor,
        data: toJson(draft.data, `${draft.type}.data`),
        prev,
    };
    const event = { ...body, hash: computeHash(body) };
    serializeEvent(event); // enforces MAX_EVENT_BYTES before anything touches storage
    return event;
}
/** One canonical line; byte-identical wherever it is stored (loose file or segment line). */
export function serializeEvent(e) {
    const line = canonicalize(e);
    if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) {
        throw new ValidationError(`event ${e.type} is larger than ${MAX_EVENT_BYTES} bytes; store large payloads outside the log and reference them.`);
    }
    return line;
}
const isStr = (v) => typeof v === 'string';
const isStrOrNull = (v) => v === null || typeof v === 'string';
const isInt = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isBool = (v) => typeof v === 'boolean';
const isAny = (v) => v !== undefined;
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLabels = (v) => isObj(v) && Object.values(v).every(isStr);
const isEvidence = (v) => Array.isArray(v) && v.every((e) => isObj(e) && isStr(e.ref) && isStrOrNull(e.note));
const isSteps = (v) => Array.isArray(v) && v.every((s) => isObj(s) && isStr(s.id) && isStr(s.title) && isStrArr(s.dependsOn));
const isCrit = (v) => v === 'blocking' || v === 'advisory';
const isIntOrNull = (v) => v === null || isInt(v);
const SCHEMA = {
    'task.created': { kind: isStr, goal: isStr, input: isAny, parentTaskId: isStrOrNull, dependsOn: isStrArr, labels: isLabels },
    'run.claimed': { owner: isStr, epoch: isInt, leaseUntil: isStr, takeover: isBool },
    'run.heartbeat': { owner: isStr, epoch: isInt, leaseUntil: isStr },
    'run.released': { owner: isStr, epoch: isInt },
    'plan.declared': { steps: isSteps, reason: isStrOrNull },
    'plan.step_done': { stepId: isStr, result: isAny },
    'plan.step_skipped': { stepId: isStr, reason: isStr },
    'decision.recorded': { id: isStr, summary: isStr, rationale: isStrOrNull, basedOn: isStrArr },
    'assumption.recorded': { key: isStr, statement: isStr, criticality: isCrit, fingerprint: isStr, value: isAny, evidence: isEvidence },
    'assumption.retracted': { key: isStr, reason: isStr },
    'fact.observed': { key: isStr, fingerprint: isStr, value: isAny, source: isStrOrNull },
    'effect.intended': { key: isStr, description: isStr, params: isAny, epoch: isIntOrNull },
    'effect.completed': { key: isStr, result: isAny },
    'effect.failed': { key: isStr, error: isStr, retryable: isBool },
    'await.registered': {
        awaitId: isStr, token: isStr, purpose: isStr, stepId: isStrOrNull, request: isAny, deadlineAt: isStrOrNull, basisSeq: isInt,
    },
    'await.resolved': { awaitId: isStr, idempotencyKey: isStr, payload: isAny, source: isStrOrNull, late: isBool },
    'await.delivery_rejected': { awaitId: isStr, idempotencyKey: isStr, reason: (v) => v === 'already-resolved', payload: isAny },
    'await.expired': { awaitId: isStr },
    'task.completed': { result: isAny },
    'task.failed': { error: isStr, detail: isAny },
    'task.cancelled': { reason: isStr },
};
const OPTIONAL_FIELDS = {
    'effect.failed': { uncertain: isBool },
};
/**
 * Parses and verifies one serialized event: envelope shape, known format and
 * type (an unknown one is `LogUnsupportedError`, never skipped), payload shape
 * and the event's own hash. `expectedTaskId` binds it to the task being read.
 */
export function parseEvent(raw, expectedTaskId, hintSeq) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new LogCorruptError(expectedTaskId, hintSeq, 'event is not valid JSON');
    }
    if (!isObj(parsed))
        throw new LogCorruptError(expectedTaskId, hintSeq, 'event is not an object');
    const seq = parsed.seq;
    if (!isInt(seq) || seq < 1)
        throw new LogCorruptError(expectedTaskId, hintSeq, 'event has no valid seq');
    const s = seq;
    if (parsed.v !== EVENT_FORMAT_VERSION)
        throw new LogUnsupportedError(expectedTaskId, s, `event format version`);
    const type = parsed.type;
    if (typeof type !== 'string' || !EVENT_TYPES.includes(type)) {
        throw new LogUnsupportedError(expectedTaskId, s, 'event type');
    }
    if (parsed.taskId !== expectedTaskId)
        throw new LogCorruptError(expectedTaskId, s, 'event belongs to another task');
    if (!isStr(parsed.at) || !isStrOrNull(parsed.actor) || !isStr(parsed.prev) || !isStr(parsed.hash)) {
        throw new LogCorruptError(expectedTaskId, s, 'malformed envelope fields');
    }
    const data = parsed.data;
    const schema = SCHEMA[type];
    if (!isObj(data))
        throw new LogCorruptError(expectedTaskId, s, 'event data is not an object');
    for (const [field, check] of Object.entries(schema)) {
        if (!(field in data) || !check(data[field]))
            throw new LogCorruptError(expectedTaskId, s, `payload field "${field}" of ${type} is invalid`);
    }
    // Fields added after format v1 was fixed: may be absent (older logs), must be well-formed when present.
    for (const [field, check] of Object.entries(OPTIONAL_FIELDS[type] ?? {})) {
        if (field in data && !check(data[field]))
            throw new LogCorruptError(expectedTaskId, s, `payload field "${field}" of ${type} is invalid`);
    }
    const { hash, ...rest } = parsed;
    if (computeHash(rest) !== hash)
        throw new LogCorruptError(expectedTaskId, s, 'content hash mismatch');
    return parsed;
}
/**
 * Verifies that `events` continue a chain whose last event had `expectedPrev`
 * and seq `lastSeq`: contiguous seq, `prev` links, nothing after the first
 * violation is trusted. Throws `LogCorruptError`.
 */
export function verifyChain(taskId, events, lastSeq, expectedPrev) {
    let seq = lastSeq;
    let prev = expectedPrev;
    for (const e of events) {
        if (e.seq !== seq + 1)
            throw new LogCorruptError(taskId, e.seq, `sequence gap (expected ${seq + 1})`);
        if (e.prev !== prev)
            throw new LogCorruptError(taskId, e.seq, 'prev hash does not match the preceding event');
        seq = e.seq;
        prev = e.hash;
    }
}
export { GENESIS_HASH };
