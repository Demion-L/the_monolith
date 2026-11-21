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

import { mutateState, readState, type StateReadTarget, type StateWriteTarget } from './state-keeper.js';
import { STORY_ID_RE, MAX_PREVIOUS_OWNERS, type CoordinatoriumState, type Mission, type MissionOwner, type PreviousOwner } from './types.js';
import { ValidationError, MissionNotFoundError, InvalidTransitionError } from './errors.js';
import type { ExecutionContext } from './context.js';
import { nextMissionId } from './mission.js';

/**
 * CREATED     a new Mission was registered for this context.
 * REUSED      the context's existing active Mission is used (no new record).
 * SKIPPED     nothing to enrol: the observed action is not implementation. State untouched.
 * CONFLICT    ownership is ambiguous (several candidates / a different story); an explicit choice is required.
 * UNAVAILABLE enrolment could not be performed (state unreadable, lock, write failure). Nothing is assumed.
 */
export type EnrollmentStatus = 'CREATED' | 'REUSED' | 'SKIPPED' | 'CONFLICT' | 'UNAVAILABLE';

export interface EnrollmentResult {
  status: EnrollmentStatus;
  missionId: string | null;
  reason: string;
  /** CONFLICT: the active Missions of this context that made the choice ambiguous. */
  candidates?: string[];
  /** REUSED across a restart: the previous session id recorded on the Mission. */
  resumedFromSession?: string;
}

export function enrollmentIdentity(ctx: ExecutionContext): string {
  return `${ctx.agent}@${ctx.worktree}`;
}

function validateContext(ctx: ExecutionContext): void {
  if (typeof ctx.agent !== 'string' || ctx.agent.trim() === '' || ctx.agent.length > 64) throw new ValidationError('"agent" must be a non-empty string of at most 64 characters');
  if (typeof ctx.worktree !== 'string' || ctx.worktree === '' || ctx.worktree.length > 4096) throw new ValidationError('"worktree" must be a non-empty path');
  if (typeof ctx.source !== 'string' || ctx.source === '' || ctx.source.length > 64) throw new ValidationError('"source" must be a non-empty string of at most 64 characters');
  if (ctx.storyId !== undefined && !STORY_ID_RE.test(ctx.storyId)) throw new ValidationError(`"storyId" must match ${STORY_ID_RE.source}`);
}

function owned(state: CoordinatoriumState, ctx: ExecutionContext): Mission[] {
  return Object.values(state.tactical.missions)
    .filter((m) => m.status === 'in_progress' && m.owner !== undefined && m.owner.agent === ctx.agent && m.owner.worktree === ctx.worktree)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
}

type Decision = { kind: 'reuse'; mission: Mission } | { kind: 'conflict'; candidates: Mission[]; reason: string } | { kind: 'create' };

function decide(state: CoordinatoriumState, ctx: ExecutionContext): Decision {
  const mine = owned(state, ctx);
  if (mine.length === 0) return { kind: 'create' };
  if (ctx.storyId !== undefined) {
    const linked = mine.filter((m) => m.storyId === ctx.storyId);
    if (linked.length === 1) return { kind: 'reuse', mission: linked[0] };
    if (linked.length > 1) return { kind: 'conflict', candidates: linked, reason: `several active missions of this context are linked to ${ctx.storyId}` };
    return { kind: 'conflict', candidates: mine, reason: `this context already has an active mission not linked to ${ctx.storyId}; finish it or hand it off explicitly` };
  }
  if (mine.length === 1) return { kind: 'reuse', mission: mine[0] };
  return { kind: 'conflict', candidates: mine, reason: 'several active missions belong to this context; name one explicitly' };
}

function conflict(d: Extract<Decision, { kind: 'conflict' }>): EnrollmentResult {
  return { status: 'CONFLICT', missionId: null, reason: d.reason, candidates: d.candidates.map((m) => m.id) };
}

export function autoMissionTitle(ctx: ExecutionContext): string {
  const where = ctx.branch !== undefined ? `branch ${ctx.branch}` : 'a detached HEAD';
  const dir = ctx.worktree.split(/[\\/]/).filter(Boolean).pop() ?? ctx.worktree;
  return `Managed implementation (${ctx.agent}, worktree ${dir}, ${where})`;
}

/**
 * Enrol `ctx` in the Mission lifecycle. Never throws for operational failures: they come back as
 * `UNAVAILABLE` so an adapter can apply its explicit policy. Programming errors in the context are reported the
 * same way (the adapter must not crash the host).
 */
