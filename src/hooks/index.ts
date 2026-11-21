/* eslint-disable no-console */
/**
 * Claude Code hooks (GOV-EVOLUTION Phase 6). Core defines the rules; hooks only invoke them.
 *
 *   monolith hook session-start   SessionStart: injects project context (active story, missions,
 *                                 governance findings) as `additionalContext`.
 *   monolith hook stop            Stop: diagnostic reminder only. NEVER blocks: no `decision`,
 *                                 no `continue:false`, no exit 2; does nothing when
 *                                 `stop_hook_active` is true (no Stop loop).
 *   monolith hook pre-compact     PreCompact: prints plain-text instructions that Claude Code adds to the
 *                                 compaction summary (what to preserve; a reminder to record a checkpoint).
 *                                 Never blocks (no exit 2, no `decision`), never writes a checkpoint itself.
 *   monolith hook pre-tool-use    PreToolUse (Managed Execution): when `execution.mode` is "managed", enrols the first
 *                                 implementation action in a Mission (Core `enrollMission`) and denies the controlled write
 *                                 if enrolment is impossible. Unmanaged projects: silent no-op. Reads never create a Mission.
 *   monolith hook status          Honest report of the execution mode and whether the hook is installed.
 *   monolith hook print-config [--managed]
 *                                 Prints the opt-in settings snippet to stdout. Writes nothing and
 *                                 never touches any Claude Code settings file.
 *
 * Fail-safe: every fault ends in exit 0 with a short `systemMessage` (or silence) — EXCEPT a controlled write in managed
 * mode whose enrolment failed: that is denied (fail closed), by design. Only `pre-tool-use` writes anything (the
 * Mission record, via Core). No recursion: a hook started by a hook (`MONOLITH_HOOK_ACTIVE`) exits silently.
 * Cost: one dashboard read per session start / stop, never per tool call.
 */

import { readDashboardModel } from '../readmodel/index.js';
import { buildGovernanceReport } from '../governance/check.js';
import type { GovernanceReport } from '../governance/types.js';
import { sanitizeSingleLine } from '../brief/sanitize.js';
import { buildRecoveryPacket, renderRecoveryPacket } from '../handover/recovery.js';
import { evidenceStore } from '../handover/evidence.js';
import { readGitView } from '../handover/git.js';
import { enrollMission, currentMissions } from '../coordinatorium/enrollment.js';
import { deriveExecutionContext, describeOwnership, resolveWorktreeRoot, type ExecutionContext } from '../coordinatorium/context.js';
import { resolveStateLocation, stateReadTargetOf, stateWriteTargetOf } from '../coordinatorium/state-location.js';
import { readExecutionConfig } from '../coordinatorium/execution-config.js';
import { listMissions } from '../coordinatorium/mission.js';
import { classifyToolUse } from './classify.js';
import { buildExecutionStatus } from './execution-status.js';

export const HOOK_USAGE = 'Usage: monolith hook session-start | stop | pre-compact | pre-tool-use | status | print-config [--managed]';
export const HOST_AGENT = 'claude-code';
export const MAX_STDIN_BYTES = 256 * 1024;
const MAX_LINES = 12;

export interface HookInput {
  hook_event_name?: string;
  trigger?: string;
  stop_hook_active?: boolean;
  source?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
}

export function parseHookInput(raw: string): HookInput {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as HookInput) : {};
  } catch {
    return {};
  }
}

const one = (s: string): string => sanitizeSingleLine(s).slice(0, 200);

/** Context lines from Core's recovery packet (host-independent logic lives in `handover/recovery.ts`). */
export function buildSessionContext(projectRoot: string): { lines: string[]; report: GovernanceReport } {
  const model = readDashboardModel(projectRoot);
  const report = buildGovernanceReport(projectRoot, model);
  const packet = buildRecoveryPacket(projectRoot, { model, report });
  return { lines: renderRecoveryPacket(packet).split('\n'), report };
}

export function handleSessionStart(projectRoot: string, extraLines: string[] = []): object {
  try {
    const { lines: base } = buildSessionContext(projectRoot);
    const lines = [...base, ...extraLines];
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } };
  } catch {
    return { systemMessage: 'MONOLITH session hook: project context could not be computed; continuing without it.' };
  }
}


// ---------------------------------------------------------------------------
// Managed Execution
// ---------------------------------------------------------------------------

/** The directory the host says the agent works in (payload `cwd`), falling back to the process directory. */
function hostDir(input: HookInput, cwd: string): string {
  return typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : cwd;
}

