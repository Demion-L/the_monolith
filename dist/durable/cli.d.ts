/**
 * `monolith durable ...` — read-mostly operator commands over the durable store
 * of the current MONOLITH instance (`<monolithRoot>/durable`).
 *
 *   monolith durable list [--status active|completed|failed|cancelled]
 *   monolith durable show <taskId> [--reveal-tokens]
 *   monolith durable assess <taskId>
 *   monolith durable packet <taskId> [--reveal-tokens]
 *   monolith durable verify [taskId]
 *   monolith durable retention --retain-days N [--compact-after N] [--apply]
 *
 * Output is JSON so it can be piped. Nothing here creates, claims or edits a
 * task: tasks are driven by application code through `DurableTasks`. The only
 * mutating command is `retention --apply`; without `--apply` it only reports.
 */
import { DurableTasks } from './runtime.js';
export declare const DURABLE_DIR_NAME = "durable";
export interface CliIo {
    cwd: string;
    out: (s: string) => void;
    err: (s: string) => void;
}
export declare function openDurable(cwd: string): DurableTasks;
/** Returns the process exit code: 0 ok, 1 usage/error, 2 verification found a problem. */
export declare function runDurable(args: string[], io: CliIo): Promise<number>;
export declare function runDurableCommand(args: string[]): Promise<void>;
//# sourceMappingURL=cli.d.ts.map