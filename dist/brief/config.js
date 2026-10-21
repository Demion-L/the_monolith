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
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
const DEFAULT_MONOLITH_ROOT = '.monolith';
const DEFAULT_PROJECT_NAME = 'project';
function readConfigJson(targetDir) {
    const configPath = join(targetDir, 'monolith.config.json');
    if (!existsSync(configPath))
        return null;
    try {
        const raw = readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
export function readBriefConfig(targetDir) {
    const cfg = readConfigJson(targetDir);
    if (!cfg) {
        return { monolithRoot: DEFAULT_MONOLITH_ROOT, projectName: DEFAULT_PROJECT_NAME, extraAdrDirs: [] };
    }
    const monolithRoot = typeof cfg.monolithRoot === 'string' && cfg.monolithRoot.length > 0
        ? cfg.monolithRoot
        : DEFAULT_MONOLITH_ROOT;
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
        if (Array.isArray(adrDirs)) {
            extraAdrDirs = adrDirs.filter((d) => typeof d === 'string' && d.length > 0);
        }
    }
    return { monolithRoot, projectName, extraAdrDirs };
}
