/**
 * Durable State — event and state types.
 *
 * The source of truth of a task is its append-only, hash-chained event log.
 * `TaskState` is a pure fold of that log (projection.ts); it is never stored
 * as authority and can always be rebuilt. Nothing here knows about SphynX, an
 * LLM, or any business domain: `kind`, `goal`, `input`, payloads and results
 * are opaque application data.
 */

import type { Json } from './canonical.js';

export type { Json };

/** Bumped only for an incompatible change of the envelope. Readers refuse unknown versions. */
export const EVENT_FORMAT_VERSION = 1;

/** `prev` of the first event of every task. */
export const GENESIS_HASH = '0'.repeat(64);

export interface Evidence {
  /** Opaque reference: a URL, a document id, an event id of another system. */
  ref: string;
  note: string | null;
}

export interface PlanStepDecl {
  id: string;
  title: string;
  dependsOn: string[];
}

export type Criticality = 'blocking' | 'advisory';

/** Payload of every event type. The keys are the closed set of event types of format v1. */
export interface EventDataMap {
  'task.created': {
    kind: string;
    goal: string;
    input: Json | null;
    parentTaskId: string | null;
    dependsOn: string[];
    labels: Record<string, string>;
  };
  'run.claimed': { owner: string; epoch: number; leaseUntil: string; takeover: boolean };
  'run.heartbeat': { owner: string; epoch: number; leaseUntil: string };
  'run.released': { owner: string; epoch: number };
  'plan.declared': { steps: PlanStepDecl[]; reason: string | null };
  'plan.step_done': { stepId: string; result: Json | null };
  'plan.step_skipped': { stepId: string; reason: string };
  'decision.recorded': { id: string; summary: string; rationale: string | null; basedOn: string[] };
  'assumption.recorded': {
    key: string;
    statement: string;
    criticality: Criticality;
    fingerprint: string;
    value: Json | null;
    evidence: Evidence[];
  };
  'assumption.retracted': { key: string; reason: string };
  'fact.observed': { key: string; fingerprint: string; value: Json | null; source: string | null };
  'effect.intended': { key: string; description: string; params: Json | null; epoch: number | null };
  'effect.completed': { key: string; result: Json | null };
  /**
   * `uncertain: true` — the call threw, but the exception does not prove the external operation did not happen
   * (a timeout after the request was sent). Recorded together with `retryable: false`, so a reader that predates
   * the field also refuses to run it again. Absent (older logs) means a certain failure, as before.
   */
  'effect.failed': { key: string; error: string; retryable: boolean; uncertain?: boolean };
  'await.registered': {
    awaitId: string;
    token: string;
    purpose: string;
    stepId: string | null;
    request: Json | null;
    deadlineAt: string | null;
    /** Head of the log when the request was sent: the state "at send" is `foldUntil(basisSeq)`. */
    basisSeq: number;
  };
  'await.resolved': { awaitId: string; idempotencyKey: string; payload: Json; source: string | null; late: boolean };
  'await.delivery_rejected': { awaitId: string; idempotencyKey: string; reason: 'already-resolved'; payload: Json };
  'await.expired': { awaitId: string };
  'task.completed': { result: Json | null };
  'task.failed': { error: string; detail: Json | null };
  'task.cancelled': { reason: string };
}

export type EventType = keyof EventDataMap;

