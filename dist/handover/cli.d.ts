/**
 * `monolith handover check [--json] [--strict]` and `monolith evidence run|report|list`
 * (ACCOUNTABILITY-001).
 *
 * `handover check` is read-only: it writes nothing, runs no test, needs no LLM or network.
 * `evidence run` executes ONE command given as argv (no shell) and records its exit status; `evidence report`
 * records somebody's statement as REPORTED. Only those two commands write, and only a new file under the
 * verification directory. They never finalize, close missions or touch any document.
 *
 * Exit codes — handover check: 0 ran, 1 usage, 2 --strict and status is not READY_FOR_REVIEW, 3 could not run.
 * evidence run: the command's own exit code when it ran (so it can gate a script), 1 usage/refusal, 3 internal.
 */
import type { HandoverReport } from './types.js';
export declare const HANDOVER_USAGE = "Usage: monolith handover check [--json] [--strict]";
export declare const EVIDENCE_USAGE: string;
export type HandoverArgs = {
    ok: true;
    json: boolean;
    strict: boolean;
} | {
    ok: false;
    message: string;
};
export declare function parseHandoverArgs(args: string[]): HandoverArgs;
export declare function renderHandoverReport(r: HandoverReport, color?: boolean): string;
export declare function runHandoverCommand(args: string[], cwd?: string): Promise<number>;
export declare function runEvidenceCommand(args: string[], cwd?: string): Promise<number>;
//# sourceMappingURL=cli.d.ts.map