import type { ProjectConfig } from './types.js';
export interface ScaffoldResult {
    filesCreated: number;
    dirsCreated: string[];
}
export declare function scaffoldInstance(targetDir: string, config: ProjectConfig): Promise<ScaffoldResult>;
//# sourceMappingURL=scaffold.d.ts.map