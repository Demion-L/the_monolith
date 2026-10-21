/**
 * Minimal `monolith.config.json` reader for the brief subsystem.
 *
 * Mirrors the existing `readMonolithRoot()` duplicated in
 * `src/coordinatorium/cli.ts` and `src/validate/index.ts` — same
 * "duplicate rather than couple CLI layers together" precedent, same
 * defensive try/catch-to-default behavior. Adds one new, explicit,
 * optional field: `contextGateway.adrDirs` (DEC-CONTEXT-003 / section 8 —
 * the existing config contract had no way to name additional ADR
 * directories, so this is the minimal extension to it, not a new
 * configuration subsystem).
 */
export interface BriefConfig {
    monolithRoot: string;
    projectName: string;
    /**
     * Additional ADR directories to scan, relative to targetDir, beyond the
     * standard `<monolithRoot>/adr`. Empty unless explicitly configured via
     * `monolith.config.json`'s `contextGateway.adrDirs` field.
     */
    extraAdrDirs: string[];
}
export declare function readBriefConfig(targetDir: string): BriefConfig;
//# sourceMappingURL=config.d.ts.map