import type { ProjectConfig } from './types.js';
import { type WriteWarning } from '../root/index.js';
export interface ScaffoldResult {
    filesCreated: number;
    dirsCreated: string[];
    /** Non-fatal write findings (e.g. best-effort platform). */
    warnings: WriteWarning[];
}
/**
 * Preflight: compute every tracked template target path scaffoldInstance
 * would write, and return the ones that already exist on disk — or that cannot
 * be written safely (a symlink, including a dangling one, at the target or in
 * a parent component; a FIFO or other special file). Must be called — and
 * found empty — before scaffoldInstance runs, so a conflict is caught before
 * any file is written (no half-scaffolded instance). This is advice for a
 * clean error message; the exclusive creation in scaffoldInstance is the
 * authoritative check.
 *
 * `state.json` is intentionally excluded when it is a regular file:
 * scaffoldInstance never overwrites it (mutable Coordinatorium runtime data,
 * ADR-008), so its presence is not a conflict. A symlink there still is.
 */
export declare function planScaffoldConflicts(targetDir: string, config: ProjectConfig): string[];
export declare function scaffoldInstance(targetDir: string, config: ProjectConfig): Promise<ScaffoldResult>;
//# sourceMappingURL=scaffold.d.ts.map