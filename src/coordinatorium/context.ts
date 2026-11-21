/**
 * Execution context and ownership semantics (Autonomous Execution Discipline).
 *
 * Host-neutral: nothing here knows Claude Code. A host adapter only builds an `ExecutionContext` and calls Core.
 * Ownership is COORDINATION, not authentication (see `MissionOwner`).
 */

import { execFileSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { resolve } from 'path';
import { MissionOwnershipError } from './errors.js';
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

const GIT_ENV_STRIP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE'];

function gitOut(cwd: string, args: string[]): string | null {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const k of GIT_ENV_STRIP) delete env[k];
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'], env }).trim();
  } catch {
    return null;
  }
}

/** Worktree root (real path) of `dir`: the git top level, else `dir` itself. */
export function resolveWorktreeRoot(dir: string): string {
  const abs = resolve(dir);
  const top = gitOut(abs, ['rev-parse', '--show-toplevel']);
  try {
    return realpathSync(top !== null && top !== '' ? top : abs);
  } catch {
    return top !== null && top !== '' ? top : abs;
  }
}

export interface DeriveOptions {
  agent: string;
  source: string;
  sessionId?: string;
  storyId?: string;
  intent?: 'implement' | 'read';
}

/** Build the context of the process working in `dir`. Branch is read best-effort (detached HEAD => omitted). */
export function deriveExecutionContext(dir: string, opts: DeriveOptions): ExecutionContext {
  const worktree = resolveWorktreeRoot(dir);
  const branch = gitOut(worktree, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const ctx: ExecutionContext = { agent: opts.agent, worktree, source: opts.source };
  if (opts.sessionId !== undefined && opts.sessionId !== '') ctx.sessionId = opts.sessionId.slice(0, 256);
  if (branch !== null && branch !== '') ctx.branch = branch.slice(0, 256);
  if (opts.storyId !== undefined) ctx.storyId = opts.storyId;
  if (opts.intent !== undefined) ctx.intent = opts.intent;
  return ctx;
}

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

export function describeOwnership(mission: Mission, current: Pick<ExecutionContext, 'worktree'>): OwnershipView {
  const o = mission.owner;
  if (o === undefined) return { relation: 'unowned', liveness: 'not-applicable', detail: 'manual/legacy mission: no owner recorded' };
  if (o.worktree === current.worktree) return { relation: 'this-context', liveness: 'not-applicable', detail: `owned by this worktree (${o.agent}${o.sessionId ? `, last session ${o.sessionId}` : ''})` };
  if (!existsSync(o.worktree)) return { relation: 'other-context', liveness: 'confirmed-orphaned', detail: `owner worktree ${o.worktree} no longer exists` };
  return { relation: 'other-context', liveness: 'unknown', detail: `owned by ${o.agent} in ${o.worktree}; whether it is still working is UNKNOWN` };
}

/**
 * Managed-workflow guard: an owned Mission may only be changed from its owner's worktree. A Mission without an
 * owner is never restricted (backward compatibility). Throws `MissionOwnershipError`; changes nothing.
 */
export function assertMissionAccess(mission: Mission, actor: Pick<ExecutionContext, 'worktree'> | undefined, operation: string): void {
  if (actor === undefined || mission.owner === undefined) return;
  if (mission.owner.worktree === actor.worktree) return;
  throw new MissionOwnershipError(mission.id, mission.owner.worktree, operation);
}
