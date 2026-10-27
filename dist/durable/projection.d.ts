/**
 * Projection — the pure fold from events to `TaskState`.
 *
 * Deterministic and total over valid logs: the same events always give the
 * same state, with no clock, randomness or I/O. It is also *strict*: an event
 * that violates the task's own rules (a second claim with the wrong epoch, a
 * delivery to an unknown await, an event after a terminal one) is a corrupt
 * log, not something to be skipped. Writers run every new event through
 * `applyEvent` before publishing it, so a log that was written by this code
 * always folds.
 */
import { GENESIS_HASH, type PlanStepDecl, type TaskEvent, type TaskState } from './types.js';
/** Idempotency keys are scoped to the await they were delivered to ('awaitId' never contains ':'). */
export declare function deliveryKey(awaitId: string, idempotencyKey: string): string;
/**
 * A string-keyed dictionary that does not inherit from `Object.prototype`.
 *
 * Keys of these dictionaries are application data (assumption keys, effect keys, await ids, labels).
 * On a plain object `d['__proto__'] = x` replaces the prototype instead of storing an entry, and
 * `d['constructor']` / `d['toString']` read an inherited function for a key that was never written.
 * A null-prototype object has neither problem; it serializes exactly like a plain one (JSON, canonical
 * form, `Object.keys/values/entries`), so stored events and the public `Record<string, T>` types are unchanged.
 */
export declare function newDict<T>(from?: Readonly<Record<string, T>>): Record<string, T>;
/** Validates a plan declaration; returns the first problem or `null`. Shared by the runtime (nice errors) and the fold (strictness). */
export declare function planProblem(steps: readonly PlanStepDecl[]): string | null;
export declare function applyEvent(prevState: TaskState | null, e: TaskEvent): TaskState;
/** Folds a verified, contiguous list of events (starting at seq 1, or continuing `from`). */
export declare function foldEvents(events: readonly TaskEvent[], from?: TaskState | null): TaskState;
/** The state as it was when the log had `seq` events — "what did the task look like when this was sent". */
export declare function foldUntil(events: readonly TaskEvent[], seq: number): TaskState;
/** Deep copy. `structuredClone` alone would turn the null-prototype dictionaries back into plain objects. */
export declare function cloneState(s: TaskState): TaskState;
export { GENESIS_HASH };
//# sourceMappingURL=projection.d.ts.map