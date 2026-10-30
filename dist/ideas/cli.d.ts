/**
 * `monolith idea ...` command handlers (IDEA-001A).
 *
 * Thin layer: strict flag parsing, store calls, output. No LLM, no network;
 * `add` writes exactly one new file under `<monolithRoot>/memory/long-term/ideas/` and
 * touches no other state (not `active.md`, not `state.json`); `list` and `show` write nothing.
 */
import type { Readable } from 'stream';
interface AddFlags {
    title?: string;
    description?: string;
    context?: string;
    descriptionStdin?: boolean;
}
/** Strict: every flag needs a value, none may repeat, unknown flags and stray arguments are errors. */
export declare function parseAddArgs(args: string[]): AddFlags;
/**
 * Read all of `input` as UTF-8, byte for byte (no trimming, BOM kept). Refuses
 * more than STDIN_MAX_BYTES, invalid UTF-8 and a read error; nothing is
 * interpreted. A terminal is refused instead of waiting for typed input.
 */
export declare function readStdinText(input?: Readable & {
    isTTY?: boolean;
}): Promise<string>;
export declare function runIdeaAdd(args: string[], targetDir?: string, stdin?: Readable & {
    isTTY?: boolean;
}): Promise<void>;
export declare function runIdeaList(args: string[], targetDir?: string): Promise<void>;
export declare function runIdeaShow(args: string[], targetDir?: string): Promise<void>;
/** Dispatcher used by the CLI entrypoint. */
export declare function runIdeaCommand(args: string[], targetDir?: string): Promise<void>;
export {};
//# sourceMappingURL=cli.d.ts.map