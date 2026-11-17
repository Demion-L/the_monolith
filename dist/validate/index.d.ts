export interface ValidateOptions {
    targetDir: string;
    quiet?: boolean;
}
/** One static check, as the CLI and the Mission Control API both report it. */
export interface ValidationCheck {
    /** Stable machine id; `label` is the CLI display name. */
    id: 'configuration' | 'instance' | 'templates';
    label: string;
    passed: boolean;
    /** Reason for a FAIL; may name project-relative files. */
    error?: string;
    /** Printed after a PASS only. */
    note?: string;
}
export interface ValidationReport {
    checks: ValidationCheck[];
    passed: boolean;
    /** Leftover write files (SEC-001B.2). Never affects `passed`. */
    warning: string | null;
}
/**
 * The validation itself, without printing or exiting: the single definition of
 * "the project passes `monolith validate`" for the CLI and for Mission Control.
 * Read-only and static (ADR-011): it never executes project code. `targetDir`
 * must be an explicit absolute path; the cwd is never assumed.
 */
export declare function validateProject(targetDir: string): ValidationReport;
export declare function runValidate(options: ValidateOptions): Promise<void>;
//# sourceMappingURL=index.d.ts.map