function contextFor(input: HookInput, cwd: string, intent: 'implement' | 'read'): ExecutionContext {
  return deriveExecutionContext(hostDir(input, cwd), { agent: HOST_AGENT, source: 'hook:PreToolUse', sessionId: input.session_id, intent });
}

/** Facts for SessionStart / Stop: execution mode, this context's missions, other contexts' active missions. Never writes. */
export async function buildExecutionLines(input: HookInput, cwd: string): Promise<string[]> {
  const root = resolveWorktreeRoot(hostDir(input, cwd));
  const st = buildExecutionStatus(root);
  const lines = [`Execution: ${st.summary}`];
  try {
    const ctx = contextFor(input, cwd, 'read');
    const target = stateReadTargetOf(resolveStateLocation(root));
    const mine = await currentMissions(target, ctx);
    if (mine.length > 0) {
      lines.push(`Mission(s) owned by this worktree: ${mine.map((m) => `${one(m.id)} (${one(m.title)})`).join('; ')}. ` +
        'Work continues under it; a restarted session resumes it. A crash leaves it in progress — it is never closed automatically. Record facts with `monolith mission checkpoint`.');
    } else if (st.config.mode === 'managed') {
      lines.push('No mission is registered for this worktree yet. One is registered automatically at the first implementation action (reading and discussion register nothing).');
    }
    for (const m of (await listMissions(target)).filter((x) => x.status === 'in_progress' && x.owner !== undefined && x.owner.worktree !== ctx.worktree)) {
      const v = describeOwnership(m, ctx);
      lines.push(`Active mission of another context: ${one(m.id)} — ${one(v.detail)}${v.liveness === 'confirmed-orphaned' ? ' (confirmed orphaned: continue it only with `monolith mission handoff ' + one(m.id) + ' --reason "..."`)' : ''}. It is not yours; do not checkpoint or finish it.`);
    }
  } catch {
    lines.push('Mission ownership could not be read; nothing was assumed.');
  }
  return lines;
}

function deny(reason: string): object {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

/**
 * PreToolUse. Returns the JSON for stdout, or null for "no opinion" (the host's own permission flow continues; this
 * hook NEVER answers "allow", so it cannot override the user's permission rules).
 *
 *   unmanaged project              -> null
 *   read / governed / external /
 *   uncontrolled action            -> null (never creates a mission)
 *   implementation action          -> Core enrolment:
 *       CREATED   -> additionalContext with the Mission id (the agent must know it)
 *       REUSED    -> null (or a one-line note after a restart)
 *       CONFLICT  -> deny
 *       UNAVAILABLE -> deny, or allow-with-warning when `execution.onEnrollmentFailure` is "allow"
 */
export async function handlePreToolUse(input: HookInput, cwd: string = process.cwd()): Promise<object | null> {
  const dir = hostDir(input, cwd);
  const root = resolveWorktreeRoot(dir);
  const cfg = readExecutionConfig(root);
  if (cfg.status !== 'ok') {
    return { systemMessage: `MONOLITH: execution mode could not be determined (${one(cfg.detail ?? '')}); this write is NOT governed by Managed Execution. Fix monolith.config.json.` };
  }
  if (cfg.mode !== 'managed') return null;

  const cls = classifyToolUse(input.tool_name, input.tool_input, dir, root);
  if (cls.action !== 'implementation') return null;

  const stop = 'Tell the owner; do not work around this check.';
  let result;
  try {
    const ctx = contextFor(input, cwd, 'implement');
    result = await enrollMission(stateWriteTargetOf(resolveStateLocation(root)), ctx);
  } catch (err) {
    result = { status: 'UNAVAILABLE' as const, missionId: null, reason: err instanceof Error ? one(`${err.name}: ${err.message}`) : 'unknown error' };
  }
  switch (result.status) {
    case 'CREATED':
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `MONOLITH Managed Execution registered this implementation work as mission ${result.missionId} (owner: this worktree). Record real progress with \`monolith mission checkpoint ${result.missionId} --summary "..."\`; finish it with \`monolith mission finish\` only when the work is actually done.` } };
    case 'REUSED':
      return result.resumedFromSession !== undefined
        ? { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `MONOLITH: resumed mission ${result.missionId} of this worktree (previous session ${one(result.resumedFromSession)}). Check its checkpoints (\`monolith mission checkpoints ${result.missionId}\`) before continuing.` } }
        : null;
    case 'CONFLICT':
      return deny(`MONOLITH Managed Execution: ${one(result.reason)} (${(result.candidates ?? []).join(', ')}). This ${one(input.tool_name ?? 'tool')} call was blocked and nothing was changed. Resolve it with \`monolith mission current\`, \`monolith mission finish\` or \`monolith mission handoff\`. ${stop}`);
    default:
      if (cfg.onEnrollmentFailure === 'allow') {
        return { systemMessage: `MONOLITH Managed Execution: enrolment failed (${one(result.reason)}); the write proceeds because execution.onEnrollmentFailure is "allow". This write is NOT tracked by a mission.` };
      }
      return deny(`MONOLITH Managed Execution: this ${one(input.tool_name ?? 'tool')} call was blocked because the work could not be enrolled in a mission (${one(result.reason)}). Nothing was written. ${stop}`);
  }
}

