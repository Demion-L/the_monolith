/**
 * Durable State — event and state types.
 *
 * The source of truth of a task is its append-only, hash-chained event log.
 * `TaskState` is a pure fold of that log (projection.ts); it is never stored
 * as authority and can always be rebuilt. Nothing here knows about SphynX, an
 * LLM, or any business domain: `kind`, `goal`, `input`, payloads and results
 * are opaque application data.
 */
/** Bumped only for an incompatible change of the envelope. Readers refuse unknown versions. */
export const EVENT_FORMAT_VERSION = 1;
/** `prev` of the first event of every task. */
export const GENESIS_HASH = '0'.repeat(64);
export const EVENT_TYPES = [
    'task.created',
    'run.claimed',
    'run.heartbeat',
    'run.released',
    'plan.declared',
    'plan.step_done',
    'plan.step_skipped',
    'decision.recorded',
    'assumption.recorded',
    'assumption.retracted',
    'fact.observed',
    'effect.intended',
    'effect.completed',
    'effect.failed',
    'await.registered',
    'await.resolved',
    'await.delivery_rejected',
    'await.expired',
    'task.completed',
    'task.failed',
    'task.cancelled',
];
/**
 * Events whose `'adopted'` append result counts as success (Amendment-004G, section 2.11 / 8.2). A closed list: none of
 * these confers the right to an irreversible action, that right comes from another event won through the CAS.
 * Everything not named here (the rights-bearing `task.created`, `run.claimed`, `effect.intended`, `await.resolved`,
 * and any type added later) is deny-by-default: `'adopted'` is treated like `'conflict'`.
 */
export const ADOPTED_IS_SUCCESS_EVENT_TYPES = [
    'effect.completed',
    'effect.failed',
    'task.completed',
    'task.failed',
    'task.cancelled',
    'plan.declared',
    'plan.step_done',
    'plan.step_skipped',
    'decision.recorded',
    'assumption.recorded',
    'assumption.retracted',
    'fact.observed',
    'run.heartbeat',
    'run.released',
    'await.registered',
    'await.expired',
    'await.delivery_rejected',
];
const ADOPTED_IS_SUCCESS = new Set(ADOPTED_IS_SUCCESS_EVENT_TYPES);
/** True only for a type named in the closed list; an unknown string is false (fail closed). */
export function adoptedIsSuccess(type) {
    return ADOPTED_IS_SUCCESS.has(type);
}
export const TERMINAL_EVENT_TYPES = ['task.completed', 'task.failed', 'task.cancelled'];
export function isTerminal(status) {
    return status !== 'active';
}
// ---------------------------------------------------------------------------
// Prune decision register (ADR-019, Design A)
// ---------------------------------------------------------------------------
/** Number of prune attempts a task may ever use. A liveness limit; attempt numbers are never reused or reset. */
export const MAX_PRUNE_ATTEMPTS = 1000;
