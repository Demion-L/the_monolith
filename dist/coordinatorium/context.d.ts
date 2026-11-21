/**
 * Execution context and ownership semantics (Autonomous Execution Discipline).
 *
 * Host-neutral: nothing here knows Claude Code. A host adapter only builds an `ExecutionContext` and calls Core.
 * Ownership is COORDINATION, not authentication (see `MissionOwner`).
 */
import type { Mission } from './types.js';
export interface ExecutionContext {
    /** Host adapter name ("claude-code", "codex", "cli", ...). Informational. */
    agent: string;
    /** Real path of the worktree. The identity of the execution context. */
    worktree: string;
    sessionId?: string;
    /** Informational; never an identity. */
    branch?: string;
    /** Only an explicit story link is used; it is never inferred. */
    storyId?: string;
    /** Who is asking, e.g. "hook:PreToolUse" or "cli". */
    source: string;
    /** What the host observed. Only `implement` can enrol. Default `implement`. */
    intent?: 'implement' | 'read';
}
/** Worktree root (real path) of `dir`: the git top level, else `dir` itself. */
export declare function resolveWorktreeRoot(dir: string): string;
export interface DeriveOptions {
    agent: string;
    source: string;
    sessionId?: string;
    storyId?: string;
    intent?: 'implement' | 'read';
}
/** Build the context of the process working in `dir`. Branch is read best-effort (detached HEAD => omitted). */
export declare function deriveExecutionContext(dir: string, opts: DeriveOptions): ExecutionContext;
export type OwnershipRelation = 'unowned' | 'this-context' | 'other-context';
/**
 * What is KNOWN about whether the owner is still around. There is no heartbeat and no timeout rule: absence of
 * activity proves nothing. Only one fact is conclusive: the owner's worktree no longer exists.
 */
export type OwnerLiveness = 'not-applicable' | 'unknown' | 'confirmed-orphaned';
export interface OwnershipView {
    relation: OwnershipRelation;
    liveness: OwnerLiveness;
    detail: string;
}
export declare function describeOwnership(mission: Mission, current: Pick<ExecutionContext, 'worktree'>): OwnershipView;
/**
 * Managed-workflow guard: an owned Mission may only be changed from its owner's worktree. A Mission without an
 * owner is never restricted (backward compatibility). Throws `MissionOwnershipError`; changes nothing.
 */
export declare function assertMissionAccess(mission: Mission, actor: Pick<ExecutionContext, 'worktree'> | undefined, operation: string): void;
//# sourceMappingURL=context.d.ts.map