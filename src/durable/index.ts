/**
 * Durable State — a domain-neutral, crash-safe execution record for long-running
 * agentic tasks. See docs/adr/ADR-017-durable-execution-state.md.
 */

export { DurableTasks, newOwnerId, parseToken } from './runtime.js';
export type {
  DurableTasksOptions,
  Fence,
  CreateTaskInput,
  TaskSummary,
  DeliveryResult,
  EffectOptions,
  EffectOutcome,
  ResumePacket,
  VerifyReport,
  RetentionReport,
} from './runtime.js';
export { FsEventStore, AppendOutcomeUnknownError, MAX_SEGMENT_BYTES } from './fs-store.js';
export type { FsStoreOptions, FsStoreTarget } from './fs-store.js';
export { MemoryEventStore } from './memory-store.js';
export { assessTask, diffStates, leaseIsLive } from './assess.js';
export type { Assessment, AssessOptions, ResumeMode, Reason, ReasonCode, AssumptionChange, ResultToConsume, StateChange } from './assess.js';
export { planRetention } from './retention.js';
export type { RetentionPolicy, RetentionDecision, RetentionAction, InterruptedWork } from './retention.js';
export { foldEvents, foldUntil, applyEvent } from './projection.js';
export { MAX_EVENT_BYTES } from './log.js';
export { toJson, canonicalize, fingerprintOf } from './canonical.js';
export type { Json } from './canonical.js';
export * from './errors.js';
export type {
  EventStore,
  TaskEvent,
  EventType,
  TaskState,
  TaskStatus,
  Tombstone,
  LogRead,
  Evidence,
  Criticality,
  PlanStepState,
  AwaitState,
  EffectState,
  AssumptionState,
  StoreDiagnostic,
} from './types.js';
