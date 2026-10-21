/**
 * `monolith mission ...` command handlers.
 *
 * Thin layer: parses flags, resolves the instance's state directory, calls
 * into mission.ts, and formats output. All lifecycle/validation logic lives
 * in mission.ts.
 */
export declare function runMissionStart(args: string[], targetDir?: string): Promise<void>;
export declare function runMissionList(_args: string[], targetDir?: string): Promise<void>;
export declare function runMissionShow(args: string[], targetDir?: string): Promise<void>;
export declare function runMissionCheckpoint(args: string[], targetDir?: string): Promise<void>;
export declare function runMissionCheckpoints(args: string[], targetDir?: string): Promise<void>;
export declare function runMissionFinish(args: string[], targetDir?: string): Promise<void>;
//# sourceMappingURL=cli.d.ts.map