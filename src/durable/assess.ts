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

import { canonicalize, fingerprintOf, toJson, type Json } from './canonical.js';
import type { AwaitState, PlanStepState, TaskEvent, TaskState } from './types.js';

export type ResumeMode = 'closed' | 'waiting' | 'direct' | 'adaptive' | 'recovery';

export type ReasonCode =
  | 'BLOCKING_ASSUMPTION_CHANGED'
  | 'BLOCKING_ASSUMPTION_UNVERIFIED'
  | 'ADVISORY_ASSUMPTION_CHANGED'
  | 'EFFECT_IN_DOUBT'
  | 'AWAIT_EXPIRED'
  | 'LATE_RESULT'
  | 'PLAN_STUCK'
  | 'NO_PLAN_YET'
  | 'NO_PLAN_BUT_PROGRESS'
  | 'WORLD_CHANGED_SINCE_SEND'
  | 'REPLANNED_SINCE_SEND'
  | 'LEASE_HELD';

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
  unresolvedEffects: Array<{ key: string; description: string; intendedAtSeq: number; inDoubt: boolean; uncertainFailure: boolean }>;
  /** Events by someone other than the sender, after the oldest unconsumed result's request was sent. */
  sinceSend: Array<{ seq: number; type: string; at: string; actor: string | null; key: string | null }>;
  /** False while another owner holds a live lease. */
  claimable: boolean;
}

const WORLD_TYPES = new Set(['fact.observed', 'plan.declared', 'assumption.recorded', 'assumption.retracted', 'decision.recorded']);
const PROGRESS_TYPES = new Set(['plan.step_done', 'plan.step_skipped', 'decision.recorded', 'effect.completed']);

function keyOf(e: TaskEvent): string | null {
  switch (e.type) {
    case 'fact.observed':
    case 'assumption.recorded':
    case 'assumption.retracted':
      return e.data.key;
    case 'decision.recorded':
      return e.data.id;
    default:
      return null;
  }
}

export function leaseIsLive(state: TaskState, now: Date): boolean {
  const l = state.lease;
  return l !== null && !l.released && Date.parse(l.leaseUntil) > now.getTime();
}

