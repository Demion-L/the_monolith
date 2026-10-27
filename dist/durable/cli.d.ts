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
/**
 * Opens the durable store of the instance. A store without `durable-protocol.json` is open for diagnostics only: reads
 * work, every write is refused (`STORE_PROTOCOL`). Opening never creates the marker.
 */
export declare function openDurable(cwd: string): DurableTasks;
/**
 * The explicit operator action that makes an EMPTY store writable (Design A section 46.5, ADR-018 D3). Not reachable from
 * `runDurable` on purpose: it must be called by a person or script that knows no runtime of an older version is running.
 * Refuses a store that already holds tasks.
 */
export declare function initializeDurable(cwd: string): 'initialized' | 'already-initialized';
/** Returns the process exit code: 0 ok, 1 usage/error, 2 verification found a problem. */
export declare function runDurable(args: string[], io: CliIo): Promise<number>;
export declare function runDurableCommand(args: string[]): Promise<void>;
//# sourceMappingURL=cli.d.ts.map