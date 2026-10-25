/**
 * Resume assessment — "may I simply carry on?"
 *
 * A pure, deterministic function of a task's state and log (no clock except
 * the `now` the caller passes, no I/O, no LLM). It answers the question every
 * resumed agentic task has to answer, and classifies the answer into the
 * three continuation scenarios:
 *
 *  - `direct`   : results are in, nothing the plan relied on changed, the next
 *                 step is known — continue without further reasoning.
 *  - `adaptive` : results are in, the world moved, but nothing *blocking* was
 *                 invalidated — continue, taking the listed changes into account.
 *  - `recovery` : a blocking assumption broke, an effect is in doubt, an awaited
 *                 result never came, or the next step is unknown — the plan can't
 *                 be trusted; hand the resume packet to a reasoning component.
 *
 * plus `waiting` (nothing runnable yet; more results are expected) and
 * `closed` (terminal). The classification is conservative: a doubt is never
 * resolved in favour of `direct`.
 *
 * The assessment compares *recorded* assumptions with the *current* values of
 * the facts they were about. Current values come from `fact.observed` events
 * (other agents/systems reporting) and from `observations` the caller supplies
 * live; the live value wins. Durable State does not know how to look at the
 * world — the application does — but it knows what the plan relied on.
 */
import { type Json } from './canonical.js';
import type { AwaitState, PlanStepState, TaskEvent, TaskState } from './types.js';
export type ResumeMode = 'closed' | 'waiting' | 'direct' | 'adaptive' | 'recovery';
export type ReasonCode = 'BLOCKING_ASSUMPTION_CHANGED' | 'BLOCKING_ASSUMPTION_UNVERIFIED' | 'ADVISORY_ASSUMPTION_CHANGED' | 'EFFECT_IN_DOUBT' | 'AWAIT_EXPIRED' | 'LATE_RESULT' | 'PLAN_STUCK' | 'NO_PLAN_YET' | 'NO_PLAN_BUT_PROGRESS' | 'WORLD_CHANGED_SINCE_SEND' | 'REPLANNED_SINCE_SEND' | 'LEASE_HELD'
/** A task this one requires (parentTaskId / dependsOn) was pruned or is missing: the task must not run. */
 | 'REQUIRED_TASK_GONE';
export interface Reason {
    code: ReasonCode;
    severity: 'recovery' | 'adaptive' | 'info';
    detail: string;
    refs: string[];
}
export interface AssumptionChange {
    key: string;
    criticality: 'blocking' | 'advisory';
    statement: string;
    was: Json | null;
    now: Json | null;
    source: 'live' | 'recorded';
}
export interface AssessOptions {
    now: Date;
    /** Current values of facts, keyed like the assumptions. Wins over recorded observations. */
    observations?: Record<string, unknown>;
    /** What an unverifiable *blocking* assumption means. Default `'adaptive'`. */
    unverifiedBlocking?: 'ignore' | 'adaptive' | 'recovery';
}
export interface ResultToConsume {
    awaitId: string;
    stepId: string | null;
    purpose: string;
    payload: Json | null;
    late: boolean;
    basisSeq: number;
    resolvedAtSeq: number;
}
export interface Assessment {
    taskId: string;
    status: TaskState['status'];
    mode: ResumeMode;
    headSeq: number;
    reasons: Reason[];
    /** Steps that can run right now (deps closed, their awaits resolved). */
    nextSteps: PlanStepState[];
    planComplete: boolean;
    /** Results that arrived but whose step has not been closed yet. */
    results: ResultToConsume[];
    pendingAwaits: Array<Pick<AwaitState, 'awaitId' | 'purpose' | 'stepId' | 'deadlineAt' | 'registeredAtSeq'>>;
    assumptionChanges: AssumptionChange[];
    unresolvedEffects: Array<{
        key: string;
        description: string;
        intendedAtSeq: number;
        inDoubt: boolean;
        uncertainFailure: boolean;
    }>;
    /** Events by someone other than the sender, after the oldest unconsumed result's request was sent. */
    sinceSend: Array<{
        seq: number;
        type: string;
        at: string;
        actor: string | null;
        key: string | null;
    }>;
    /** False while another owner holds a live lease. */
    claimable: boolean;
}
export declare function leaseIsLive(state: TaskState, now: Date): boolean;
export declare function assessTask(state: TaskState, events: readonly TaskEvent[], opts: AssessOptions): Assessment;
export interface StateChange {
    section: 'plan' | 'assumptions' | 'observations' | 'effects' | 'awaits' | 'decisions' | 'status';
    key: string;
    change: 'added' | 'removed' | 'changed';
}
/** What differs between `before` (e.g. the state when a request was sent) and `after` (now). */
export declare function diffStates(before: TaskState, after: TaskState): StateChange[];
//# sourceMappingURL=assess.d.ts.map