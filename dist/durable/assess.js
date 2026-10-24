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
import { canonicalize, fingerprintOf, toJson } from './canonical.js';
const WORLD_TYPES = new Set(['fact.observed', 'plan.declared', 'assumption.recorded', 'assumption.retracted', 'decision.recorded']);
const PROGRESS_TYPES = new Set(['plan.step_done', 'plan.step_skipped', 'decision.recorded', 'effect.completed']);
function keyOf(e) {
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
export function leaseIsLive(state, now) {
    const l = state.lease;
    return l !== null && !l.released && Date.parse(l.leaseUntil) > now.getTime();
}
export function assessTask(state, events, opts) {
    const reasons = [];
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
    const closed = (id) => stepById.get(id)?.status !== 'pending';
    // --- plan readiness -------------------------------------------------------
    const nextSteps = plan.filter((p) => {
        if (p.status !== 'pending')
            return false;
        if (!p.dependsOn.every(closed))
            return false;
        return awaits.filter((a) => a.stepId === p.id).every((a) => a.status === 'resolved');
    });
    const pendingSteps = plan.filter((p) => p.status === 'pending');
    const planComplete = state.plan !== null && pendingSteps.length === 0;
    const pendingAwaits = awaits
        .filter((a) => a.status === 'pending')
        .map((a) => ({ awaitId: a.awaitId, purpose: a.purpose, stepId: a.stepId, deadlineAt: a.deadlineAt, registeredAtSeq: a.registeredAtSeq }));
    // --- results that arrived but were not acted on ---------------------------
    const lastProgress = events.reduce((m, e) => (PROGRESS_TYPES.has(e.type) ? Math.max(m, e.seq) : m), 0);
    const results = awaits
        .filter((a) => a.status === 'resolved')
        .filter((a) => (a.stepId !== null && stepById.has(a.stepId) ? stepById.get(a.stepId)?.status === 'pending' : a.resolvedAtSeq > lastProgress))
        .map((a) => ({
        awaitId: a.awaitId, stepId: a.stepId, purpose: a.purpose, payload: a.payload, late: a.late, basisSeq: a.basisSeq,
        resolvedAtSeq: a.resolvedAtSeq,
    }));
    // --- assumptions vs. the present -----------------------------------------
    const liveObs = new Map();
    const liveVal = new Map();
    for (const [k, v] of Object.entries(opts.observations ?? {})) {
        const j = toJson(v, `observation ${k}`);
        liveObs.set(k, fingerprintOf(j));
        liveVal.set(k, j);
    }
    const assumptionChanges = [];
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
        if (liveFp === undefined && rec && rec.seq < a.recordedAtSeq)
            continue;
        if (currentFp !== a.fingerprint) {
            assumptionChanges.push({
                key: a.key, criticality: a.criticality, statement: a.statement, was: a.value,
                now: liveFp !== undefined ? liveVal.get(a.key) : (rec?.value ?? null), source: liveFp !== undefined ? 'live' : 'recorded',
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
        .filter((x) => x.status === 'intended')
        .sort((a, b) => a.intendedAtSeq - b.intendedAtSeq)
        .map((x) => ({
        key: x.key, description: x.description, intendedAtSeq: x.intendedAtSeq,
        // In flight (not in doubt) only while its own epoch still holds a live lease.
        inDoubt: !(live && state.lease !== null && x.intendedEpoch === state.lease.epoch),
    }));
    for (const x of unresolvedEffects.filter((u) => u.inDoubt)) {
        reasons.push({
            code: 'EFFECT_IN_DOUBT', severity: 'recovery',
            detail: `effect "${x.key}" (${x.description}) was started but its outcome was never recorded`, refs: [x.key],
        });
    }
    // --- awaits that did not deliver -------------------------------------------
    for (const a of awaits) {
        if (a.status === 'expired') {
            reasons.push({ code: 'AWAIT_EXPIRED', severity: 'recovery', detail: `no result for "${a.purpose}" arrived before its deadline`, refs: [a.awaitId] });
        }
        else if (a.status === 'resolved' && a.late) {
            reasons.push({ code: 'LATE_RESULT', severity: 'adaptive', detail: `the result for "${a.purpose}" arrived after it was declared expired`, refs: [a.awaitId] });
        }
    }
    // --- what happened elsewhere while we waited -------------------------------
    const sinceSend = [];
    if (results.length > 0) {
        const oldest = results.reduce((m, r) => Math.min(m, r.basisSeq), Number.MAX_SAFE_INTEGER);
        const senderOf = (awaitId) => {
            const reg = events.find((e) => e.type === 'await.registered' && e.data.awaitId === awaitId);
            return reg ? reg.actor : null;
        };
        const ownActors = new Set(results.map((r) => senderOf(r.awaitId)));
        for (const e of events) {
            if (e.seq <= oldest || !WORLD_TYPES.has(e.type))
                continue;
            if (e.actor !== null && ownActors.has(e.actor))
                continue;
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
        reasons.push(anyProgress
            ? { code: 'NO_PLAN_BUT_PROGRESS', severity: 'recovery', detail: 'work was recorded but no plan exists, so the next step is unknown', refs: [] }
            : { code: 'NO_PLAN_YET', severity: 'info', detail: 'the task has no plan yet', refs: [] });
    }
    else if (pendingSteps.length > 0 && nextSteps.length === 0 && pendingAwaits.length === 0 && !reasons.some((r) => r.code === 'AWAIT_EXPIRED')) {
        reasons.push({ code: 'PLAN_STUCK', severity: 'recovery', detail: 'steps remain but none can run and nothing is awaited', refs: pendingSteps.map((p) => p.id) });
    }
    if (live && state.lease) {
        reasons.push({ code: 'LEASE_HELD', severity: 'info', detail: `held by "${state.lease.owner}" until ${state.lease.leaseUntil}`, refs: [state.lease.owner] });
    }
    // --- classification --------------------------------------------------------------
    const has = (sev) => reasons.some((r) => r.severity === sev);
    let mode;
    if (has('recovery'))
        mode = 'recovery';
    else if (nextSteps.length === 0 && !planComplete && pendingAwaits.length > 0)
        mode = 'waiting';
    else if (has('adaptive'))
        mode = 'adaptive';
    else
        mode = 'direct';
    return {
        ...base, mode, reasons, nextSteps, planComplete, results, pendingAwaits, assumptionChanges, unresolvedEffects, sinceSend,
        claimable: !live,
    };
}
function sameJson(a, b) {
    return canonicalize(toJson(a)) === canonicalize(toJson(b));
}
/** What differs between `before` (e.g. the state when a request was sent) and `after` (now). */
export function diffStates(before, after) {
    const out = [];
    const cmp = (section, a, b) => {
        for (const k of Object.keys(b).sort()) {
            if (!(k in a))
                out.push({ section, key: k, change: 'added' });
            else if (!sameJson(a[k], b[k]))
                out.push({ section, key: k, change: 'changed' });
        }
        for (const k of Object.keys(a).sort())
            if (!(k in b))
                out.push({ section, key: k, change: 'removed' });
    };
    const byId = (xs) => Object.fromEntries((xs ?? []).map((x) => [x.id, x]));
    cmp('plan', byId(before.plan), byId(after.plan));
    cmp('assumptions', before.assumptions, after.assumptions);
    cmp('observations', before.observations, after.observations);
    cmp('effects', before.effects, after.effects);
    cmp('awaits', before.awaits, after.awaits);
    cmp('decisions', byId(before.decisions), byId(after.decisions));
    if (before.status !== after.status)
        out.push({ section: 'status', key: 'status', change: 'changed' });
    return out;
}
