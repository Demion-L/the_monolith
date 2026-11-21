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
import { type StateReadTarget, type StateWriteTarget } from './state-keeper.js';
import { type Mission } from './types.js';
import type { ExecutionContext } from './context.js';
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
export declare function enrollmentIdentity(ctx: ExecutionContext): string;
export declare function autoMissionTitle(ctx: ExecutionContext): string;
/**
 * Enrol `ctx` in the Mission lifecycle. Never throws for operational failures: they come back as
 * `UNAVAILABLE` so an adapter can apply its explicit policy. Programming errors in the context are reported the
 * same way (the adapter must not crash the host).
 */
export declare function enrollMission(target: StateWriteTarget, ctx: ExecutionContext): Promise<EnrollmentResult>;
/** Read-only: the active Missions this context owns (for session start, `mission current`, Stop). */
export declare function currentMissions(target: StateReadTarget, ctx: Pick<ExecutionContext, 'worktree'> & Partial<ExecutionContext>): Promise<Mission[]>;
/**
 * Explicit transfer of an in_progress Mission to `ctx`. The only way to take over another context's Mission (or
 * to adopt an unowned one). It requires a reason, appends the previous owner to the record and writes nothing
 * else: no checkpoint, no summary.
 */
export declare function handoffMission(target: StateWriteTarget, missionId: string, ctx: ExecutionContext, reason: string): Promise<Mission>;
//# sourceMappingURL=enrollment.d.ts.map