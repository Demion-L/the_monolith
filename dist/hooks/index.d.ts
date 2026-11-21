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
import type { GovernanceReport } from '../governance/types.js';
export declare const HOOK_USAGE = "Usage: monolith hook session-start | stop | pre-compact | pre-tool-use | status | print-config [--managed]";
export declare const HOST_AGENT = "claude-code";
export declare const MAX_STDIN_BYTES: number;
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
export declare function parseHookInput(raw: string): HookInput;
/** Context lines from Core's recovery packet (host-independent logic lives in `handover/recovery.ts`). */
export declare function buildSessionContext(projectRoot: string): {
    lines: string[];
    report: GovernanceReport;
};
export declare function handleSessionStart(projectRoot: string, extraLines?: string[]): object;
/**
 * The active story, ONLY when active.md names it unambiguously (the same single `**Story:**` line Finalize uses).
 * Anything else (no file, no section, several or malformed lines, unreadable) yields undefined: no story signal, and
 * nothing is guessed. Used so that a Story switch in the same worktree is a CONFLICT instead of a silent reuse.
 */
export declare function activeStoryIdForHook(root: string): string | undefined;
/** Facts for SessionStart / Stop: execution mode, this context's missions, other contexts' active missions. Never writes. */
export declare function buildExecutionLines(input: HookInput, cwd: string): Promise<string[]>;
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
export declare function handlePreToolUse(input: HookInput, cwd?: string): Promise<object | null>;
export declare function handleStop(projectRoot: string, input: HookInput, managedNote?: string | null): object | null;
/**
 * PreCompact: text for the compaction summary. Plain stdout is the only channel Claude Code documents for it
 * (`systemMessage` is discarded). It states what MONOLITH knows; it records nothing and invents nothing.
 */
export declare function handlePreCompact(projectRoot: string, ownedIds?: string[] | null): string | null;
/** Opt-in settings snippet. `|| true` and `command -v` keep a missing CLI from breaking the session. */
export declare function hookConfigSnippet(managed?: boolean): string;
export declare function runHookCommand(args: string[], cwd?: string): Promise<number>;
//# sourceMappingURL=index.d.ts.map