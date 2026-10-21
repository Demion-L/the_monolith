/**
 * `monolith brief` CLI command handler.
 *
 * stdout carries only the brief's own content; CLI diagnostics and the
 * INCOMPLETE warning go to stderr (section 12). Exit codes (DEC-CONTEXT-002):
 *   0 — brief formed (COMPLETE or INCOMPLETE)
 *   1 — CLI usage error (thrown as a plain Error, caught by src/cli/index.ts's main())
 *   2 — --strict and the result is INCOMPLETE
 */
export interface BriefArgsOk {
    ok: true;
    maxChars: number;
    strict: boolean;
}
export interface BriefArgsErr {
    ok: false;
    message: string;
}
export type BriefArgsResult = BriefArgsOk | BriefArgsErr;
export declare function parseBriefArgs(args: string[]): BriefArgsResult;
export declare function runBrief(args: string[], targetDir?: string): Promise<void>;
//# sourceMappingURL=cli.d.ts.map