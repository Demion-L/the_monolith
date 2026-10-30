/**
 * `monolith idea ...` command handlers (IDEA-001A).
 *
 * Thin layer: strict flag parsing, store calls, output. No LLM, no network;
 * `add` writes exactly one new file under `<monolithRoot>/memory/long-term/ideas/` and
 * touches no other state (not `active.md`, not `state.json`); `list` and `show` write nothing.
 */
interface AddFlags {
    title?: string;
    description?: string;
    context?: string;
}
/** Strict: every flag needs a value, none may repeat, unknown flags and stray arguments are errors. */
export declare function parseAddArgs(args: string[]): AddFlags;
export declare function runIdeaAdd(args: string[], targetDir?: string): Promise<void>;
export declare function runIdeaList(args: string[], targetDir?: string): Promise<void>;
export declare function runIdeaShow(args: string[], targetDir?: string): Promise<void>;
/** Dispatcher used by the CLI entrypoint. */
export declare function runIdeaCommand(args: string[], targetDir?: string): Promise<void>;
export {};
//# sourceMappingURL=cli.d.ts.map