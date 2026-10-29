/**
 * Minimal `monolith.config.json` reader for the brief subsystem.
 *
 * Mirrors the existing `readMonolithRoot()` duplicated in
 * `src/coordinatorium/cli.ts` and `src/validate/index.ts` — same
 * "duplicate rather than couple CLI layers together" precedent. Adds one
 * new, explicit, optional field: `contextGateway.adrDirs` (DEC-CONTEXT-003 /
 * section 8 — the existing config contract had no way to name additional
 * ADR directories, so this is the minimal extension to it, not a new
 * configuration subsystem).
 *
 * Review finding F-6: a missing config file is a legitimate, silent
 * default (no project has been configured yet). A *present but corrupted*
 * config file is not the same thing and must not be masked as "healthy
 * project, defaults apply" — it is reported via CONFIG_UNREADABLE and
 * forces Completeness: INCOMPLETE, same severity model as STATE_UNREADABLE.
 * Likewise, a present-but-wrong-shape `contextGateway.adrDirs` (not an
 * array) is reported via CONFIG_ADR_DIRS_INVALID rather than silently
 * collapsing to `[]`. Non-string entries *within* an otherwise-valid array
 * are dropped with a lower-severity (warn) note — a partially-junk list is
 * a lesser problem than the field having the wrong shape entirely.
 */
import type { BriefDiagnostic } from './types.js';
export interface BriefConfig {
    monolithRoot: string;
    projectName: string;
    /**
     * ADR directories to scan, relative to targetDir. Defaults to the canonical
     * `docs/adr`; `monolith.config.json`'s `contextGateway.adrDirs` replaces
     * (does not extend) that default. No legacy directory is scanned implicitly.
     */
    adrDirs: string[];
}
/**
 * Throws RootContainmentError when `monolithRoot` violates the SEC-001A
 * containment policy (see src/root) — the brief never degrades to a default
 * root in that case.
 */
export declare function readBriefConfig(targetDir: string, diagnostics?: BriefDiagnostic[]): BriefConfig;
//# sourceMappingURL=config.d.ts.map