/* eslint-disable no-console */
/**
 * Claude Code hooks (GOV-EVOLUTION Phase 6). Core defines the rules; hooks only invoke them.
 *
 *   monolith hook session-start   SessionStart: injects project context (active story, missions,
 *                                 governance findings) as `additionalContext`.
 *   monolith hook stop            Stop: diagnostic reminder only. NEVER blocks: no `decision`,
 *                                 no `continue:false`, no exit 2; does nothing when
 *                                 `stop_hook_active` is true (no Stop loop).
 *   monolith hook print-config    Prints the opt-in settings snippet to stdout. Writes nothing and
 *                                 never touches any Claude Code settings file.
 *
 * Fail-safe: every fault ends in exit 0 with a short `systemMessage` (or silence). Read-only: no
 * file is written. No recursion: a hook started by a hook (`MONOLITH_HOOK_ACTIVE`) exits silently.
 * Cost: one dashboard read per session start / stop, never per tool call.
 */

import { readDashboardModel } from '../readmodel/index.js';
import { buildGovernanceReport } from '../governance/check.js';
import type { GovernanceReport } from '../governance/types.js';
import { sanitizeSingleLine } from '../brief/sanitize.js';

export const HOOK_USAGE = 'Usage: monolith hook session-start | stop | print-config';
export const MAX_STDIN_BYTES = 256 * 1024;
const MAX_LINES = 12;

export interface HookInput {
  hook_event_name?: string;
  stop_hook_active?: boolean;
  source?: string;
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

/** Compact context lines from Core's own results. */
export function buildSessionContext(projectRoot: string): { lines: string[]; report: GovernanceReport } {
  const model = readDashboardModel(projectRoot);
  const report = buildGovernanceReport(projectRoot, model);
  const lines: string[] = ['MONOLITH project context (from `monolith`; read-only; refresh with `monolith brief`).'];
  const ov = model.projectOverview.data;
  if (ov === null) {
    lines.push('Instance: not established (no valid monolith.config.json). Run `monolith validate`.');
  } else {
    const claim = ov.storyClaim;
    lines.push(`Active story: ${claim?.kind === 'ids' ? claim.ids.map(one).join(', ') : claim?.kind === 'none' ? 'none recorded' : 'unresolved'}.`);
    const active = model.currentMissions.data?.active ?? [];
    lines.push(
      active.length === 0
        ? 'Active mission: none. Record work with `monolith mission start` / `checkpoint` / `finish`.'
        : `Active mission(s): ${active.map((m) => `${one(m.id)} (${one(m.title)})`).join('; ')}. Record progress with \`monolith mission checkpoint\`.`,
    );
  }
  const bad = report.findings.filter((f) => f.severity !== 'INFO');
  if (bad.length === 0) lines.push('Governance check: no issues.');
  else {
    lines.push(`Governance check: ${report.counts.error} error(s), ${report.counts.warning} warning(s). Run \`monolith governance check\`. Fix formats per .monolith/protocols/governance/document-formats.md.`);
    for (const f of bad.slice(0, MAX_LINES)) lines.push(`- [${f.severity}] ${f.area} ${f.code}${f.path ? ` (${f.path})` : ''}`);
    if (bad.length > MAX_LINES) lines.push(`- … ${bad.length - MAX_LINES} more`);
  }
  lines.push('Reminder: update project context (active.md, checkpoints) when work changes; finalize only via `monolith finalize` with owner approval.');
  return { lines, report };
}

export function handleSessionStart(projectRoot: string): object {
  try {
    const { lines } = buildSessionContext(projectRoot);
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } };
  } catch {
    return { systemMessage: 'MONOLITH session hook: project context could not be computed; continuing without it.' };
  }
}

export function handleStop(projectRoot: string, input: HookInput): object | null {
  if (input.stop_hook_active === true) return null;
  try {
    const model = readDashboardModel(projectRoot);
    const notes: string[] = [];
    const active = model.currentMissions.data?.active ?? [];
    if (active.length > 0) notes.push(`mission ${active.map((m) => one(m.id)).join(', ')} is still in progress (checkpoint or finish it)`);
    const report = buildGovernanceReport(projectRoot, model);
    if (report.result === 'ISSUES_FOUND') notes.push(`governance check reports ${report.counts.error} error(s), ${report.counts.warning} warning(s)`);
    return notes.length === 0 ? null : { systemMessage: `MONOLITH: ${notes.join('; ')}.` };
  } catch {
    return null;
  }
}

/** Opt-in settings snippet. `|| true` and `command -v` keep a missing CLI from breaking the session. */
export function hookConfigSnippet(): string {
  const cmd = (sub: string): string => `command -v monolith >/dev/null 2>&1 && monolith hook ${sub} || true`;
  return JSON.stringify(
    {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: cmd('session-start'), timeout: 20 }] }],
        Stop: [{ hooks: [{ type: 'command', command: cmd('stop'), timeout: 20 }] }],
      },
    },
    null,
    2,
  );
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
    console.log(hookConfigSnippet());
    return 0;
  }
  if (sub !== 'session-start' && sub !== 'stop') {
    console.error(HOOK_USAGE);
    return 1;
  }
  if (process.env.MONOLITH_HOOK_ACTIVE === '1') return 0; // recursion guard
  process.env.MONOLITH_HOOK_ACTIVE = '1';
  try {
    const input = parseHookInput(await readStdin());
    const out = sub === 'session-start' ? handleSessionStart(cwd) : handleStop(cwd, input);
    if (out !== null) console.log(JSON.stringify(out));
  } catch {
    console.log(JSON.stringify({ systemMessage: 'MONOLITH hook failed safely; no action taken.' }));
  }
  return 0;
}
