/**
 * DurableTasks — the application-facing API of Durable State.
 *
 * Every state change is one event appended to the task's log by compare-and-
 * set on the next sequence number (see `EventStore.append`). There is no
 * lock and no in-memory authority: any process can load a task from the store,
 * decide, and append; if another process appended first the attempt re-reads
 * and decides again against the new state. Consequences:
 *
 *  - no lost updates, no stale locks, nothing to recover after a crash —
 *    a crash leaves either the event (complete) or nothing;
 *  - every operation is idempotent where a retry after a crash is plausible
 *    (same id + same content is a no-op; same id + different content is an
 *    error), so "run the step again" is always safe at the state level;
 *  - a worker acts under a *fence* (owner + epoch): once someone else claims
 *    the task, the old worker's next write fails with `StaleFenceError`
 *    instead of interleaving with the new one;
 *  - results from outside arrive through `deliver(token, ...)`, which needs no
 *    live process, tolerates duplicates and any order, and never loses a
 *    payload it declines to apply.
 *
 * Side effects *outside* the store cannot be made exactly-once by a store.
 * `runEffect` records intent before and outcome after, so after a crash the
 * state says precisely which effects completed, which are known not to have
 * run, and which are *in doubt* (needs reconciliation with the external system).
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import { hostname } from 'os';
import { canonicalize, fingerprintOf, toJson, type Json } from './canonical.js';
import { assessTask, diffStates, leaseIsLive, type AssessOptions, type Assessment, type StateChange } from './assess.js';
import {
  ContentionError,
  EffectConflictError,
  EffectFailedError,
  EffectInDoubtError,
  LeaseHeldError,
  LogCorruptError,
  LogTooLargeError,
  RetentionRefusedError,
  StaleFenceError,
  TaskClosedError,
  TaskExistsError,
  TaskNotFoundError,
  TaskPrunedError,
  ValidationError,
} from './errors.js';
import { AppendOutcomeUnknownError } from './fs-store.js';
import { assertId, assertNonEmpty, stampEvent, verifyChain } from './log.js';
import { applyEvent, cloneState, deliveryKey, foldEvents, foldUntil, planProblem } from './projection.js';
import { planRetention, type RetentionDecision, type RetentionPolicy } from './retention.js';
import {
  GENESIS_HASH,
  type AssumptionState,
  type Criticality,
  type EffectState,
  type EventDataMap,
  type EventDraft,
  type EventStore,
  type EventType,
  type Evidence,
  type PlanStepDecl,
  type PlanStepState,
  type StoreDiagnostic,
  type TaskEvent,
  type TaskState,
  type TaskStatus,
  type Tombstone,
} from './types.js';
import { sha256Hex } from './canonical.js';

export interface DurableTasksOptions {
  store: EventStore;
  now?: () => Date;
  /** Source of ids for tasks/awaits created without an explicit id. */
  newId?: () => string;
  defaultLeaseMs?: number;
  maxEventsPerTask?: number;
  maxAppendAttempts?: number;
  /** Tasks kept in the in-memory read cache (least recently used are dropped). Default 256. */
  maxCachedTasks?: number;
}

/** Proof of the right to act on a task as its current worker. */
export interface Fence {
  taskId: string;
  owner: string;
  epoch: number;
}

export interface CreateTaskInput {
  /** Supply a deterministic id to make creation idempotent across retries and restarts. */
  taskId?: string;
  kind: string;
  goal: string;
  input?: unknown;
  parentTaskId?: string;
  dependsOn?: string[];
  labels?: Record<string, string>;
}

export interface TaskSummary {
  taskId: string;
  kind: string;
  goal: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  headSeq: number;
  pendingAwaits: number;
  leaseOwner: string | null;
  parentTaskId: string | null;
}

export type DeliveryResult =
  | { kind: 'accepted'; taskId: string; awaitId: string; seq: number }
  /** Same idempotency key seen before: nothing was written. */
  | { kind: 'duplicate'; taskId: string; awaitId: string; seq: number }
  /** The await already had a different result. The delivery is kept in the log as `await.delivery_rejected`. */
  | { kind: 'conflict'; taskId: string; awaitId: string; seq: number }
  | { kind: 'ignored'; reason: 'task-closed' | 'task-pruned'; taskId: string }
  | { kind: 'rejected'; reason: 'malformed-token' | 'unknown-task' | 'unknown-await' | 'bad-token' };

export interface EffectOptions<T extends Json> {
  description: string;
  params?: unknown;
  /**
   * Asked when the previous attempt left the outcome unrecorded. Look at the external
   * system (by the effect key, which should double as its idempotency key) and say what happened.
   */
  reconcile?: (effect: EffectState) => Promise<{ status: 'completed'; result: T } | { status: 'not-executed' }>;
  /** Whether a thrown error leaves the effect retryable (default true). */
  retryable?: boolean;
}

export interface EffectOutcome<T> {
  result: T;
  /** True when the recorded result was returned and the function was not called. */
  replayed: boolean;
}

export interface ResumePacket {
  formatVersion: 1;
  generatedFromSeq: number;
  task: {
    taskId: string; kind: string; goal: string; input: Json | null; parentTaskId: string | null;
    dependsOn: string[]; labels: Record<string, string>; status: TaskStatus; createdAt: string; headSeq: number;
  };
  assessment: Assessment;
  plan: PlanStepState[] | null;
  decisions: TaskState['decisions'];
  assumptions: AssumptionState[];
  observations: TaskState['observations'][string][];
  effects: EffectState[];
  awaits: Array<TaskState['awaits'][string]>;
  /** For every unconsumed result: what changed between sending the request and now. */
  sinceSend: Array<{ awaitId: string; basisSeq: number; changes: StateChange[] }>;
  timeline: Array<{ seq: number; type: string; at: string; actor: string | null; key: string | null }>;
  timelineTruncated: boolean;
}

export interface VerifyReport {
  taskId: string;
  ok: boolean;
  headSeq: number | null;
  status: TaskStatus | 'pruned' | null;
  error: string | null;
  diagnostics: StoreDiagnostic[];
}

