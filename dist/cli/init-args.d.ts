export type InitArgsResult = {
    ok: true;
    yes: boolean;
} | {
    ok: false;
    message: string;
};
/**
 * Parses args after `monolith init`. There is no positional target-directory
 * argument — init always scaffolds process.cwd() — so any arg that isn't a
 * known flag is an explicit error, not a silently ignored no-op (see
 * LESSON-2026-0006 / TD-007: a stray positional arg was previously dropped
 * on the floor and the CLI scaffolded the current directory instead).
 */
export declare function parseInitArgs(args: string[]): InitArgsResult;
//# sourceMappingURL=init-args.d.ts.map