export function handleStop(projectRoot: string, input: HookInput, managedNote: string | null = null): object | null {
  if (input.stop_hook_active === true) return null;
  try {
    const model = readDashboardModel(projectRoot);
    const notes: string[] = [];
    const active = model.currentMissions.data?.active ?? [];
    if (active.length > 0) {
      notes.push(`mission ${active.map((m) => one(m.id)).join(', ')} is still in progress (checkpoint or finish it)`);
      // Only an objectively observable signal is reported: uncommitted changes while a mission is open.
      const dirs = (() => {
        try {
          return [evidenceStore(projectRoot).dirRel];
        } catch {
          return [];
        }
      })();
      const view = readGitView(projectRoot, dirs);
      if (view.dirty === true) notes.push('the working tree has uncommitted changes — consider `monolith mission checkpoint` to record progress');
      const withoutCheckpoint = (model.history?.data?.missions ?? []).filter((m) => m.status === 'in_progress' && m.checkpointCount === 0);
      if (withoutCheckpoint.length > 0) notes.push(`no checkpoint is recorded for ${withoutCheckpoint.map((m) => one(m.id)).join(', ')}`);
    }
    if (managedNote !== null) notes.push(managedNote);
    const report = buildGovernanceReport(projectRoot, model);
    if (report.result === 'ISSUES_FOUND') notes.push(`governance check reports ${report.counts.error} error(s), ${report.counts.warning} warning(s)`);
    if (notes.length > 0) notes.push('before a final report on autonomous work, run `monolith handover check`');
    return notes.length === 0 ? null : { systemMessage: `MONOLITH: ${notes.join('; ')}.` };
  } catch {
    return null;
  }
}

/**
 * PreCompact: text for the compaction summary. Plain stdout is the only channel Claude Code documents for it
 * (`systemMessage` is discarded). It states what MONOLITH knows; it records nothing and invents nothing.
 */
