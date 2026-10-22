/* eslint-disable no-console */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve, relative } from 'path';
import { pathToFileURL } from 'url';
import { resolveMonolithRoot, RootContainmentError } from '../root/index.js';
const REQUIRED_DIRS = ['memory', 'context', 'protocols', 'skills', 'governance', 'learning', 'tests'];
// Only flag variables that init is responsible for substituting.
// User-facing content placeholders (e.g. {{PLAN_TITLE}}) are intentional and must not be flagged.
const INIT_VARS = new Set([
    'PROJECT_NAME', 'LANGUAGE', 'PACKAGE_MANAGER', 'AI_TOOL',
    'MONOLITH_ROOT', 'FINALIZATION_PROTOCOL', 'PROTOCOLS_JSON',
    'MISTAKE_ROOTS_JSON', 'DRIFT_LOG_PATH',
]);
const INIT_PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;
const COL_WIDTH = 16;
async function checkConfiguration(targetDir) {
    const configPath = join(targetDir, 'monolith.config.json');
    if (!existsSync(configPath)) {
        return { label: 'Configuration', passed: false, error: 'missing monolith.config.json' };
    }
    const defPath = join(targetDir, 'project.definition.mjs');
    if (!existsSync(defPath)) {
        return { label: 'Configuration', passed: false, error: 'missing project.definition.mjs' };
    }
    try {
        const raw = readFileSync(configPath, 'utf8');
        const cfg = JSON.parse(raw);
        if (!Object.prototype.hasOwnProperty.call(cfg, 'monolithRoot')) {
            return { label: 'Configuration', passed: false, error: 'monolith.config.json missing monolithRoot field' };
        }
        resolveMonolithRoot(targetDir, { status: 'ok', cfg });
    }
    catch (err) {
        if (err instanceof RootContainmentError) {
            return { label: 'Configuration', passed: false, error: err.message };
        }
        return { label: 'Configuration', passed: false, error: 'monolith.config.json is not valid JSON' };
    }
    try {
        const fileUrl = pathToFileURL(resolve(defPath)).href;
        const mod = await import(fileUrl);
        if (!mod.PROJECT_DEFINITION) {
            return { label: 'Configuration', passed: false, error: 'project.definition.mjs missing PROJECT_DEFINITION export' };
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { label: 'Configuration', passed: false, error: `project.definition.mjs failed to load: ${msg}` };
    }
    return { label: 'Configuration', passed: true };
}
function checkInstance(targetDir, monolithRoot) {
    const instanceDir = join(targetDir, monolithRoot);
    if (!existsSync(instanceDir)) {
        return { label: 'Instance', passed: false, error: `missing ${monolithRoot}/` };
    }
    for (const dir of REQUIRED_DIRS) {
        if (!existsSync(join(instanceDir, dir))) {
            return { label: 'Instance', passed: false, error: `missing ${monolithRoot}/${dir}/` };
        }
    }
    return { label: 'Instance', passed: true };
}
function walkFiles(dir) {
    const results = [];
    if (!existsSync(dir))
        return results;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
            continue; // never follow links out of the instance (SEC-001A)
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkFiles(full));
        }
        else {
            results.push(full);
        }
    }
    return results;
}
function hasUnreplacedInitVars(content) {
    let match;
    INIT_PLACEHOLDER_RE.lastIndex = 0;
    while ((match = INIT_PLACEHOLDER_RE.exec(content)) !== null) {
        if (INIT_VARS.has(match[1]))
            return true;
    }
    return false;
}
function checkTemplates(targetDir, monolithRoot) {
    const violations = [];
    const instanceDir = join(targetDir, monolithRoot);
    for (const file of walkFiles(instanceDir)) {
        if (file.endsWith('.gitkeep'))
            continue;
        try {
            const content = readFileSync(file, 'utf8');
            if (hasUnreplacedInitVars(content)) {
                violations.push(relative(targetDir, file));
            }
        }
        catch {
            // binary or unreadable — skip
        }
    }
    for (const rootFile of ['project.definition.mjs', 'monolith.config.json', 'AGENTS.md']) {
        const filePath = join(targetDir, rootFile);
        if (!existsSync(filePath))
            continue;
        try {
            const content = readFileSync(filePath, 'utf8');
            if (hasUnreplacedInitVars(content)) {
                violations.push(rootFile);
            }
        }
        catch {
            // skip
        }
    }
    if (violations.length > 0) {
        return {
            label: 'Templates',
            passed: false,
            error: `unreplaced placeholders in ${violations.length} file(s): ${violations.slice(0, 3).join(', ')}${violations.length > 3 ? ` (+${violations.length - 3} more)` : ''}`,
        };
    }
    return { label: 'Templates', passed: true };
}
function formatRow(result) {
    const label = result.label.padEnd(COL_WIDTH);
    const status = result.passed ? 'PASS' : 'FAIL';
    const tail = result.error ? `  ${result.error}` : '';
    return `${label}${status}${tail}`;
}
export async function runValidate(options) {
    const targetDir = resolve(options.targetDir);
    const quiet = options.quiet ?? false;
    // Containment failures are reported by checkConfiguration; the instance
    // and template checks must not touch a root that failed resolution.
    let monolithRoot = null;
    try {
        monolithRoot = resolveMonolithRoot(targetDir).monolithRoot;
    }
    catch (err) {
        if (!(err instanceof RootContainmentError))
            throw err;
    }
    const configResult = await checkConfiguration(targetDir);
    const instanceResult = monolithRoot === null
        ? { label: 'Instance', passed: false, error: 'skipped: monolithRoot failed validation' }
        : checkInstance(targetDir, monolithRoot);
    const templateResult = monolithRoot === null
        ? { label: 'Templates', passed: false, error: 'skipped: monolithRoot failed validation' }
        : checkTemplates(targetDir, monolithRoot);
    const results = [configResult, instanceResult, templateResult];
    const passed = results.every((r) => r.passed);
    if (quiet) {
        if (!passed) {
            for (const r of results) {
                if (!r.passed)
                    console.log(formatRow(r));
            }
        }
    }
    else {
        console.log('');
        console.log('MONOLITH validate');
        console.log('');
        for (const r of results) {
            console.log(formatRow(r));
        }
        console.log('');
        console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);
        console.log('');
    }
    process.exit(passed ? 0 : 1);
}
