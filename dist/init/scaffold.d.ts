import type { ProjectConfig } from './types.js';
export interface ScaffoldResult {
    filesCreated: number;
    dirsCreated: string[];
}
/**
 * Preflight: compute every tracked template target path scaffoldInstance
 * would write, and return the ones that already exist on disk. Must be
 * called — and found empty — before scaffoldInstance runs, so a conflict
 * is caught before any file is written (no half-scaffolded instance).
 *
 * `state.json` is intentionally excluded: scaffoldInstance never overwrites
 * it (mutable Coordinatorium runtime data, ADR-008), so its presence is not
 * a conflict.
 */
export declare function planScaffoldConflicts(targetDir: string, config: ProjectConfig): string[];
export declare function scaffoldInstance(targetDir: string, config: ProjectConfig): Promise<ScaffoldResult>;
//# sourceMappingURL=scaffold.d.ts.map