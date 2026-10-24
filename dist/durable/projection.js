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
import { LogCorruptError } from './errors.js';
import { GENESIS_HASH } from './types.js';
/** Idempotency keys are scoped to the await they were delivered to ('awaitId' never contains ':'). */
export function deliveryKey(awaitId, idempotencyKey) {
    return `${awaitId}:${idempotencyKey}`;
}
function corrupt(taskId, seq, reason) {
    throw new LogCorruptError(taskId, seq, reason);
}
/** Validates a plan declaration; returns the first problem or `null`. Shared by the runtime (nice errors) and the fold (strictness). */
export function planProblem(steps) {
    const ids = new Set();
    for (const s of steps) {
        if (ids.has(s.id))
            return `duplicate step id "${s.id}"`;
        ids.add(s.id);
    }
    for (const s of steps) {
        for (const d of s.dependsOn) {
            if (!ids.has(d))
                return `step "${s.id}" depends on unknown step "${d}"`;
            if (d === s.id)
                return `step "${s.id}" depends on itself`;
        }
    }
    // cycle detection (Kahn)
    const indeg = new Map(steps.map((s) => [s.id, s.dependsOn.length]));
    const queue = steps.filter((s) => s.dependsOn.length === 0).map((s) => s.id);
    let visited = 0;
    while (queue.length > 0) {
        const id = queue.pop();
        visited++;
        for (const s of steps) {
            if (s.dependsOn.includes(id)) {
                const n = indeg.get(s.id) - 1;
                indeg.set(s.id, n);
                if (n === 0)
                    queue.push(s.id);
            }
        }
    }
    return visited === steps.length ? null : 'the plan has a dependency cycle';
}
export function applyEvent(prevState, e) {
    const t = e.taskId;
    if (prevState === null) {
        if (e.seq !== 1 || e.type !== 'task.created')
            corrupt(t, e.seq, 'a log must start with task.created at seq 1');
        const d = e.data;
        return {
            taskId: t,
            kind: d.kind,
            goal: d.goal,
            input: d.input,
            parentTaskId: d.parentTaskId,
            dependsOn: [...d.dependsOn],
            labels: { ...d.labels },
            status: 'active',
            createdAt: e.at,
            updatedAt: e.at,
            closedAt: null,
            result: null,
            error: null,
            headSeq: 1,
            headHash: e.hash,
            epoch: 0,
            lease: null,
            plan: null,
            decisions: [],
            assumptions: {},
            observations: {},
            effects: {},
            awaits: {},
            deliveryKeys: {},
            eventCount: 1,
        };
    }
    const s = prevState;
    if (e.seq !== s.headSeq + 1)
        corrupt(t, e.seq, `sequence gap (expected ${s.headSeq + 1})`);
    if (s.status !== 'active')
        corrupt(t, e.seq, `event after the terminal state (${s.status})`);
    switch (e.type) {
        case 'task.created':
            return corrupt(t, e.seq, 'task.created after seq 1');
        case 'run.claimed': {
            const d = e.data;
            if (d.epoch !== s.epoch + 1)
                corrupt(t, e.seq, `claim epoch ${d.epoch} is not ${s.epoch + 1}`);
            s.epoch = d.epoch;
            s.lease = { owner: d.owner, epoch: d.epoch, leaseUntil: d.leaseUntil, released: false };
            break;
        }
        case 'run.heartbeat': {
            const d = e.data;
            if (!s.lease || s.lease.released || s.lease.epoch !== d.epoch || s.lease.owner !== d.owner) {
                corrupt(t, e.seq, 'heartbeat from a non-current lease holder');
            }
            s.lease.leaseUntil = d.leaseUntil;
            break;
        }
        case 'run.released': {
            const d = e.data;
            if (!s.lease || s.lease.released || s.lease.epoch !== d.epoch || s.lease.owner !== d.owner) {
                corrupt(t, e.seq, 'release from a non-current lease holder');
            }
            s.lease.released = true;
            break;
        }
        case 'plan.declared': {
            const problem = planProblem(e.data.steps);
            if (problem)
                corrupt(t, e.seq, `invalid plan: ${problem}`);
            const previous = new Map((s.plan ?? []).map((p) => [p.id, p]));
            s.plan = e.data.steps.map((decl) => {
                const old = previous.get(decl.id);
                // A re-plan never reopens work that is already closed.
                if (old && old.status !== 'pending')
                    return { ...old, title: decl.title, dependsOn: [...decl.dependsOn] };
                return { id: decl.id, title: decl.title, dependsOn: [...decl.dependsOn], status: 'pending', result: null, skipReason: null, closedAtSeq: null };
            });
            break;
        }
        case 'plan.step_done':
        case 'plan.step_skipped': {
            const step = s.plan?.find((p) => p.id === e.data.stepId);
            if (!step)
                corrupt(t, e.seq, `unknown plan step "${e.data.stepId}"`);
            if (step.status !== 'pending')
                corrupt(t, e.seq, `plan step "${step.id}" is already ${step.status}`);
            if (e.type === 'plan.step_done') {
                step.status = 'done';
                step.result = e.data.result;
            }
            else {
                step.status = 'skipped';
                step.skipReason = e.data.reason;
            }
            step.closedAtSeq = e.seq;
            break;
        }
        case 'decision.recorded': {
            if (s.decisions.some((x) => x.id === e.data.id))
                corrupt(t, e.seq, `duplicate decision id "${e.data.id}"`);
            s.decisions.push({ id: e.data.id, seq: e.seq, at: e.at, summary: e.data.summary, rationale: e.data.rationale, basedOn: [...e.data.basedOn] });
            break;
        }
        case 'assumption.recorded': {
            const d = e.data;
            s.assumptions[d.key] = {
                key: d.key, statement: d.statement, criticality: d.criticality, fingerprint: d.fingerprint, value: d.value,
                evidence: d.evidence.map((x) => ({ ...x })), status: 'active', recordedAtSeq: e.seq, retractedReason: null,
            };
            break;
        }
        case 'assumption.retracted': {
            const a = s.assumptions[e.data.key];
            if (!a || a.status !== 'active')
                corrupt(t, e.seq, `no active assumption "${e.data.key}"`);
            a.status = 'retracted';
            a.retractedReason = e.data.reason;
            break;
        }
        case 'fact.observed': {
            const d = e.data;
            s.observations[d.key] = { key: d.key, fingerprint: d.fingerprint, value: d.value, source: d.source, seq: e.seq, at: e.at };
            break;
        }
        case 'effect.intended': {
            const d = e.data;
            const old = s.effects[d.key];
            if (old && old.status === 'completed')
                corrupt(t, e.seq, `effect "${d.key}" is already completed`);
            s.effects[d.key] = {
                key: d.key, description: d.description, params: d.params, status: 'intended', intendedAtSeq: e.seq,
                intendedEpoch: d.epoch, result: null, error: null, retryable: true,
            };
            break;
        }
        case 'effect.completed': {
            const x = s.effects[e.data.key];
            if (!x || x.status === 'completed')
                corrupt(t, e.seq, `effect "${e.data.key}" cannot be completed from ${x ? x.status : 'nothing'}`);
            x.status = 'completed';
            x.result = e.data.result;
            x.error = null;
            break;
        }
        case 'effect.failed': {
            const x = s.effects[e.data.key];
            if (!x || x.status !== 'intended')
                corrupt(t, e.seq, `effect "${e.data.key}" cannot fail from ${x ? x.status : 'nothing'}`);
            x.status = 'failed';
            x.error = e.data.error;
            x.retryable = e.data.retryable;
            break;
        }
        case 'await.registered': {
            const d = e.data;
            if (s.awaits[d.awaitId])
                corrupt(t, e.seq, `duplicate await id "${d.awaitId}"`);
            if (Object.values(s.awaits).some((a) => a.token === d.token))
                corrupt(t, e.seq, 'duplicate await token');
            s.awaits[d.awaitId] = {
                awaitId: d.awaitId, token: d.token, purpose: d.purpose, stepId: d.stepId, request: d.request, deadlineAt: d.deadlineAt,
                basisSeq: d.basisSeq, registeredAtSeq: e.seq, status: 'pending', resolvedAtSeq: null, payload: null, idempotencyKey: null,
                source: null, late: false, rejectedDeliveries: 0,
            };
            break;
        }
        case 'await.resolved': {
            const d = e.data;
            const a = s.awaits[d.awaitId];
            if (!a)
                corrupt(t, e.seq, `delivery to unknown await "${d.awaitId}"`);
            if (a.status === 'resolved')
                corrupt(t, e.seq, `await "${a.awaitId}" is already resolved`);
            if (a.status === 'expired' && !d.late)
                corrupt(t, e.seq, 'delivery after expiry must be marked late');
            const dk = deliveryKey(d.awaitId, d.idempotencyKey);
            if (dk in s.deliveryKeys)
                corrupt(t, e.seq, 'idempotency key reused');
            a.status = 'resolved';
            a.resolvedAtSeq = e.seq;
            a.payload = d.payload;
            a.idempotencyKey = d.idempotencyKey;
            a.source = d.source;
            a.late = d.late;
            s.deliveryKeys[dk] = e.seq;
            break;
        }
        case 'await.delivery_rejected': {
            const d = e.data;
            const a = s.awaits[d.awaitId];
            if (!a || a.status !== 'resolved')
                corrupt(t, e.seq, 'rejected delivery for an await that is not resolved');
            const dk = deliveryKey(d.awaitId, d.idempotencyKey);
            if (dk in s.deliveryKeys)
                corrupt(t, e.seq, 'idempotency key reused');
            a.rejectedDeliveries++;
            s.deliveryKeys[dk] = e.seq;
            break;
        }
        case 'await.expired': {
            const a = s.awaits[e.data.awaitId];
            if (!a || a.status !== 'pending')
                corrupt(t, e.seq, `await "${e.data.awaitId}" cannot expire`);
            a.status = 'expired';
            break;
        }
        case 'task.completed':
            s.status = 'completed';
            s.result = e.data.result;
            s.closedAt = e.at;
            break;
        case 'task.failed':
            s.status = 'failed';
            s.error = e.data.error;
            s.closedAt = e.at;
            break;
        case 'task.cancelled':
            s.status = 'cancelled';
            s.error = e.data.reason;
            s.closedAt = e.at;
            break;
    }
    s.headSeq = e.seq;
    s.headHash = e.hash;
    s.updatedAt = e.at;
    s.eventCount++;
    return s;
}
/** Folds a verified, contiguous list of events (starting at seq 1, or continuing `from`). */
export function foldEvents(events, from = null) {
    let state = from;
    for (const e of events)
        state = applyEvent(state, e);
    if (state === null)
        throw new LogCorruptError('?', null, 'empty log');
    return state;
}
/** The state as it was when the log had `seq` events — "what did the task look like when this was sent". */
export function foldUntil(events, seq) {
    return foldEvents(events.filter((e) => e.seq <= seq));
}
export function cloneState(s) {
    return structuredClone(s);
}
export { GENESIS_HASH };