export function assessTask(state: TaskState, events: readonly TaskEvent[], opts: AssessOptions): Assessment {
  const reasons: Reason[] = [];
  const base = {
    taskId: state.taskId,
    status: state.status,
    headSeq: state.headSeq,
  };
  const live = leaseIsLive(state, opts.now);

  if (state.status !== 'active') {
    return {
      ...base, mode: 'closed', reasons, nextSteps: [], planComplete: state.plan?.every((p) => p.status !== 'pending') ?? false,
      results: [], pendingAwaits: [], assumptionChanges: [], unresolvedEffects: [], sinceSend: [], claimable: false,
    };
  }

  const awaits = Object.values(state.awaits).sort((a, b) => a.registeredAtSeq - b.registeredAtSeq);
  const plan = state.plan ?? [];
  const stepById = new Map(plan.map((p) => [p.id, p]));
  const closed = (id: string): boolean => stepById.get(id)?.status !== 'pending';

  // --- plan readiness -------------------------------------------------------
  const nextSteps = plan.filter((p) => {
    if (p.status !== 'pending') return false;
    if (!p.dependsOn.every(closed)) return false;
    return awaits.filter((a) => a.stepId === p.id).every((a) => a.status === 'resolved');
  });
  const pendingSteps = plan.filter((p) => p.status === 'pending');
  const planComplete = state.plan !== null && pendingSteps.length === 0;

  const pendingAwaits = awaits
    .filter((a) => a.status === 'pending')
    .map((a) => ({ awaitId: a.awaitId, purpose: a.purpose, stepId: a.stepId, deadlineAt: a.deadlineAt, registeredAtSeq: a.registeredAtSeq }));

  // --- results that arrived but were not acted on ---------------------------
  const lastProgress = events.reduce((m, e) => (PROGRESS_TYPES.has(e.type) ? Math.max(m, e.seq) : m), 0);
  const results: ResultToConsume[] = awaits
    .filter((a) => a.status === 'resolved')
    .filter((a) => (a.stepId !== null && stepById.has(a.stepId) ? stepById.get(a.stepId)?.status === 'pending' : (a.resolvedAtSeq as number) > lastProgress))
    .map((a) => ({
      awaitId: a.awaitId, stepId: a.stepId, purpose: a.purpose, payload: a.payload, late: a.late, basisSeq: a.basisSeq,
      resolvedAtSeq: a.resolvedAtSeq as number,
    }));

  // --- assumptions vs. the present -----------------------------------------
  const liveObs = new Map<string, string>();
  const liveVal = new Map<string, Json>();
  for (const [k, v] of Object.entries(opts.observations ?? {})) {
    const j = toJson(v, `observation ${k}`);
    liveObs.set(k, fingerprintOf(j));
    liveVal.set(k, j);
  }
  const assumptionChanges: AssumptionChange[] = [];
  const unverified = opts.unverifiedBlocking ?? 'adaptive';
  for (const a of Object.values(state.assumptions).filter((x) => x.status === 'active').sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))) {
    const liveFp = liveObs.get(a.key);
    const rec = state.observations[a.key];
    const currentFp = liveFp ?? rec?.fingerprint;
    if (currentFp === undefined) {
      if (a.criticality === 'blocking' && unverified !== 'ignore') {
        reasons.push({
          code: 'BLOCKING_ASSUMPTION_UNVERIFIED',
          severity: unverified === 'recovery' ? 'recovery' : 'adaptive',
          detail: `no current value is known for blocking assumption "${a.key}": ${a.statement}`,
          refs: [a.key],
        });
      }
      continue;
    }
    // A recorded observation older than the assumption says nothing about what changed since.
    if (liveFp === undefined && rec && rec.seq < a.recordedAtSeq) continue;
    if (currentFp !== a.fingerprint) {
      assumptionChanges.push({
        key: a.key, criticality: a.criticality, statement: a.statement, was: a.value,
        now: liveFp !== undefined ? (liveVal.get(a.key) as Json) : (rec?.value ?? null), source: liveFp !== undefined ? 'live' : 'recorded',
      });
      reasons.push({
        code: a.criticality === 'blocking' ? 'BLOCKING_ASSUMPTION_CHANGED' : 'ADVISORY_ASSUMPTION_CHANGED',
        severity: a.criticality === 'blocking' ? 'recovery' : 'adaptive',
        detail: `assumption "${a.key}" no longer holds: ${a.statement}`,
        refs: [a.key],
      });
    }
  }

  // --- effects whose outcome is unknown --------------------------------------
  const unresolvedEffects = Object.values(state.effects)
    .filter((x) => x.status === 'intended' || (x.status === 'failed' && x.uncertain))
    .sort((a, b) => a.intendedAtSeq - b.intendedAtSeq)
    .map((x) => ({
      key: x.key, description: x.description, intendedAtSeq: x.intendedAtSeq,
      // In flight (not in doubt) only while its own epoch still holds a live lease. A call that already
      // failed with an unknown outcome is not in flight: nobody is going to record a result for it.
      inDoubt: x.status === 'failed' || !(live && state.lease !== null && x.intendedEpoch === state.lease.epoch),
      uncertainFailure: x.status === 'failed',
    }));
  for (const x of unresolvedEffects.filter((u) => u.inDoubt)) {
    reasons.push({
      code: 'EFFECT_IN_DOUBT', severity: 'recovery',
      detail: x.uncertainFailure
        ? `effect "${x.key}" (${x.description}) failed with an unknown outcome: the external operation may have taken effect`
        : `effect "${x.key}" (${x.description}) was started but its outcome was never recorded`,
      refs: [x.key],
    });
  }

  // --- awaits that did not deliver -------------------------------------------
  for (const a of awaits) {
    if (a.status === 'expired') {
      reasons.push({ code: 'AWAIT_EXPIRED', severity: 'recovery', detail: `no result for "${a.purpose}" arrived before its deadline`, refs: [a.awaitId] });
    } else if (a.status === 'resolved' && a.late) {
      reasons.push({ code: 'LATE_RESULT', severity: 'adaptive', detail: `the result for "${a.purpose}" arrived after it was declared expired`, refs: [a.awaitId] });
    }
  }

  // --- what happened elsewhere while we waited -------------------------------
  const sinceSend: Assessment['sinceSend'] = [];
  if (results.length > 0) {
    const oldest = results.reduce((m, r) => Math.min(m, r.basisSeq), Number.MAX_SAFE_INTEGER);
    const senderOf = (awaitId: string): string | null => {
      const reg = events.find((e) => e.type === 'await.registered' && e.data.awaitId === awaitId);
      return reg ? reg.actor : null;
    };
    const ownActors = new Set(results.map((r) => senderOf(r.awaitId)));
    for (const e of events) {
      if (e.seq <= oldest || !WORLD_TYPES.has(e.type)) continue;
      if (e.actor !== null && ownActors.has(e.actor)) continue;
      sinceSend.push({ seq: e.seq, type: e.type, at: e.at, actor: e.actor, key: keyOf(e) });
    }
    if (sinceSend.some((e) => e.type === 'plan.declared')) {
      reasons.push({ code: 'REPLANNED_SINCE_SEND', severity: 'adaptive', detail: 'the plan was changed by someone else after the request was sent', refs: [] });
    }
    const facts = sinceSend.filter((e) => e.type !== 'plan.declared');
    if (facts.length > 0) {
      reasons.push({
        code: 'WORLD_CHANGED_SINCE_SEND', severity: 'adaptive',
        detail: `${facts.length} change(s) by other actors were recorded after the request was sent`, refs: facts.map((f) => String(f.seq)),
      });
    }
  }

  // --- plan shape --------------------------------------------------------------
  const anyProgress = events.some((e) => PROGRESS_TYPES.has(e.type) || e.type.startsWith('await.') || e.type.startsWith('effect.'));
  if (state.plan === null) {
    reasons.push(
      anyProgress
        ? { code: 'NO_PLAN_BUT_PROGRESS', severity: 'recovery', detail: 'work was recorded but no plan exists, so the next step is unknown', refs: [] }
        : { code: 'NO_PLAN_YET', severity: 'info', detail: 'the task has no plan yet', refs: [] },
    );
  } else if (pendingSteps.length > 0 && nextSteps.length === 0 && pendingAwaits.length === 0 && !reasons.some((r) => r.code === 'AWAIT_EXPIRED')) {
    reasons.push({ code: 'PLAN_STUCK', severity: 'recovery', detail: 'steps remain but none can run and nothing is awaited', refs: pendingSteps.map((p) => p.id) });
  }

  if (live && state.lease) {
    reasons.push({ code: 'LEASE_HELD', severity: 'info', detail: `held by "${state.lease.owner}" until ${state.lease.leaseUntil}`, refs: [state.lease.owner] });
  }

  // --- classification --------------------------------------------------------------
  const has = (sev: Reason['severity']): boolean => reasons.some((r) => r.severity === sev);
  let mode: ResumeMode;
  if (has('recovery')) mode = 'recovery';
  else if (nextSteps.length === 0 && !planComplete && pendingAwaits.length > 0) mode = 'waiting';
  else if (has('adaptive')) mode = 'adaptive';
  else mode = 'direct';

  return {
    ...base, mode, reasons, nextSteps, planComplete, results, pendingAwaits, assumptionChanges, unresolvedEffects, sinceSend,
    claimable: !live,
  };
}

