/**
 * Mission enrollment (Autonomous Execution Discipline) — Core semantics.
 *
 * `enrollMission` is the ONE operation that decides whether implementation work gets a Mission: it reuses the
 * Mission of the calling execution context, creates one when there is none, and refuses when ownership is
 * ambiguous. Host adapters (Claude Code hooks, a future Codex adapter, a CLI) only detect that implementation
 * began and call this. They hold no competing logic.
 *
 *  - Idempotent: the same context never gets a second Mission. Creation and lookup happen inside one locked
 *    `mutateState` critical section (the existing lock; no second lock manager), so N concurrent callers produce
 *    exactly one Mission.
 *  - Never captures a foreign Mission: only a Mission owned by the same (agent, worktree) is reused. Manual Missions
 *    and Missions of other worktrees are never joined, even when active on the same branch.
 *  - Never invents history: the title states only what is known; no checkpoint, summary or decision is written.
 */
import { mutateState, readState } from './state-keeper.js';
import { STORY_ID_RE, MAX_PREVIOUS_OWNERS } from './types.js';
import { ValidationError, MissionNotFoundError, InvalidTransitionError } from './errors.js';
import { nextMissionId } from './mission.js';
export function enrollmentIdentity(ctx) {
    return `${ctx.agent}@${ctx.worktree}`;
}
function validateContext(ctx) {
    if (typeof ctx.agent !== 'string' || ctx.agent.trim() === '' || ctx.agent.length > 64)
        throw new ValidationError('"agent" must be a non-empty string of at most 64 characters');
    if (typeof ctx.worktree !== 'string' || ctx.worktree === '' || ctx.worktree.length > 4096)
        throw new ValidationError('"worktree" must be a non-empty path');
    if (typeof ctx.source !== 'string' || ctx.source === '' || ctx.source.length > 64)
        throw new ValidationError('"source" must be a non-empty string of at most 64 characters');
    if (ctx.storyId !== undefined && !STORY_ID_RE.test(ctx.storyId))
        throw new ValidationError(`"storyId" must match ${STORY_ID_RE.source}`);
}
function owned(state, ctx) {
    return Object.values(state.tactical.missions)
        .filter((m) => m.status === 'in_progress' && m.owner !== undefined && m.owner.agent === ctx.agent && m.owner.worktree === ctx.worktree)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
}
function decide(state, ctx) {
    const mine = owned(state, ctx);
    if (mine.length === 0)
        return { kind: 'create' };
    if (ctx.storyId !== undefined) {
        const linked = mine.filter((m) => m.storyId === ctx.storyId);
        if (linked.length === 1)
            return { kind: 'reuse', mission: linked[0] };
        if (linked.length > 1)
            return { kind: 'conflict', candidates: linked, reason: `several active missions of this context are linked to ${ctx.storyId}` };
        return { kind: 'conflict', candidates: mine, reason: `this context already has an active mission not linked to ${ctx.storyId}; finish it or hand it off explicitly` };
    }
    if (mine.length === 1)
        return { kind: 'reuse', mission: mine[0] };
    return { kind: 'conflict', candidates: mine, reason: 'several active missions belong to this context; name one explicitly' };
}
function conflict(d) {
    return { status: 'CONFLICT', missionId: null, reason: d.reason, candidates: d.candidates.map((m) => m.id) };
}
export function autoMissionTitle(ctx) {
    const where = ctx.branch !== undefined ? `branch ${ctx.branch}` : 'a detached HEAD';
    const dir = ctx.worktree.split(/[\\/]/).filter(Boolean).pop() ?? ctx.worktree;
    return `Managed implementation (${ctx.agent}, worktree ${dir}, ${where})`;
}
/**
 * Enrol `ctx` in the Mission lifecycle. Never throws for operational failures: they come back as
 * `UNAVAILABLE` so an adapter can apply its explicit policy. Programming errors in the context are reported the
 * same way (the adapter must not crash the host).
 */
