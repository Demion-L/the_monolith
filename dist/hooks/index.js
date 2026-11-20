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
 *   monolith hook print-config    Prints the opt-in settings snippet to stdout. Writes nothing and
 *                                 never touches any Claude Code settings file.
 *
 * Fail-safe: every fault ends in exit 0 with a short `systemMessage` (or silence). Read-only: no
 * file is written. No recursion: a hook started by a hook (`MONOLITH_HOOK_ACTIVE`) exits silently.
 * Cost: one dashboard read per session start / stop, never per tool call.
 */
import { readDashboardModel } from '../readmodel/index.js';
import { buildGovernanceReport } from '../governance/check.js';
import { sanitizeSingleLine } from '../brief/sanitize.js';
import { buildRecoveryPacket, renderRecoveryPacket } from '../handover/recovery.js';
import { evidenceStore } from '../handover/evidence.js';
import { readGitView } from '../handover/git.js';
export const HOOK_USAGE = 'Usage: monolith hook session-start | stop | pre-compact | print-config';
export const MAX_STDIN_BYTES = 256 * 1024;
const MAX_LINES = 12;
export function parseHookInput(raw) {
    try {
        const v = JSON.parse(raw);
        return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {};
    }
    catch {
        return {};
    }
}
const one = (s) => sanitizeSingleLine(s).slice(0, 200);
/** Context lines from Core's recovery packet (host-independent logic lives in `handover/recovery.ts`). */
export function buildSessionContext(projectRoot) {
    const model = readDashboardModel(projectRoot);
    const report = buildGovernanceReport(projectRoot, model);
    const packet = buildRecoveryPacket(projectRoot, { model, report });
    return { lines: renderRecoveryPacket(packet).split('\n'), report };
}
export function handleSessionStart(projectRoot) {
    try {
        const { lines } = buildSessionContext(projectRoot);
        return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } };
    }
    catch {
        return { systemMessage: 'MONOLITH session hook: project context could not be computed; continuing without it.' };
    }
}
export function handleStop(projectRoot, input) {
    if (input.stop_hook_active === true)
        return null;
    try {
        const model = readDashboardModel(projectRoot);
        const notes = [];
        const active = model.currentMissions.data?.active ?? [];
        if (active.length > 0) {
            notes.push(`mission ${active.map((m) => one(m.id)).join(', ')} is still in progress (checkpoint or finish it)`);
            // Only an objectively observable signal is reported: uncommitted changes while a mission is open.
            const dirs = (() => {
                try {
                    return [evidenceStore(projectRoot).dirRel];
                }
                catch {
                    return [];
                }
            })();
            const view = readGitView(projectRoot, dirs);
            if (view.dirty === true)
                notes.push('the working tree has uncommitted changes — consider `monolith mission checkpoint` to record progress');
            const withoutCheckpoint = (model.history?.data?.missions ?? []).filter((m) => m.status === 'in_progress' && m.checkpointCount === 0);
            if (withoutCheckpoint.length > 0)
                notes.push(`no checkpoint is recorded for ${withoutCheckpoint.map((m) => one(m.id)).join(', ')}`);
        }
        const report = buildGovernanceReport(projectRoot, model);
        if (report.result === 'ISSUES_FOUND')
            notes.push(`governance check reports ${report.counts.error} error(s), ${report.counts.warning} warning(s)`);
        if (notes.length > 0)
            notes.push('before a final report on autonomous work, run `monolith handover check`');
        return notes.length === 0 ? null : { systemMessage: `MONOLITH: ${notes.join('; ')}.` };
    }
    catch {
        return null;
    }
}
/**
 * PreCompact: text for the compaction summary. Plain stdout is the only channel Claude Code documents for it
 * (`systemMessage` is discarded). It states what MONOLITH knows; it records nothing and invents nothing.
 */
export function handlePreCompact(projectRoot) {
    try {
        const p = buildRecoveryPacket(projectRoot);
        const lines = [];
        if (p.activeStory.known && p.activeStory.value.kind === 'ids')
            lines.push(`Active story: ${p.activeStory.value.ids.join(', ')}.`);
        if (p.activeMissions.known && p.activeMissions.value.length > 0) {
            lines.push(`Active mission(s): ${p.activeMissions.value.map((m) => `${m.id} (${m.title})`).join('; ')}.`);
            if (p.lastCheckpoint.known)
                lines.push(`Last recorded checkpoint: ${p.lastCheckpoint.value.id} — ${p.lastCheckpoint.value.summary}`);
            else
                lines.push('No checkpoint is recorded for the active mission(s).');
            lines.push('Preserve in the summary: what is done, what remains, decisions taken and why, and the commands whose results were observed. Progress made since the last checkpoint is not yet recorded: after compaction record it with `monolith mission checkpoint <id> --summary "..." --remaining "..."` — only facts, never invented.');
        }
        if (lines.length === 0)
            return null;
        return `MONOLITH state to preserve across compaction (read-only snapshot):\n${lines.join('\n')}`;
    }
    catch {
        return null;
    }
}
/** Opt-in settings snippet. `|| true` and `command -v` keep a missing CLI from breaking the session. */
export function hookConfigSnippet() {
    const cmd = (sub) => `command -v monolith >/dev/null 2>&1 && monolith hook ${sub} || true`;
    return JSON.stringify({
        hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: cmd('session-start'), timeout: 20 }] }],
            Stop: [{ hooks: [{ type: 'command', command: cmd('stop'), timeout: 20 }] }],
            PreCompact: [{ hooks: [{ type: 'command', command: cmd('pre-compact'), timeout: 20 }] }],
        },
    }, null, 2);
}
async function readStdin() {
    if (process.stdin.isTTY)
        return '';
    const chunks = [];
    let size = 0;
    for await (const c of process.stdin) {
        size += c.length;
        if (size > MAX_STDIN_BYTES)
            break;
        chunks.push(c);
    }
    return Buffer.concat(chunks).toString('utf8');
}
export async function runHookCommand(args, cwd = process.cwd()) {
    const sub = args[0];
    if (sub === 'print-config') {
        console.log(hookConfigSnippet());
        return 0;
    }
    if (sub !== 'session-start' && sub !== 'stop' && sub !== 'pre-compact') {
        console.error(HOOK_USAGE);
        return 1;
    }
    if (process.env.MONOLITH_HOOK_ACTIVE === '1')
        return 0; // recursion guard
    process.env.MONOLITH_HOOK_ACTIVE = '1';
    try {
        const input = parseHookInput(await readStdin());
        if (sub === 'pre-compact') {
            const text = handlePreCompact(cwd);
            if (text !== null)
                console.log(text);
            return 0;
        }
        const out = sub === 'session-start' ? handleSessionStart(cwd) : handleStop(cwd, input);
        if (out !== null)
            console.log(JSON.stringify(out));
    }
    catch {
        console.log(JSON.stringify({ systemMessage: 'MONOLITH hook failed safely; no action taken.' }));
    }
    return 0;
}
