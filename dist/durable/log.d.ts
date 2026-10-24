/**
 * Event envelope: stamping, hashing, strict parsing, chain verification.
 *
 * Each event commits to its predecessor (`prev`) and to its own content
 * (`hash`), and the task id is part of the hashed content. A flipped bit, a
 * deleted or reordered event, or an event copied from another task is
 * therefore detected on read instead of being folded into the state.
 */
import { GENESIS_HASH, type EventDraft, type TaskEvent } from './types.js';
/** Protective ceiling for one event (payloads are application data). */
export declare const MAX_EVENT_BYTES: number;
export declare const ID_PATTERN: RegExp;
export declare function assertId(label: string, value: unknown): asserts value is string;
export declare function assertNonEmpty(label: string, value: unknown, max: number): asserts value is string;
type Hashable = Omit<TaskEvent, 'hash'>;
export declare function computeHash(e: Hashable): string;
export declare function stampEvent(taskId: string, seq: number, at: string, prev: string, draft: EventDraft): TaskEvent;
/** One canonical line; byte-identical wherever it is stored (loose file or segment line). */
export declare function serializeEvent(e: TaskEvent): string;
/**
 * Parses and verifies one serialized event: envelope shape, known format and
 * type (an unknown one is `LogUnsupportedError`, never skipped), payload shape
 * and the event's own hash. `expectedTaskId` binds it to the task being read.
 */
export declare function parseEvent(raw: string, expectedTaskId: string, hintSeq: number | null): TaskEvent;
/**
 * Verifies that `events` continue a chain whose last event had `expectedPrev`
 * and seq `lastSeq`: contiguous seq, `prev` links, nothing after the first
 * violation is trusted. Throws `LogCorruptError`.
 */
export declare function verifyChain(taskId: string, events: readonly TaskEvent[], lastSeq: number, expectedPrev: string): void;
export { GENESIS_HASH };
//# sourceMappingURL=log.d.ts.map