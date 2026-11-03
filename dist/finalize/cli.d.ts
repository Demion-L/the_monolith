/**
 * `monolith finalize plan|apply` (DOCSYNC-001, ADR-022).
 *
 * `plan` is read-only. `apply` writes only with `--approve <digest>` taken from
 * a `plan` the owner reviewed. Exit codes: 0 ok / already finalized; 1 usage or
 * unreadable proposal; 2 not ready / refused (nothing written); 3 incomplete
 * (partially applied — see the output).
 */
export declare function runFinalizeCommand(args: string[], targetDir?: string): Promise<number>;
//# sourceMappingURL=cli.d.ts.map