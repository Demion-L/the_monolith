/**
 * `monolith mission ...` command handlers.
 *
 * Thin layer: parses flags, resolves the instance's state directory, calls
 * into mission.ts, and formats output. All lifecycle/validation logic lives
 * in mission.ts.
 */
import { SafeWriteError } from '../root/index.js';
import { LockCreationError } from './errors.js';
/**
 * A write whose outcome is UNKNOWN (SEC-001B.2) was NOT retried and nothing was
 * cleaned up. The wrapper keeps the machine-readable fields of the original
 * error (`code`, `publication`, `phase`, `path`) and the error itself as
 * `cause`; only the message gains guidance, which depends on WHAT is unknown:
 *
 *  - `state`: `state.json` may or may not have been replaced. Look at the
 *    missions before repeating a command that is not idempotent (a second
 *    `start` would register a second mission).
 *  - `lock`: it is the creation of the lock file that is unknown; no state was
 *    written. The mission list says nothing about it — inspect the lock and its
 *    staging files, and remove nothing while another command may be running.
 */
export declare class UnknownWriteOutcomeError extends Error {
    readonly code: string;
    readonly publication: "UNKNOWN";
    readonly phase: string;
    readonly path: string;
    readonly subject: 'state' | 'lock';
    readonly cause: unknown;
    constructor(original: SafeWriteError | LockCreationError);
}
export declare function withWriteGuidance<T>(run: () => Promise<T>): Promise<T>;
export declare function runMissionStart(args: string[], targetDir?: string): Promise<void>;
export declare function runMissionList(_args: string[], targetDir?: string): Promise<void>;
export declare function runMissionShow(args: string[], targetDir?: string): Promise<void>;
export declare function runMissionCheckpoint(args: string[], targetDir?: string): Promise<void>;
export declare function runMissionCheckpoints(args: string[], targetDir?: string): Promise<void>;
export declare function runMissionFinish(args: string[], targetDir?: string): Promise<void>;
//# sourceMappingURL=cli.d.ts.map