export const EVENT_TYPES: readonly EventType[] = [
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
export const ADOPTED_IS_SUCCESS_EVENT_TYPES: readonly EventType[] = [
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

const ADOPTED_IS_SUCCESS = new Set<string>(ADOPTED_IS_SUCCESS_EVENT_TYPES);

/** True only for a type named in the closed list; an unknown string is false (fail closed). */
export function adoptedIsSuccess(type: string): boolean {
  return ADOPTED_IS_SUCCESS.has(type);
}

export const TERMINAL_EVENT_TYPES: readonly EventType[] = ['task.completed', 'task.failed', 'task.cancelled'];

export type EventOf<T extends EventType> = {
  v: typeof EVENT_FORMAT_VERSION;
  taskId: string;
  seq: number;
  at: string;
  type: T;
  actor: string | null;
  data: EventDataMap[T];
  prev: string;
  hash: string;
};

/** A stored event. Distributes over the type so `switch (e.type)` narrows `e.data`. */
export type TaskEvent = { [T in EventType]: EventOf<T> }[EventType];

/** What a caller proposes; the runtime stamps `seq`, `at`, `prev`, `hash`. */
export type EventDraft = { [T in EventType]: { type: T; actor: string | null; data: EventDataMap[T] } }[EventType];

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export type TaskStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface PlanStepState {
  id: string;
  title: string;
  dependsOn: string[];
  status: 'pending' | 'done' | 'skipped';
  result: Json | null;
  skipReason: string | null;
  closedAtSeq: number | null;
}

export interface DecisionState {
  id: string;
  seq: number;
  at: string;
  summary: string;
  rationale: string | null;
  basedOn: string[];
}

export interface AssumptionState {
  key: string;
  statement: string;
  criticality: Criticality;
  fingerprint: string;
  value: Json | null;
  evidence: Evidence[];
  status: 'active' | 'retracted';
  recordedAtSeq: number;
  retractedReason: string | null;
}

export interface ObservationState {
  key: string;
  fingerprint: string;
  value: Json | null;
  source: string | null;
  seq: number;
  at: string;
}

export interface EffectState {
  key: string;
  description: string;
  params: Json | null;
  status: 'intended' | 'completed' | 'failed';
  intendedAtSeq: number;
  intendedEpoch: number | null;
  result: Json | null;
  error: string | null;
  retryable: boolean;
  /**
   * The last attempt threw and it is not known whether the external operation took effect. Such an effect is in
   * doubt: it is neither run again nor treated as done until `reconcile` (or an operator) settles it.
   */
  uncertain: boolean;
}

export interface AwaitState {
  awaitId: string;
  token: string;
  purpose: string;
  stepId: string | null;
  request: Json | null;
  deadlineAt: string | null;
  basisSeq: number;
  registeredAtSeq: number;
  status: 'pending' | 'resolved' | 'expired';
  resolvedAtSeq: number | null;
  payload: Json | null;
  idempotencyKey: string | null;
  source: string | null;
  late: boolean;
  rejectedDeliveries: number;
}

export interface LeaseState {
  owner: string;
  epoch: number;
  leaseUntil: string;
  released: boolean;
}

export interface TaskState {
  taskId: string;
  kind: string;
  goal: string;
  input: Json | null;
  parentTaskId: string | null;
  dependsOn: string[];
  labels: Record<string, string>;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  result: Json | null;
  error: string | null;
  headSeq: number;
  headHash: string;
  /** Highest epoch ever issued (fencing counter). */
  epoch: number;
  lease: LeaseState | null;
  plan: PlanStepState[] | null;
  decisions: DecisionState[];
  assumptions: Record<string, AssumptionState>;
  observations: Record<string, ObservationState>;
  effects: Record<string, EffectState>;
  awaits: Record<string, AwaitState>;
  /** `awaitId:idempotencyKey` -> seq of the delivery that carried it (duplicate suppression, scoped per await). */
  deliveryKeys: Record<string, number>;
  eventCount: number;
}

export function isTerminal(status: TaskStatus): boolean {
  return status !== 'active';
}

// ---------------------------------------------------------------------------
// Store contract
// ---------------------------------------------------------------------------

export interface Tombstone {
  v: 1;
  taskId: string;
  kind: string;
  finalStatus: TaskStatus;
  createdAt: string;
  closedAt: string;
  prunedAt: string;
  headSeq: number;
  headHash: string;
  /** sha256 of the canonical final result/error, so "what did it return" can be audited without keeping the data. */
  outcomeDigest: string;
}

export interface StoreDiagnostic {
  code:
    | 'LOOSE_COPY_OF_COMPACTED_EVENT'
    | 'STAGING_RESIDUE_REPAIRED'
    | 'STAGING_FILE_PRESENT'
    | 'UNKNOWN_ENTRY'
    /** A tombstone exists but event/segment files of the pruned task are still on disk: an interrupted prune. */
    | 'PRUNE_INCOMPLETE'
    /** The prune decision register has an artifact that is not part of its grammar (an operator's `.bak`, say). */
    | 'UNKNOWN_PRUNE_ARTIFACT';
  taskId: string;
  name: string;
}

export interface LogRead {
  /** False when the task directory does not exist and no tombstone is present. */
  exists: boolean;
  /**
   * Set when the task is pruned (`committed`), AND — for consumers written against the pre-register protocol — while a
   * prune attempt is open (`preparing`): they treat "tombstone visible, data intact" as a prune that is not settled.
   * `prune.kind` tells the two apart.
   */
  tombstone: Tombstone | null;
  /** The observed prune state when it is anything but `live`. Informational; the register is the authority. */
  prune?: PruneState;
  /** Verified-contiguous in seq, ascending, `seq > afterSeq`. Hash chain is verified by the caller. */
  events: TaskEvent[];
  /** Highest seq already packed into immutable segments (0 if none). Informational; used to plan compaction. */
  compactedThrough: number;
  diagnostics: StoreDiagnostic[];
}

export interface CompactionResult {
  segment: string | null;
  packedEvents: number;
  removedFiles: number;
}

// ---------------------------------------------------------------------------
// Prune decision register (ADR-019, Design A)
// ---------------------------------------------------------------------------

/** Number of prune attempts a task may ever use. A liveness limit; attempt numbers are never reused or reset. */
export const MAX_PRUNE_ATTEMPTS = 1000;

export type PruneOutcome = 'commit' | 'abort';

/** Who published an `abort`. Diagnostic only; it never changes the semantics of the decision. */
export type DecisionBy = 'pruner' | 'child' | 'creator' | 'claim' | 'append' | 'compact' | 'pin';

export type PruneStateKind = 'live' | 'preparing' | 'committed' | 'missing' | 'corrupt' | 'unreadable' | 'legacy';

/**
 * What the register says about a task, derived from the names and contents of its directory (Design A, section 20.2).
 * Nothing here is persisted and nothing is written by computing it. `corrupt`, `unreadable`, `missing` and `legacy`
 * never grant the right to an irreversible action.
 */
export interface PruneState {
  kind: PruneStateKind;
  /** `preparing` / `committed`: the attempt number. `live`: the highest attempt number seen (0 if none). */
  attempt?: number;
  /** `preparing` / `committed`: the tombstone of the attempt. `legacy`: the legacy tombstone. */
  tombstone?: Tombstone;
  /** `corrupt`: the finding; `unreadable`: what could not be read or confirmed. */
  reason?: string;
  /** `corrupt` / `legacy`: whether the finding rests on present files (`present`) or on confirmed absence (`lookup`). */
  basis?: 'present' | 'lookup';
  /** `corrupt`: the register file the finding is about, if any. */
  file?: string;
  /** `committed`: files of the pruned task that are still on disk (`> 0` means deleting, `0` means gone). Not monotonic. */
  residue?: number;
  /** `committed`: the commit was written by the legacy migration procedure. */
  migrated?: boolean;
  /** Findings that do not change the verdict (`UNKNOWN_PRUNE:<name>`). */
  anomalies?: string[];
  /** `committed`. Mode A only: the commit is visible to every process, but survival of an OS crash is NOT guaranteed. */
  durability?: 'NOT_GUARANTEED';
}

/** Result of `EventStore.append` (Amendment-004G, CEI-6). Only `'appended'` carries the right of the slot's winner. */
export type AppendOutcome = 'appended' | 'adopted' | 'conflict';

/**
 * The persistence contract. A backend must provide ONE linearizable primitive:
 * `append` publishes an event at `event.seq` if and only if that slot is free,
 * atomically, and reports `'conflict'` otherwise. Everything else (locking-free
 * concurrency, idempotency, fencing, integrity) is built on it above this line,
 * so a SQL/KV backend can implement it with a unique key.
 */
export interface EventStore {
  /**
   * `rawEvents`: return the events of a task whose prune attempt is open (`prune.kind === 'preparing'`) instead of
   * hiding them behind the transitional tombstone. A pruner needs the head of the log AFTER its `prepare` is visible.
   */
  readLog(taskId: string, opts?: { afterSeq?: number; rawEvents?: boolean }): Promise<LogRead>;
  /**
   * Amendment-004G. `'appended'`: this call created the first file of the slot and the canonical content is the event
   * (the right derived from winning the slot). `'adopted'`: the canonical content equals the event, but this call cannot
   * prove it created the slot (EEXIST, evidence through a segment, a retry). `'conflict'`: the slot holds another event.
   */
  append(event: TaskEvent): Promise<AppendOutcome>;
  listTaskIds(): Promise<string[]>;
  /** Pack verified events `1..throughSeq` into immutable storage, then drop the loose copies. Idempotent. */
  compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult>;
  /**
   * Low-level prune, always through the decision register: make sure there is a `commit` for the tombstone (publishing
   * the attempt and the commit itself when there is none and `requireCommit` is not set — this form does NOT look for
   * referrers), publish `tombstone.json` from the commit, then remove the task's data. Idempotent: a second call
   * finishes an interrupted one. With `requireCommit` it refuses unless a verified `commit` already exists.
   */
  prune(tombstone: Tombstone, opts?: { requireCommit?: boolean }): Promise<{ removedFiles: number }>;
  /**
   * Optional. Finish an interrupted compaction: remove loose event copies that a verified segment already covers.
   * A copy is removed only if it is byte-identical to the event in the segment; anything else is kept (`keptFiles`)
   * because it cannot be proven redundant. Idempotent; safe to run concurrently with readers, writers and itself.
   */
  sweepCompacted?(taskId: string): Promise<{ removedFiles: number; keptFiles: number }>;

  // --- Optional: consistency between a task and the tasks that refer to it (parentTaskId / dependsOn) ---
  //
  // `prune` removes a task that something may be about to refer to. Neither "check, then prune" nor "check,
  // then create the child" is safe across processes, so the two sides publish a marker first and look at the
  // other side's marker second (a store must make the markers durable and linearizable the same way as `append`):
  //   child:  pinReference(parent, child)  ->  (it reports 'parent-pruned' if the tombstone is already there)  ->  append child
  //   prune:  markPruned(tombstone)        ->  listReferences(parent) / look at the tasks  ->  withdrawTombstone or prune
  // Whichever marker is published second sees the first, so at least one side backs off.

  /** Record that `childId` is being created with a reference to `parentId`. Create-only and idempotent. */
  pinReference?(parentId: string, childId: string, at: string): Promise<'pinned' | 'parent-pruned' | 'parent-missing'>;
  /** The references recorded by `pinReference` (pins stay until the parent is pruned). */
  listReferences?(parentId: string): Promise<Array<{ childId: string; at: string }>>;
  /** Adapter of the pre-register protocol: open a prune attempt (`preparePrune`), remove nothing. Idempotent. */
  markPruned?(tombstone: Tombstone): Promise<void>;
  /**
   * Adapter of the pre-register protocol: `decidePrune(abort)` for the open attempt. Throws `TombstoneCommittedError`
   * when the register says `commit`: a committed prune cannot be taken back.
   */
  withdrawTombstone?(tombstone: Tombstone): Promise<void>;

  // --- Optional: the persisted prune decision register (ADR-019). Required of a store that claims Design A. ---

  /**
   * Publish the next attempt (`prune-<n>.prepare.json`, create-only) for a task in state `live`, or accept the attempt
   * that is already open (`preparing`). `n = 1 + the highest attempt ever seen`; numbers are never reused. Refuses
   * (`PruneAttemptLimitError`) when `n > MAX_PRUNE_ATTEMPTS`, and in every other state.
   */
  preparePrune?(tombstone: Tombstone): Promise<{ attempt: number; created: boolean }>;
  /**
   * Publish the decision of an attempt (create-only, first writer wins) and return the VALUE OF THE REGISTER, which is
   * not necessarily the value asked for. Only for an attempt whose valid `prepare` is visible. A `commit` must carry the
   * tombstone of the attempt. It never deletes or rewrites a decision.
   */
  decidePrune?(taskId: string, attempt: number, outcome: PruneOutcome, tombstone?: Tombstone, by?: DecisionBy): Promise<PruneOutcome>;
  /** Derive the state of the register (Design A, section 20.2). Read-only; never repairs and never deletes. */
  pruneState?(taskId: string): Promise<PruneState>;
}
