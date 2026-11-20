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
import type { GovernanceReport } from '../governance/types.js';
export declare const HOOK_USAGE = "Usage: monolith hook session-start | stop | pre-compact | print-config";
export declare const MAX_STDIN_BYTES: number;
export interface HookInput {
    hook_event_name?: string;
    trigger?: string;
    stop_hook_active?: boolean;
    source?: string;
}
export declare function parseHookInput(raw: string): HookInput;
/** Context lines from Core's recovery packet (host-independent logic lives in `handover/recovery.ts`). */
export declare function buildSessionContext(projectRoot: string): {
    lines: string[];
    report: GovernanceReport;
};
export declare function handleSessionStart(projectRoot: string): object;
export declare function handleStop(projectRoot: string, input: HookInput): object | null;
/**
 * PreCompact: text for the compaction summary. Plain stdout is the only channel Claude Code documents for it
 * (`systemMessage` is discarded). It states what MONOLITH knows; it records nothing and invents nothing.
 */
export declare function handlePreCompact(projectRoot: string): string | null;
/** Opt-in settings snippet. `|| true` and `command -v` keep a missing CLI from breaking the session. */
export declare function hookConfigSnippet(): string;
export declare function runHookCommand(args: string[], cwd?: string): Promise<number>;
//# sourceMappingURL=index.d.ts.map