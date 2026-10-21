import type { InitOptions } from './types.js';
/**
 * Thrown when `monolith init` would overwrite existing tracked files.
 * Raised strictly before any write — see planScaffoldConflicts. Carries a
 * non-zero exit via the CLI's top-level main().catch handler.
 */
export declare class InitConflictError extends Error {
    readonly conflicts: string[];
    constructor(conflicts: string[]);
}
export declare function runInit(options?: InitOptions): Promise<void>;
//# sourceMappingURL=index.d.ts.map