export async function enrollMission(target: StateWriteTarget, ctx: ExecutionContext): Promise<EnrollmentResult> {
  try {
    validateContext(ctx);
    if (ctx.intent === 'read') return { status: 'SKIPPED', missionId: null, reason: 'not an implementation action; no mission is registered for reading or discussion' };

    // Fast path (no lock, no write): the common repeated call from the same session.
    const quick = decide(await readState(target as StateReadTarget), ctx);
    if (quick.kind === 'reuse' && (ctx.sessionId === undefined || quick.mission.owner?.sessionId === ctx.sessionId)) {
      return { status: 'REUSED', missionId: quick.mission.id, reason: 'active mission of this execution context' };
    }

    const { result } = await mutateState(target, (draft): EnrollmentResult => {
      const d = decide(draft, ctx);
      if (d.kind === 'conflict') return conflict(d);
      if (d.kind === 'reuse') {
        const owner = d.mission.owner as MissionOwner;
        const resumedFrom = ctx.sessionId !== undefined && owner.sessionId !== undefined && owner.sessionId !== ctx.sessionId ? owner.sessionId : undefined;
        if (ctx.sessionId !== undefined && owner.sessionId !== ctx.sessionId) {
          owner.sessionId = ctx.sessionId;
          d.mission.updatedAt = new Date().toISOString();
        }
        return { status: 'REUSED', missionId: d.mission.id, reason: 'active mission of this execution context', ...(resumedFrom !== undefined ? { resumedFromSession: resumedFrom } : {}) };
      }
      const id = nextMissionId(draft.tactical.missions);
      const now = new Date().toISOString();
      const owner: MissionOwner = { agent: ctx.agent, worktree: ctx.worktree, source: ctx.source, enrolledAt: now };
      if (ctx.sessionId !== undefined) owner.sessionId = ctx.sessionId;
      if (ctx.branch !== undefined) owner.branch = ctx.branch;
      const mission: Mission = { id, title: autoMissionTitle(ctx), system: 'autonomous', status: 'in_progress', startedAt: now, updatedAt: now, summary: null, owner };
      if (ctx.storyId !== undefined) mission.storyId = ctx.storyId;
      draft.tactical.missions[id] = mission;
      return { status: 'CREATED', missionId: id, reason: 'first implementation action of this execution context' };
    });
    return result;
  } catch (err) {
    return { status: 'UNAVAILABLE', missionId: null, reason: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 600) : 'unknown error' };
  }
}

/** Read-only: the active Missions this context owns (for session start, `mission current`, Stop). */
export async function currentMissions(target: StateReadTarget, ctx: Pick<ExecutionContext, 'worktree'> & Partial<ExecutionContext>): Promise<Mission[]> {
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
export async function handoffMission(target: StateWriteTarget, missionId: string, ctx: ExecutionContext, reason: string): Promise<Mission> {
  validateContext(ctx);
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why === '') throw new ValidationError('a handoff requires a non-empty reason');
  if (why.length > 1000) throw new ValidationError('"reason" must be at most 1000 characters');
  const { result } = await mutateState(target, (draft) => {
    const m = draft.tactical.missions[missionId];
    if (!m) throw new MissionNotFoundError(missionId);
    if (m.status !== 'in_progress') throw new InvalidTransitionError(`Mission "${missionId}" is "${m.status}"; only an in_progress mission can be handed off`);
    const now = new Date().toISOString();
    const previous: PreviousOwner[] = [...(m.owner?.previous ?? [])];
    if (m.owner !== undefined) {
      const p: PreviousOwner = { agent: m.owner.agent, worktree: m.owner.worktree, releasedAt: now, reason: why };
      if (m.owner.sessionId !== undefined) p.sessionId = m.owner.sessionId;
      previous.push(p);
    }
    const owner: MissionOwner = { agent: ctx.agent, worktree: ctx.worktree, source: ctx.source, enrolledAt: now };
    if (ctx.sessionId !== undefined) owner.sessionId = ctx.sessionId;
    if (ctx.branch !== undefined) owner.branch = ctx.branch;
    if (previous.length > 0) owner.previous = previous.slice(-MAX_PREVIOUS_OWNERS);
    m.owner = owner;
    m.updatedAt = now;
    return m;
  });
  return result;
}