export async function enrollMission(target, ctx) {
    try {
        validateContext(ctx);
        if (ctx.intent === 'read')
            return { status: 'SKIPPED', missionId: null, reason: 'not an implementation action; no mission is registered for reading or discussion' };
        // Fast path (no lock, no write): the common repeated call from the same session.
        const quick = decide(await readState(target), ctx);
        if (quick.kind === 'reuse' && (ctx.sessionId === undefined || quick.mission.owner?.sessionId === ctx.sessionId)) {
            return { status: 'REUSED', missionId: quick.mission.id, reason: 'active mission of this execution context' };
        }
        const { result } = await mutateState(target, (draft) => {
            const d = decide(draft, ctx);
            if (d.kind === 'conflict')
                return conflict(d);
            if (d.kind === 'reuse') {
                const owner = d.mission.owner;
                const resumedFrom = ctx.sessionId !== undefined && owner.sessionId !== undefined && owner.sessionId !== ctx.sessionId ? owner.sessionId : undefined;
                if (ctx.sessionId !== undefined && owner.sessionId !== ctx.sessionId) {
                    owner.sessionId = ctx.sessionId;
                    d.mission.updatedAt = new Date().toISOString();
                }
                return { status: 'REUSED', missionId: d.mission.id, reason: 'active mission of this execution context', ...(resumedFrom !== undefined ? { resumedFromSession: resumedFrom } : {}) };
            }
            const id = nextMissionId(draft.tactical.missions);
            const now = new Date().toISOString();
            const owner = { agent: ctx.agent, worktree: ctx.worktree, source: ctx.source, enrolledAt: now };
            if (ctx.sessionId !== undefined)
                owner.sessionId = ctx.sessionId;
            if (ctx.branch !== undefined)
                owner.branch = ctx.branch;
            const mission = { id, title: autoMissionTitle(ctx), system: 'autonomous', status: 'in_progress', startedAt: now, updatedAt: now, summary: null, owner };
            if (ctx.storyId !== undefined)
                mission.storyId = ctx.storyId;
            draft.tactical.missions[id] = mission;
            return { status: 'CREATED', missionId: id, reason: 'first implementation action of this execution context' };
        });
        return result;
    }
    catch (err) {
        return { status: 'UNAVAILABLE', missionId: null, reason: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 600) : 'unknown error' };
    }
}
/** Read-only: the active Missions this context owns (for session start, `mission current`, Stop). */
export async function currentMissions(target, ctx) {
    const state = await readState(target);
    return Object.values(state.tactical.missions)
        .filter((m) => m.status === 'in_progress' && m.owner !== undefined && m.owner.worktree === ctx.worktree)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
}
/**
 * Explicit transfer of an in_progress Mission to `ctx`. The only way to take over another context's Mission (or
 * to adopt an unowned one). It requires a reason, appends the previous owner to the record and writes nothing
 * else: no checkpoint, no summary.
 */
export async function handoffMission(target, missionId, ctx, reason) {
    validateContext(ctx);
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why === '')
        throw new ValidationError('a handoff requires a non-empty reason');
    if (why.length > 1000)
        throw new ValidationError('"reason" must be at most 1000 characters');
    const { result } = await mutateState(target, (draft) => {
        const m = draft.tactical.missions[missionId];
        if (!m)
            throw new MissionNotFoundError(missionId);
        if (m.status !== 'in_progress')
            throw new InvalidTransitionError(`Mission "${missionId}" is "${m.status}"; only an in_progress mission can be handed off`);
        const now = new Date().toISOString();
        const previous = [...(m.owner?.previous ?? [])];
        if (m.owner !== undefined) {
            const p = { agent: m.owner.agent, worktree: m.owner.worktree, releasedAt: now, reason: why };
            if (m.owner.sessionId !== undefined)
                p.sessionId = m.owner.sessionId;
            previous.push(p);
        }
        const owner = { agent: ctx.agent, worktree: ctx.worktree, source: ctx.source, enrolledAt: now };
        if (ctx.sessionId !== undefined)
            owner.sessionId = ctx.sessionId;
        if (ctx.branch !== undefined)
            owner.branch = ctx.branch;
        if (previous.length > 0)
            owner.previous = previous.slice(-MAX_PREVIOUS_OWNERS);
        m.owner = owner;
        m.updatedAt = now;
        return m;
    });
    return result;
}
