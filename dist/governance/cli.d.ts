/**
 * `monolith governance check [--json] [--strict]` (GOV-EVOLUTION Phase 5).
 *
 * Read-only: writes nothing, creates no state file, never executes project code, needs no LLM.
 * Core defines the rules; this command only invokes them and prints the result.
 *
 * Exit codes (additive; `monolith validate` and `monolith brief` keep theirs):
 *   0 — the check ran. Findings are printed; they do not change the exit code unless --strict.
 *   1 — usage error.
 *   2 — --strict and at least one WARNING or ERROR was found (INFO never counts).
 *   3 — the check itself could not be executed (unexpected fault).
 */
import type { GovernanceReport } from './types.js';
export declare const GOVERNANCE_USAGE = "Usage: monolith governance check [--json] [--strict]";
export interface GovernanceArgsOk {
    ok: true;
    json: boolean;
    strict: boolean;
}
export type GovernanceArgs = GovernanceArgsOk | {
    ok: false;
    message: string;
};
export declare function parseGovernanceArgs(args: string[]): GovernanceArgs;
export declare function renderGovernanceReport(r: GovernanceReport, color?: boolean): string;
export declare function runGovernanceCommand(args: string[], cwd?: string): Promise<number>;
//# sourceMappingURL=cli.d.ts.map