export function handlePreCompact(projectRoot: string, ownedIds: string[] | null = null): string | null {
  try {
    const p = buildRecoveryPacket(projectRoot);
    const lines: string[] = [];
    if (ownedIds !== null) lines.push(ownedIds.length > 0 ? `Mission(s) owned by this worktree: ${ownedIds.join(', ')} (continue only these; others belong to other contexts).` : 'No mission is owned by this worktree.');
    if (p.activeStory.known && p.activeStory.value.kind === 'ids') lines.push(`Active story: ${p.activeStory.value.ids.join(', ')}.`);
    if (p.activeMissions.known && p.activeMissions.value.length > 0) {
      lines.push(`Active mission(s): ${p.activeMissions.value.map((m) => `${m.id} (${m.title})`).join('; ')}.`);
      if (p.lastCheckpoint.known) lines.push(`Last recorded checkpoint: ${p.lastCheckpoint.value.id} — ${p.lastCheckpoint.value.summary}`);
      else lines.push('No checkpoint is recorded for the active mission(s).');
      lines.push('Preserve in the summary: what is done, what remains, decisions taken and why, and the commands whose results were observed. Progress made since the last checkpoint is not yet recorded: after compaction record it with `monolith mission checkpoint <id> --summary "..." --remaining "..."` — only facts, never invented.');
    }
    if (lines.length === 0) return null;
    return `MONOLITH state to preserve across compaction (read-only snapshot):\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

/** Opt-in settings snippet. `|| true` and `command -v` keep a missing CLI from breaking the session. */
export function hookConfigSnippet(managed = false): string {
  const cmd = (sub: string): string => `command -v monolith >/dev/null 2>&1 && monolith hook ${sub} || true`;
  const hooks: Record<string, unknown> = {
    SessionStart: [{ hooks: [{ type: 'command', command: cmd('session-start'), timeout: 20 }] }],
    Stop: [{ hooks: [{ type: 'command', command: cmd('stop'), timeout: 20 }] }],
    PreCompact: [{ hooks: [{ type: 'command', command: cmd('pre-compact'), timeout: 20 }] }],
  };
  if (managed) {
    // Fail closed: a missing CLI or a crashing hook must not become a silent bypass of the controlled tools.
    const strict =
      "command -v monolith >/dev/null 2>&1 || { echo 'MONOLITH Managed Execution: the monolith CLI was not found, so this write cannot be enrolled in a mission. Install it or remove this hook.' >&2; exit 2; }; " +
      "monolith hook pre-tool-use || { echo 'MONOLITH Managed Execution: the hook failed; this write was blocked.' >&2; exit 2; }";
    hooks.PreToolUse = [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash', hooks: [{ type: 'command', command: strict, timeout: 30 }] }];
  }
  return JSON.stringify({ hooks }, null, 2);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += (c as Buffer).length;
    if (size > MAX_STDIN_BYTES) break;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runHookCommand(args: string[], cwd: string = process.cwd()): Promise<number> {
  const sub = args[0];
  if (sub === 'print-config') {
    console.log(hookConfigSnippet(args.includes('--managed')));
    if (args.includes('--managed')) {
      console.error('# Also set "execution": { "mode": "managed" } in monolith.config.json (the hook is a no-op until you do). Merge this snippet into .claude/settings.json yourself; nothing was written.');
    }
    return 0;
  }
  if (sub === 'status') {
    const root = resolveWorktreeRoot(cwd);
    const st = buildExecutionStatus(root);
    console.log(st.summary);
    console.log(`  mode: ${st.config.mode}; on enrolment failure: ${st.config.onEnrollmentFailure}; config: ${st.config.status}`);
    console.log(`  hook: ${st.hook.installation} — ${st.hook.note}`);
    return st.enforcement === 'configured-hook-not-found' || st.enforcement === 'config-problem' ? 2 : 0;
  }
  if (sub !== 'session-start' && sub !== 'stop' && sub !== 'pre-compact' && sub !== 'pre-tool-use') {
    console.error(HOOK_USAGE);
    return 1;
  }
  if (process.env.MONOLITH_HOOK_ACTIVE === '1') return 0; // recursion guard
  process.env.MONOLITH_HOOK_ACTIVE = '1';
  let input: HookInput = {};
  try {
    input = parseHookInput(await readStdin());
    const dir = hostDir(input, cwd);
    if (sub === 'pre-tool-use') {
      try {
        const out = await handlePreToolUse(input, cwd);
        if (out !== null) console.log(JSON.stringify(out));
      } catch (err) {
        // Fail closed for a controlled write in a managed project; never for anything else.
        const managed = readExecutionConfig(resolveWorktreeRoot(dir)).mode === 'managed';
        console.log(JSON.stringify(managed ? deny(`MONOLITH Managed Execution: the hook failed (${one(err instanceof Error ? err.message : String(err))}); this call was blocked. Tell the owner; do not work around this check.`) : { systemMessage: 'MONOLITH hook failed safely; no action taken.' }));
      }
      return 0;
    }
    const root = resolveWorktreeRoot(dir);
    if (sub === 'pre-compact') {
      let owned: string[] | null = null;
      try {
        if (readExecutionConfig(root).mode === 'managed') owned = (await currentMissions(stateReadTargetOf(resolveStateLocation(root)), contextFor(input, cwd, 'read'))).map((m) => m.id);
      } catch {
        owned = null;
      }
      const text = handlePreCompact(root, owned);
      if (text !== null) console.log(text);
      return 0;
    }
    if (sub === 'session-start') {
      let extra: string[] = [];
      try {
        extra = await buildExecutionLines(input, cwd);
      } catch {
        extra = [];
      }
      console.log(JSON.stringify(handleSessionStart(root, extra)));
      return 0;
    }
    let managedNote: string | null = null;
    try {
      if (readExecutionConfig(root).mode === 'managed' && input.stop_hook_active !== true) {
        const mine = await currentMissions(stateReadTargetOf(resolveStateLocation(root)), contextFor(input, cwd, 'read'));
        if (mine.length === 0) {
          const view = readGitView(root, []);
          if (view.dirty === true) managedNote = 'managed mode: the working tree has uncommitted changes but no mission is registered for this worktree (untracked implementation; write controls cover only hook-routed tools)';
        } else {
          managedNote = `managed mode: mission ${mine.map((m) => one(m.id)).join(', ')} stays in progress after this stop (stopping is not finishing; nothing was closed)`;
        }
      }
    } catch {
      managedNote = null;
    }
    const out = handleStop(root, input, managedNote);
    if (out !== null) console.log(JSON.stringify(out));
  } catch {
    console.log(JSON.stringify({ systemMessage: 'MONOLITH hook failed safely; no action taken.' }));
  }
  return 0;
}
