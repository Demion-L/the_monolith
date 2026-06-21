export interface ProjectConfig {
    projectName: string;
    language: 'typescript' | 'javascript' | 'python' | 'other';
    packageManager: 'pnpm' | 'npm' | 'yarn' | 'other';
    aiTool: 'claude' | 'cursor' | 'windsurf' | 'other';
    finalizationProtocol: string;
    protocols: string[];
    monolithRoot: string;
}
export interface InitOptions {
    targetDir: string;
    yes?: boolean;
}
//# sourceMappingURL=types.d.ts.map