// ---------------------------------------------------------------------------
// Diff between two states of the same task
// ---------------------------------------------------------------------------

export interface StateChange {
  section: 'plan' | 'assumptions' | 'observations' | 'effects' | 'awaits' | 'decisions' | 'status';
  key: string;
  change: 'added' | 'removed' | 'changed';
}

function sameJson(a: unknown, b: unknown): boolean {
  return canonicalize(toJson(a)) === canonicalize(toJson(b));
}

/** What differs between `before` (e.g. the state when a request was sent) and `after` (now). */
export function diffStates(before: TaskState, after: TaskState): StateChange[] {
  const out: StateChange[] = [];
  const cmp = (section: StateChange['section'], a: Record<string, unknown>, b: Record<string, unknown>): void => {
    for (const k of Object.keys(b).sort()) {
      if (!Object.hasOwn(a, k)) out.push({ section, key: k, change: 'added' });
      else if (!sameJson(a[k], b[k])) out.push({ section, key: k, change: 'changed' });
    }
    for (const k of Object.keys(a).sort()) if (!Object.hasOwn(b, k)) out.push({ section, key: k, change: 'removed' });
  };
  const byId = <T extends { id: string }>(xs: T[] | null): Record<string, T> => Object.fromEntries((xs ?? []).map((x) => [x.id, x]));
  cmp('plan', byId(before.plan), byId(after.plan));
  cmp('assumptions', before.assumptions, after.assumptions);
  cmp('observations', before.observations, after.observations);
  cmp('effects', before.effects, after.effects);
  cmp('awaits', before.awaits, after.awaits);
  cmp('decisions', byId(before.decisions), byId(after.decisions));
  if (before.status !== after.status) out.push({ section: 'status', key: 'status', change: 'changed' });
  return out;
}
