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
import { type Json } from './canonical.js';
import { type AssessOptions, type Assessment, type StateChange } from './assess.js';
import { type RetentionDecision, type RetentionPolicy } from './retention.js';
import { type AssumptionState, type Criticality, type EffectState, type EventStore, type PlanStepState, type StoreDiagnostic, type TaskEvent, type TaskState, type TaskStatus, type Tombstone } from './types.js';
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
    /**
     * Event slots above `maxEventsPerTask` that only lease changes (`claim`, `release`) and terminal events
     * (`complete`, `fail`, `cancel`) may use, so a task that exhausted its ordinary budget can always be closed.
     * The last slot is for a terminal event only. Default 16; 0 restores the strict ceiling.
     */
    terminalReserveEvents?: number;
    /**
     * How long a reference pinned by a task that is being created counts as "creation in progress" when nothing
     * of that task was published yet. A creator that died between pinning and publishing must not block the
     * referenced task's pruning forever. Default 10 minutes.
     */
    referenceGraceMs?: number;
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
export type DeliveryResult = {
    kind: 'accepted';
    taskId: string;
    awaitId: string;
    seq: number;
}
/** Same idempotency key seen before: nothing was written. */
 | {
    kind: 'duplicate';
    taskId: string;
    awaitId: string;
    seq: number;
}
/** The await already had a different result. The delivery is kept in the log as `await.delivery_rejected`. */
 | {
    kind: 'conflict';
    taskId: string;
    awaitId: string;
    /** The stored `await.delivery_rejected` event, or - when `recorded` is false - the event that resolved the await. */
    seq: number;
    /**
     * False when the per-await / per-task cap on stored rejections was reached: the delivery was answered
     * but, to keep the log bounded, not written.
     */
    recorded: boolean;
} | {
    kind: 'ignored';
    reason: 'task-closed' | 'task-pruned';
    taskId: string;
} | {
    kind: 'rejected';
    reason: 'malformed-token' | 'unknown-task' | 'unknown-await' | 'bad-token';
};
export interface EffectOptions<T extends Json> {
    description: string;
    params?: unknown;
    /**
     * Asked when the previous attempt left the outcome unrecorded. Look at the external
     * system (by the effect key, which should double as its idempotency key) and say what happened.
     */
    reconcile?: (effect: EffectState) => Promise<{
        status: 'completed';
        result: T;
    } | {
        status: 'not-executed';
    }>;
    /**
     * Says what an exception thrown by `fn` proves. `'not-executed'`: the external operation certainly did not
     * take effect. `'unknown'`: it may have (a timeout, a dropped connection, any error after the request left).
     * Default: only `EffectNotExecutedError` is `'not-executed'`; everything else is `'unknown'`, because an
     * exception is not evidence that the remote side did nothing.
     */
    classifyError?: (err: unknown) => 'not-executed' | 'unknown';
    /**
     * Whether a failure classified `'not-executed'` may be run again (default true). It has no effect on an
     * `'unknown'` failure: that one is never run again blindly, whatever this says — it needs `reconcile`.
     */
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
        taskId: string;
        kind: string;
        goal: string;
        input: Json | null;
        parentTaskId: string | null;
        dependsOn: string[];
        labels: Record<string, string>;
        status: TaskStatus;
        createdAt: string;
        headSeq: number;
    };
    assessment: Assessment;
    plan: PlanStepState[] | null;
    decisions: TaskState['decisions'];
    assumptions: AssumptionState[];
    observations: TaskState['observations'][string][];
    effects: EffectState[];
    awaits: Array<TaskState['awaits'][string]>;
    /** For every unconsumed result: what changed between sending the request and now. */
    sinceSend: Array<{
        awaitId: string;
        basisSeq: number;
        changes: StateChange[];
    }>;
    timeline: Array<{
        seq: number;
        type: string;
        at: string;
        actor: string | null;
        key: string | null;
    }>;
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
    applied: Array<{
        taskId: string;
        action: 'prune' | 'compact';
        detail: string;
    }>;
}
/** A unique, human-readable worker identity: host, pid, random suffix. Use one per process incarnation. */
export declare function newOwnerId(): string;
export declare function parseToken(token: unknown): {
    taskId: string;
    awaitId: string;
    nonce: string;
} | null;
export declare class DurableTasks {
    private readonly store;
    private readonly now;
    private readonly newId;
    private readonly defaultLeaseMs;
    private readonly maxEvents;
    private readonly maxAttempts;
    private readonly maxCached;
    private readonly terminalReserve;
    private readonly referenceGraceMs;
    /** Validated, incrementally extended view per task. A cache of the log, never an authority. */
    private readonly cache;
    /** Effect executions running in this runtime, so concurrent calls with one identity share one `fn` call. */
    private readonly inflight;
    constructor(opts: DurableTasksOptions);
    private remember;
    /** Brings the cached state up to the head of the log. Throws if the task is missing or pruned. */
    private refresh;
    private loadFull;
    /**
     * Read state -> decide -> append, repeated until the append wins its slot.
     * `plan` must be a pure function of the state it is given: it is re-run
     * against fresh state after every lost race.
     */
    private mutate;
    /**
     * How many events a task may hold before `type` is refused. Ordinary events stop at `maxEvents`; lease changes
     * may use the reserve except its last slot; terminal events may use all of it. See `terminalReserveEvents`.
     */
    private eventLimitFor;
    /**
     * Runs a proposed event through the fold before anything is stored. A violation here means the *caller's*
     * request does not fit the task's current state (the stored log was just verified and is fine), so it is
     * a `ValidationError`, never a `LogCorruptError`: corruption is reserved for stored data that fails verification.
     */
    private precheck;
    /**
     * After an unknown publication outcome: is *our* event (same hash) the one in the slot? Matching bytes cannot prove
     * that this call created the slot, so the answer is 'adopted', never 'appended' (Amendment-004G, F-G-3). A failing
     * read propagates: the outcome stays unknown and no right is granted.
     */
    private resolveUnknown;
    createTask(input: CreateTaskInput): Promise<{
        taskId: string;
        created: boolean;
        state: TaskState;
    }>;
    /**
     * True when `taskId` exists and is not pruned. A tombstone may be transient (a prune that found a referrer
     * withdraws it right away), so a pruned answer is re-checked for a short while before it is believed.
     */
    private referenceIsLive;
    /**
     * Immediate feedback for the creator, NOT the safety net: a creator that is killed before it gets here leaves an
     * active task behind, and that is made harmless by `claim` / discovery (see `blockingRequirement`). It runs without
     * looking at any clock: a clock-dependent skip is what let a skewed creator keep a task whose parent was pruned.
     * Only a parent that is GONE cancels the new task. A parent whose prune is merely unfinished is rolled back on the
     * spot (this task is published and active, so it is a referrer the prune must respect) or, if that cannot be
     * done now, left alone: `claim` refuses to run the task until the question is settled, and cancels nothing.
     */
    private assertReferencesSurvived;
    /**
     * What a required task is, as seen right now (a logical model; nothing of this is persisted):
     *  - `live`     it exists and carries no tombstone.
     *  - `pending`  a tombstone exists, but the prune is unfinished and may still be rolled back, or cannot be examined.
     *               This is a transient state. It is never a reason to cancel anybody.
     *  - `gone`     it never existed, or its removal has started or finished: the prune is committed and irreversible.
     *
     * Why the tombstone alone proves nothing: a pruner publishes it BEFORE it looks for referrers, and a stopped
     * (SIGSTOP) or killed pruner leaves it behind with all data in place. Only the data decides:
     *  - complete data + a referrer that is active ⇒ the pruner has not passed its referrer check (or never will);
     *    the prune is rolled back here (`withdrawTombstone`, idempotent, refused once any file was removed).
     *  - data gone or partly removed ⇒ the pruner passed its referrer check and committed.
     * With `recover: false` nothing is written: an unfinished prune is reported as `pending`.
     * No timeout takes part in this decision; `pending` is retried by the caller, never promoted to `gone`.
     */
    private requirementState;
    /**
     * The first task an ACTIVE task requires (`parentTaskId`, `dependsOn`) that is gone, else the first whose prune is
     * pending, else `null`. This — not the presence of `task.created` in the log — is what permits execution. Why it
     * is safe without any clock: a pruner publishes its tombstone and only then looks for referrers; this check runs
     * after the task's `task.created` is published. So either the tombstone is visible here, or the pruner sees the
     * task and backs off. Once the check has passed, no prune of the required task can succeed while this task is active.
     */
    private blockingRequirement;
    /**
     * Durable, idempotent cleanup of an orphan whose required task is GONE (never for a pending prune):
     * `task.cancelled` (a terminal event, which also fits in the reserve).
     * Best effort by design: if the write fails (crash, ENOSPC) the task stays active in the log but
     * `blockingRequirement` keeps refusing it on every call, and the next discovery tries the write again.
     */
    private quarantine;
    /**
     * An active task that refers to `taskId`: either published (`parentTaskId` / `dependsOn`) or being created
     * (a recent pin with no task behind it yet). `null` if nothing needs `taskId` any more.
     */
    private activeReferrer;
    getState(taskId: string): Promise<TaskState>;
    /** The state when the log had `seq` events. */
    getStateAt(taskId: string, seq: number): Promise<TaskState>;
    getLog(taskId: string): Promise<{
        state: TaskState;
        events: TaskEvent[];
        diagnostics: StoreDiagnostic[];
    }>;
    listTasks(filter?: {
        status?: TaskStatus;
        kind?: string;
        label?: [string, string];
    }): Promise<TaskSummary[]>;
    /**
     * Become the task's current worker. Fails with `LeaseHeldError` while another
     * owner's lease is live; an expired or released lease (a dead worker) can be
     * taken over. Every claim increments the epoch, which fences out the previous holder.
     */
    claim(taskId: string, opts: {
        owner: string;
        leaseMs?: number;
    }): Promise<Fence>;
    private assertFence;
    /** Mutation by the fenced worker. */
    private fenced;
    heartbeat(f: Fence, leaseMs?: number): Promise<void>;
    /** Give the task up. Idempotent; a closed task or an already-superseded fence is a quiet no-op. */
    release(f: Fence): Promise<void>;
    declarePlan(f: Fence, steps: Array<{
        id: string;
        title: string;
        dependsOn?: string[];
    }>, reason?: string): Promise<void>;
    /** Marks a step done. Idempotent: completing a done step is a no-op. */
    completeStep(f: Fence, stepId: string, result?: unknown): Promise<void>;
    skipStep(f: Fence, stepId: string, reason: string): Promise<void>;
    /** Records why something was chosen. Same id + same content is a no-op. */
    recordDecision(f: Fence, d: {
        id: string;
        summary: string;
        rationale?: string;
        basedOn?: string[];
    }): Promise<void>;
    /**
     * Records something the plan relies on, together with the value it was
     * based on. `assess` later compares it with the current value of the same
     * key. `blocking` (default): if it changes, the plan is not to be trusted.
     * `advisory`: if it changes, adapt.
     */
    recordAssumption(f: Fence, a: {
        key: string;
        statement: string;
        value: unknown;
        criticality?: Criticality;
        evidence?: Array<{
            ref: string;
            note?: string;
        }>;
        /**
         * Replace an active assumption that holds a DIFFERENT value. Off by default on purpose: a worker
         * that is re-run after a restart re-states its assumptions, and silently overwriting the recorded
         * value with today's one would erase exactly the change `assess` exists to detect.
         */
        supersede?: boolean;
    }): Promise<void>;
    retractAssumption(f: Fence, key: string, reason: string): Promise<void>;
    /**
     * Another agent or system reports a fact about the world. No fence: observers
     * are not the task's worker. An observation equal to the latest one for the key is a no-op.
     */
    observe(taskId: string, o: {
        key: string;
        value: unknown;
        source?: string;
    }): Promise<void>;
    /**
     * Runs `fn` at most once *as far as the log can tell*, and records what happened.
     * `key` should also be the idempotency key sent to the external system.
     *
     *  - completed before: returns the recorded result, `fn` is not called;
     *  - intent recorded but no outcome (crash in between): calls `reconcile` if
     *    given, else throws `EffectInDoubtError` — it will not guess;
     *  - failed before and PROVABLY not executed (`EffectNotExecutedError` / `classifyError`): runs again
     *    if retryable (default), else `EffectFailedError`;
     *  - `fn` threw anything else: an exception does not prove the remote side did nothing (a timeout after
     *    the request was sent is the typical case), so the outcome is recorded as unknown and treated like an
     *    announced effect without outcome: `reconcile` or `EffectInDoubtError`, never an automatic re-run.
     *    This is "at most once as far as the log can tell", not exactly-once: only an idempotency key honoured
     *    by the external system (use `key` for it) makes a repeated call harmless.
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
    runEffect<T extends Json>(f: Fence, key: string, fn: () => Promise<T>, opts: EffectOptions<T>): Promise<EffectOutcome<T>>;
    private executeEffect;
    /**
     * Announces that an answer is expected and returns the token the answer must
     * carry. Idempotent per `awaitId`: a restarted worker that registers the same
     * await again gets the same token and nothing new is written.
     * `basisSeq` records where the log stood at send time, so "what did the task
     * look like then, and what changed since" is always answerable.
     */
    registerAwait(f: Fence, a: {
        awaitId?: string;
        purpose: string;
        stepId?: string;
        request?: unknown;
        deadlineAt?: Date | string;
    }): Promise<{
        awaitId: string;
        token: string;
        created: boolean;
    }>;
    /**
     * Hand an externally produced result to the task it belongs to. Needs no
     * live process and no fence — only the token. Safe to call repeatedly and in any order:
     *  - same `idempotencyKey` again → `duplicate`, nothing written;
     *  - a different result for an already resolved await → `conflict`; the payload is kept
     *    in the log (`await.delivery_rejected`) and does not replace the first one;
     *  - a result after the await's deadline passed → accepted, flagged `late`;
     *  - a result for a finished task → `ignored` (its log is sealed).
     */
    deliver(token: string, payload: unknown, opts: {
        idempotencyKey: string;
        source?: string;
    }): Promise<DeliveryResult>;
    /** Marks pending awaits whose deadline has passed as expired. Returns the awaits it expired. */
    sweepDeadlines(taskId?: string): Promise<Array<{
        taskId: string;
        awaitId: string;
    }>>;
    complete(f: Fence, result?: unknown): Promise<void>;
    fail(f: Fence, error: string, detail?: unknown): Promise<void>;
    /** Administrative stop: no fence needed. Idempotent for an already cancelled task. */
    cancel(taskId: string, reason: string, actor?: string): Promise<void>;
    assess(taskId: string, opts?: Omit<AssessOptions, 'now'> & {
        now?: Date;
    }): Promise<Assessment>;
    /**
     * An active task whose required task is gone is reported as not claimable, with the reason; `claim` enforces it.
     * A required task whose prune is pending also makes it not claimable, but the task is not cancelled.
     * `recover`: roll back an unfinished prune of a required task (a write); `assess` / `resumePacket` do not.
     */
    private withRequirements;
    /** Everything a resumed worker — or a reasoning component — needs, in one deterministic document. */
    resumePacket(taskId: string, opts?: Omit<AssessOptions, 'now'> & {
        now?: Date;
    }): Promise<ResumePacket>;
    private keyOf;
    /**
     * The wake-up query of a scheduler after a restart: active tasks nobody is
     * working on that have something to do (`direct`, `adaptive`, `recovery`).
     * Tasks that only wait for more results are not returned.
     */
    findResumable(opts?: {
        observations?: (state: TaskState) => Record<string, unknown> | undefined;
    }): Promise<Array<{
        taskId: string;
        mode: Assessment['mode'];
        reasons: string[];
    }>>;
    /** Re-reads and re-verifies logs end to end (hash chain, sequence, fold). Never repairs. */
    verify(taskId?: string): Promise<VerifyReport[]>;
    /**
     * Decide what retention would do. Nothing is changed. Tasks whose log fails
     * verification are skipped (never pruned or compacted while corrupt).
     */
    planRetention(policy: RetentionPolicy): Promise<RetentionDecision[]>;
    /** Executes a plan. Every destructive step re-checks its precondition against the live log. */
    applyRetention(policy: RetentionPolicy): Promise<RetentionReport>;
    /**
     * Packs events up to `throughSeq` into verified segments. Returns the number of events packed.
     * Also finishes an interrupted earlier compaction: loose copies that a published segment already covers
     * are removed (only if byte-identical to the segment), even when there is nothing new to pack.
     */
    compact(taskId: string, opts: {
        throughSeq: number;
    }): Promise<number>;
    /**
     * Removes a finished task's log, leaving a tombstone. Refuses unless the
     * task is terminal, past retention, and not referenced by an active task —
     * checked now, against the live log, not against an earlier plan.
     */
    pruneTask(taskId: string, policy: Pick<RetentionPolicy, 'terminalRetentionMs'>): Promise<Tombstone>;
    /** A referrer showed up after the tombstone was published: undo the prune if the data is still complete. */
    private refuseAfterTombstone;
}
//# sourceMappingURL=runtime.d.ts.map