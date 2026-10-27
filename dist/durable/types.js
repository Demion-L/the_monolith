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
export const TERMINAL_EVENT_TYPES = ['task.completed', 'task.failed', 'task.cancelled'];
export function isTerminal(status) {
    return status !== 'active';
}
