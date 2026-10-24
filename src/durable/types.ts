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
  'effect.failed': { key: string; error: string; retryable: boolean };
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
  code: 'LOOSE_COPY_OF_COMPACTED_EVENT' | 'STAGING_RESIDUE_REPAIRED' | 'STAGING_FILE_PRESENT' | 'UNKNOWN_ENTRY';
  taskId: string;
  name: string;
}

export interface LogRead {
  /** False when the task directory does not exist and no tombstone is present. */
  exists: boolean;
  tombstone: Tombstone | null;
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

/**
 * The persistence contract. A backend must provide ONE linearizable primitive:
 * `append` publishes an event at `event.seq` if and only if that slot is free,
 * atomically, and reports `'conflict'` otherwise. Everything else (locking-free
 * concurrency, idempotency, fencing, integrity) is built on it above this line,
 * so a SQL/KV backend can implement it with a unique key.
 */
export interface EventStore {
  readLog(taskId: string, opts?: { afterSeq?: number }): Promise<LogRead>;
  append(event: TaskEvent): Promise<'appended' | 'conflict'>;
  listTaskIds(): Promise<string[]>;
  /** Pack verified events `1..throughSeq` into immutable storage, then drop the loose copies. Idempotent. */
  compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult>;
  /** Write the tombstone, then remove the task's data. Idempotent: a second call finishes an interrupted one. */
  prune(tombstone: Tombstone): Promise<{ removedFiles: number }>;
}
