/**
 * What MONOLITH can honestly say about Managed Execution for a project (read-only, host-neutral inputs).
 *
 * It never claims that enforcement "works": it reports the configured mode and whether the project's own Claude Code
 * settings contain the PreToolUse hook. User-level (global) settings are NOT inspected, so a missing project hook is
 * reported as "not found in project settings", never as proof that no hook exists anywhere.
 */
import { type ExecutionConfig } from '../coordinatorium/execution-config.js';
export type HookInstallation = 'found' | 'not-found' | 'unreadable' | 'not-applicable';
export interface ExecutionStatus {
    config: ExecutionConfig;
    hook: {
        installation: HookInstallation;
        where: string | null;
        note: string;
    };
    /** One-line honest summary for humans. */
    enforcement: 'inactive-off' | 'configured-hook-found' | 'configured-hook-not-found' | 'config-problem';
    summary: string;
}
export declare function findPreToolUseHook(projectRoot: string): ExecutionStatus['hook'];
export declare function buildExecutionStatus(projectRoot: string): ExecutionStatus;
//# sourceMappingURL=execution-status.d.ts.map