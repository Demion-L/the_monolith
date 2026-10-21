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
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
const DEFAULT_MONOLITH_ROOT = '.monolith';
const DEFAULT_PROJECT_NAME = 'project';
function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
}
export function readBriefConfig(targetDir, diagnostics = []) {
    const defaults = { monolithRoot: DEFAULT_MONOLITH_ROOT, projectName: DEFAULT_PROJECT_NAME, extraAdrDirs: [] };
    const configPath = join(targetDir, 'monolith.config.json');
    if (!existsSync(configPath)) {
        // Absent config is a legitimate, unconfigured project — not an error.
        return defaults;
    }
    let raw;
    try {
        raw = readFileSync(configPath, 'utf8');
    }
    catch (err) {
        diagnostics.push({
            code: 'CONFIG_UNREADABLE',
            severity: 'error',
            message: `monolith.config.json exists but could not be read: ${errMsg(err)}. Proceeding with defaults.`,
        });
        return defaults;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        diagnostics.push({
            code: 'CONFIG_UNREADABLE',
            severity: 'error',
            message: `monolith.config.json is not valid JSON: ${errMsg(err)}. Proceeding with defaults.`,
        });
        return defaults;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        diagnostics.push({
            code: 'CONFIG_UNREADABLE',
            severity: 'error',
            message: 'monolith.config.json does not contain a JSON object. Proceeding with defaults.',
        });
        return defaults;
    }
    const cfg = parsed;
    const monolithRoot = typeof cfg.monolithRoot === 'string' && cfg.monolithRoot.length > 0 ? cfg.monolithRoot : DEFAULT_MONOLITH_ROOT;
    let projectName = DEFAULT_PROJECT_NAME;
    const project = cfg.project;
    if (typeof project === 'object' && project !== null && !Array.isArray(project)) {
        const name = project.name;
        if (typeof name === 'string' && name.length > 0)
            projectName = name;
    }
    let extraAdrDirs = [];
    const contextGateway = cfg.contextGateway;
    if (typeof contextGateway === 'object' && contextGateway !== null && !Array.isArray(contextGateway)) {
        const adrDirs = contextGateway.adrDirs;
        if (adrDirs !== undefined) {
            if (!Array.isArray(adrDirs)) {
                diagnostics.push({
                    code: 'CONFIG_ADR_DIRS_INVALID',
                    severity: 'error',
                    message: 'monolith.config.json#contextGateway.adrDirs is present but is not an array; ignoring it.',
                });
            }
            else {
                const stringEntries = adrDirs.filter((d) => typeof d === 'string' && d.length > 0);
                if (stringEntries.length !== adrDirs.length) {
                    diagnostics.push({
                        code: 'CONFIG_ADR_DIRS_INVALID',
                        severity: 'warn',
                        message: 'monolith.config.json#contextGateway.adrDirs contains non-string entries; they were dropped.',
                    });
                }
                extraAdrDirs = stringEntries;
            }
        }
    }
    return { monolithRoot, projectName, extraAdrDirs };
}