export interface RetentionReport {
  decisions: RetentionDecision[];
  applied: Array<{ taskId: string; action: 'prune' | 'compact'; detail: string }>;
}

const KIND_MAX = 100;
const GOAL_MAX = 4000;
const TEXT_MAX = 4000;
const KEY_MAX = 200;
const MAX_TIMELINE = 500;
const COMPACT_CHUNK_BYTES = 4 * 1024 * 1024;

function draft<T extends EventType>(type: T, actor: string | null, data: EventDataMap[T]): EventDraft {
  return { type, actor, data } as EventDraft;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A unique, human-readable worker identity: host, pid, random suffix. Use one per process incarnation. */
export function newOwnerId(): string {
  return `${hostname().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24)}-${process.pid}-${randomBytes(3).toString('hex')}`;
}

/** What a compare-and-set on an effect compares: its state and the announcement it belongs to. */
function effectIdentity(e: EffectState | undefined): string {
  return e ? `${e.status}@${e.intendedAtSeq}` : 'none';
}

const TOKEN_PREFIX = 'dsc1';

export function parseToken(token: unknown): { taskId: string; awaitId: string; nonce: string } | null {
  if (typeof token !== 'string' || token.length > 400) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const [, taskId, awaitId, nonce] = parts as [string, string, string, string];
  try {
    assertId('taskId', taskId);
    assertId('awaitId', awaitId);
  } catch {
    return null;
  }
  return /^[0-9a-f]{32}$/.test(nonce) ? { taskId, awaitId, nonce } : null;
}

export class DurableTasks {
  private readonly store: EventStore;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly defaultLeaseMs: number;
  private readonly maxEvents: number;
  private readonly maxAttempts: number;
  private readonly maxCached: number;
  /** Validated, incrementally extended view per task. A cache of the log, never an authority. */
  private readonly cache = new Map<string, TaskState>();
  /** Effect executions running in this runtime, so concurrent calls with one identity share one `fn` call. */
  private readonly inflight = new Map<string, Promise<EffectOutcome<Json>>>();

  constructor(opts: DurableTasksOptions) {
    this.store = opts.store;
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? (() => randomBytes(8).toString('hex'));
    this.defaultLeaseMs = opts.defaultLeaseMs ?? 5 * 60_000;
    this.maxEvents = opts.maxEventsPerTask ?? 50_000;
    this.maxAttempts = opts.maxAppendAttempts ?? 100;
    this.maxCached = opts.maxCachedTasks ?? 256;
  }

  private remember(taskId: string, state: TaskState): void {
    this.cache.delete(taskId); // re-insert: Map order is recency order
    this.cache.set(taskId, state);
    while (this.cache.size > this.maxCached) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }

  // =========================================================================
  // Core: load and compare-and-set append
  // =========================================================================

  /** Brings the cached state up to the head of the log. Throws if the task is missing or pruned. */
  private async refresh(taskId: string): Promise<TaskState> {
    for (let pass = 0; ; pass++) {
      const cached = this.cache.get(taskId);
      const after = cached?.headSeq ?? 0;
      const log = await this.store.readLog(taskId, { afterSeq: after });
      if (log.tombstone) {
        this.cache.delete(taskId);
        throw new TaskPrunedError(taskId);
      }
      if (!log.exists || (log.events.length === 0 && !cached)) {
        this.cache.delete(taskId);
        throw new TaskNotFoundError(taskId);
      }
      if (log.events.length === 0) return cached as TaskState;
      try {
        verifyChain(taskId, log.events, after, cached?.headHash ?? GENESIS_HASH);
        const next = foldEvents(log.events, cached ? cloneState(cached) : null);
        this.remember(taskId, next);
        return next;
      } catch (err) {
        // A cached prefix that no longer matches the log is dropped and re-read once from scratch.
        if (cached && pass === 0 && err instanceof LogCorruptError) {
          this.cache.delete(taskId);
          continue;
        }
        throw err;
      }
    }
  }

  private async loadFull(taskId: string): Promise<{ state: TaskState; events: TaskEvent[]; diagnostics: StoreDiagnostic[]; compactedThrough: number }> {
    const log = await this.store.readLog(taskId);
    if (log.tombstone) throw new TaskPrunedError(taskId);
    if (!log.exists || log.events.length === 0) throw new TaskNotFoundError(taskId);
    verifyChain(taskId, log.events, 0, GENESIS_HASH);
    const state = foldEvents(log.events);
    this.remember(taskId, state);
    return { state: cloneState(state), events: log.events, diagnostics: log.diagnostics, compactedThrough: log.compactedThrough };
  }

  /**
   * Read state -> decide -> append, repeated until the append wins its slot.
   * `plan` must be a pure function of the state it is given: it is re-run
   * against fresh state after every lost race.
   */
  private async mutate<R>(
    taskId: string,
    plan: (s: TaskState) => { draft: EventDraft | null; result: (event: TaskEvent | null, state: TaskState) => R },
  ): Promise<R> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const state = await this.refresh(taskId);
      if (state.status !== 'active') {
        // A planner may still answer a read-only question about a closed task (e.g. duplicate delivery).
        const probe = plan(state);
        if (probe.draft === null) return probe.result(null, state);
        throw new TaskClosedError(taskId, state.status);
      }
      const p = plan(state);
      if (p.draft === null) return p.result(null, state);
      if (state.eventCount >= this.maxEvents) throw new LogTooLargeError(taskId, this.maxEvents);

      const event = stampEvent(taskId, state.headSeq + 1, this.now().toISOString(), state.headHash, p.draft);
      const next = this.precheck(state, event);

      let outcome: 'appended' | 'conflict';
      try {
        outcome = await this.store.append(event);
      } catch (err) {
        if (!(err instanceof AppendOutcomeUnknownError)) throw err;
        outcome = await this.resolveUnknown(event);
      }
      if (outcome === 'appended') {
        this.remember(taskId, next);
        return p.result(event, next);
      }
      if (attempt >= 2) await sleep(Math.floor(Math.random() * Math.min(2 ** attempt, 40)));
    }
    throw new ContentionError(taskId, this.maxAttempts);
  }

  /**
   * Runs a proposed event through the fold before anything is stored. A violation here means the *caller's*
   * request does not fit the task's current state (the stored log was just verified and is fine), so it is
   * a `ValidationError`, never a `LogCorruptError`: corruption is reserved for stored data that fails verification.
   */
  private precheck(state: TaskState, event: TaskEvent): TaskState {
    try {
      return applyEvent(cloneState(state), event);
    } catch (err) {
      if (err instanceof LogCorruptError) {
        throw new ValidationError(`${event.type} is not allowed in the current state of task "${event.taskId}": ${err.reason}.`);
      }
      throw err;
    }
  }

  /** After an unknown publication outcome: is *our* event (same hash) the one in the slot? */
  private async resolveUnknown(event: TaskEvent): Promise<'appended' | 'conflict'> {
    const log = await this.store.readLog(event.taskId, { afterSeq: event.seq - 1 });
    const there = log.events[0];
    return there !== undefined && there.seq === event.seq && there.hash === event.hash ? 'appended' : 'conflict';
  }

  // =========================================================================
  // Tasks
  // =========================================================================

  async createTask(input: CreateTaskInput): Promise<{ taskId: string; created: boolean; state: TaskState }> {
    assertNonEmpty('kind', input.kind, KIND_MAX);
    assertNonEmpty('goal', input.goal, GOAL_MAX);
    const taskId = input.taskId ?? `task-${this.newId()}`;
    assertId('taskId', taskId);
    const refs = [...(input.parentTaskId ? [input.parentTaskId] : []), ...(input.dependsOn ?? [])];
    for (const r of refs) assertId('referenced task id', r);
    const labels = input.labels ?? {};
    if (Object.keys(labels).length > 20) throw new ValidationError('at most 20 labels.');
    for (const [k, v] of Object.entries(labels)) {
      if (typeof v !== 'string' || k.length > 64 || v.length > 256) throw new ValidationError('labels must be short string pairs.');
    }
    const data: EventDataMap['task.created'] = {
      kind: input.kind,
      goal: input.goal,
      input: input.input === undefined ? null : toJson(input.input, 'input'),
      parentTaskId: input.parentTaskId ?? null,
      dependsOn: [...(input.dependsOn ?? [])].sort(),
      labels: { ...labels },
    };
    for (const r of refs) {
      try {
        await this.refresh(r);
      } catch (err) {
        if (err instanceof TaskNotFoundError || err instanceof TaskPrunedError) {
          throw new ValidationError(`referenced task "${r}" does not exist (or was pruned).`);
        }
        throw err;
      }
    }

    const event = stampEvent(taskId, 1, this.now().toISOString(), GENESIS_HASH, draft('task.created', null, data));
    let outcome: 'appended' | 'conflict';
    try {
      outcome = await this.store.append(event);
    } catch (err) {
      if (!(err instanceof AppendOutcomeUnknownError)) throw err;
      outcome = await this.resolveUnknown(event);
    }
    if (outcome === 'appended') {
      const state = applyEvent(null, event);
      this.remember(taskId, state);
      return { taskId, created: true, state: cloneState(state) };
    }
    // The id is taken: the same request repeated is fine, a different one is an error.
    const existing = await this.refresh(taskId);
    const same =
      existing.kind === data.kind && existing.goal === data.goal && existing.parentTaskId === data.parentTaskId &&
      canonicalize(existing.input) === canonicalize(data.input) &&
      canonicalize(existing.dependsOn as unknown as Json) === canonicalize(data.dependsOn as unknown as Json) &&
      canonicalize(existing.labels) === canonicalize(data.labels);
    if (!same) throw new TaskExistsError(taskId);
    return { taskId, created: false, state: cloneState(existing) };
  }

  async getState(taskId: string): Promise<TaskState> {
    return cloneState(await this.refresh(taskId));
  }

  /** The state when the log had `seq` events. */
  async getStateAt(taskId: string, seq: number): Promise<TaskState> {
    const { events } = await this.loadFull(taskId);
    if (!Number.isInteger(seq) || seq < 1 || seq > events.length) throw new ValidationError(`seq must be between 1 and ${events.length}.`);
    return foldUntil(events, seq);
  }

  async getLog(taskId: string): Promise<{ state: TaskState; events: TaskEvent[]; diagnostics: StoreDiagnostic[] }> {
    const { state, events, diagnostics } = await this.loadFull(taskId);
    return { state, events, diagnostics };
  }

  async listTasks(filter: { status?: TaskStatus; kind?: string; label?: [string, string] } = {}): Promise<TaskSummary[]> {
    const out: TaskSummary[] = [];
    for (const id of await this.store.listTaskIds()) {
      let s: TaskState;
      try {
        s = await this.refresh(id);
      } catch (err) {
        if (err instanceof TaskPrunedError || err instanceof TaskNotFoundError) continue;
        throw err;
      }
      if (filter.status && s.status !== filter.status) continue;
      if (filter.kind && s.kind !== filter.kind) continue;
      if (filter.label && s.labels[filter.label[0]] !== filter.label[1]) continue;
      out.push({
        taskId: s.taskId, kind: s.kind, goal: s.goal, status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt,
        closedAt: s.closedAt, headSeq: s.headSeq, parentTaskId: s.parentTaskId,
        pendingAwaits: Object.values(s.awaits).filter((a) => a.status === 'pending').length,
        leaseOwner: s.lease && !s.lease.released ? s.lease.owner : null,
      });
    }
    return out;
  }

  // =========================================================================
  // Worker identity: lease + fencing
  // =========================================================================

  /**
   * Become the task's current worker. Fails with `LeaseHeldError` while another
   * owner's lease is live; an expired or released lease (a dead worker) can be
   * taken over. Every claim increments the epoch, which fences out the previous holder.
   */
  async claim(taskId: string, opts: { owner: string; leaseMs?: number }): Promise<Fence> {
    assertId('owner', opts.owner);
    const leaseMs = opts.leaseMs ?? this.defaultLeaseMs;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new ValidationError('leaseMs must be positive.');
    return this.mutate(taskId, (s) => {
      if (s.status !== 'active') throw new TaskClosedError(taskId, s.status);
      const now = this.now();
      if (s.lease && leaseIsLive(s, now) && s.lease.owner !== opts.owner) {
        throw new LeaseHeldError(taskId, s.lease.owner, s.lease.leaseUntil);
      }
      const epoch = s.epoch + 1;
      return {
        draft: draft('run.claimed', opts.owner, {
          owner: opts.owner, epoch, leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
          takeover: s.lease !== null && !s.lease.released,
        }),
        result: () => ({ taskId, owner: opts.owner, epoch }),
      };
    });
  }

  private assertFence(s: TaskState, f: Fence): void {
    if (s.status !== 'active') throw new TaskClosedError(s.taskId, s.status);
    if (!s.lease || s.lease.released || s.lease.owner !== f.owner || s.lease.epoch !== f.epoch) {
      throw new StaleFenceError(s.taskId, f.owner, f.epoch, s.epoch);
    }
  }

  /** Mutation by the fenced worker. */
  private fenced<R>(
    f: Fence,
    plan: (s: TaskState) => { draft: EventDraft | null; result: (event: TaskEvent | null, state: TaskState) => R },
  ): Promise<R> {
    return this.mutate(f.taskId, (s) => {
      this.assertFence(s, f);
      return plan(s);
    });
  }

  async heartbeat(f: Fence, leaseMs?: number): Promise<void> {
    const ms = leaseMs ?? this.defaultLeaseMs;
    await this.fenced(f, () => ({
      draft: draft('run.heartbeat', f.owner, { owner: f.owner, epoch: f.epoch, leaseUntil: new Date(this.now().getTime() + ms).toISOString() }),
      result: () => undefined,
    }));
  }

  /** Give the task up. Idempotent; a closed task or an already-superseded fence is a quiet no-op. */
  async release(f: Fence): Promise<void> {
    try {
      await this.fenced(f, (s) => ({
        draft: s.lease?.released ? null : draft('run.released', f.owner, { owner: f.owner, epoch: f.epoch }),
        result: () => undefined,
      }));
    } catch (err) {
      if (err instanceof TaskClosedError || err instanceof StaleFenceError) return;
      throw err;
    }
  }

  // =========================================================================
  // Plan, decisions, assumptions, observations
  // =========================================================================

  async declarePlan(f: Fence, steps: Array<{ id: string; title: string; dependsOn?: string[] }>, reason?: string): Promise<void> {
    const decl: PlanStepDecl[] = steps.map((s) => {
      assertId('step id', s.id);
      assertNonEmpty('step title', s.title, 500);
      return { id: s.id, title: s.title, dependsOn: [...(s.dependsOn ?? [])] };
    });
    const problem = planProblem(decl);
    if (problem) throw new ValidationError(`invalid plan: ${problem}.`);
    await this.fenced(f, (s) => {
      const same =
        s.plan !== null && s.plan.length === decl.length &&
        decl.every((d, i) => {
          const p = (s.plan as PlanStepState[])[i] as PlanStepState;
          return p.id === d.id && p.title === d.title && canonicalize(p.dependsOn as unknown as Json) === canonicalize(d.dependsOn as unknown as Json);
        });
      return { draft: same ? null : draft('plan.declared', f.owner, { steps: decl, reason: reason ?? null }), result: () => undefined };
    });
  }

  /** Marks a step done. Idempotent: completing a done step is a no-op. */
  async completeStep(f: Fence, stepId: string, result?: unknown): Promise<void> {
    const res = result === undefined ? null : toJson(result, 'result');
    await this.fenced(f, (s) => {
      const step = s.plan?.find((p) => p.id === stepId);
      if (!step) throw new ValidationError(`unknown plan step "${stepId}".`);
      if (step.status === 'done') return { draft: null, result: () => undefined };
      if (step.status === 'skipped') throw new ValidationError(`step "${stepId}" was skipped.`);
      const open = step.dependsOn.filter((d) => (s.plan as PlanStepState[]).find((p) => p.id === d)?.status === 'pending');
      if (open.length > 0) throw new ValidationError(`step "${stepId}" depends on unfinished step(s): ${open.join(', ')}.`);
      const waiting = Object.values(s.awaits).filter((a) => a.stepId === stepId && a.status !== 'resolved');
      if (waiting.length > 0) throw new ValidationError(`step "${stepId}" still waits for: ${waiting.map((a) => a.awaitId).join(', ')} (skipStep to bypass).`);
      return { draft: draft('plan.step_done', f.owner, { stepId, result: res }), result: () => undefined };
    });
  }

  async skipStep(f: Fence, stepId: string, reason: string): Promise<void> {
    assertNonEmpty('reason', reason, TEXT_MAX);
    await this.fenced(f, (s) => {
      const step = s.plan?.find((p) => p.id === stepId);
      if (!step) throw new ValidationError(`unknown plan step "${stepId}".`);
      if (step.status === 'skipped') return { draft: null, result: () => undefined };
      if (step.status === 'done') throw new ValidationError(`step "${stepId}" is already done.`);
      return { draft: draft('plan.step_skipped', f.owner, { stepId, reason }), result: () => undefined };
    });
  }

  /** Records why something was chosen. Same id + same content is a no-op. */
  async recordDecision(f: Fence, d: { id: string; summary: string; rationale?: string; basedOn?: string[] }): Promise<void> {
    assertId('decision id', d.id);
    assertNonEmpty('summary', d.summary, TEXT_MAX);
    const data: EventDataMap['decision.recorded'] = { id: d.id, summary: d.summary, rationale: d.rationale ?? null, basedOn: [...(d.basedOn ?? [])] };
    await this.fenced(f, (s) => {
      const old = s.decisions.find((x) => x.id === d.id);
      if (old) {
        if (old.summary === data.summary && old.rationale === data.rationale && canonicalize(old.basedOn as unknown as Json) === canonicalize(data.basedOn as unknown as Json)) {
          return { draft: null, result: () => undefined };
        }
        throw new ValidationError(`decision "${d.id}" already exists with different content.`);
      }
      return { draft: draft('decision.recorded', f.owner, data), result: () => undefined };
    });
  }

  /**
   * Records something the plan relies on, together with the value it was
   * based on. `assess` later compares it with the current value of the same
   * key. `blocking` (default): if it changes, the plan is not to be trusted.
   * `advisory`: if it changes, adapt.
   */
  async recordAssumption(
    f: Fence,
    a: {
      key: string;
      statement: string;
      value: unknown;
      criticality?: Criticality;
      evidence?: Array<{ ref: string; note?: string }>;
      /**
       * Replace an active assumption that holds a DIFFERENT value. Off by default on purpose: a worker
       * that is re-run after a restart re-states its assumptions, and silently overwriting the recorded
       * value with today's one would erase exactly the change `assess` exists to detect.
       */
      supersede?: boolean;
    },
  ): Promise<void> {
    assertNonEmpty('assumption key', a.key, KEY_MAX);
    assertNonEmpty('statement', a.statement, TEXT_MAX);
    const value = toJson(a.value, 'assumption value');
    const evidence: Evidence[] = (a.evidence ?? []).map((e) => {
      assertNonEmpty('evidence ref', e.ref, 1000);
      return { ref: e.ref, note: e.note ?? null };
    });
    const data: EventDataMap['assumption.recorded'] = {
      key: a.key, statement: a.statement, criticality: a.criticality ?? 'blocking', fingerprint: fingerprintOf(value), value, evidence,
    };
    await this.fenced(f, (s) => {
      const old = s.assumptions[a.key];
      if (
        old && old.status === 'active' && old.fingerprint === data.fingerprint && old.statement === data.statement &&
        old.criticality === data.criticality && canonicalize(old.evidence as unknown as Json) === canonicalize(evidence as unknown as Json)
      ) {
        return { draft: null, result: () => undefined };
      }
      if (old && old.status === 'active' && old.fingerprint !== data.fingerprint && !a.supersede) {
        throw new ValidationError(
          `assumption "${a.key}" is already recorded with a different value; it was made before the world may have changed. ` +
            'Compare it with the current value (assess) and pass supersede: true only for a deliberate re-assessment.',
        );
      }
      return { draft: draft('assumption.recorded', f.owner, data), result: () => undefined };
    });
  }

  async retractAssumption(f: Fence, key: string, reason: string): Promise<void> {
    assertNonEmpty('reason', reason, TEXT_MAX);
    await this.fenced(f, (s) => {
      const a = s.assumptions[key];
      if (!a) throw new ValidationError(`no assumption "${key}".`);
      return { draft: a.status === 'retracted' ? null : draft('assumption.retracted', f.owner, { key, reason }), result: () => undefined };
    });
  }

  /**
   * Another agent or system reports a fact about the world. No fence: observers
   * are not the task's worker. An observation equal to the latest one for the key is a no-op.
   */
  async observe(taskId: string, o: { key: string; value: unknown; source?: string }): Promise<void> {
    assertNonEmpty('observation key', o.key, KEY_MAX);
    const value = toJson(o.value, 'observation value');
    const fingerprint = fingerprintOf(value);
    await this.mutate(taskId, (s) => {
      if (s.observations[o.key]?.fingerprint === fingerprint) return { draft: null, result: () => undefined };
      return {
        draft: draft('fact.observed', o.source ?? null, { key: o.key, fingerprint, value, source: o.source ?? null }),
        result: () => undefined,
      };
    });
  }

  // =========================================================================
  // Effects
  // =========================================================================

  /**
   * Runs `fn` at most once *as far as the log can tell*, and records what happened.
   * `key` should also be the idempotency key sent to the external system.
   *
   *  - completed before: returns the recorded result, `fn` is not called;
   *  - intent recorded but no outcome (crash in between): calls `reconcile` if
   *    given, else throws `EffectInDoubtError` — it will not guess;
   *  - failed before as retryable: runs again; non-retryable: `EffectFailedError`.
   *
   * Concurrency. Calls with the same (fence, key) inside one runtime share a single execution: the
   * later callers wait for it and receive its result (`replayed: true`) or its error. Between runtimes
   * and processes the guarantee comes from the log: the announcement (`effect.intended`) is appended
   * only if the effect is still exactly as this call found it, so of N callers that decided on the same
   * state only one announces and runs `fn`; the others get `EffectConflictError` and `fn` is not
   * called. A different owner finds the unfinished effect in doubt (its epoch is no longer current).
   * A fence belongs to one worker; sharing one fence between processes is outside the contract
   * (the compare-and-set still keeps `fn` single, but `reconcile` cannot tell a live peer from a dead one).
   */
  async runEffect<T extends Json>(f: Fence, key: string, fn: () => Promise<T>, opts: EffectOptions<T>): Promise<EffectOutcome<T>> {
    assertNonEmpty('effect key', key, KEY_MAX);
    assertNonEmpty('description', opts.description, TEXT_MAX);
    const params = opts.params === undefined ? null : toJson(opts.params, 'effect params');

    // No await between the lookup and the registration: two callers cannot both miss the map.
    const slot = `${f.taskId}\u0000${f.owner}\u0000${f.epoch}\u0000${key}`;
    const running = this.inflight.get(slot);
    if (running) {
      const shared = await running;
      return { result: shared.result as T, replayed: true };
    }
    const run = this.executeEffect(f, key, fn, opts, params);
    this.inflight.set(slot, run as Promise<EffectOutcome<Json>>);
    try {
      return await run;
    } finally {
      if (this.inflight.get(slot) === run) this.inflight.delete(slot);
    }
  }

  private async executeEffect<T extends Json>(f: Fence, key: string, fn: () => Promise<T>, opts: EffectOptions<T>, params: Json | null): Promise<EffectOutcome<T>> {
    const taskId = f.taskId;
    const state = await this.getState(taskId);
    this.assertFence(state, f);
    const prior = state.effects[key];
    if (prior?.status === 'completed') return { result: prior.result as T, replayed: true };
    if (prior?.status === 'failed' && !prior.retryable) throw new EffectFailedError(taskId, key, prior.error ?? 'unknown');
    if (prior?.status === 'intended') {
      if (!opts.reconcile) throw new EffectInDoubtError(taskId, key);
      const verdict = await opts.reconcile(prior);
      if (verdict.status === 'completed') {
        const res = toJson(verdict.result, 'reconciled result');
        const recorded = await this.fenced<Json>(f, (s) => {
          const cur = s.effects[key];
          if (cur?.status === 'completed') return { draft: null, result: () => cur.result };
          if (effectIdentity(cur) !== effectIdentity(prior)) throw new EffectConflictError(taskId, key);
          return { draft: draft('effect.completed', f.owner, { key, result: res }), result: () => res };
        });
        return { result: recorded as T, replayed: true };
      }
      // not executed: fall through and run it, re-announcing the intent under our epoch.
    }

    // Announce. The append succeeds only if the effect is still as we found it.
    const announced = await this.fenced<{ replay: Json | undefined }>(f, (s) => {
      const cur = s.effects[key];
      if (cur?.status === 'completed') return { draft: null, result: () => ({ replay: cur.result }) };
      if (effectIdentity(cur) !== effectIdentity(prior)) throw new EffectConflictError(taskId, key);
      return {
        draft: draft('effect.intended', f.owner, { key, description: opts.description, params, epoch: f.epoch }),
        result: () => ({ replay: undefined }),
      };
    });
    if (announced.replay !== undefined) return { result: announced.replay as T, replayed: true };

    let result: T;
    try {
      result = await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.fenced(f, () => ({
        draft: draft('effect.failed', f.owner, { key, error: message.slice(0, TEXT_MAX), retryable: opts.retryable ?? true }),
        result: () => undefined,
      }));
      throw err;
    }
    const res = toJson(result, 'effect result');
    await this.fenced(f, (s) => ({
      draft: s.effects[key]?.status === 'completed' ? null : draft('effect.completed', f.owner, { key, result: res }),
      result: () => undefined,
    }));
    return { result, replayed: false };
  }

  // =========================================================================
  // Waiting for the outside world
  // =========================================================================

  /**
   * Announces that an answer is expected and returns the token the answer must
   * carry. Idempotent per `awaitId`: a restarted worker that registers the same
   * await again gets the same token and nothing new is written.
   * `basisSeq` records where the log stood at send time, so "what did the task
   * look like then, and what changed since" is always answerable.
   */
  async registerAwait(
    f: Fence,
    a: { awaitId?: string; purpose: string; stepId?: string; request?: unknown; deadlineAt?: Date | string },
  ): Promise<{ awaitId: string; token: string; created: boolean }> {
    const awaitId = a.awaitId ?? `await-${this.newId()}`;
    assertId('awaitId', awaitId);
    assertNonEmpty('purpose', a.purpose, 500);
    const request = a.request === undefined ? null : toJson(a.request, 'request');
    const deadlineMs = a.deadlineAt === undefined ? null : new Date(a.deadlineAt).getTime();
    if (deadlineMs !== null && !Number.isFinite(deadlineMs)) throw new ValidationError('deadlineAt is not a valid date.');
    const deadlineAt = deadlineMs === null ? null : new Date(deadlineMs).toISOString();
    return this.fenced<{ awaitId: string; token: string; created: boolean }>(f, (s) => {
      const old = s.awaits[awaitId];
      if (old) {
        if (old.purpose !== a.purpose || old.stepId !== (a.stepId ?? null)) {
          throw new ValidationError(`await "${awaitId}" already exists with a different purpose or step.`);
        }
        return { draft: null, result: () => ({ awaitId, token: old.token, created: false }) };
      }
      if (a.stepId !== undefined && !s.plan?.some((p) => p.id === a.stepId)) {
        throw new ValidationError(`await refers to unknown plan step "${a.stepId}"; declare the plan first.`);
      }
      const token = `${TOKEN_PREFIX}.${f.taskId}.${awaitId}.${randomBytes(16).toString('hex')}`;
      return {
        draft: draft('await.registered', f.owner, {
          awaitId, token, purpose: a.purpose, stepId: a.stepId ?? null, request, deadlineAt, basisSeq: s.headSeq,
        }),
        result: () => ({ awaitId, token, created: true }),
      };
    });
  }

  /**
   * Hand an externally produced result to the task it belongs to. Needs no
   * live process and no fence — only the token. Safe to call repeatedly and in any order:
   *  - same `idempotencyKey` again → `duplicate`, nothing written;
   *  - a different result for an already resolved await → `conflict`; the payload is kept
   *    in the log (`await.delivery_rejected`) and does not replace the first one;
   *  - a result after the await's deadline passed → accepted, flagged `late`;
   *  - a result for a finished task → `ignored` (its log is sealed).
   */
  async deliver(token: string, payload: unknown, opts: { idempotencyKey: string; source?: string }): Promise<DeliveryResult> {
    assertNonEmpty('idempotencyKey', opts.idempotencyKey, KEY_MAX);
    const parsed = parseToken(token);
    if (!parsed) return { kind: 'rejected', reason: 'malformed-token' };
    const body = toJson(payload, 'payload');
    const { taskId, awaitId, nonce } = parsed;
    try {
      return await this.mutate<DeliveryResult>(taskId, (s) => {
        const known = s.deliveryKeys[deliveryKey(awaitId, opts.idempotencyKey)];
        const a = s.awaits[awaitId];
        if (!a) return { draft: null, result: () => ({ kind: 'rejected', reason: 'unknown-await' }) };
        const got = Buffer.from(nonce);
        const want = Buffer.from(a.token.split('.')[3] ?? '');
        if (got.length !== want.length || !timingSafeEqual(got, want)) {
          return { draft: null, result: () => ({ kind: 'rejected', reason: 'bad-token' }) };
        }
        if (known !== undefined) return { draft: null, result: () => ({ kind: 'duplicate', taskId, awaitId, seq: known }) };
        if (s.status !== 'active') return { draft: null, result: () => ({ kind: 'ignored', reason: 'task-closed', taskId }) };
        if (a.status === 'resolved') {
          return {
            draft: draft('await.delivery_rejected', opts.source ?? null, { awaitId, idempotencyKey: opts.idempotencyKey, reason: 'already-resolved', payload: body }),
            result: (e) => ({ kind: 'conflict', taskId, awaitId, seq: (e as TaskEvent).seq }),
          };
        }
        return {
          draft: draft('await.resolved', opts.source ?? null, {
            awaitId, idempotencyKey: opts.idempotencyKey, payload: body, source: opts.source ?? null, late: a.status === 'expired',
          }),
          result: (e) => ({ kind: 'accepted', taskId, awaitId, seq: (e as TaskEvent).seq }),
        };
      });
    } catch (err) {
      if (err instanceof TaskNotFoundError) return { kind: 'rejected', reason: 'unknown-task' };
      if (err instanceof TaskPrunedError) return { kind: 'ignored', reason: 'task-pruned', taskId };
      throw err;
    }
  }

  /** Marks pending awaits whose deadline has passed as expired. Returns the awaits it expired. */
  async sweepDeadlines(taskId?: string): Promise<Array<{ taskId: string; awaitId: string }>> {
    const ids = taskId ? [taskId] : await this.store.listTaskIds();
    const expired: Array<{ taskId: string; awaitId: string }> = [];
    for (const id of ids) {
      let s: TaskState;
      try {
        s = await this.refresh(id);
      } catch (err) {
        if (err instanceof TaskPrunedError || err instanceof TaskNotFoundError) continue;
        throw err;
      }
      if (s.status !== 'active') continue;
      for (const a of Object.values(s.awaits)) {
        if (a.status !== 'pending' || a.deadlineAt === null || Date.parse(a.deadlineAt) > this.now().getTime()) continue;
        await this.mutate(id, (cur) => {
          const x = cur.awaits[a.awaitId];
          return { draft: x && x.status === 'pending' ? draft('await.expired', null, { awaitId: a.awaitId }) : null, result: () => undefined };
        });
        expired.push({ taskId: id, awaitId: a.awaitId });
      }
    }
    return expired;
  }

  // =========================================================================
  // Closing
  // =========================================================================

  async complete(f: Fence, result?: unknown): Promise<void> {
    const res = result === undefined ? null : toJson(result, 'result');
    await this.fenced(f, () => ({ draft: draft('task.completed', f.owner, { result: res }), result: () => undefined }));
  }

  async fail(f: Fence, error: string, detail?: unknown): Promise<void> {
    assertNonEmpty('error', error, TEXT_MAX);
    const d = detail === undefined ? null : toJson(detail, 'detail');
    await this.fenced(f, () => ({ draft: draft('task.failed', f.owner, { error, detail: d }), result: () => undefined }));
  }

  /** Administrative stop: no fence needed. Idempotent for an already cancelled task. */
  async cancel(taskId: string, reason: string, actor?: string): Promise<void> {
    assertNonEmpty('reason', reason, TEXT_MAX);
    await this.mutate(taskId, (s) => ({
      draft: s.status === 'cancelled' ? null : draft('task.cancelled', actor ?? null, { reason }),
      result: () => undefined,
    }));
  }

  // =========================================================================
  // Resuming
  // =========================================================================

  async assess(taskId: string, opts: Omit<AssessOptions, 'now'> & { now?: Date } = {}): Promise<Assessment> {
    const { state, events } = await this.loadFull(taskId);
    return assessTask(state, events, { ...opts, now: opts.now ?? this.now() });
  }

  /** Everything a resumed worker — or a reasoning component — needs, in one deterministic document. */
  async resumePacket(taskId: string, opts: Omit<AssessOptions, 'now'> & { now?: Date } = {}): Promise<ResumePacket> {
    const { state, events } = await this.loadFull(taskId);
    const assessment = assessTask(state, events, { ...opts, now: opts.now ?? this.now() });
    const bases = [...new Set(assessment.results.map((r) => r.basisSeq))].sort((a, b) => a - b);
    const sinceSend = bases.map((basisSeq) => ({
      awaitId: assessment.results.filter((r) => r.basisSeq === basisSeq).map((r) => r.awaitId).sort().join(','),
      basisSeq,
      changes: diffStates(foldUntil(events, basisSeq), state),
    }));
    const timelineAll = events.map((e) => ({ seq: e.seq, type: e.type as string, at: e.at, actor: e.actor, key: this.keyOf(e) }));
    const byKey = <T extends { key: string }>(xs: T[]): T[] => xs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return {
      formatVersion: 1,
      generatedFromSeq: state.headSeq,
      task: {
        taskId: state.taskId, kind: state.kind, goal: state.goal, input: state.input, parentTaskId: state.parentTaskId,
        dependsOn: state.dependsOn, labels: state.labels, status: state.status, createdAt: state.createdAt, headSeq: state.headSeq,
      },
      assessment,
      plan: state.plan,
      decisions: state.decisions,
      assumptions: byKey(Object.values(state.assumptions)),
      observations: byKey(Object.values(state.observations)),
      effects: byKey(Object.values(state.effects)),
      awaits: Object.values(state.awaits).sort((a, b) => a.registeredAtSeq - b.registeredAtSeq),
      sinceSend,
      timeline: timelineAll.slice(-MAX_TIMELINE),
      timelineTruncated: timelineAll.length > MAX_TIMELINE,
    };
  }

  private keyOf(e: TaskEvent): string | null {
    switch (e.type) {
      case 'fact.observed': case 'assumption.recorded': case 'assumption.retracted': case 'effect.intended':
      case 'effect.completed': case 'effect.failed':
        return e.data.key;
      case 'decision.recorded':
        return e.data.id;
      case 'await.registered': case 'await.resolved': case 'await.expired': case 'await.delivery_rejected':
        return e.data.awaitId;
      case 'plan.step_done': case 'plan.step_skipped':
        return e.data.stepId;
      default:
        return null;
    }
  }

  /**
   * The wake-up query of a scheduler after a restart: active tasks nobody is
   * working on that have something to do (`direct`, `adaptive`, `recovery`).
   * Tasks that only wait for more results are not returned.
   */
  async findResumable(opts: { observations?: (state: TaskState) => Record<string, unknown> | undefined } = {}): Promise<Array<{ taskId: string; mode: Assessment['mode']; reasons: string[] }>> {
    const out: Array<{ taskId: string; mode: Assessment['mode']; reasons: string[] }> = [];
    for (const id of await this.store.listTaskIds()) {
      let loaded;
      try {
        loaded = await this.loadFull(id);
      } catch (err) {
        if (err instanceof TaskPrunedError || err instanceof TaskNotFoundError) continue;
        throw err;
      }
      if (loaded.state.status !== 'active') continue;
      const a = assessTask(loaded.state, loaded.events, { now: this.now(), observations: opts.observations?.(loaded.state) });
      if (!a.claimable || a.mode === 'waiting' || a.mode === 'closed') continue;
      out.push({ taskId: id, mode: a.mode, reasons: a.reasons.filter((r) => r.severity !== 'info').map((r) => r.code) });
    }
    return out;
  }

  // =========================================================================
  // Integrity and lifecycle
  // =========================================================================

  /** Re-reads and re-verifies logs end to end (hash chain, sequence, fold). Never repairs. */
  async verify(taskId?: string): Promise<VerifyReport[]> {
    const ids = taskId ? [taskId] : await this.store.listTaskIds();
    const reports: VerifyReport[] = [];
    for (const id of ids) {
      try {
        const log = await this.store.readLog(id);
        if (log.tombstone) {
          reports.push({ taskId: id, ok: true, headSeq: log.tombstone.headSeq, status: 'pruned', error: null, diagnostics: log.diagnostics });
          continue;
        }
        if (!log.exists || log.events.length === 0) throw new TaskNotFoundError(id);
        verifyChain(id, log.events, 0, GENESIS_HASH);
        const s = foldEvents(log.events);
        reports.push({ taskId: id, ok: true, headSeq: s.headSeq, status: s.status, error: null, diagnostics: log.diagnostics });
      } catch (err) {
        reports.push({ taskId: id, ok: false, headSeq: null, status: null, error: err instanceof Error ? err.message : String(err), diagnostics: [] });
      }
    }
    return reports;
  }

  /**
   * Decide what retention would do. Nothing is changed. Tasks whose log fails
   * verification are skipped (never pruned or compacted while corrupt).
   */
  async planRetention(policy: RetentionPolicy): Promise<RetentionDecision[]> {
    const states: TaskState[] = [];
    const compacted = new Map<string, number>();
    for (const id of await this.store.listTaskIds()) {
      try {
        const l = await this.loadFull(id);
        states.push(l.state);
        compacted.set(id, l.compactedThrough);
      } catch (err) {
        if (err instanceof TaskPrunedError || err instanceof TaskNotFoundError) continue;
        if (err instanceof LogCorruptError) continue;
        throw err;
      }
    }
    return planRetention(states, compacted, policy, this.now());
  }

  /** Executes a plan. Every destructive step re-checks its precondition against the live log. */
  async applyRetention(policy: RetentionPolicy): Promise<RetentionReport> {
    const decisions = await this.planRetention(policy);
    const applied: RetentionReport['applied'] = [];
    for (const d of decisions) {
      if (d.action === 'compact') {
        const n = await this.compact(d.taskId, { throughSeq: d.throughSeq as number });
        applied.push({ taskId: d.taskId, action: 'compact', detail: `${n} events packed` });
      } else if (d.action === 'prune') {
        try {
          const t = await this.pruneTask(d.taskId, policy);
          applied.push({ taskId: d.taskId, action: 'prune', detail: `tombstone ${t.headHash.slice(0, 12)}` });
        } catch (err) {
          if (err instanceof RetentionRefusedError) continue; // state changed since planning: keep
          throw err;
        }
      }
    }
    return { decisions, applied };
  }

  /** Packs events up to `throughSeq` into verified segments. Returns the number of events packed. */
  async compact(taskId: string, opts: { throughSeq: number }): Promise<number> {
    const { state, events, compactedThrough } = await this.loadFull(taskId);
    const through = Math.min(opts.throughSeq, state.headSeq - 1);
    if (through <= compactedThrough) return 0;
    const todo = events.filter((e) => e.seq > compactedThrough && e.seq <= through);
    let packed = 0;
    let chunk: TaskEvent[] = [];
    let bytes = 0;
    const flush = async (): Promise<void> => {
      if (chunk.length === 0) return;
      await this.store.compact(taskId, (chunk[chunk.length - 1] as TaskEvent).seq, chunk);
      packed += chunk.length;
      chunk = [];
      bytes = 0;
    };
    for (const e of todo) {
      const size = Buffer.byteLength(canonicalize(e as unknown as Json), 'utf8') + 1;
      if (bytes + size > COMPACT_CHUNK_BYTES) await flush();
      chunk.push(e);
      bytes += size;
    }
    await flush();
    return packed;
  }

  /**
   * Removes a finished task's log, leaving a tombstone. Refuses unless the
   * task is terminal, past retention, and not referenced by an active task —
   * checked now, against the live log, not against an earlier plan.
   */
  async pruneTask(taskId: string, policy: Pick<RetentionPolicy, 'terminalRetentionMs'>): Promise<Tombstone> {
    const { state } = await this.loadFull(taskId);
    if (state.status === 'active') throw new RetentionRefusedError(taskId, 'the task is still active');
    const age = this.now().getTime() - Date.parse(state.closedAt as string);
    if (age < policy.terminalRetentionMs) throw new RetentionRefusedError(taskId, 'the task is within its retention period');
    for (const other of await this.store.listTaskIds()) {
      if (other === taskId) continue;
      let o: TaskState;
      try {
        o = (await this.loadFull(other)).state;
      } catch (err) {
        if (err instanceof TaskPrunedError || err instanceof TaskNotFoundError) continue;
        throw err;
      }
      if (o.status === 'active' && (o.parentTaskId === taskId || o.dependsOn.includes(taskId))) {
        throw new RetentionRefusedError(taskId, `active task "${other}" refers to it`);
      }
    }
    const outcome = state.status === 'completed' ? state.result : { error: state.error };
    const tomb: Tombstone = {
      v: 1, taskId, kind: state.kind, finalStatus: state.status, createdAt: state.createdAt, closedAt: state.closedAt as string,
      prunedAt: this.now().toISOString(), headSeq: state.headSeq, headHash: state.headHash,
      outcomeDigest: sha256Hex(canonicalize((outcome ?? null) as Json)),
    };
    await this.store.prune(tomb);
    this.cache.delete(taskId);
    return tomb;
  }
}
